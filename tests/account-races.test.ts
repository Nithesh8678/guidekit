import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import { createApp } from '../apps/server/src/app.js';
import type { AccountDeliveryMessage } from '../apps/server/src/accounts.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-account-races-')), origins = new Set<string>(), messages: AccountDeliveryMessage[] = [];
  const core = createApp({ dataDir: dir, adminOrigins: origins, testing: true,
    delivery: { mode: 'local', async deliver(message) { messages.push(message); } },
    provider: { async status() { return { provider: 'codex', available: true, authenticated: true, message: 'Explicit account race fixture' }; }, async infer() { throw new Error('Account race tests never call inference.'); }, async close() {} }
  });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  async function request(path: string, cookie = '', body?: unknown) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  }
  function staleSession(userId: string, epoch: number) {
    // Model an in-flight session touch restoring a pre-revocation row. A live epoch check
    // must reject it even though its cookie signature and former identity are valid.
    const id = `race_${userId}`, expires = Date.now() + 60_000;
    core.repo.db.prepare('INSERT OR REPLACE INTO dashboard_sessions VALUES (?,?,?)').run(id, JSON.stringify({ userId, authEpoch: epoch, cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires);
    const signature = createHmac('sha256', core.repo.sessionSecret).update(id).digest('base64').replace(/=+$/, '');
    return `gk.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
  }
  async function close() { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(dir, { recursive: true, force: true }); }
  return { core, request, staleSession, messages, close };
}
const passwordHash = (value: string) => hash(value, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

test('a password reset committed while login verifies an earlier hash cannot mint a current-epoch session', async () => {
  const state = await fixture(); const oldPassword = 'synthetic-old-review-password';
  try {
    const owner = state.core.repo.register({ email: 'login-race@example.invalid', name: 'Race owner', companyName: 'Race' }, await passwordHash(oldPassword));
    const nextHash = await passwordHash('synthetic-replacement-password'), originalRow = state.core.repo.row.bind(state.core.repo); let resetCommitted = false;
    state.core.repo.row = ((sql, ...args) => {
      const result = originalRow(sql, ...args);
      if (!resetCommitted && /SELECT .*password_hash.*FROM users WHERE email=\?/.test(sql) && args[0] === owner.user.email) {
        resetCommitted = true;
        // The lookup has captured its old hash. Commit the exact reset state while
        // native Argon2 verification yields, without relying on sleep/race timing.
        queueMicrotask(() => state.core.repo.db.prepare('UPDATE users SET password_hash=?,auth_epoch=auth_epoch+1 WHERE id=?').run(nextHash, owner.user.id));
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
    const owner = state.core.repo.register({ email: 'invite-owner@example.invalid', name: 'Invite owner', companyName: 'Owner' }, digest);
    const invited = state.core.repo.register({ email: 'invite-victim@example.invalid', name: 'Invited user', companyName: 'Invited' }, digest);
    const ownerCookie = state.staleSession(owner.user.id, 0);
    state.core.repo.db.prepare('UPDATE users SET auth_epoch=1 WHERE id=?').run(invited.user.id);
    const revokedCookie = state.staleSession(invited.user.id, 0);
    assert.equal((await state.request('/api/account', revokedCookie)).status, 401);
    assert.equal((await state.request('/api/workspace/invitations', ownerCookie, { email: invited.user.email, role: 'editor' })).status, 201);
    const value = new URLSearchParams(state.messages.at(-1)!.link.split('?')[1]).get('token')!;
    const rejected = await state.request('/api/auth/invitations/accept', revokedCookie, { token: value });
    assert.equal(rejected.status, 401); assert.equal((await state.request('/api/auth/me', rejected.cookie)).data.workspace, null);
    assert.equal(state.core.repo.workspace(invited.user.id, owner.tenant.id), null);
    // Rejection must preserve the invitation for its genuinely authenticated owner.
    const signedIn = await state.request('/api/auth/login', '', { email: invited.user.email, password: 'synthetic-review-password' });
    const accepted = await state.request('/api/auth/invitations/accept', signedIn.cookie, { token: value });
    assert.equal(accepted.status, 200); assert.equal(accepted.data.workspace.tenant.id, owner.tenant.id);
    assert.equal((await state.request('/api/account', accepted.cookie)).status, 200);
  } finally { await state.close(); }
});
