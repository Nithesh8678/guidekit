import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';
import { digest } from '../apps/server/src/database.js';
import { localAccountDelivery, type AccountDeliveryMessage } from '../apps/server/src/accounts.js';

const config = { name: 'Workspace guide', companyName: 'Company', allowedOrigins: ['http://127.0.0.1:4411'] };
test('account recovery, organization membership and authorization use expiring single-use links and live roles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-accounts-')), origins = new Set<string>(), messages: AccountDeliveryMessage[] = [];
  const core = createApp({ dataDir: dir, adminOrigins: origins, testing: true, delivery: { mode: 'local', deliver: async message => { messages.push(message); } }, provider: { status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Test provider' }), infer: async () => { throw new Error('No inference in account tests'); }, close: async () => {} } });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  async function request(path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}${path}`, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  }
  const tokenOf = (message: AccountDeliveryMessage) => new URLSearchParams(message.link.split('?')[1]).get('token')!;
  let owner = '', secondSession = '', otherOwner = '', viewer = '', viewerId = '', agentId = '', tenantId = '';
  const ownerEmail = 'owner@example.invalid', initialPassword = 'initial-test-password', changedPassword = 'changed-test-password';
  try {
    await t.test('registers owners, profile updates preserve the account, and wrong credentials cannot change password', async () => {
      const a = await request('/api/auth/register', '', { email: ownerEmail, name: 'Test owner', companyName: 'Company A', password: initialPassword }); owner = a.cookie; tenantId = a.data.workspace.tenant.id;
      assert.equal(a.status, 201); assert.equal(a.data.workspace.role, 'owner'); assert.equal(a.data.workspace.user.emailVerified, false);
      const b = await request('/api/auth/register', '', { email: 'other@example.invalid', name: 'Other owner', companyName: 'Company B', password: initialPassword }); otherOwner = b.cookie;
      const login = await request('/api/auth/login', '', { email: ownerEmail, password: initialPassword }); secondSession = login.cookie;
      const profile = await request('/api/account/profile', owner, { name: 'Updated owner' }, 'PUT'); assert.equal(profile.data.workspace.user.name, 'Updated owner');
      assert.equal((await request('/api/account/profile', owner, { email: 'replace@example.invalid', name: 'Bad' }, 'PUT')).status, 400);
      assert.equal((await request('/api/account/password', owner, { currentPassword: 'wrong', password: changedPassword })).status, 401);
      const created = await request('/api/agents', owner, config); agentId = created.data.agent.id;
    });
    await t.test('verification has hashed tokens, no token in response, rotation, purpose isolation and one-use consumption', async () => {
      const first = await request('/api/account/verification', owner, {}); assert.equal(first.status, 200); assert.equal(first.data.token, undefined);
      const oldToken = tokenOf(messages.at(-1)!); await request('/api/account/verification', owner, {}); const value = tokenOf(messages.at(-1)!);
      assert.notEqual(oldToken, value); assert.equal((await request('/api/auth/verify', '', { token: oldToken })).status, 400);
      assert.equal((await request('/api/auth/reset-password', '', { token: value, password: changedPassword })).status, 400);
      assert.ok(core.repo.row('SELECT id FROM account_tokens WHERE token_hash=?', digest(value)));
      assert.doesNotMatch(JSON.stringify(core.repo.rows('SELECT * FROM account_tokens')), new RegExp(value));
      assert.equal((await request('/api/auth/verify', '', { token: value })).status, 200); assert.equal((await request('/api/auth/verify', '', { token: value })).status, 400);
      assert.equal((await request('/api/auth/me', owner)).data.workspace.user.emailVerified, true);
    });
    await t.test('password change revokes other sessions and stale in-flight session copies using auth epochs', async () => {
      const secondId = decodeURIComponent(secondSession.slice('gk.sid='.length)).slice(2).split('.')[0]!;
      const priorSession = core.repo.row('SELECT * FROM dashboard_sessions WHERE id=?', secondId);
      const result = await request('/api/account/password', owner, { currentPassword: initialPassword, password: changedPassword }); assert.equal(result.status, 200); owner = result.cookie;
      assert.equal((await request('/api/auth/me', secondSession)).data.workspace, null);
      if (priorSession) { core.repo.db.prepare('INSERT OR REPLACE INTO dashboard_sessions VALUES (?,?,?)').run(priorSession.id, priorSession.data, priorSession.expires); assert.equal((await request('/api/auth/me', secondSession)).data.workspace, null); }
      assert.equal((await request('/api/auth/login', '', { email: ownerEmail, password: initialPassword })).status, 401);
      assert.equal((await request('/api/auth/login', '', { email: ownerEmail, password: changedPassword })).status, 200);
    });
    await t.test('invitation acceptance is single-use and viewer authorization is enforced on every agent write', async () => {
      const invite = await request('/api/workspace/invitations', owner, { email: 'viewer@example.invalid', role: 'viewer' }); assert.equal(invite.status, 201); assert.equal(invite.data.token, undefined);
      const value = tokenOf(messages.at(-1)!); assert.equal((await request('/api/auth/invitations/preview', '', { token: value })).data.role, 'viewer');
      const accepted = await request('/api/auth/invitations/accept', '', { token: value, name: 'Test viewer', password: initialPassword }); assert.equal(accepted.status, 200); viewer = accepted.cookie; viewerId = accepted.data.workspace.user.id;
      assert.equal(accepted.data.workspace.role, 'viewer'); assert.equal(accepted.data.workspace.user.emailVerified, true);
      assert.equal((await request('/api/auth/invitations/accept', viewer, { token: value })).status, 400);
      assert.equal((await request(`/api/agents/${agentId}`, viewer)).status, 200);
      for (const [path, body, method] of [['/api/agents', config, 'POST'], [`/api/agents/${agentId}`, config, 'PUT'], [`/api/agents/${agentId}/documents`, { title: 'Guide', content: 'Text' }, 'POST'], [`/api/agents/${agentId}/publish`, {}, 'POST'], [`/api/agents/${agentId}/versions/1/activate`, {}, 'POST'], [`/api/agents/${agentId}/unpublish`, {}, 'POST']] as const) assert.equal((await request(path, viewer, body, method)).status, 403);
      assert.equal((await request('/api/workspace/invitations', viewer, { email: 'intruder@example.invalid', role: 'admin' })).status, 403);
      assert.equal((await request('/api/workspace/audit', viewer)).status, 403);
      assert.equal((await request(`/api/agents/${agentId}`, otherOwner)).status, 404);
    });
    await t.test('role updates take effect immediately, owners are protected and removal revokes workspace access', async () => {
      assert.equal((await request(`/api/workspace/members/${viewerId}`, otherOwner, { role: 'editor' }, 'PATCH')).status, 404);
      assert.equal((await request(`/api/workspace/members/${viewerId}`, owner, { role: 'editor' }, 'PATCH')).status, 200);
      assert.equal((await request(`/api/agents/${agentId}/documents`, viewer, { title: 'Guide', content: 'Verified company text.' })).status, 201);
      const ownerId = (await request('/api/auth/me', owner)).data.workspace.user.id;
      assert.equal((await request(`/api/workspace/members/${ownerId}`, owner, undefined, 'DELETE')).status, 403);
      assert.equal((await request(`/api/workspace/members/${viewerId}`, owner, undefined, 'DELETE')).status, 200);
      assert.equal((await request('/api/agents', viewer)).status, 401);
    });
    await t.test('existing accounts must authenticate the invited email, then can safely switch between workspaces', async () => {
      await request('/api/workspace/invitations', owner, { email: 'other@example.invalid', role: 'editor' }); const value = tokenOf(messages.at(-1)!);
      assert.equal((await request('/api/auth/invitations/accept', owner, { token: value })).status, 401);
      const result = await request('/api/auth/invitations/accept', otherOwner, { token: value }); assert.equal(result.status, 200); otherOwner = result.cookie;
      assert.equal(result.data.workspace.tenant.id, tenantId); assert.equal(result.data.workspace.role, 'editor');
      const account = await request('/api/account', otherOwner); assert.equal(account.data.workspaces.length, 2);
      const home = account.data.workspaces.find((item: any) => item.id !== tenantId);
      const switched = await request('/api/account/switch', otherOwner, { tenantId: home.id }); otherOwner = switched.cookie; assert.equal(switched.data.workspace.role, 'owner');
      assert.equal((await request('/api/account/switch', otherOwner, { tenantId: 'foreign_workspace' })).status, 404);
    });
    await t.test('expired/revoked invitations cannot be used and audit records exclude tokens/passwords/content', async () => {
      const invite = await request('/api/workspace/invitations', owner, { email: 'revoked@example.invalid', role: 'admin' }); const value = tokenOf(messages.at(-1)!);
      assert.equal((await request(`/api/workspace/invitations/${invite.data.id}`, otherOwner, undefined, 'DELETE')).status, 404);
      assert.equal((await request(`/api/workspace/invitations/${invite.data.id}`, owner, undefined, 'DELETE')).status, 200);
      assert.equal((await request('/api/auth/invitations/accept', '', { token: value, name: 'Revoked user', password: initialPassword })).status, 400);
      await request('/api/workspace/invitations', owner, { email: 'expired@example.invalid', role: 'viewer' }); const expired = tokenOf(messages.at(-1)!); core.repo.db.prepare('UPDATE account_tokens SET expires=0 WHERE token_hash=?').run(digest(expired));
      assert.equal((await request('/api/auth/invitations/preview', '', { token: expired })).status, 400);
      const audit = await request('/api/workspace/audit', owner); assert.equal(audit.status, 200); assert.ok(audit.data.events.some((event: any) => event.event === 'workspace.joined'));
      for (const secret of [value, expired, initialPassword, changedPassword, 'Verified company text.']) assert.ok(!JSON.stringify(audit.data).includes(secret));
    });
    await t.test('recovery responses do not enumerate accounts; reset expires once and revokes every session', async () => {
      const unknown = await request('/api/auth/forgot-password', '', { email: 'missing@example.invalid' });
      const known = await request('/api/auth/forgot-password', '', { email: ownerEmail }); assert.deepEqual(known.data, unknown.data);
      const value = tokenOf(messages.at(-1)!); const reset = await request('/api/auth/reset-password', '', { token: value, password: 'recovered-test-password' }); assert.equal(reset.status, 200);
      assert.equal((await request('/api/auth/me', owner)).data.workspace, null); assert.equal((await request('/api/auth/reset-password', '', { token: value, password: initialPassword })).status, 400);
      assert.equal((await request('/api/auth/login', '', { email: ownerEmail, password: changedPassword })).status, 401);
      const login = await request('/api/auth/login', '', { email: ownerEmail, password: 'recovered-test-password' }); assert.equal(login.status, 200); owner = login.cookie;
      const another = await request('/api/auth/login', '', { email: ownerEmail, password: 'recovered-test-password' }); const revoked = await request('/api/account/revoke-sessions', owner, {}); owner = revoked.cookie;
      assert.equal((await request('/api/auth/me', another.cookie)).data.workspace, null); assert.ok((await request('/api/auth/me', owner)).data.workspace);
    });
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(dir, { recursive: true, force: true }); }
});

test('local account delivery stores links only in private ignored data storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-delivery-'));
  try { const delivery = localAccountDelivery(dir), message = { to: 'test@example.invalid', purpose: 'verify' as const, link: 'http://127.0.0.1:4410/#account/verify?token=fixture', expiresAt: new Date().toISOString() }; await delivery.deliver(message); const [file] = await readdir(join(dir, 'account-outbox')); assert.deepEqual(JSON.parse(await readFile(join(dir, 'account-outbox', file!), 'utf8')), message); assert.equal((await stat(join(dir, 'account-outbox', file!))).mode & 0o777, 0o600); assert.equal((await stat(join(dir, 'account-outbox'))).mode & 0o777, 0o700); } finally { await rm(dir, { recursive: true, force: true }); }
});
