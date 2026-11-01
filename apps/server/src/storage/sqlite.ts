import { Repository } from '../database.js';
import { Mutex, transactionStorage, type SQLDriver, type SQLStatement, type SQLValue } from './driver.js';

/** Legacy schema stays available to backup/restore tools; new code always awaits this driver. */
export class SqliteDriver implements SQLDriver {
  readonly dialect = 'sqlite' as const;
  private readonly mutex = new Mutex();
  private readonly storage = transactionStorage<true>();
  private closed = false;
  readonly sessionSecret: string;
  constructor(private readonly legacy: Repository) { this.sessionSecret = legacy.sessionSecret; }
  static async open(dir: string): Promise<SqliteDriver> {
    const legacy = new Repository(dir);
    try {
      // A separate marker avoids changing the legacy SQLite migration/version contract.
      legacy.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS repository_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      `);
      const migrated = legacy.row('SELECT version FROM repository_migrations WHERE version=1');
      if (!migrated) {
        legacy.db.exec(`CREATE TABLE publication_states_next (
          agent_id TEXT NOT NULL, version INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('preparing','syncing','ready','failed')),
          graph_source TEXT NOT NULL CHECK(graph_source IN ('local','tigergraph','postgres')),
          error TEXT, completed_at TEXT, activation_epoch INTEGER NOT NULL, legacy INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(agent_id,version), FOREIGN KEY(agent_id,version) REFERENCES versions(agent_id,number));
          INSERT INTO publication_states_next SELECT * FROM publication_states;
          DROP TABLE publication_states;
          ALTER TABLE publication_states_next RENAME TO publication_states;
          INSERT INTO repository_migrations VALUES (1,datetime('now'));
        `);
      }
      legacy.db.exec('COMMIT');
      return new SqliteDriver(legacy);
    } catch (error) { try { legacy.db.exec('ROLLBACK'); } finally { legacy.close(); } throw error; }
  }
  private async access<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Repository is closed.');
    const context = this.storage.getStore();
    if (context) { if (!context.active) throw new Error('Transaction is no longer active.'); return fn(); }
    return this.mutex.run(async () => { if (this.closed) throw new Error('Repository is closed.'); return fn(); });
  }
  prepare(sql: string): SQLStatement {
    return {
      run: (...values: SQLValue[]) => this.access(() => { const result = this.legacy.db.prepare(sql).run(...values); return { changes: Number(result.changes) }; }),
      get: (...values: SQLValue[]) => this.access(() => this.legacy.db.prepare(sql).get(...values) as ReturnType<Repository['row']>),
      all: (...values: SQLValue[]) => this.access(() => this.legacy.db.prepare(sql).all(...values) as ReturnType<Repository['rows']>),
    };
  }
  async exec(sql: string): Promise<void> { await this.access(() => this.legacy.db.exec(sql)); }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.storage.getStore();
    if (parent) {
      if (!parent.active) throw new Error('Transaction is no longer active.');
      const name = `guidekit_${++parent.savepoint}`;
      this.legacy.db.exec(`SAVEPOINT ${name}`);
      try { const result = await fn(); this.legacy.db.exec(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { this.legacy.db.exec(`ROLLBACK TO SAVEPOINT ${name}`); this.legacy.db.exec(`RELEASE SAVEPOINT ${name}`); throw error; }
    }
    return this.mutex.run(async () => {
      if (this.closed) throw new Error('Repository is closed.');
      const context = { resource: true as const, active: true, savepoint: 0 };
      return this.storage.run(context, async () => {
        this.legacy.db.exec('BEGIN IMMEDIATE');
        try { const result = await fn(); this.legacy.db.exec('COMMIT'); return result; }
        catch (error) { this.legacy.db.exec('ROLLBACK'); throw error; }
        finally { context.active = false; }
      });
    });
  }
  async close(): Promise<void> { await this.mutex.run(async () => { if (!this.closed) { this.closed = true; this.legacy.close(); } }); }
}
