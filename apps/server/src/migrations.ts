import type { DatabaseSync } from 'node:sqlite';

/** Forward-only, transactional upgrades. Existing version contents never change. */
export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 1);
  if (current > 2) throw new Error('This database was created by a newer GuideKit release. Use a compatible server.');
  if (current >= 2) return;
  db.exec('BEGIN IMMEDIATE');
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
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
