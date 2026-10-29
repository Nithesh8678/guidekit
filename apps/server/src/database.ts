import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import session, { type SessionData } from 'express-session';
import type { Agent, AgentConfig, AgentDetail, AgentVersion, KnowledgeDocument, Workspace, Citation } from '../../../packages/contracts/src/index.js';
import { migrate } from './migrations.js';

export const now = () => new Date().toISOString();
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export type Row = Record<string, string | number | null>;
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class Repository {
  readonly db: DatabaseSync;
  readonly sessionSecret: string;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const secretPath = join(dir, 'session.secret');
    if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('hex'), { mode: 0o600 });
    this.sessionSecret = readFileSync(secretPath, 'utf8');
    this.db = new DatabaseSync(join(dir, 'guidekit.sqlite'), { timeout: 5000 });
    chmodSync(join(dir, 'guidekit.sqlite'), 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), config TEXT NOT NULL, published_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (agent_id TEXT NOT NULL REFERENCES agents(id), number INTEGER NOT NULL, config TEXT NOT NULL, documents TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(agent_id, number));
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(tenant_id UNINDEXED, agent_id UNINDEXED, version UNINDEXED, document_id UNINDEXED, title, content);
      CREATE TABLE IF NOT EXISTS embed_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, version INTEGER NOT NULL, origin TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES embed_sessions(id), tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, request_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, response TEXT, action_name TEXT, created_at TEXT NOT NULL, UNIQUE(session_id, request_id));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES embed_sessions(id), run_id TEXT NOT NULL REFERENCES runs(id), action_name TEXT NOT NULL, arguments TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS runs_agent_created ON runs(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS documents_agent ON documents(agent_id);
      INSERT OR IGNORE INTO schema_migrations VALUES (1, datetime('now'));
    `);
    migrate(this.db);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  row(sql: string, ...args: (string | number | null)[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  rows(sql: string, ...args: (string | number | null)[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  workspace(userId: string, tenantId?: string): Workspace | null {
    const row = this.row('SELECT u.id,u.email,u.name,u.verified_at,m.role,t.id AS tenantId,t.name AS tenantName FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=? AND (? IS NULL OR t.id=?) ORDER BY (t.id=u.tenant_id) DESC,m.created_at LIMIT 1', userId, tenantId ?? null, tenantId ?? null);
    return row ? { user: { id: String(row.id), email: String(row.email), name: String(row.name), emailVerified: !!row.verified_at }, tenant: { id: String(row.tenantId), name: String(row.tenantName) }, role: row.role as Workspace['role'] } : null;
  }
  register(input: { email: string; name: string; companyName: string }, passwordHash: string): Workspace {
    if (this.row('SELECT id FROM users WHERE email=?', input.email)) throw new AppError(409, 'An account with this email already exists.');
    return this.transaction(() => {
      const tenantId = newId('org'), userId = newId('usr');
      this.db.prepare('INSERT INTO tenants VALUES (?,?)').run(tenantId, input.companyName);
      this.db.prepare('INSERT INTO users (id,tenant_id,email,name,password_hash) VALUES (?,?,?,?,?)').run(userId, tenantId, input.email, input.name, passwordHash);
      this.db.prepare('INSERT INTO memberships VALUES (?,?,?,?)').run(userId, tenantId, 'owner', now());
      return this.workspace(userId)!;
    });
  }
  audit(tenantId: string, actorId: string, event: string, resourceId: string, details: Record<string, string | number | boolean | null> = {}): void {
    this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)').run(newId('aud'), tenantId, actorId, event, resourceId, JSON.stringify(details), now());
  }
  agentFrom(row: Row): Agent {
    return { ...JSON.parse(String(row.config)), id: String(row.id), tenantId: String(row.tenant_id), publishedVersion: row.published_version === null ? null : Number(row.published_version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
  agent(tenantId: string, id: string): Agent {
    const row = this.row('SELECT * FROM agents WHERE tenant_id=? AND id=?', tenantId, id);
    if (!row) throw new AppError(404, 'Agent not found.');
    return this.agentFrom(row);
  }
  listAgents(tenantId: string): Agent[] { return this.rows('SELECT * FROM agents WHERE tenant_id=? ORDER BY created_at DESC', tenantId).map(row => this.agentFrom(row)); }
  createAgent(tenantId: string, config: AgentConfig): Agent {
    if (this.listAgents(tenantId).length >= 20) throw new AppError(409, 'This local workspace supports up to 20 agents.');
    const id = newId('agt'), timestamp = now();
    this.db.prepare('INSERT INTO agents (id,tenant_id,config,published_version,created_at,updated_at) VALUES (?,?,?,NULL,?,?)').run(id, tenantId, JSON.stringify(config), timestamp, timestamp);
    return this.agent(tenantId, id);
  }
  updateAgent(tenantId: string, id: string, config: AgentConfig): Agent {
    this.agent(tenantId, id);
    this.db.prepare('UPDATE agents SET config=?, updated_at=? WHERE id=? AND tenant_id=?').run(JSON.stringify(config), now(), id, tenantId);
    return this.agent(tenantId, id);
  }
  documents(tenantId: string, agentId: string): KnowledgeDocument[] {
    this.agent(tenantId, agentId);
    return this.rows('SELECT * FROM documents WHERE agent_id=? ORDER BY created_at DESC', agentId).map(row => ({ id: String(row.id), title: String(row.title), content: String(row.content), createdAt: String(row.created_at) }));
  }
  addDocument(tenantId: string, agentId: string, input: { title: string; content: string }): KnowledgeDocument {
    const docs = this.documents(tenantId, agentId);
    if (docs.some(doc => doc.content.replaceAll('\r\n', '\n').trim() === input.content.replaceAll('\r\n', '\n').trim())) throw new AppError(409, 'This source text is already in the knowledge base. Update the existing document instead.');
    if (docs.length >= 40 || docs.reduce((n, d) => n + Buffer.byteLength(d.content), 0) + Buffer.byteLength(input.content) > 2_000_000) throw new AppError(413, 'This agent supports 40 documents and 2 MB of source text.');
    const doc = { ...input, id: newId('doc'), createdAt: now() };
    this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run(doc.id, agentId, doc.title, doc.content, doc.createdAt);
    this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
    return doc;
  }
  removeDocument(tenantId: string, agentId: string, id: string) {
    this.agent(tenantId, agentId);
    const result = this.db.prepare('DELETE FROM documents WHERE id=? AND agent_id=?').run(id, agentId);
    if (!result.changes) throw new AppError(404, 'Document not found.');
    this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
  }
  updateDocument(tenantId: string, agentId: string, id: string, input: { title: string; content: string }): KnowledgeDocument {
    const documents = this.documents(tenantId, agentId), previous = documents.find(doc => doc.id === id);
    if (!previous) throw new AppError(404, 'Document not found.');
    if (documents.some(doc => doc.id !== id && doc.content.replaceAll('\r\n', '\n').trim() === input.content.replaceAll('\r\n', '\n').trim())) throw new AppError(409, 'This source text already belongs to another document.');
    if (documents.filter(doc => doc.id !== id).reduce((size, doc) => size + Buffer.byteLength(doc.content), 0) + Buffer.byteLength(input.content) > 2_000_000) throw new AppError(413, 'This agent supports 2 MB of source text.');
    this.db.prepare('UPDATE documents SET title=?,content=? WHERE id=? AND agent_id=?').run(input.title, input.content, id, agentId);
    this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
    return { ...previous, ...input };
  }
  publish(tenantId: string, agentId: string, graphSource: 'local' | 'tigergraph' = 'local'): AgentVersion {
    const agent = this.agent(tenantId, agentId), documents = this.documents(tenantId, agentId);
    if (!documents.length) throw new AppError(400, 'Add company knowledge before publishing.');
    return this.transaction(() => {
      const number = Number(this.row('SELECT COALESCE(MAX(number),0)+1 AS number FROM versions WHERE agent_id=?', agentId)!.number), createdAt = now();
      const { id: _id, tenantId: _tenant, createdAt: _created, updatedAt: _updated, publishedVersion: _pub, ...config } = agent;
      this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?)').run(agentId, number, JSON.stringify(config), JSON.stringify(documents), createdAt);
      this.db.prepare('UPDATE agents SET updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(createdAt, agentId, tenantId);
      const epoch = Number(this.row('SELECT release_epoch FROM agents WHERE id=?', agentId)!.release_epoch);
      this.db.prepare('INSERT INTO publication_states (agent_id,version,status,graph_source,error,completed_at,activation_epoch) VALUES (?,?,?,?,NULL,?,?)').run(agentId, number, graphSource === 'local' ? 'ready' : 'preparing', graphSource, graphSource === 'local' ? createdAt : null, epoch);
      if (graphSource === 'local') this.db.prepare('UPDATE agents SET published_version=? WHERE id=?').run(number, agentId);
      const insert = this.db.prepare('INSERT INTO knowledge_fts (tenant_id,agent_id,version,document_id,title,content) VALUES (?,?,?,?,?,?)');
      for (const doc of documents) for (let offset = 0; offset < doc.content.length; offset += 700) insert.run(tenantId, agentId, number, doc.id, doc.title, doc.content.slice(offset, offset + 900));
      return this.version(tenantId, agentId, number).version;
    });
  }
  detail(tenantId: string, id: string): AgentDetail {
    return { agent: this.agent(tenantId, id), documents: this.documents(tenantId, id), versions: this.rows('SELECT v.*,p.status,p.graph_source,p.error,p.completed_at FROM versions v JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE v.agent_id=? ORDER BY number DESC', id).map(row => this.versionFrom(row)), sessions: this.rows('SELECT * FROM runs WHERE tenant_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 50', tenantId, id).map(row => ({ id: String(row.id), question: String(row.question), answer: String(row.answer), status: String(row.status), createdAt: String(row.created_at), actionName: row.action_name === null ? null : String(row.action_name) })) };
  }
  private versionFrom(row: Row): AgentVersion {
    return { number: Number(row.number), createdAt: String(row.created_at), documentCount: JSON.parse(String(row.documents)).length, status: row.status as AgentVersion['status'], graphSource: row.graph_source as AgentVersion['graphSource'], ...(row.error ? { error: String(row.error) } : {}), ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}) };
  }
  version(tenantId: string, agentId: string, number: number): { version: AgentVersion; config: AgentConfig; documents: KnowledgeDocument[] } {
    this.agent(tenantId, agentId);
    const row = this.row('SELECT v.*,p.status,p.graph_source,p.error,p.completed_at FROM versions v JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE v.agent_id=? AND v.number=?', agentId, number);
    if (!row) throw new AppError(404, 'Version not found.');
    return { version: this.versionFrom(row), config: JSON.parse(String(row.config)), documents: JSON.parse(String(row.documents)) };
  }
  publicationState(agentId: string, number: number, status: AgentVersion['status'], error?: string, activate = false): void {
    this.transaction(() => {
      const state = this.row('SELECT activation_epoch FROM publication_states WHERE agent_id=? AND version=?', agentId, number);
      if (!state) throw new AppError(404, 'Version not found.');
      this.db.prepare('UPDATE publication_states SET status=?,error=?,completed_at=? WHERE agent_id=? AND version=?').run(status, error ?? null, status === 'ready' ? now() : null, agentId, number);
      if (status === 'ready' && activate) this.db.prepare('UPDATE agents SET published_version=?,updated_at=? WHERE id=? AND release_epoch=?').run(number, now(), agentId, Number(state.activation_epoch));
    });
  }
  activateVersion(tenantId: string, agentId: string, number: number): void {
    if (this.version(tenantId, agentId, number).version.status !== 'ready') throw new AppError(409, 'This version is not ready. Retry preparation before activating it.');
    this.db.prepare('UPDATE agents SET published_version=?,updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(number, now(), agentId, tenantId);
  }
  unpublish(tenantId: string, agentId: string): void { this.agent(tenantId, agentId); this.db.prepare('UPDATE agents SET published_version=NULL,updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(now(), agentId, tenantId); }
  published(agentId: string, number?: number): { tenantId: string; config: AgentConfig; version: number; documents: KnowledgeDocument[]; graphSource: AgentVersion['graphSource'] } {
    const row = this.row('SELECT v.*, a.tenant_id FROM versions v JOIN agents a ON a.id=v.agent_id WHERE v.agent_id=? AND v.number=COALESCE(?,a.published_version)', agentId, number ?? null);
    if (!row) throw new AppError(404, 'This agent has no published version.');
    if (number === undefined && this.row('SELECT status FROM publication_states WHERE agent_id=? AND version=?', agentId, Number(row.number))?.status !== 'ready') throw new AppError(503, 'This version is preparing its knowledge. Retry when publication is ready.');
    const source = this.row('SELECT graph_source FROM publication_states WHERE agent_id=? AND version=?', agentId, Number(row.number));
    return { tenantId: String(row.tenant_id), config: JSON.parse(String(row.config)), version: Number(row.number), documents: JSON.parse(String(row.documents)), graphSource: source!.graph_source as AgentVersion['graphSource'] };
  }
  retrieve(tenantId: string, agentId: string, version: number, question: string): Citation[] {
    const stop = new Set(['the', 'and', 'how', 'can', 'you', 'for', 'with', 'what', 'this', 'that', 'please', 'would', 'could', 'help', 'want', 'need', 'show', 'tell', 'about', 'does', 'are', 'your']);
    const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].filter(t => t.length > 2 && !stop.has(t)).slice(0, 24);
    if (!terms.length) return [];
    const match = terms.map(term => `"${term.replaceAll('"', '')}"*`).join(' OR ');
    const rows = this.rows('SELECT document_id,title,content FROM knowledge_fts WHERE knowledge_fts MATCH ? AND tenant_id=? AND agent_id=? AND version=? ORDER BY bm25(knowledge_fts) LIMIT 8', match, tenantId, agentId, version);
    return rows.map(row => ({ documentId: String(row.document_id), title: String(row.title), excerpt: String(row.content) }));
  }
  close() { this.db.close(); }
}

export class SqliteSessionStore extends session.Store {
  constructor(private repo: Repository) { super(); }
  override get(id: string, callback: (err: unknown, data?: SessionData | null) => void) {
    try { const row = this.repo.row('SELECT data FROM dashboard_sessions WHERE id=? AND expires>?', id, Date.now()); callback(null, row ? JSON.parse(String(row.data)) : null); } catch (e) { callback(e); }
  }
  override set(id: string, data: SessionData, callback?: (err?: unknown) => void) {
    try { this.repo.db.prepare('INSERT OR REPLACE INTO dashboard_sessions VALUES (?,?,?)').run(id, JSON.stringify(data), data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 28_800_000); callback?.(); } catch (e) { callback?.(e); }
  }
  override destroy(id: string, callback?: (err?: unknown) => void) {
    try { this.repo.db.prepare('DELETE FROM dashboard_sessions WHERE id=?').run(id); callback?.(); } catch (e) { callback?.(e); }
  }
  override touch(id: string, data: SessionData, callback?: (err?: unknown) => void) { this.set(id, data, callback); }
}
