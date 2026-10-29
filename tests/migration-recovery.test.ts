import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash, verify } from '@node-rs/argon2';
import { Repository, SqliteSessionStore } from '../apps/server/src/database.js';
import { Publications } from '../apps/server/src/publications.js';

const config = { name: 'Legacy guide', companyName: 'Legacy company', description: 'Saved company settings', instructions: 'Saved public instructions', greeting: 'Welcome back', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4711'], allowedActions: ['create.contact'] };
const timestamp = '2026-10-01T12:00:00.000Z';
const document = { id: 'doc_legacy', title: 'Published contact guide', content: 'Contacts can be exported as CSV from the directory.', createdAt: timestamp };
const legacyColumns: Record<string, string> = {
  tenants: 'id,name', users: 'id,tenant_id,email,name,password_hash', dashboard_sessions: 'id,data,expires',
  agents: 'id,tenant_id,config,published_version,created_at,updated_at', documents: 'id,agent_id,title,content,created_at',
  versions: 'agent_id,number,config,documents,created_at', knowledge_fts: 'tenant_id,agent_id,version,document_id,title,content',
  embed_sessions: 'id,token_hash,tenant_id,agent_id,version,origin,expires',
  runs: 'id,session_id,tenant_id,agent_id,request_id,question,answer,status,response,action_name,created_at',
  receipts: 'id,session_id,run_id,action_name,arguments,status,message'
};
function savedRows(db: DatabaseSync) {
  return Object.fromEntries(Object.entries(legacyColumns).map(([table, columns]) => [table, JSON.parse(JSON.stringify(db.prepare(`SELECT ${columns} FROM ${table} ORDER BY 1`).all()))]));
}
function schema(db: DatabaseSync) { return JSON.parse(JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all())); }

test('a real persisted schema-1 workspace upgrades without losing accounts, knowledge, immutable releases, sessions or history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-legacy-schema-')), path = join(dir, 'guidekit.sqlite'), secret = 'synthetic-legacy-session-secret-preserved-for-this-test-only-0001';
  let repo: Repository | undefined, legacy: DatabaseSync | undefined;
  try {
    await writeFile(join(dir, 'session.secret'), secret, { mode: 0o600 }); legacy = new DatabaseSync(path);
    // This is the shipped schema-1 layout, not a current Repository with its migration marker changed.
    legacy.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL);
      CREATE TABLE dashboard_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE agents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),config TEXT NOT NULL,published_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE documents(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),title TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE versions(agent_id TEXT NOT NULL REFERENCES agents(id),number INTEGER NOT NULL,config TEXT NOT NULL,documents TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(agent_id,number));
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(tenant_id UNINDEXED,agent_id UNINDEXED,version UNINDEXED,document_id UNINDEXED,title,content);
      CREATE TABLE embed_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,tenant_id TEXT NOT NULL,agent_id TEXT NOT NULL,version INTEGER NOT NULL,origin TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE runs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES embed_sessions(id),tenant_id TEXT NOT NULL,agent_id TEXT NOT NULL,request_id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,response TEXT,action_name TEXT,created_at TEXT NOT NULL,UNIQUE(session_id,request_id));
      CREATE TABLE receipts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES embed_sessions(id),run_id TEXT NOT NULL REFERENCES runs(id),action_name TEXT NOT NULL,arguments TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',message TEXT NOT NULL DEFAULT '');
      CREATE INDEX runs_agent_created ON runs(agent_id,created_at DESC);
      CREATE INDEX documents_agent ON documents(agent_id);
    `);
    const passwordHash = await hash('synthetic-legacy-password', { memoryCost: 19456, timeCost: 2, parallelism: 1 }), expires = Date.now() + 60_000;
    legacy.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(timestamp); legacy.prepare('INSERT INTO tenants VALUES(?,?)').run('org_legacy', 'Legacy company');
    legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('usr_legacy', 'org_legacy', 'legacy@example.invalid', 'Original owner', passwordHash);
    legacy.prepare('INSERT INTO dashboard_sessions VALUES(?,?,?)').run('dashboard_legacy', JSON.stringify({ userId: 'usr_legacy', cookie: { path: '/', expires: new Date(expires).toISOString() } }), expires);
    legacy.prepare('INSERT INTO agents VALUES(?,?,?,?,?,?)').run('agt_legacy', 'org_legacy', JSON.stringify(config), 1, timestamp, timestamp);
    legacy.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(document.id, 'agt_legacy', 'Newer unpublished draft', 'Unpublished draft changes must remain separate.', timestamp);
    legacy.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run('agt_legacy', 1, JSON.stringify(config), JSON.stringify([document]), timestamp);
    legacy.prepare('INSERT INTO knowledge_fts VALUES(?,?,?,?,?,?)').run('org_legacy', 'agt_legacy', 1, document.id, document.title, document.content);
    legacy.prepare('INSERT INTO embed_sessions VALUES(?,?,?,?,?,?,?)').run('ses_legacy', 'synthetic-legacy-token-digest', 'org_legacy', 'agt_legacy', 1, config.allowedOrigins[0]!, expires);
    legacy.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('run_legacy', 'ses_legacy', 'org_legacy', 'agt_legacy', 'request_legacy', 'How do I export contacts?', 'Use directory export.', 'action_succeeded', JSON.stringify({ answer: 'Use directory export.' }), 'create.contact', timestamp);
    legacy.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)').run('rcp_legacy', 'ses_legacy', 'run_legacy', 'create.contact', JSON.stringify({ name: 'Synthetic legacy contact' }), 'succeeded', 'Website verified the result.');
    const before = savedRows(legacy); legacy.close(); legacy = undefined;

    repo = new Repository(dir); assert.deepEqual(savedRows(repo.db), before);
    assert.deepEqual(repo.rows('SELECT version FROM schema_migrations ORDER BY version').map(row => row.version), [1, 2, 3]);
    assert.equal(repo.row('SELECT applied_at FROM schema_migrations WHERE version=1')!.applied_at, timestamp);
    assert.equal(repo.workspace('usr_legacy')!.role, 'owner'); assert.equal(repo.workspace('usr_legacy')!.user.emailVerified, false);
    assert.equal(repo.row('SELECT auth_epoch FROM users WHERE id=?', 'usr_legacy')!.auth_epoch, 0);
    assert.equal(await verify(String(repo.row('SELECT password_hash FROM users WHERE id=?', 'usr_legacy')!.password_hash), 'synthetic-legacy-password'), true);
    const session = await new Promise<any>((accept, reject) => new SqliteSessionStore(repo!).get('dashboard_legacy', (error, value) => error ? reject(error) : accept(value)));
    assert.equal(session.userId, 'usr_legacy'); assert.equal(session.authEpoch ?? 0, 0);
    assert.equal(repo.agent('org_legacy', 'agt_legacy').publishedVersion, 1); assert.equal(repo.version('org_legacy', 'agt_legacy', 1).version.status, 'ready');
    assert.deepEqual(repo.published('agt_legacy').documents, [document]); assert.equal(repo.documents('org_legacy', 'agt_legacy')[0]!.title, 'Newer unpublished draft');
    assert.equal(repo.retrieve('org_legacy', 'agt_legacy', 1, 'export contacts')[0]!.excerpt, document.content);
    assert.equal(repo.row('SELECT duration_ms,error_code,request_hash FROM runs WHERE id=?', 'run_legacy')!.duration_ms, null);
    const publications = new Publications(repo); await publications.close(); const upgraded = { rows: savedRows(repo.db), schema: schema(repo.db), states: JSON.parse(JSON.stringify(repo.rows('SELECT * FROM publication_states'))) };
    repo.close(); repo = new Repository(dir);
    assert.deepEqual({ rows: savedRows(repo.db), schema: schema(repo.db), states: JSON.parse(JSON.stringify(repo.rows('SELECT * FROM publication_states'))) }, upgraded);
    assert.equal(await readFile(join(dir, 'session.secret'), 'utf8'), secret); assert.equal(repo.row('PRAGMA integrity_check')!.integrity_check, 'ok');
  } finally { legacy?.close(); repo?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a future schema-4 database is rejected without changing saved rows, schema or its signing secret', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-future-schema-')); let repo: Repository | undefined, inspect: DatabaseSync | undefined;
  try {
    repo = new Repository(dir); const owner = repo.register({ email: 'future@example.invalid', name: 'Future owner', companyName: 'Future' }, 'synthetic-future-password-hash');
    const agent = repo.createAgent(owner.tenant.id, config); repo.addDocument(owner.tenant.id, agent.id, document); repo.publish(owner.tenant.id, agent.id);
    repo.db.exec("CREATE TABLE future_only(id TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO future_only VALUES('future','preserve this future data'); INSERT INTO schema_migrations VALUES(4,'2026-10-29T00:00:00Z')");
    const before = { rows: savedRows(repo.db), schema: schema(repo.db), markers: JSON.parse(JSON.stringify(repo.rows('SELECT * FROM schema_migrations ORDER BY version'))), future: repo.row('SELECT value FROM future_only')!.value }, secret = repo.sessionSecret;
    repo.close(); repo = undefined; assert.throws(() => new Repository(dir), /newer GuideKit release/);
    inspect = new DatabaseSync(join(dir, 'guidekit.sqlite'));
    assert.deepEqual({ rows: savedRows(inspect), schema: schema(inspect), markers: JSON.parse(JSON.stringify(inspect.prepare('SELECT * FROM schema_migrations ORDER BY version').all())), future: (inspect.prepare('SELECT value FROM future_only').get() as { value: string }).value }, before);
    assert.equal(await readFile(join(dir, 'session.secret'), 'utf8'), secret); assert.equal((inspect.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  } finally { repo?.close(); inspect?.close(); await rm(dir, { recursive: true, force: true }); }
});
