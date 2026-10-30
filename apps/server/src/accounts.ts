import type { Express, Request, RequestHandler } from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { Workspace, WorkspaceRole } from '../../../packages/contracts/src/index.js';
import { Repository, AppError, digest, newId, now } from './database.js';

export interface AccountDeliveryMessage { to: string; purpose: 'reset' | 'verify' | 'invite'; link: string; expiresAt: string; }
export interface AccountDelivery { readonly mode: 'local' | 'external'; deliver(message: AccountDeliveryMessage): Promise<void>; }
/** Explicit local transport: private operator outbox, never logs or browser responses. */
export function localAccountDelivery(dataDir: string): AccountDelivery {
  return { mode: 'local', async deliver(message) { const dir = join(dataDir, 'account-outbox'); await mkdir(dir, { recursive: true, mode: 0o700 }); await writeFile(join(dir, `${newId('mail')}.json`), JSON.stringify(message), { mode: 0o600, flag: 'wx' }); } };
}
const email = z.string().trim().toLowerCase().email().max(200), password = z.string().min(12).max(256), token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const role = z.enum(['admin', 'editor', 'viewer']);
export function registerAccounts(app: Express, repo: Repository, options: { workspace(req: Request): Workspace; identity(req: Request): string | null; signedIn(req: Request, userId: string, tenantId?: string, expectedEpoch?: number): Promise<void>; authLimit: RequestHandler; origin?: string; delivery: AccountDelivery }) {
  const { workspace, identity, signedIn, authLimit, delivery } = options;
  const admin = (req: Request) => { const actor = workspace(req); if (!['owner', 'admin'].includes(actor.role!)) throw new AppError(403, 'Only workspace owners and admins can manage members.'); return actor; };
  async function issue(purpose: AccountDeliveryMessage['purpose'], address: string, userId: string | null, tenantId: string | null, payload: Record<string, unknown>, origin: string) {
    const value = randomBytes(32).toString('base64url'), id = newId('tok'), expires = Date.now() + (purpose === 'invite' ? 86_400_000 : 1_800_000);
    // Rotate previous links of the same purpose; persisted storage contains only the digest.
    repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE purpose=? AND email=? AND tenant_id IS ? AND consumed_at IS NULL').run(now(), purpose, address, tenantId);
    repo.db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?,?,?,?,NULL,?)').run(id, digest(value), purpose, userId, tenantId, address, JSON.stringify(payload), expires, now());
    try { await delivery.deliver({ to: address, purpose, link: `${origin}/#account/${purpose}?token=${value}`, expiresAt: new Date(expires).toISOString() }); }
    catch { repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE id=?').run(now(), id); throw new AppError(503, 'Account delivery is unavailable. Check the configured delivery adapter.'); }
    return id;
  }
  function findToken(value: string, purpose: string) {
    const record = repo.row('SELECT * FROM account_tokens WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires>?', digest(value), purpose, Date.now());
    if (!record) throw new AppError(400, 'This link is invalid, expired or already used. Request a new one.');
    return record;
  }
  const origin = (req: Request) => options.origin ?? `${req.protocol}://${req.get('host')}`;
  app.get('/api/account', (req, res) => { const actor = workspace(req); res.json({ workspace: actor, workspaces: repo.rows('SELECT t.id,t.name,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY m.created_at', actor.user.id), delivery: delivery.mode }); });
  app.put('/api/account/profile', (req, res) => {
    const actor = workspace(req), input = z.object({ name: z.string().trim().min(2).max(100) }).strict().parse(req.body);
    repo.db.prepare('UPDATE users SET name=? WHERE id=?').run(input.name, actor.user.id); repo.audit(actor.tenant.id, actor.user.id, 'account.profile_updated', actor.user.id);
    res.json({ workspace: repo.workspace(actor.user.id, actor.tenant.id) });
  });
  app.post('/api/account/switch', async (req, res) => { const actor = workspace(req), epoch = Number(req.session.authEpoch ?? 0), input = z.object({ tenantId: z.string().max(160) }).strict().parse(req.body); if (!repo.workspace(actor.user.id, input.tenantId)) throw new AppError(404, 'Workspace not found.'); await signedIn(req, actor.user.id, input.tenantId, epoch); res.json({ workspace: repo.workspace(actor.user.id, input.tenantId) }); });
  app.post('/api/account/password', authLimit, async (req, res) => {
    const actor = workspace(req), input = z.object({ currentPassword: z.string().min(1).max(256), password }).strict().parse(req.body);
    const record = repo.row('SELECT password_hash,auth_epoch FROM users WHERE id=?', actor.user.id)!;
    if (!await verify(String(record.password_hash), input.currentPassword)) throw new AppError(401, 'Current password is incorrect.');
    const nextHash = await hash(input.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    repo.transaction(() => { if (!repo.db.prepare('UPDATE users SET password_hash=?,auth_epoch=auth_epoch+1 WHERE id=? AND password_hash=? AND auth_epoch=?').run(nextHash, actor.user.id, String(record.password_hash), Number(record.auth_epoch)).changes) throw new AppError(409, 'Account access changed while this request was running. Sign in again.'); repo.db.prepare("DELETE FROM dashboard_sessions WHERE json_extract(data,'$.userId')=?").run(actor.user.id); repo.audit(actor.tenant.id, actor.user.id, 'account.password_changed', actor.user.id); });
    await signedIn(req, actor.user.id, actor.tenant.id, Number(record.auth_epoch) + 1); res.json({ ok: true });
  });
  app.post('/api/account/revoke-sessions', async (req, res) => { const actor = workspace(req), epoch = Number(req.session.authEpoch ?? 0) + 1; repo.db.prepare('UPDATE users SET auth_epoch=auth_epoch+1 WHERE id=?').run(actor.user.id); repo.db.prepare("DELETE FROM dashboard_sessions WHERE json_extract(data,'$.userId')=?").run(actor.user.id); repo.audit(actor.tenant.id, actor.user.id, 'account.sessions_revoked', actor.user.id); await signedIn(req, actor.user.id, actor.tenant.id, epoch); res.json({ ok: true }); });
  app.post('/api/account/verification', authLimit, async (req, res) => { const actor = workspace(req); if (!actor.user.emailVerified) await issue('verify', actor.user.email, actor.user.id, actor.tenant.id, {}, origin(req)); res.json({ ok: true, delivery: delivery.mode }); });
  app.post('/api/auth/verify', authLimit, (req, res) => {
    const input = z.object({ token }).strict().parse(req.body), record = findToken(input.token, 'verify');
    repo.transaction(() => { repo.db.prepare('UPDATE users SET verified_at=? WHERE id=?').run(now(), String(record.user_id)); repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE id=?').run(now(), String(record.id)); repo.audit(String(record.tenant_id), String(record.user_id), 'account.email_verified', String(record.user_id)); }); res.json({ ok: true });
  });
  app.post('/api/auth/forgot-password', authLimit, async (req, res) => {
    const input = z.object({ email }).strict().parse(req.body), user = repo.row('SELECT id,tenant_id FROM users WHERE email=?', input.email);
    if (user) { try { await issue('reset', input.email, String(user.id), String(user.tenant_id), {}, origin(req)); } catch { repo.audit(String(user.tenant_id), String(user.id), 'account.delivery_failed', String(user.id), { purpose: 'reset' }); } }
    res.json({ ok: true, message: 'If an account exists, recovery instructions are queued when the configured delivery adapter is available.', delivery: delivery.mode });
  });
  app.post('/api/auth/reset-password', authLimit, async (req, res) => {
    const input = z.object({ token, password }).strict().parse(req.body); findToken(input.token, 'reset');
    const nextHash = await hash(input.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    repo.transaction(() => { const record = findToken(input.token, 'reset'), userId = String(record.user_id); repo.db.prepare('UPDATE users SET password_hash=?,auth_epoch=auth_epoch+1 WHERE id=?').run(nextHash, userId); repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL').run(now(), userId, 'reset'); repo.db.prepare("DELETE FROM dashboard_sessions WHERE json_extract(data,'$.userId')=?").run(userId); repo.audit(String(record.tenant_id), userId, 'account.password_reset', userId); });
    await new Promise<void>((accept, reject) => req.session.destroy(error => error ? reject(error) : accept())); res.clearCookie('gk.sid').json({ ok: true });
  });
  app.get('/api/workspace/members', (req, res) => {
    const actor = workspace(req); res.json({ members: repo.rows('SELECT u.id,u.name,u.email,m.role,m.created_at AS createdAt FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY m.created_at', actor.tenant.id), invitations: ['owner', 'admin'].includes(actor.role!) ? repo.rows("SELECT id,email,payload,expires FROM account_tokens WHERE tenant_id=? AND purpose='invite' AND consumed_at IS NULL AND expires>? ORDER BY created_at DESC", actor.tenant.id, Date.now()).map(row => ({ id: row.id, email: row.email, role: JSON.parse(String(row.payload)).role, expiresAt: new Date(Number(row.expires)).toISOString() })) : [] });
  });
  app.post('/api/workspace/invitations', authLimit, async (req, res) => {
    const actor = admin(req), input = z.object({ email, role }).strict().parse(req.body);
    if (repo.row('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=? AND m.tenant_id=?', input.email, actor.tenant.id)) throw new AppError(409, 'This account is already a workspace member.');
    if (Number(repo.row("SELECT COUNT(*) AS count FROM account_tokens WHERE tenant_id=? AND purpose='invite' AND consumed_at IS NULL AND expires>?", actor.tenant.id, Date.now())!.count) >= 30) throw new AppError(409, 'This workspace has 30 pending invitations. Revoke one before inviting again.');
    const id = await issue('invite', input.email, null, actor.tenant.id, { role: input.role }, origin(req)); repo.audit(actor.tenant.id, actor.user.id, 'workspace.invited', id, { role: input.role }); res.status(201).json({ id, delivery: delivery.mode });
  });
  app.delete('/api/workspace/invitations/:id', (req, res) => { const actor = admin(req); if (!repo.db.prepare("UPDATE account_tokens SET consumed_at=? WHERE id=? AND tenant_id=? AND purpose='invite' AND consumed_at IS NULL").run(now(), String(req.params.id), actor.tenant.id).changes) throw new AppError(404, 'Invitation not found.'); repo.audit(actor.tenant.id, actor.user.id, 'workspace.invitation_revoked', String(req.params.id)); res.json({ ok: true }); });
  app.post('/api/auth/invitations/preview', authLimit, (req, res) => { const input = z.object({ token }).strict().parse(req.body), record = findToken(input.token, 'invite'); res.json({ email: record.email, companyName: repo.row('SELECT name FROM tenants WHERE id=?', String(record.tenant_id))!.name, role: JSON.parse(String(record.payload)).role }); });
  app.post('/api/auth/invitations/accept', authLimit, async (req, res) => {
    const input = z.object({ token, name: z.string().trim().min(2).max(100).optional(), password: password.optional() }).strict().parse(req.body), record = findToken(input.token, 'invite');
    let user = repo.row('SELECT id,auth_epoch FROM users WHERE email=?', String(record.email)), nextHash: string | undefined;
    if (user && identity(req) !== user.id) throw new AppError(401, 'Sign in to the invited email account before accepting this invitation.');
    if (!user) { if (!input.name || !input.password) throw new AppError(400, 'Provide your name and a password to create the invited account.'); nextHash = await hash(input.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
    const accepted = repo.transaction(() => {
      const latest = findToken(input.token, 'invite'), tenantId = String(latest.tenant_id);
      user = repo.row('SELECT id,auth_epoch FROM users WHERE email=?', String(latest.email));
      if (user && identity(req) !== user.id) throw new AppError(409, 'Account access changed while accepting. Sign in and retry.');
      const userId = user ? String(user.id) : newId('usr');
      if (!user) repo.db.prepare('INSERT INTO users (id,tenant_id,email,name,password_hash,verified_at) VALUES (?,?,?,?,?,?)').run(userId, tenantId, String(latest.email), input.name!, nextHash!, now());
      repo.db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)').run(userId, tenantId, JSON.parse(String(latest.payload)).role as WorkspaceRole, now());
      repo.db.prepare('UPDATE users SET verified_at=COALESCE(verified_at,?) WHERE id=?').run(now(), userId);
      repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE id=?').run(now(), String(latest.id)); repo.audit(tenantId, userId, 'workspace.joined', userId); return { userId, tenantId, epoch: Number(user?.auth_epoch ?? 0) };
    });
    await signedIn(req, accepted.userId, accepted.tenantId, accepted.epoch); res.json({ workspace: repo.workspace(accepted.userId, accepted.tenantId) });
  });
  app.patch('/api/workspace/members/:id', (req, res) => {
    const actor = admin(req), targetId = String(req.params.id), input = z.object({ role }).strict().parse(req.body), target = repo.row('SELECT role FROM memberships WHERE user_id=? AND tenant_id=?', targetId, actor.tenant.id);
    if (!target) throw new AppError(404, 'Member not found.');
    if (target.role === 'owner' || targetId === actor.user.id || (actor.role === 'admin' && target.role === 'admin')) throw new AppError(403, 'Owners and your own membership cannot be changed here. Only owners can manage other admins.');
    repo.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run(input.role, targetId, actor.tenant.id); repo.audit(actor.tenant.id, actor.user.id, 'workspace.role_changed', targetId, { role: input.role }); res.json({ ok: true });
  });
  app.delete('/api/workspace/members/:id', (req, res) => {
    const actor = admin(req), targetId = String(req.params.id), target = repo.row('SELECT role FROM memberships WHERE user_id=? AND tenant_id=?', targetId, actor.tenant.id);
    if (!target) throw new AppError(404, 'Member not found.');
    if (target.role === 'owner' || targetId === actor.user.id || (actor.role === 'admin' && target.role === 'admin')) throw new AppError(403, 'This membership cannot be removed by your account.');
    repo.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(targetId, actor.tenant.id); repo.audit(actor.tenant.id, actor.user.id, 'workspace.member_removed', targetId); res.json({ ok: true });
  });
  app.get('/api/workspace/audit', (req, res) => { const actor = admin(req); res.json({ events: repo.rows('SELECT id,actor_id AS actorId,event,resource_id AS resourceId,details,created_at AS createdAt FROM audit_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200', actor.tenant.id).map(row => ({ ...row, details: JSON.parse(String(row.details)) })) }); });
}
