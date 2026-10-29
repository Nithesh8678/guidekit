import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { createApp, type InferenceProvider } from '../apps/server/src/app.js';

test('real HTTP core: tenancy, publishing, retrieval, actions, and private runtime boundaries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-core-'));
  let calls = 0, lastPrompt = '', nextPlan: Record<string, unknown> = { answer: 'Use Create contact to add a person.', steps: [{ targetId: 'create-contact', text: 'Choose Create contact.' }], action: null, citationIds: [] };
  const provider: InferenceProvider = {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit isolated test provider.' }),
    infer: async input => { calls++; lastPrompt = input.prompt; return JSON.stringify(nextPlan); }, close: async () => {}
  };
  const origins = new Set<string>();
  const core = createApp({ dataDir: directory, provider, adminOrigins: origins, testing: true });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  const website = 'http://127.0.0.1:4411', otherWebsite = 'http://127.0.0.1:4412';
  async function request(path: string, options: { method?: string; cookie?: string; origin?: string; token?: string; body?: unknown; host?: string } = {}) {
    const headers: Record<string, string> = { Origin: options.origin ?? base };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.host) headers.Host = options.host;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const data = await res.json() as any;
    return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
  }
  let cookieA = '', cookieB = '', agentId = '', docId = '', token = '', runId = '', receiptId = '';
  const config = { name: 'Northstar guide', companyName: 'Northstar', description: 'CRM assistance', instructions: 'Use our published guide.', greeting: 'What would you like to do?', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: ['create_contact'] };
  const page = { url: `${website}/`, title: 'Northstar CRM', targets: [{ id: 'create-contact', label: 'Create contact', role: 'button' }], context: {}, actions: [{ name: 'create_contact', description: 'Create a contact', requiresConfirmation: true, inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'company', 'status'], properties: { name: { type: 'string' }, company: { type: 'string' }, status: { type: 'string', enum: ['New', 'Qualified'] } } } }] };
  const ask = (message: string, requestId: string) => request('/api/embed/session/ask', { token, origin: website, body: { message, page, requestId } });
  try {
    await t.test('registration uses private, persistent sessions; no pre-created account', async () => {
      assert.equal((await request('/api/auth/me')).data.workspace, null);
      const a = await request('/api/auth/register', { body: { email: 'owner-a@example.invalid', name: 'Owner A', companyName: 'Company A', password: 'a-long-test-password-A' } });
      assert.equal(a.status, 201); assert.ok(a.cookie); cookieA = a.cookie!;
      assert.match(a.headers.get('set-cookie')!, /HttpOnly/); assert.match(a.headers.get('set-cookie')!, /SameSite=Strict/i);
      const b = await request('/api/auth/register', { body: { email: 'owner-b@example.invalid', name: 'Owner B', companyName: 'Company B', password: 'a-long-test-password-B' } });
      assert.equal(b.status, 201); cookieB = b.cookie!;
      assert.notEqual(a.data.workspace.tenant.id, b.data.workspace.tenant.id);
    });
    await t.test('rejects unauthenticated requests, foreign origins and DNS rebinding', async () => {
      assert.equal((await request('/api/agents')).status, 401);
      assert.equal((await request('/api/agents', { cookie: cookieA, origin: 'https://attacker.invalid', body: config })).status, 403);
      const rebindingStatus = await new Promise<number>(accept => {
        const attack = httpRequest(`${base}/health`, { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); accept(response.statusCode!); }); attack.end();
      });
      assert.equal(rebindingStatus, 403);
      const noOrigin = await fetch(`${base}/api/agents`, { method: 'POST', headers: { Cookie: cookieA, 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      assert.equal(noOrigin.status, 403);
    });
    await t.test('creates tenant-scoped agent and never shares its draft with embeds', async () => {
      const created = await request('/api/agents', { cookie: cookieA, body: config }); assert.equal(created.status, 201); agentId = created.data.agent.id;
      assert.equal((await request(`/api/agents/${agentId}`, { cookie: cookieB })).status, 404);
      assert.equal((await request('/api/agents', { cookie: cookieB })).data.agents.length, 0);
      assert.equal((await request(`/api/agents/${agentId}`, { method: 'PUT', cookie: cookieB, body: config })).status, 404);
      assert.equal((await request(`/api/embed/${agentId}/session`, { origin: website, body: {} })).status, 404);
    });
    await t.test('validates knowledge size, ownership and publication requirements', async () => {
      assert.equal((await request(`/api/agents/${agentId}/publish`, { cookie: cookieA, body: {} })).status, 400);
      assert.equal((await request(`/api/agents/${agentId}/documents`, { cookie: cookieB, body: { title: 'Wrong tenant', content: 'Should not appear.' } })).status, 404);
      assert.equal((await request(`/api/agents/${agentId}/documents`, { cookie: cookieA, body: { title: 'Too large', content: 'x'.repeat(262145) } })).status, 400);
      const doc = await request(`/api/agents/${agentId}/documents`, { cookie: cookieA, body: { title: 'Contact handbook', content: 'To create a contact, enter their name and company, choose New, Qualified or Customer, then select Create contact. Northstar’s trial lasts 17 days.' } });
      assert.equal(doc.status, 201); docId = doc.data.document.id;
      const published = await request(`/api/agents/${agentId}/publish`, { cookie: cookieA, body: {} }); assert.equal(published.status, 201); assert.equal(published.data.version.number, 1);
    });
    await t.test('enforces exact published origins and returns scoped expiring credentials', async () => {
      assert.equal((await request(`/api/embed/${agentId}/session`, { origin: otherWebsite, body: {} })).status, 403);
      const started = await request(`/api/embed/${agentId}/session`, { origin: website, body: {} }); assert.equal(started.status, 200); token = started.data.token;
      assert.ok(started.data.expiresAt > Date.now()); assert.equal(started.data.agent.version, 1);
      assert.equal(started.headers.get('access-control-allow-origin'), website);
      assert.equal(started.data.agent.instructions, undefined); assert.equal(started.data.documents, undefined);
      assert.equal((await request('/api/embed/session/ask', { origin: otherWebsite, token, body: { message: 'Help', page: { ...page, url: `${otherWebsite}/` }, requestId: 'wrong_origin' } })).status, 403);
    });
    await t.test('retrieves only published company knowledge and validates live targets', async () => {
      nextPlan = { answer: 'The trial lasts 17 days.', steps: [{ targetId: 'create-contact', text: 'Select Create contact.' }], action: null, citationIds: [docId] };
      const answer = await ask('What is the Northstar trial duration and how do I create a contact?', 'ask_1'); assert.equal(answer.status, 200); runId = answer.data.runId;
      assert.equal(answer.data.citations[0]?.documentId, docId); assert.match(lastPrompt, /17 days/); assert.equal(answer.data.provider, 'codex');
      assert.equal((await ask('Different question', 'ask_1')).status, 409);
      const before = calls; const replay = await ask('What is the Northstar trial duration and how do I create a contact?', 'ask_1'); assert.equal(replay.data.runId, runId); assert.equal(calls, before);
    });
    await t.test('blocks fabricated targets and unregistered actions', async () => {
      nextPlan = { answer: 'Follow this.', steps: [{ targetId: 'invented', text: 'Click an invented control.' }], action: null, citationIds: [] };
      assert.equal((await ask('Guide me', 'bad_target')).status, 502);
      nextPlan = { answer: 'I can propose this.', steps: [], action: { name: 'delete_everything', argumentsJson: '{}', reason: 'Should be rejected.' }, citationIds: [] };
      assert.equal((await ask('Delete everything', 'bad_action')).status, 502);
    });
    await t.test('blocks invalid action arguments before creating a receipt', async () => {
      nextPlan = { answer: 'I can propose a contact.', steps: [], action: { name: 'create_contact', argumentsJson: '{"name":42}', reason: 'Create contact.' }, citationIds: [] };
      assert.equal((await ask('Create a contact', 'bad_args')).status, 502);
    });
    await t.test('proposes a validated action and records no success before confirmation', async () => {
      nextPlan = { answer: 'Review the contact before creating it.', steps: [], action: { name: 'create_contact', argumentsJson: JSON.stringify({ name: 'Jamie Rivera', company: 'Acme Studio', status: 'New' }), reason: 'You asked to add this contact.' }, citationIds: [docId] };
      const answer = await ask('Create Jamie Rivera at Acme Studio', 'create_1'); assert.equal(answer.status, 200); receiptId = answer.data.action.receiptId;
      assert.equal(answer.data.action.requiresConfirmation, true);
      const detail = await request(`/api/agents/${agentId}`, { cookie: cookieA }); assert.equal(detail.data.sessions.find((r: any) => r.id === answer.data.runId).status, 'awaiting_confirmation');
    });
    await t.test('receipts are session-bound, final, and replay-safe', async () => {
      const another = await request(`/api/embed/${agentId}/session`, { origin: website, body: {} });
      const body = { receiptId, status: 'succeeded', message: 'Host verified a saved contact.' };
      assert.equal((await request('/api/embed/session/action-result', { origin: website, token: another.data.token, body })).status, 404);
      assert.equal((await request('/api/embed/session/action-result', { origin: website, token, body })).status, 200);
      assert.equal((await request('/api/embed/session/action-result', { origin: website, token, body })).status, 200);
      assert.equal((await request('/api/embed/session/action-result', { origin: website, token, body: { ...body, status: 'failed' } })).status, 409);
    });
    await t.test('draft edits/deletion do not change a pinned published session', async () => {
      assert.equal((await request(`/api/agents/${agentId}/documents/${docId}`, { cookie: cookieA, method: 'DELETE' })).status, 200);
      await request(`/api/agents/${agentId}/documents`, { cookie: cookieA, body: { title: 'New handbook', content: 'Northstar trial duration is now 31 days. Create a contact using the form.' } });
      await request(`/api/agents/${agentId}/publish`, { cookie: cookieA, body: {} });
      nextPlan = { answer: 'The trial is 17 days in this published version.', steps: [], action: null, citationIds: [docId] };
      const old = await ask('Northstar trial duration contact', 'old_version'); assert.equal(old.status, 200); assert.equal(old.data.version, 1); assert.match(lastPrompt, /17 days/); assert.doesNotMatch(lastPrompt, /31 days/);
      const fresh = await request(`/api/embed/${agentId}/session`, { origin: website, body: {} }); assert.equal(fresh.data.agent.version, 2);
    });
    await t.test('expired embed tokens cannot use the model; dashboard logout invalidates its session', async () => {
      core.repo.db.prepare('UPDATE embed_sessions SET expires=0').run();
      const before = calls; assert.equal((await ask('Hello', 'expired')).status, 401); assert.equal(calls, before);
      assert.equal((await request('/api/auth/logout', { cookie: cookieA, body: {} })).status, 200);
      assert.equal((await request('/api/agents', { cookie: cookieA })).status, 401);
    });
    await t.test('stores persistent version rows and hashes credentials with Argon2id', async () => {
      const rows = core.repo.rows('SELECT password_hash FROM users'); assert.ok(rows.every(r => String(r.password_hash).startsWith('$argon2id$')));
      assert.equal(core.repo.listAgents((await request('/api/auth/me', { cookie: cookieB })).data.workspace.tenant.id).length, 0);
      assert.equal(core.repo.row('SELECT COUNT(*) AS n FROM versions WHERE agent_id=?', agentId)?.n, 2);
    });
  } finally {
    await new Promise<void>(accept => server.close(() => accept()));
    await core.close(); await rm(directory, { recursive: true, force: true });
  }
});
