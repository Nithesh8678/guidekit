import type { PoolClient } from 'pg';

/** Product data uses portable text JSON and ISO timestamps, preserving SQLite snapshots byte-for-byte. */
export async function migratePostgres(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('guidekit:product-schema'))");
    const marker = await client.query("SELECT to_regclass('guidekit_schema_migrations') AS marker");
    if (!marker.rows[0]?.marker) {
      const conflicts = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('tenants','users','agents','versions','dashboard_sessions','knowledge_fts')");
      if (conflicts.rows.length) throw new Error('This database already contains unmarked product tables. Import into an empty GuideKit database; existing tables were not changed.');
    }
    await client.query('CREATE TABLE IF NOT EXISTS guidekit_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const result = await client.query('SELECT COALESCE(MAX(version),0) AS version FROM guidekit_schema_migrations');
    const current = Number(result.rows[0].version);
    if (current > 1) throw new Error('This PostgreSQL database was created by a newer GuideKit release. Use a compatible server.');
    if (current < 1) {
      await client.query(`
        CREATE TABLE tenants (id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE users (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,verified_at TEXT,auth_epoch INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE dashboard_sessions (id TEXT PRIMARY KEY,data TEXT NOT NULL,expires BIGINT NOT NULL);
        CREATE TABLE agents (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),config TEXT NOT NULL,published_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,release_epoch INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE documents (id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),title TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE versions (agent_id TEXT NOT NULL REFERENCES agents(id),number INTEGER NOT NULL,config TEXT NOT NULL,documents TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(agent_id,number));
        CREATE TABLE publication_states (agent_id TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('preparing','syncing','ready','failed')),graph_source TEXT NOT NULL CHECK(graph_source IN ('local','tigergraph','postgres')),error TEXT,completed_at TEXT,activation_epoch INTEGER NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(agent_id,version),FOREIGN KEY(agent_id,version) REFERENCES versions(agent_id,number));
        CREATE TABLE knowledge_fts (id BIGSERIAL PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),agent_id TEXT NOT NULL,version INTEGER NOT NULL,document_id TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',title || ' ' || content)) STORED,FOREIGN KEY(agent_id,version) REFERENCES versions(agent_id,number));
        CREATE TABLE embed_sessions (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,tenant_id TEXT NOT NULL REFERENCES tenants(id),agent_id TEXT NOT NULL,version INTEGER NOT NULL,origin TEXT NOT NULL,expires BIGINT NOT NULL,FOREIGN KEY(agent_id,version) REFERENCES versions(agent_id,number));
        CREATE TABLE runs (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES embed_sessions(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),agent_id TEXT NOT NULL REFERENCES agents(id),request_id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,response TEXT,action_name TEXT,created_at TEXT NOT NULL,duration_ms INTEGER,error_code TEXT,request_hash TEXT,UNIQUE(session_id,request_id));
        CREATE TABLE receipts (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES embed_sessions(id),run_id TEXT NOT NULL REFERENCES runs(id),action_name TEXT NOT NULL,arguments TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',message TEXT NOT NULL DEFAULT '');
        CREATE TABLE memberships (user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),created_at TEXT NOT NULL,PRIMARY KEY(user_id,tenant_id));
        CREATE TABLE account_tokens (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,purpose TEXT NOT NULL CHECK(purpose IN ('reset','verify','invite')),user_id TEXT REFERENCES users(id),tenant_id TEXT REFERENCES tenants(id),email TEXT NOT NULL,payload TEXT NOT NULL,expires BIGINT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
        CREATE TABLE audit_events (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),actor_id TEXT NOT NULL,event TEXT NOT NULL,resource_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX runs_agent_created ON runs(agent_id,created_at DESC);
        CREATE INDEX documents_agent ON documents(agent_id);
        CREATE INDEX account_tokens_scope ON account_tokens(tenant_id,purpose,expires);
        CREATE INDEX audit_events_tenant ON audit_events(tenant_id,created_at DESC);
        CREATE INDEX dashboard_sessions_expiry ON dashboard_sessions(expires);
        CREATE INDEX embed_sessions_expiry ON embed_sessions(expires);
        CREATE INDEX knowledge_scope ON knowledge_fts(tenant_id,agent_id,version);
        CREATE INDEX knowledge_keyword ON knowledge_fts USING GIN(search_vector);
      `);
      await client.query('INSERT INTO guidekit_schema_migrations VALUES (1,$1)', [new Date().toISOString()]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
