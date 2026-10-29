import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import session, { type SessionData } from 'express-session';
import type { Agent, AgentConfig, AgentDetail, KnowledgeDocument, Workspace, Citation } from '../../../packages/contracts/src/index.js';

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
    this.db = new DatabaseSync(join(dir, 'guidekit.sqlite'));
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
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  row(sql: string, ...args: (string | number | null)[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  rows(sql: string, ...args: (string | number | null)[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  workspace(userId: string): Workspace | null {
    const row = this.row('SELECT u.id, u.email, u.name, t.id AS tenantId, t.name AS tenantName FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=?', userId);
    return row ? { user: { id: String(row.id), email: String(row.email), name: String(row.name) }, tenant: { id: String(row.tenantId), name: String(row.tenantName) } } : null;
  }
  register(input: { email: string; name: string; companyName: string }, passwordHash: string): Workspace {
    if (this.row('SELECT id FROM users WHERE email=?', input.email)) throw new AppError(409, 'An account with this email already exists.');
    return this.transaction(() => {
      const tenantId = newId('org'), userId = newId('usr');
      this.db.prepare('INSERT INTO tenants VALUES (?,?)').run(tenantId, input.companyName);
      this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(userId, tenantId, input.email, input.name, passwordHash);
      return this.workspace(userId)!;
    });
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
    this.db.prepare('INSERT INTO agents VALUES (?,?,?,NULL,?,?)').run(id, tenantId, JSON.stringify(config), timestamp, timestamp);
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
  publish(tenantId: string, agentId: string) {
    const agent = this.agent(tenantId, agentId), documents = this.documents(tenantId, agentId);
    if (!documents.length) throw new AppError(400, 'Add company knowledge before publishing.');
    return this.transaction(() => {
      const number = (agent.publishedVersion ?? 0) + 1, createdAt = now();
      const { id: _id, tenantId: _tenant, createdAt: _created, updatedAt: _updated, publishedVersion: _pub, ...config } = agent;
      this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?)').run(agentId, number, JSON.stringify(config), JSON.stringify(documents), createdAt);
      this.db.prepare('UPDATE agents SET published_version=?, updated_at=? WHERE id=? AND tenant_id=?').run(number, createdAt, agentId, tenantId);
      const insert = this.db.prepare('INSERT INTO knowledge_fts (tenant_id,agent_id,version,document_id,title,content) VALUES (?,?,?,?,?,?)');
      for (const doc of documents) for (let offset = 0; offset < doc.content.length; offset += 700) insert.run(tenantId, agentId, number, doc.id, doc.title, doc.content.slice(offset, offset + 900));
      return { number, createdAt, documentCount: documents.length };
    });
  }
  detail(tenantId: string, id: string): AgentDetail {
    return { agent: this.agent(tenantId, id), documents: this.documents(tenantId, id), versions: this.rows('SELECT number,created_at,documents FROM versions WHERE agent_id=? ORDER BY number DESC', id).map(row => ({ number: Number(row.number), createdAt: String(row.created_at), documentCount: JSON.parse(String(row.documents)).length })), sessions: this.rows('SELECT * FROM runs WHERE tenant_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 50', tenantId, id).map(row => ({ id: String(row.id), question: String(row.question), answer: String(row.answer), status: String(row.status), createdAt: String(row.created_at), actionName: row.action_name === null ? null : String(row.action_name) })) };
  }
  published(agentId: string, number?: number): { tenantId: string; config: AgentConfig; version: number; documents: KnowledgeDocument[] } {
    const row = this.row('SELECT v.*, a.tenant_id FROM versions v JOIN agents a ON a.id=v.agent_id WHERE v.agent_id=? AND v.number=COALESCE(?,a.published_version)', agentId, number ?? null);
    if (!row) throw new AppError(404, 'This agent has no published version.');
    return { tenantId: String(row.tenant_id), config: JSON.parse(String(row.config)), version: Number(row.number), documents: JSON.parse(String(row.documents)) };
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
