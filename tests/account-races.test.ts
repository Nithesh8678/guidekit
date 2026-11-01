import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AsyncRepository } from '../apps/server/src/repository.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import { createApp } from '../apps/server/src/app.js';
import type { AccountDeliveryMessage } from '../apps/server/src/accounts.js';

// Opt-in live PostgreSQL verification uses a new disposable schema for each test.
// Normal local/CI runs keep the SQLite fixture and never connect to a remote DB.
async function isolatedAccountRepository(dir: string) {
  const value = process.env.GUIDEKIT_TEST_POSTGRES_URL;
  if (!value) return { repository: undefined, async close() {} };
  const direct = new URL(value);
  if (direct.hostname.endsWith('.neon.tech')) direct.hostname = direct.hostname.replace('-pooler.', '.');
  if (direct.searchParams.get('sslmode') === 'require') direct.searchParams.set('sslmode', 'verify-full');
  const owner = new Pool({ connectionString: direct.toString(), max: 1 }), schema = `gk_http_${randomUUID().replaceAll('-', '')}`;
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    const runtime = new URL(direct); runtime.searchParams.set('options', `-c search_path=${schema}`);
    const repository = await AsyncRepository.open({ dir, connectionString: runtime.toString(), migrate: true });
    return { repository, async close() { await owner.query(`DROP SCHEMA ${schema} CASCADE`); await owner.end(); } };
  } catch (error) { await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await owner.end(); throw error; }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-account-races-')), origins = new Set<string>(), messages: AccountDeliveryMessage[] = [];
  const database = await isolatedAccountRepository(dir);
  let statusGate: (() => Promise<void>) | undefined;
  const core = (await createApp({ dataDir: dir, repository: database.repository, adminOrigins: origins, testing: true,
    delivery: { mode: 'local', async deliver(message) { messages.push(message); } },
    provider: { async status() { await statusGate?.(); return { provider: 'codex', available: true, authenticated: true, message: 'Explicit account race fixture' }; }, async infer() { throw new Error('Account race tests never call inference.'); }, async close() {} }
  }));
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  async function request(path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}${path}`, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  }
  async function staleSession(userId: string, epoch: number, tenantId?: string) {
    // Model an in-flight session touch restoring a pre-revocation row. A live epoch check
    // must reject it even though its cookie signature and former identity are valid.
    const id = `race_${userId}`, expires = Date.now() + 60_000;
    (await core.repo.db.prepare('INSERT OR REPLACE INTO dashboard_sessions VALUES (?,?,?)').run(id, JSON.stringify({ userId, tenantId, authEpoch: epoch, cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires));
    const signature = createHmac('sha256', core.repo.sessionSecret).update(id).digest('base64').replace(/=+$/, '');
    return `gk.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
  }
  async function close() { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await database.close(); await rm(dir, { recursive: true, force: true }); }
  return { core, request, staleSession, messages, close, holdStatus: (gate: () => Promise<void>) => { statusGate = gate; } };
}
const passwordHash = (value: string) => hash(value, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

test('a password reset committed while login verifies an earlier hash cannot mint a current-epoch session', async () => {
  const state = await fixture(); const oldPassword = 'synthetic-old-review-password';
  try {
    const owner = (await state.core.repo.register({ email: 'login-race@example.invalid', name: 'Race owner', companyName: 'Race' }, await passwordHash(oldPassword)));
    const nextHash = await passwordHash('synthetic-replacement-password'), originalRow = state.core.repo.row.bind(state.core.repo); let resetCommitted = false;
    state.core.repo.row = (async (sql, ...args) => {
      const result = await originalRow(sql, ...args);
      if (!resetCommitted && /SELECT .*password_hash.*FROM users WHERE email=\?/.test(sql) && args[0] === owner.user.email) {
        resetCommitted = true;
        // The lookup has captured its old hash. Commit the exact reset state while
        // login continues, without relying on sleep/race timing.
        await state.core.repo.db.prepare('UPDATE users SET password_hash=?,auth_epoch=auth_epoch+1 WHERE id=?').run(nextHash, owner.user.id);
      }
      return result;
    }) as typeof state.core.repo.row;
    const login = await state.request('/api/auth/login', '', { email: owner.user.email, password: oldPassword });
    state.core.repo.row = originalRow;
    assert.equal(resetCommitted, true); assert.equal(login.status, 401);
    assert.equal((await state.request('/api/auth/me', login.cookie)).data.workspace, null);
    const fresh = await state.request('/api/auth/login', '', { email: owner.user.email, password: 'synthetic-replacement-password' });
    assert.equal(fresh.status, 200); assert.equal((await state.request('/api/account', fresh.cookie)).status, 200);
  } finally { await state.close(); }
});

test('a revoked session cannot accept an existing-account invitation or refresh its authentication epoch', async () => {
  const state = await fixture();
  try {
    const digest = await passwordHash('synthetic-review-password');
    const owner = (await state.core.repo.register({ email: 'invite-owner@example.invalid', name: 'Invite owner', companyName: 'Owner' }, digest));
    const invited = (await state.core.repo.register({ email: 'invite-victim@example.invalid', name: 'Invited user', companyName: 'Invited' }, digest));
    const ownerCookie = await state.staleSession(owner.user.id, 0);
    (await state.core.repo.db.prepare('UPDATE users SET auth_epoch=1 WHERE id=?').run(invited.user.id));
    const revokedCookie = await state.staleSession(invited.user.id, 0);
    assert.equal((await state.request('/api/account', revokedCookie)).status, 401);
    assert.equal((await state.request('/api/workspace/invitations', ownerCookie, { email: invited.user.email, role: 'editor' })).status, 201);
    const value = new URLSearchParams(state.messages.at(-1)!.link.split('?')[1]).get('token')!;
    const rejected = await state.request('/api/auth/invitations/accept', revokedCookie, { token: value });
    assert.equal(rejected.status, 401); assert.equal((await state.request('/api/auth/me', rejected.cookie)).data.workspace, null);
    assert.equal((await state.core.repo.workspace(invited.user.id, owner.tenant.id)), null);
    // Rejection must preserve the invitation for its genuinely authenticated owner.
    const signedIn = await state.request('/api/auth/login', '', { email: invited.user.email, password: 'synthetic-review-password' });
    const accepted = await state.request('/api/auth/invitations/accept', signedIn.cookie, { token: value });
    assert.equal(accepted.status, 200); assert.equal(accepted.data.workspace.tenant.id, owner.tenant.id);
    assert.equal((await state.request('/api/account', accepted.cookie)).status, 200);
  } finally { await state.close(); }
});

test('an authenticated response already in flight cannot restore a session deleted by logout', async () => {
  const state = await fixture(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(accept => { entered = accept; }), gate = new Promise<void>(accept => { release = accept; });
  try {
    const registered = await state.request('/api/auth/register', '', { email: 'logout-race@example.invalid', name: 'Logout user', companyName: 'Logout', password: 'synthetic-logout-password' });
    assert.equal(registered.status, 201); const oldCookie = registered.cookie;
    state.holdStatus(async () => { entered(); await gate; });
    const pending = state.request('/api/runtime/status', oldCookie); await started;
    assert.equal((await state.request('/api/auth/logout', oldCookie, {})).status, 200);
    assert.equal((await state.request('/api/account', oldCookie)).status, 401);
    release(); assert.equal((await pending).status, 200);
    // express-session touches the still-running request on response completion.
    // That touch may extend an existing session, but must never recreate a deleted one.
    assert.equal((await state.request('/api/account', oldCookie)).status, 401);
  } finally { release(); await state.close(); }
});

test('concurrent password recovery can consume a reset link only once', async () => {
  const state = await fixture();
  try {
    const owner = await state.core.repo.register({ email: 'parallel-reset@example.invalid', name: 'Recovery owner', companyName: 'Recovery' }, await passwordHash('synthetic-original-password'));
    assert.equal((await state.request('/api/auth/forgot-password', '', { email: owner.user.email })).status, 200);
    const value = new URLSearchParams(state.messages.at(-1)!.link.split('?')[1]).get('token')!;
    const passwords = ['synthetic-replacement-one', 'synthetic-replacement-two'];
    const responses = await Promise.all(passwords.map(password => state.request('/api/auth/reset-password', '', { token: value, password })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
    assert.equal((await state.core.repo.row('SELECT auth_epoch FROM users WHERE id=?', owner.user.id))!.auth_epoch, 1);
    const winner = passwords[responses.findIndex(response => response.status === 200)]!;
    assert.equal((await state.request('/api/auth/login', '', { email: owner.user.email, password: winner })).status, 200);
    assert.equal((await state.request('/api/auth/login', '', { email: owner.user.email, password: 'synthetic-original-password' })).status, 401);
  } finally { await state.close(); }
});

test('concurrent invitations cannot exceed the pending capacity within a tenant transaction', async () => {
  const state = await fixture();
  try {
    const owner = await state.core.repo.register({ email: 'parallel-invite@example.invalid', name: 'Invitation owner', companyName: 'Invitations' }, 'synthetic-no-login-hash');
    const cookie = await state.staleSession(owner.user.id, 0);
    // Start immediately below the limit so this verifies the race at the boundary,
    // independently of remote pool throughput or HTTP load-test assumptions.
    const seeded = Array.from({ length: 29 }, (_, index) => [`seed_${index}`, `synthetic_hash_${index}`, 'invite', null, owner.tenant.id, `invited-${index}@example.invalid`, JSON.stringify({ role: 'viewer' }), Date.now() + 60000, new Date().toISOString()]);
    await state.core.repo.db.prepare(`INSERT INTO account_tokens VALUES ${seeded.map(() => '(?,?,?,?,?,?,?,?,NULL,?)').join(',')}`).run(...seeded.flat());
    const responses = await Promise.all([29, 30].map(index => state.request('/api/workspace/invitations', cookie, { email: `invited-${index}@example.invalid`, role: 'viewer' })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(Number((await state.core.repo.row("SELECT COUNT(*) AS count FROM account_tokens WHERE tenant_id=? AND purpose='invite' AND consumed_at IS NULL", owner.tenant.id))!.count), 30);
    // Rotating an existing invitation does not occupy an additional capacity slot.
    assert.equal((await state.request('/api/workspace/invitations', cookie, { email: 'invited-0@example.invalid', role: 'editor' })).status, 201);
    assert.equal(Number((await state.core.repo.row("SELECT COUNT(*) AS count FROM account_tokens WHERE tenant_id=? AND purpose='invite' AND consumed_at IS NULL", owner.tenant.id))!.count), 30);
  } finally { await state.close(); }
});


test('an editor downgraded while a write is awaiting authorization cannot mutate the workspace', async () => {
  const state = await fixture(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(accept => { release = accept; }), captured = new Promise<void>(accept => { entered = accept; });
  const original = state.core.repo.workspace.bind(state.core.repo);
  try {
    const owner = await state.core.repo.register({ email: 'permission-owner@example.invalid', name: 'Permission owner', companyName: 'Permissions' }, 'synthetic-no-login-hash');
    const editor = await state.core.repo.register({ email: 'permission-editor@example.invalid', name: 'Permission editor', companyName: 'Editor' }, 'synthetic-no-login-hash');
    await state.core.repo.db.prepare('INSERT INTO memberships VALUES (?,?,?,?)').run(editor.user.id, owner.tenant.id, 'editor', new Date().toISOString());
    const ownerCookie = await state.staleSession(owner.user.id, 0), editorCookie = await state.staleSession(editor.user.id, 0, owner.tenant.id);
    let intercepted = false;
    state.core.repo.workspace = async (userId, tenantId) => {
      const result = await original(userId, tenantId);
      if (!intercepted && userId === editor.user.id && result?.tenant.id === owner.tenant.id && result.role === 'editor') { intercepted = true; entered(); await held; }
      return result;
    };
    const pending = state.request('/api/agents', editorCookie, { name: 'Denied guide', companyName: 'Permissions', allowedOrigins: ['http://127.0.0.1:4411'] });
    await captured;
    // Use the real owner endpoint to revoke permission after the in-flight write
    // captured an editor role, without relying on timing or database mocks.
    const downgrade = await state.request(`/api/workspace/members/${editor.user.id}`, ownerCookie, { role: 'viewer' }, 'PATCH'); assert.equal(downgrade.status, 200);
    release(); assert.equal((await pending).status, 403);
    assert.equal((await state.core.repo.listAgents(owner.tenant.id)).length, 0);
  } finally { release(); state.core.repo.workspace = original; await state.close(); }
});
