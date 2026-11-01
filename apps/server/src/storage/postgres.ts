import { Pool, type PoolClient, type QueryResult } from 'pg';
import { transactionStorage, type SQLDriver, type SQLStatement, type SQLValue } from './driver.js';
import { migratePostgres, verifyPostgres } from './postgres-schema.js';

/** Translate only server-authored SQL; values remain independent bound parameters. */
export function postgresSQL(input: string): string {
  let sql = input.replace(/json_extract\(data,'\$\.userId'\)/g, "(data::jsonb->>'userId')")
    .replace(/\bIS\s+\?/g, 'IS NOT DISTINCT FROM ?')
    .replace(/\?\s+IS NULL\b/g, 'CAST(? AS TEXT) IS NULL')
    .replace(/\bAS\s+([a-z][a-z0-9]*[A-Z][A-Za-z0-9_]*)\b/g, 'AS "$1"');
  const ignore = /^\s*INSERT OR IGNORE\s+INTO\b/i.test(sql);
  const replaceSession = /^\s*INSERT OR REPLACE\s+INTO dashboard_sessions\b/i.test(sql);
  if (/\bINSERT OR REPLACE\b/i.test(sql) && !replaceSession) throw new Error('Unsupported SQL replace operation.');
  sql = sql.replace(/^\s*INSERT OR (IGNORE|REPLACE)\s+INTO\b/i, 'INSERT INTO');
  if (ignore) sql = sql.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  if (replaceSession) sql = sql.replace(/;?\s*$/, ' ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,expires=EXCLUDED.expires');
  let result = '', parameter = 0, quote: string | undefined;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];
    if (quote) {
      result += character;
      if (character === quote) { if (sql[index + 1] === quote) result += sql[++index]; else quote = undefined; }
    } else if (character === "'" || character === '"') { quote = character; result += character; }
    else result += character === '?' ? `$${++parameter}` : character;
  }
  return result;
}

export class PostgresDriver implements SQLDriver {
  readonly dialect = 'postgres' as const;
  private readonly storage = transactionStorage<PoolClient>();
  private closed = false;
  private constructor(private readonly pool: Pool) {}
  static async open(connectionString: string, migrate = false): Promise<PostgresDriver> {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL connection URL.');
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (!local) {
      const mode = url.searchParams.get('sslmode');
      if (mode && !['require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error('Remote PostgreSQL requires TLS with certificate verification.');
      // pg connection URL sslmode=require otherwise permits unverifiable certificates.
      url.searchParams.set('sslmode', 'verify-full');
    }
    const pool = new Pool({ connectionString: url.toString(), max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, statement_timeout: 30_000, application_name: 'guidekit' });
    // Idle connection errors must not become uncaught process exceptions. Next requests fail normally.
    pool.on('error', () => {});
    const driver = new PostgresDriver(pool);
    try { const client = await pool.connect(); try { if (migrate) await migratePostgres(client); else await verifyPostgres(client); } finally { client.release(); } return driver; }
    catch (error) { await pool.end(); throw error; }
  }
  private async query(sql: string, values: SQLValue[] = []): Promise<QueryResult> {
    if (this.closed) throw new Error('Repository is closed.');
    const context = this.storage.getStore();
    if (context && !context.active) throw new Error('Transaction is no longer active.');
    return (context?.resource ?? this.pool).query(postgresSQL(sql), values);
  }
  prepare(sql: string): SQLStatement {
    return {
      run: async (...values) => ({ changes: (await this.query(sql, values)).rowCount ?? 0 }),
      get: async (...values) => (await this.query(sql, values)).rows[0],
      all: async (...values) => (await this.query(sql, values)).rows,
    };
  }
  async exec(sql: string): Promise<void> { await this.query(sql); }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.storage.getStore();
    if (parent) {
      if (!parent.active) throw new Error('Transaction is no longer active.');
      const name = `guidekit_${++parent.savepoint}`;
      await parent.resource.query(`SAVEPOINT ${name}`);
      try { const result = await fn(); await parent.resource.query(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await parent.resource.query(`ROLLBACK TO SAVEPOINT ${name}`); await parent.resource.query(`RELEASE SAVEPOINT ${name}`); throw error; }
    }
    if (this.closed) throw new Error('Repository is closed.');
    const client = await this.pool.connect();
    const context = { resource: client, active: true, savepoint: 0 };
    try {
      return await this.storage.run(context, async () => {
        await client.query('BEGIN');
        try { const result = await fn(); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { context.active = false; }
      });
    } finally { client.release(); }
  }
  async close(): Promise<void> { if (!this.closed) { this.closed = true; await this.pool.end(); } }
}
