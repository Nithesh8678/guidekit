import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';
import { retainHistoryAsync } from '../scripts/retention.js';

const website = 'http://127.0.0.1:4411';
test('knowledge previews, retrieval evaluation, request capacities and metrics are scoped and truthful', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-knowledge-')), origins = new Set<string>(); let infer = 0;
  const core = (await createApp({ dataDir: dir, testing: true, adminOrigins: origins, limits: { dailyRuns: 1, activeSessions: 1 }, provider: { status: async () => ({ provider: 'codex', authenticated: true, available: true, message: 'Explicit test provider' }), infer: async () => { infer++; return JSON.stringify({ answer: 'Use billing export.', steps: [], action: null, citationIds: [] }); }, close: async () => {} } }));
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  const owner = (await core.repo.register({ email: 'knowledge@example.invalid', name: 'Knowledge owner', companyName: 'Knowledge' }, 'test-hash'));
  const foreign = (await core.repo.register({ email: 'foreign@example.invalid', name: 'Other owner', companyName: 'Other' }, 'test-hash'));
  async function cookie(userId: string) { const id = `test_${userId}`, expires = Date.now() + 60000; (await core.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run(id, JSON.stringify({ userId, cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires)); const signature = createHmac('sha256', core.repo.sessionSecret).update(id).digest('base64').replace(/=+$/, ''); return `gk.sid=${encodeURIComponent(`s:${id}.${signature}`)}`; }
  const ownerCookie = await cookie(owner.user.id), otherCookie = await cookie(foreign.user.id);
  async function request(path: string, body?: unknown, token?: string, other = false) { const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: token ? website : base, Cookie: other ? otherCookie : ownerCookie, Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() as any }; }
  try {
    const agent = (await core.repo.createAgent(owner.tenant.id, { name: 'Knowledge guide', companyName: 'Knowledge', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] }));
    const doc = (await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Billing guide', content: 'Billing invoices can be exported as CSV.' }));
    await assert.rejects(async () => (await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Duplicate', content: 'Billing invoices can be exported as CSV.\r\n' })), /already in/);
    (await core.repo.publish(owner.tenant.id, agent.id));
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
    const old = new Date(Date.now() - 40 * 86400000).toISOString(); (await core.repo.db.prepare('UPDATE runs SET created_at=?').run(old)); (await core.repo.db.prepare('UPDATE embed_sessions SET expires=?').run(Date.now() - 2 * 86400000));
    const previewRetention = await retainHistoryAsync(core.repo, 30); assert.equal(previewRetention.applied, false); assert.equal(previewRetention.eligibleRuns, 1); assert.equal((await core.repo.rows('SELECT id FROM runs')).length, 1);
    const deleted = await retainHistoryAsync(core.repo, 30, true); assert.equal(deleted.eligibleRuns, 1); assert.equal((await core.repo.rows('SELECT id FROM runs')).length, 0); assert.equal((await core.repo.published(agent.id)).documents[0]!.content, doc.content); assert.ok((await core.repo.workspace(owner.user.id)));
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(dir, { recursive: true, force: true }); }
});

test('PostgreSQL knowledge selection preserves snapshot sources and validates provider evidence before inference', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-provider-')), origins = new Set<string>();
  const snapshots = new Map<number, { tenantId: string; agentId: string; version: number; documents: Array<{ id: string; title: string; content: string }> }>();
  let fail = false, forged = false, infer = 0, retrievals = 0, citedId = '';
  const knowledge = {
    id: 'postgres' as const,
    status: async () => ({ source: 'postgres' as const, configured: true, connected: !fail, mode: 'hybrid', message: 'Explicit synthetic PostgreSQL provider.' }),
    syncVersion: async (snapshot: { tenantId: string; agentId: string; version: number; documents: Array<{ id: string; title: string; content: string }> }) => { if (fail) throw new Error('private connection detail'); snapshots.set(snapshot.version, structuredClone(snapshot)); return { chunks: snapshot.documents.length }; },
    retrieve: async (scope: { tenantId: string; agentId: string; version: number }) => {
      retrievals++; if (fail) throw new Error('private connection detail');
      const snapshot = snapshots.get(scope.version)!;
      assert.equal(scope.tenantId, snapshot.tenantId); assert.equal(scope.agentId, snapshot.agentId);
      return { source: 'postgres' as const, citations: snapshot.documents.flatMap(document => document.content.split(/(?<=\.) /).map(excerpt => ({ documentId: document.id, title: document.title, excerpt: forged ? 'Fabricated text outside the saved source.' : excerpt }))), paths: [] };
    }
  };
  const core = await createApp({ dataDir: dir, testing: true, knowledge, adminOrigins: origins, provider: { status: async () => ({ provider: 'codex', authenticated: true, available: true, message: 'Explicit test provider' }), infer: async () => { infer++; return JSON.stringify({ answer: 'Use billing export.', steps: [], action: null, citationIds: [citedId] }); }, close: async () => {} } });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  try {
    const owner = await core.repo.register({ email: 'provider@example.invalid', name: 'Provider owner', companyName: 'Provider' }, 'synthetic-no-login-hash');
    const agent = await core.repo.createAgent(owner.tenant.id, { name: 'Provider guide', companyName: 'Provider', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] });
    const document = await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Billing', content: 'Billing invoices support CSV export. Export history is retained for thirty days.' }); citedId = document.id;
    await core.repo.publish(owner.tenant.id, agent.id);
    const sid = 'provider_fixture', expires = Date.now() + 60000;
    await core.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run(sid, JSON.stringify({ userId: owner.user.id, cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires);
    const signature = createHmac('sha256', core.repo.sessionSecret).update(sid).digest('base64').replace(/=+$/, '');
    const cookie = `gk.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
    const request = async (path: string, body?: unknown, token?: string) => {
      const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: token ? website : base, Cookie: cookie, Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() as any };
    };
    await t.test('a local snapshot remains local after a different provider is configured', async () => {
      const preview = await request(`/api/agents/${agent.id}/knowledge-preview`, { question: 'billing export', version: 1 });
      assert.equal(preview.status, 200); assert.equal(preview.data.knowledge.source, 'local'); assert.equal(retrievals, 0);
      const local = await request(`/api/agents/${agent.id}/knowledge-sync`, { version: 1 }); assert.equal(local.status, 200); assert.equal(local.data.source, 'local'); assert.equal(snapshots.size, 0);
    });
    await t.test('new PostgreSQL publications prepare immutable evidence and expose generic integration status', async () => {
      const publication = await request(`/api/agents/${agent.id}/publish`, {});
      assert.equal(publication.status, 201); assert.equal(publication.data.version.graphSource, 'postgres'); assert.equal(publication.data.activeVersion, 2); assert.equal(publication.data.chunks, 1);
      const integrations = await request(`/api/agents/${agent.id}/integrations`);
      assert.equal(integrations.data.knowledge.source, 'postgres'); assert.equal(integrations.data.knowledge.mode, 'hybrid'); assert.equal(integrations.data.tigergraph.configured, false);
      const preview = await request(`/api/agents/${agent.id}/knowledge-preview`, { question: 'billing export' });
      assert.equal(preview.data.knowledge.source, 'postgres'); assert.equal(preview.data.citations[0].documentId, document.id);
      await core.repo.updateDocument(owner.tenant.id, agent.id, document.id, { title: 'Draft', content: 'Unpublished text must not enter the saved PostgreSQL snapshot.' });
      const saved = await request(`/api/agents/${agent.id}/knowledge-sync`, { version: 2 }); assert.equal(saved.status, 200); assert.equal(snapshots.get(2)!.documents[0]!.content, document.content);
    });
    const started = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}' }); const token = (await started.json() as any).token;
    const page = { url: `${website}/`, title: 'Test', targets: [], actions: [], context: {} };
    await t.test('a cited document preserves distinct source excerpts for a multi-part answer', async () => {
      const answer = await request('/api/embed/session/ask', { message: 'billing export history', requestId: 'multiple_excerpts', page }, token);
      assert.equal(answer.status, 200); assert.deepEqual(answer.data.citations.map((citation: { excerpt: string }) => citation.excerpt), ['Billing invoices support CSV export.', 'Export history is retained for thirty days.']);
      assert.ok(answer.data.citations.every((citation: { documentId: string }) => citation.documentId === document.id));
    });
    await t.test('forged citations and outages fail closed without local or model fallback', async () => {
      const before = infer; forged = true;
      const answer = await request('/api/embed/session/ask', { message: 'billing', requestId: 'forged_evidence', page }, token); assert.equal(answer.status, 502); assert.match(answer.data.error, /outside this published knowledge snapshot/); assert.equal(infer, before);
      forged = false; fail = true;
      const unavailable = await request('/api/embed/session/ask', { message: 'billing', requestId: 'unavailable_evidence', page }, token); assert.equal(unavailable.status, 502); assert.match(unavailable.data.error, /PostgreSQL/); assert.doesNotMatch(unavailable.data.error, /private connection/); assert.equal(infer, before);
      const failedCandidate = await request(`/api/agents/${agent.id}/publish`, {}); assert.equal(failedCandidate.data.version.status, 'failed'); assert.equal(failedCandidate.data.activeVersion, 2); assert.equal((await request('/ready')).status, 503);
      fail = false;
      const retry = await request(`/api/agents/${agent.id}/versions/3/retry`, {}); assert.equal(retry.data.version.status, 'ready'); assert.equal(retry.data.activeVersion, 3); assert.equal((await request('/ready')).status, 200);
    });
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(dir, { recursive: true, force: true }); }
});
