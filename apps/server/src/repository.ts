import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import session, { type SessionData } from 'express-session';
import type { Agent, AgentConfig, AgentDetail, AgentVersion, KnowledgeDocument, Workspace, Citation } from '../../../packages/contracts/src/index.js';
import { AppError, now, digest, newId, type Row } from './database.js';
import type { SQLDriver, SQLValue } from './storage/driver.js';
import { SqliteDriver } from './storage/sqlite.js';
import { PostgresDriver } from './storage/postgres.js';
export { AppError, now, digest, newId, type Row } from './database.js';
export type KnowledgeSource = 'local' | 'tigergraph' | 'postgres';

/** One async business implementation for the local fallback and managed product database. */
export class AsyncRepository {
  readonly dialect: SQLDriver['dialect'];
  private constructor(readonly dir: string, readonly db: SQLDriver, readonly sessionSecret: string) { this.dialect = db.dialect; }
  static async open(options: { dir: string; connectionString?: string; migrate?: boolean }): Promise<AsyncRepository> {
    if (!options.connectionString) {
      const driver = await SqliteDriver.open(options.dir);
      return new AsyncRepository(options.dir, driver, driver.sessionSecret);
    }
    mkdirSync(options.dir, { recursive: true, mode: 0o700 }); chmodSync(options.dir, 0o700);
    const path = join(options.dir, 'session.secret');
    if (!existsSync(path)) {
      try { writeFileSync(path, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    chmodSync(path, 0o600);
    const secret = readFileSync(path, 'utf8');
    if (secret.length < 32 || secret.length > 65536) throw new Error('The local session signing secret is invalid. Restore it from a verified backup.');
    return new AsyncRepository(options.dir, await PostgresDriver.open(options.connectionString, options.migrate ?? false), secret);
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> { return this.db.transaction(fn); }
  row(sql: string, ...values: SQLValue[]): Promise<Row | undefined> { return this.db.prepare(sql).get(...values); }
  rows(sql: string, ...values: SQLValue[]): Promise<Row[]> { return this.db.prepare(sql).all(...values); }
  async lockTenant(tenantId: string): Promise<void> {
    if (!await this.row(`SELECT id FROM tenants WHERE id=?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, tenantId)) throw new AppError(404, 'Workspace not found.');
  }
  async lockUser(userId: string): Promise<void> {
    if (!await this.row(`SELECT id FROM users WHERE id=?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, userId)) throw new AppError(404, 'Account not found.');
  }
  async lockAgent(tenantId: string, agentId: string): Promise<void> {
    if (!await this.row(`SELECT id FROM agents WHERE tenant_id=? AND id=?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, tenantId, agentId)) throw new AppError(404, 'Agent not found.');
  }
  async workspace(userId: string, tenantId?: string): Promise<Workspace | null> {
    const row = await this.row('SELECT u.id,u.email,u.name,u.verified_at,m.role,t.id AS tenantId,t.name AS tenantName FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=? AND (? IS NULL OR t.id=?) ORDER BY (t.id=u.tenant_id) DESC,m.created_at LIMIT 1', userId, tenantId ?? null, tenantId ?? null);
    return row ? { user: { id: String(row.id), email: String(row.email), name: String(row.name), emailVerified: !!row.verified_at }, tenant: { id: String(row.tenantId), name: String(row.tenantName) }, role: row.role as Workspace['role'] } : null;
  }
  async register(input: { email: string; name: string; companyName: string }, passwordHash: string): Promise<Workspace> {
    try {
      return await this.transaction(async () => {
        if (await this.row('SELECT id FROM users WHERE email=?', input.email)) throw new AppError(409, 'An account with this email already exists.');
        const tenantId = newId('org'), userId = newId('usr');
        await this.db.prepare('INSERT INTO tenants VALUES (?,?)').run(tenantId, input.companyName);
        await this.db.prepare('INSERT INTO users (id,tenant_id,email,name,password_hash) VALUES (?,?,?,?,?)').run(userId, tenantId, input.email, input.name, passwordHash);
        await this.db.prepare('INSERT INTO memberships VALUES (?,?,?,?)').run(userId, tenantId, 'owner', now());
        return (await this.workspace(userId))!;
      });
    } catch (error) { if ((error as { code?: string }).code === '23505') throw new AppError(409, 'An account with this email already exists.'); throw error; }
  }
  async audit(tenantId: string, actorId: string, event: string, resourceId: string, details: Record<string, string | number | boolean | null> = {}): Promise<void> {
    await this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)').run(newId('aud'), tenantId, actorId, event, resourceId, JSON.stringify(details), now());
  }
  agentFrom(row: Row): Agent { return { ...JSON.parse(String(row.config)), id: String(row.id), tenantId: String(row.tenant_id), publishedVersion: row.published_version === null ? null : Number(row.published_version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
  async agent(tenantId: string, id: string): Promise<Agent> {
    const row = await this.row('SELECT * FROM agents WHERE tenant_id=? AND id=?', tenantId, id);
    if (!row) throw new AppError(404, 'Agent not found.');
    return this.agentFrom(row);
  }
  async listAgents(tenantId: string): Promise<Agent[]> { return (await this.rows('SELECT * FROM agents WHERE tenant_id=? ORDER BY created_at DESC', tenantId)).map(row => this.agentFrom(row)); }
  async createAgent(tenantId: string, config: AgentConfig): Promise<Agent> {
    return this.transaction(async () => {
      await this.lockTenant(tenantId);
      if ((await this.listAgents(tenantId)).length >= 20) throw new AppError(409, 'This workspace supports up to 20 agents.');
      const id = newId('agt'), timestamp = now();
      await this.db.prepare('INSERT INTO agents (id,tenant_id,config,published_version,created_at,updated_at) VALUES (?,?,?,NULL,?,?)').run(id, tenantId, JSON.stringify(config), timestamp, timestamp);
      return this.agent(tenantId, id);
    });
  }
  async updateAgent(tenantId: string, id: string, config: AgentConfig): Promise<Agent> {
    return this.transaction(async () => {
      await this.lockAgent(tenantId, id);
      await this.db.prepare('UPDATE agents SET config=?,updated_at=? WHERE id=? AND tenant_id=?').run(JSON.stringify(config), now(), id, tenantId);
      return this.agent(tenantId, id);
    });
  }
  async documents(tenantId: string, agentId: string): Promise<KnowledgeDocument[]> {
    await this.agent(tenantId, agentId);
    return (await this.rows('SELECT * FROM documents WHERE agent_id=? ORDER BY created_at DESC', agentId)).map(row => ({ id: String(row.id), title: String(row.title), content: String(row.content), createdAt: String(row.created_at) }));
  }
  async addDocument(tenantId: string, agentId: string, input: { title: string; content: string }): Promise<KnowledgeDocument> {
    return this.transaction(async () => {
      await this.lockAgent(tenantId, agentId);
      const docs = await this.documents(tenantId, agentId);
      if (docs.some(doc => doc.content.replaceAll('\r\n', '\n').trim() === input.content.replaceAll('\r\n', '\n').trim())) throw new AppError(409, 'This source text is already in the knowledge base. Update the existing document instead.');
      if (docs.length >= 40 || docs.reduce((n, d) => n + Buffer.byteLength(d.content), 0) + Buffer.byteLength(input.content) > 2_000_000) throw new AppError(413, 'This agent supports 40 documents and 2 MB of source text.');
      const doc = { ...input, id: newId('doc'), createdAt: now() };
      await this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run(doc.id, agentId, doc.title, doc.content, doc.createdAt);
      await this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
      return doc;
    });
  }
  async removeDocument(tenantId: string, agentId: string, id: string): Promise<void> {
    await this.transaction(async () => {
      await this.lockAgent(tenantId, agentId);
      const result = await this.db.prepare('DELETE FROM documents WHERE id=? AND agent_id=?').run(id, agentId);
      if (!result.changes) throw new AppError(404, 'Document not found.');
      await this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
    });
  }
  async updateDocument(tenantId: string, agentId: string, id: string, input: { title: string; content: string }): Promise<KnowledgeDocument> {
    return this.transaction(async () => {
      await this.lockAgent(tenantId, agentId);
      const docs = await this.documents(tenantId, agentId), previous = docs.find(doc => doc.id === id);
      if (!previous) throw new AppError(404, 'Document not found.');
      if (docs.some(doc => doc.id !== id && doc.content.replaceAll('\r\n', '\n').trim() === input.content.replaceAll('\r\n', '\n').trim())) throw new AppError(409, 'This source text already belongs to another document.');
      if (docs.filter(doc => doc.id !== id).reduce((size, doc) => size + Buffer.byteLength(doc.content), 0) + Buffer.byteLength(input.content) > 2_000_000) throw new AppError(413, 'This agent supports 2 MB of source text.');
      await this.db.prepare('UPDATE documents SET title=?,content=? WHERE id=? AND agent_id=?').run(input.title, input.content, id, agentId);
      await this.db.prepare('UPDATE agents SET updated_at=? WHERE id=?').run(now(), agentId);
      return { ...previous, ...input };
    });
  }
  async publish(tenantId: string, agentId: string, graphSource: KnowledgeSource = 'local'): Promise<AgentVersion> {
    return this.transaction(async () => {
      await this.lockAgent(tenantId, agentId);
      // Snapshot after the same-agent lock, including config/documents/version/activation epoch.
      const agent = await this.agent(tenantId, agentId), documents = await this.documents(tenantId, agentId);
      if (!documents.length) throw new AppError(400, 'Add company knowledge before publishing.');
      const number = Number((await this.row('SELECT COALESCE(MAX(number),0)+1 AS number FROM versions WHERE agent_id=?', agentId))!.number), createdAt = now();
      const { id: _id, tenantId: _tenant, createdAt: _created, updatedAt: _updated, publishedVersion: _pub, ...config } = agent;
      await this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?)').run(agentId, number, JSON.stringify(config), JSON.stringify(documents), createdAt);
      await this.db.prepare('UPDATE agents SET updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(createdAt, agentId, tenantId);
      const epoch = Number((await this.row('SELECT release_epoch FROM agents WHERE id=?', agentId))!.release_epoch);
      await this.db.prepare('INSERT INTO publication_states (agent_id,version,status,graph_source,error,completed_at,activation_epoch) VALUES (?,?,?,?,NULL,?,?)').run(agentId, number, graphSource === 'local' ? 'ready' : 'preparing', graphSource, graphSource === 'local' ? createdAt : null, epoch);
      if (graphSource === 'local') await this.db.prepare('UPDATE agents SET published_version=? WHERE id=?').run(number, agentId);
      const insert = this.db.prepare('INSERT INTO knowledge_fts (tenant_id,agent_id,version,document_id,title,content) VALUES (?,?,?,?,?,?)');
      for (const doc of documents) for (let offset = 0; offset < doc.content.length; offset += 700) await insert.run(tenantId, agentId, number, doc.id, doc.title, doc.content.slice(offset, offset + 900));
      return (await this.version(tenantId, agentId, number)).version;
    });
  }
  async detail(tenantId: string, id: string): Promise<AgentDetail> {
    const agent = await this.agent(tenantId, id), documents = await this.documents(tenantId, id);
    const versions = (await this.rows('SELECT v.*,p.status,p.graph_source,p.error,p.completed_at FROM versions v JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE v.agent_id=? ORDER BY number DESC', id)).map(row => this.versionFrom(row));
    const sessions = (await this.rows('SELECT * FROM runs WHERE tenant_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 50', tenantId, id)).map(row => ({ id: String(row.id), question: String(row.question), answer: String(row.answer), status: String(row.status), createdAt: String(row.created_at), actionName: row.action_name === null ? null : String(row.action_name) }));
    return { agent, documents, versions, sessions };
  }
  private versionFrom(row: Row): AgentVersion { return { number: Number(row.number), createdAt: String(row.created_at), documentCount: JSON.parse(String(row.documents)).length, status: row.status as AgentVersion['status'], graphSource: row.graph_source as AgentVersion['graphSource'], ...(row.error ? { error: String(row.error) } : {}), ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}) }; }
  async version(tenantId: string, agentId: string, number: number): Promise<{ version: AgentVersion; config: AgentConfig; documents: KnowledgeDocument[] }> {
    await this.agent(tenantId, agentId);
    const row = await this.row('SELECT v.*,p.status,p.graph_source,p.error,p.completed_at FROM versions v JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE v.agent_id=? AND v.number=?', agentId, number);
    if (!row) throw new AppError(404, 'Version not found.');
    return { version: this.versionFrom(row), config: JSON.parse(String(row.config)), documents: JSON.parse(String(row.documents)) };
  }
  async publicationState(agentId: string, number: number, status: AgentVersion['status'], error?: string, activate = false): Promise<void> {
    await this.transaction(async () => {
      // Lock the agent before its state to match publish/activate/unpublish lock order.
      const agent = await this.row('SELECT tenant_id FROM agents WHERE id=?', agentId);
      if (!agent) throw new AppError(404, 'Agent not found.');
      await this.lockAgent(String(agent.tenant_id), agentId);
      const state = await this.row('SELECT activation_epoch FROM publication_states WHERE agent_id=? AND version=?', agentId, number);
      if (!state) throw new AppError(404, 'Version not found.');
      await this.db.prepare('UPDATE publication_states SET status=?,error=?,completed_at=? WHERE agent_id=? AND version=?').run(status, error ?? null, status === 'ready' ? now() : null, agentId, number);
      if (status === 'ready' && activate) await this.db.prepare('UPDATE agents SET published_version=?,updated_at=? WHERE id=? AND release_epoch=?').run(number, now(), agentId, Number(state.activation_epoch));
    });
  }
  async activateVersion(tenantId: string, agentId: string, number: number): Promise<void> {
    await this.transaction(async () => {
      await this.lockAgent(tenantId, agentId);
      if ((await this.version(tenantId, agentId, number)).version.status !== 'ready') throw new AppError(409, 'This version is not ready. Retry preparation before activating it.');
      await this.db.prepare('UPDATE agents SET published_version=?,updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(number, now(), agentId, tenantId);
    });
  }
  async unpublish(tenantId: string, agentId: string): Promise<void> {
    await this.transaction(async () => { await this.lockAgent(tenantId, agentId); await this.db.prepare('UPDATE agents SET published_version=NULL,updated_at=?,release_epoch=release_epoch+1 WHERE id=? AND tenant_id=?').run(now(), agentId, tenantId); });
  }
  async published(agentId: string, number?: number): Promise<{ tenantId: string; config: AgentConfig; version: number; documents: KnowledgeDocument[]; graphSource: AgentVersion['graphSource'] }> {
    const row = await this.row('SELECT v.*,a.tenant_id,p.status,p.graph_source FROM versions v JOIN agents a ON a.id=v.agent_id JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE v.agent_id=? AND v.number=COALESCE(?,a.published_version)', agentId, number ?? null);
    if (!row) throw new AppError(404, 'This agent has no published version.');
    if (row.status !== 'ready') throw new AppError(503, 'This version is preparing its knowledge. Retry when publication is ready.');
    return { tenantId: String(row.tenant_id), config: JSON.parse(String(row.config)), version: Number(row.number), documents: JSON.parse(String(row.documents)), graphSource: row.graph_source as AgentVersion['graphSource'] };
  }
  async retrieve(tenantId: string, agentId: string, version: number, question: string): Promise<Citation[]> {
    await this.version(tenantId, agentId, version);
    const stop = new Set(['the','and','how','can','you','for','with','what','this','that','please','would','could','help','want','need','show','tell','about','does','are','your']);
    const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].filter(term => term.length > 2 && !stop.has(term)).slice(0, 24);
    if (!terms.length) return [];
    const rows = this.dialect === 'postgres'
      ? await this.rows("SELECT document_id,title,content FROM knowledge_fts WHERE tenant_id=? AND agent_id=? AND version=? AND search_vector @@ to_tsquery('simple',?) ORDER BY ts_rank_cd(search_vector,to_tsquery('simple',?)) DESC,id LIMIT 8", tenantId, agentId, version, terms.map(term => `${term}:*`).join(' | '), terms.map(term => `${term}:*`).join(' | '))
      : await this.rows('SELECT document_id,title,content FROM knowledge_fts WHERE knowledge_fts MATCH ? AND tenant_id=? AND agent_id=? AND version=? ORDER BY bm25(knowledge_fts) LIMIT 8', terms.map(term => `"${term}"*`).join(' OR '), tenantId, agentId, version);
    return rows.map(row => ({ documentId: String(row.document_id), title: String(row.title), excerpt: String(row.content) }));
  }
  async close(): Promise<void> { await this.db.close(); }
}

/** Async store callbacks fire only after durable operations complete. Touch cannot resurrect logout. */
export class RepositorySessionStore extends session.Store {
  constructor(private readonly repo: AsyncRepository) { super(); }
  override get(id: string, callback: (err: unknown, data?: SessionData | null) => void): void {
    this.repo.row('SELECT data FROM dashboard_sessions WHERE id=? AND expires>?', id, Date.now()).then(row => callback(null, row ? JSON.parse(String(row.data)) : null)).catch(callback);
  }
  override set(id: string, data: SessionData, callback?: (err?: unknown) => void): void {
    this.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires').run(id, JSON.stringify(data), this.expiry(data)).then(() => callback?.()).catch(error => callback?.(error));
  }
  override destroy(id: string, callback?: (err?: unknown) => void): void { this.repo.db.prepare('DELETE FROM dashboard_sessions WHERE id=?').run(id).then(() => callback?.()).catch(error => callback?.(error)); }
  override touch(id: string, data: SessionData, callback?: (err?: unknown) => void): void { this.repo.db.prepare('UPDATE dashboard_sessions SET expires=? WHERE id=?').run(this.expiry(data), id).then(() => callback?.()).catch(error => callback?.(error)); }
  private expiry(data: SessionData): number { return data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 28_800_000; }
}
