import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { compileInputSchema } from '../packages/contracts/src/schema.js';
import { createApp } from '../apps/server/src/app.js';
import { Repository } from '../apps/server/src/database.js';

test('schema interpretation rejects executable, recursive and unbounded inputs', () => {
  for (const child of [{ type: 'string', pattern: '^(a+)+$' }, { $ref: '#' }, { type: 'array', items: { type: 'string' }, maxItems: 1000000 }, { type: 'string', format: 'arbitrary-plugin' }]) {
    assert.throws(() => compileInputSchema({ type: 'object', properties: { value: child }, additionalProperties: false }));
  }
  const validate = compileInputSchema({ type: 'object', additionalProperties: false, required: ['rows'], properties: { rows: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['count'], properties: { count: { type: 'integer', minimum: 0, maximum: 3 } } } } } });
  assert.equal(validate({ rows: [{ count: 1 }] }), true);
  assert.equal(validate({ rows: [{ count: '1' }] }), false);
  assert.equal(validate({ rows: [{ count: 1, extra: true }] }), false);
  assert.equal(validate({ rows: [{ count: 1 }, { count: 2 }, { count: 3 }] }), false);
  assert.equal(validate(JSON.parse('{"rows":[],"__proto__":{}}')), false);
});

test('tenant configuration, knowledge snapshots and session secret survive SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-reopen-'));
  try {
    let repo = new Repository(directory);
    const workspace = (await repo.register({ email: 'reopen@example.invalid', name: 'Test owner', companyName: 'Persistent company' }, 'not-a-real-login-hash'));
    const agent = (await repo.createAgent(workspace.tenant.id, { name: 'Persistent guide', companyName: 'Persistent company', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] }));
    (await repo.addDocument(workspace.tenant.id, agent.id, { title: 'Policy', content: 'The support response target is 42 hours.' })); (await repo.publish(workspace.tenant.id, agent.id));
    const secret = repo.sessionSecret; (await repo.close()); repo = new Repository(directory);
    assert.equal(repo.sessionSecret, secret); assert.equal((await repo.agent(workspace.tenant.id, agent.id)).publishedVersion, 1);
    assert.equal((await repo.published(agent.id)).documents[0]!.title, 'Policy'); assert.match((await repo.retrieve(workspace.tenant.id, agent.id, 1, 'support response target'))[0]!.excerpt, /42 hours/);
    assert.equal((await repo.workspace(workspace.user.id))?.tenant.name, 'Persistent company'); (await repo.close());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('late provider completion after cancellation cannot issue an action receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-cancel-'));
  let finish!: (value: string) => void, providerSignal: AbortSignal | undefined, began!: () => void;
  const begun = new Promise<void>(accept => { began = accept; });
  const origin = 'http://127.0.0.1:4411', origins = new Set<string>();
  const core = (await createApp({ dataDir: directory, adminOrigins: origins, testing: true, provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit test provider' }), close: async () => {},
    infer: async input => { providerSignal = input.signal; began(); return new Promise<string>(accept => { finish = accept; }); }
  } }));
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) => fetch(`${base}${path}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  try {
    const auth = await post('/api/auth/register', { email: 'cancel@example.invalid', name: 'Cancellation tester', companyName: 'Cancel company', password: 'long-disposable-test-password' });
    const Cookie = auth.headers.get('set-cookie')!.split(';')[0]!;
    const agent = await (await post('/api/agents', { name: 'Cancel guide', companyName: 'Cancel company', allowedOrigins: [origin], allowedActions: ['create_contact'] }, { Cookie })).json() as any;
    await post(`/api/agents/${agent.agent.id}/documents`, { title: 'Guide', content: 'Create a contact with explicit confirmation.' }, { Cookie });
    await post(`/api/agents/${agent.agent.id}/publish`, {}, { Cookie });
    const session = await (await post(`/api/embed/${agent.agent.id}/session`, {}, { Origin: origin })).json() as any;
    const abort = new AbortController();
    const pending = post('/api/embed/session/ask', { message: 'Create a contact', requestId: 'cancel_request', page: { url: `${origin}/`, title: 'CRM', targets: [], context: {}, actions: [{ name: 'create_contact', description: 'Create contact', requiresConfirmation: true, inputSchema: { type: 'object' } }] } }, { Origin: origin, Authorization: `Bearer ${session.token}` }, abort.signal).catch(() => null);
    await begun; abort.abort(); await pending;
    for (let i = 0; i < 100 && !providerSignal?.aborted; i++) await new Promise(accept => setTimeout(accept, 5));
    assert.equal(providerSignal?.aborted, true);
    finish(JSON.stringify({ answer: 'Review this action.', steps: [], action: { name: 'create_contact', argumentsJson: '{}', reason: 'Requested' }, citationIds: [] }));
    for (let i = 0; i < 100 && (await core.repo.row('SELECT status FROM runs'))?.status === 'running'; i++) await new Promise(accept => setTimeout(accept, 5));
    assert.equal((await core.repo.row('SELECT status,response FROM runs'))?.status, 'cancelled');
    assert.equal((await core.repo.row('SELECT status,response FROM runs'))?.response, null);
    assert.equal((await core.repo.row('SELECT COUNT(*) AS n FROM receipts'))?.n, 0);
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(directory, { recursive: true, force: true }); }
});


test('startup rejects invalid database configuration without exposing transport credentials or opening a fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-startup-rejection-'));
  try {
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((accept, reject) => {
      execFile(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { timeout: 10000, env: { ...process.env, GUIDEKIT_PROVIDER: 'codex', GUIDEKIT_KNOWLEDGE_PROVIDER: 'local', GUIDEKIT_DATA_DIR: directory, GUIDEKIT_DATABASE_URL: 'http://synthetic-user:synthetic-startup-password@example.invalid/', GUIDEKIT_PORT: '4940', GUIDEKIT_DEMO_PORT: '4941', GUIDEKIT_SECOND_DEMO_PORT: '4942' } }, (error, stdout, stderr) => {
        const code = error?.code ?? 0;
        if (typeof code !== 'number') return reject(error);
        accept({ code, stdout, stderr });
      });
    });
    assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /could not start during database verification/);
    assert.doesNotMatch(result.stderr, /synthetic-user|synthetic-startup-password|example\.invalid|http:/);
    await assert.rejects(access(join(directory, '.service.lock')));
    await assert.rejects(access(join(directory, 'guidekit.sqlite')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
