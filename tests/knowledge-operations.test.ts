import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';
import { retainHistory } from '../scripts/retention.js';

const website = 'http://127.0.0.1:4411';
test('knowledge previews, retrieval evaluation, request capacities and metrics are scoped and truthful', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-knowledge-')), origins = new Set<string>(); let infer = 0;
  const core = createApp({ dataDir: dir, testing: true, adminOrigins: origins, limits: { dailyRuns: 1, activeSessions: 1 }, provider: { status: async () => ({ provider: 'codex', authenticated: true, available: true, message: 'Explicit test provider' }), infer: async () => { infer++; return JSON.stringify({ answer: 'Use billing export.', steps: [], action: null, citationIds: [] }); }, close: async () => {} } });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  const owner = core.repo.register({ email: 'knowledge@example.invalid', name: 'Knowledge owner', companyName: 'Knowledge' }, 'test-hash');
  const foreign = core.repo.register({ email: 'foreign@example.invalid', name: 'Other owner', companyName: 'Other' }, 'test-hash');
  function cookie(userId: string) { const id = `test_${userId}`, expires = Date.now() + 60000; core.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run(id, JSON.stringify({ userId, cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires); const signature = createHmac('sha256', core.repo.sessionSecret).update(id).digest('base64').replace(/=+$/, ''); return `gk.sid=${encodeURIComponent(`s:${id}.${signature}`)}`; }
  const ownerCookie = cookie(owner.user.id), otherCookie = cookie(foreign.user.id);
  async function request(path: string, body?: unknown, token?: string, other = false) { const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: token ? website : base, Cookie: other ? otherCookie : ownerCookie, Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() as any }; }
  try {
    const agent = core.repo.createAgent(owner.tenant.id, { name: 'Knowledge guide', companyName: 'Knowledge', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] });
    const doc = core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Billing guide', content: 'Billing invoices can be exported as CSV.' });
    assert.throws(() => core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Duplicate', content: 'Billing invoices can be exported as CSV.\r\n' }), /already in/);
    core.repo.publish(owner.tenant.id, agent.id);
    const preview = await request(`/api/agents/${agent.id}/knowledge-preview`, { question: 'billing invoice' }); assert.equal(preview.status, 200); assert.equal(preview.data.sufficient, true); assert.equal(preview.data.citations[0].documentId, doc.id); assert.equal(infer, 0);
    assert.equal((await request(`/api/agents/${agent.id}/knowledge-preview`, { question: 'zebraless' })).data.sufficient, false);
    assert.equal((await request(`/api/agents/${agent.id}/knowledge-preview`, { question: 'billing' }, undefined, true)).status, 404);
    const evaluation = await request(`/api/agents/${agent.id}/knowledge-evaluate`, { cases: [{ question: 'billing invoice', expectedDocumentIds: [doc.id] }, { question: 'zebraless', expectedDocumentIds: [doc.id] }] });
    assert.equal(evaluation.data.meanRecall, 0.5); assert.equal(evaluation.data.meanReciprocalRank, 0.5); assert.equal(infer, 0);
    assert.equal((await request(`/api/agents/${agent.id}/knowledge-evaluate`, { cases: [{ question: 'billing', expectedDocumentIds: ['foreign_doc'] }] })).status, 400);
    const session = await request(`/api/embed/${agent.id}/session`, {}); // Origin below must match the installed website.
    assert.equal(session.status, 403);
    const start = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}' }); const token = (await start.json() as any).token; assert.equal(start.status, 200);
    const capacity = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(capacity.status, 429);
    const page = { url: `${website}/`, title: 'Test', targets: [], actions: [], context: {} }, body = { message: 'billing', requestId: 'request_one', page };
    assert.equal((await request('/api/embed/session/ask', body, token)).status, 200); assert.equal((await request('/api/embed/session/ask', body, token)).status, 200); assert.equal(infer, 1);
    assert.equal((await request('/api/embed/session/ask', { ...body, page: { ...page, title: 'Different page' } }, token)).status, 409);
    assert.equal((await request('/api/embed/session/ask', { ...body, requestId: 'request_two' }, token)).status, 429);
    const metrics = await request(`/api/agents/${agent.id}/metrics`); assert.equal(metrics.data.workspaceUsage.remaining, 0); assert.equal(metrics.data.statuses[0].count, 1); assert.equal(typeof metrics.data.statuses[0].averageDurationMs, 'number'); assert.ok(!JSON.stringify(metrics.data).includes('Use billing export.'));
    assert.equal((await request(`/api/agents/${agent.id}/metrics`, undefined, undefined, true)).status, 404); assert.equal((await request('/ready')).status, 200);
    const old = new Date(Date.now() - 40 * 86400000).toISOString(); core.repo.db.prepare('UPDATE runs SET created_at=?').run(old); core.repo.db.prepare('UPDATE embed_sessions SET expires=?').run(Date.now() - 2 * 86400000);
    const previewRetention = retainHistory(core.repo, 30); assert.equal(previewRetention.applied, false); assert.equal(previewRetention.eligibleRuns, 1); assert.equal(core.repo.rows('SELECT id FROM runs').length, 1);
    const deleted = retainHistory(core.repo, 30, true); assert.equal(deleted.eligibleRuns, 1); assert.equal(core.repo.rows('SELECT id FROM runs').length, 0); assert.equal(core.repo.published(agent.id).documents[0]!.content, doc.content); assert.ok(core.repo.workspace(owner.user.id));
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(dir, { recursive: true, force: true }); }
});
