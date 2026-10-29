import type { DatabaseSync } from 'node:sqlite';

/** Forward-only, transactional upgrades. Existing version contents never change. */
export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 1);
  if (current > 3) throw new Error('This database was created by a newer GuideKit release. Use a compatible server.');
  if (current < 2) { db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE agents ADD COLUMN release_epoch INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE publication_states (
        agent_id TEXT NOT NULL, version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('preparing','syncing','ready','failed')),
        graph_source TEXT NOT NULL CHECK(graph_source IN ('local','tigergraph')),
        error TEXT, completed_at TEXT, activation_epoch INTEGER NOT NULL,
        legacy INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(agent_id,version),
        FOREIGN KEY(agent_id,version) REFERENCES versions(agent_id,number)
      );
      INSERT INTO publication_states
        SELECT agent_id,number,'ready','local',NULL,created_at,-1,1 FROM versions;
      INSERT INTO schema_migrations VALUES (2,datetime('now'));
    `);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; } }
  if (current < 3) { db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE users ADD COLUMN verified_at TEXT;
        ALTER TABLE users ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE memberships (user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),created_at TEXT NOT NULL,PRIMARY KEY(user_id,tenant_id));
        INSERT INTO memberships SELECT id,tenant_id,'owner',datetime('now') FROM users;
        CREATE TABLE account_tokens (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,purpose TEXT NOT NULL CHECK(purpose IN ('reset','verify','invite')),user_id TEXT REFERENCES users(id),tenant_id TEXT REFERENCES tenants(id),email TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
        CREATE INDEX account_tokens_scope ON account_tokens(tenant_id,purpose,expires);
        CREATE TABLE audit_events (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),actor_id TEXT NOT NULL,event TEXT NOT NULL,resource_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX audit_events_tenant ON audit_events(tenant_id,created_at DESC);
        ALTER TABLE runs ADD COLUMN duration_ms INTEGER;
        ALTER TABLE runs ADD COLUMN error_code TEXT;
        ALTER TABLE runs ADD COLUMN request_hash TEXT;
        INSERT INTO schema_migrations VALUES (3,datetime('now'));
      `);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
