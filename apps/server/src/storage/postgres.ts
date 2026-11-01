import { Pool, type PoolClient, type QueryResult } from 'pg';
import { AppError } from '../database.js';
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

/** The web application may never use a migration/owner connection. */
export async function assertRuntimeRole(client: Pick<PoolClient, 'query'>): Promise<void> {
  const result = await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
    EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole) AND pg_has_role(current_user,p.oid,'MEMBER')) AS privileged_member,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p')
      AND c.relname IN ('tenants','users','dashboard_sessions','agents','documents','versions','publication_states','knowledge_fts','embed_sessions','runs','receipts','memberships','account_tokens','audit_events','guidekit_schema_migrations')
      AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_product_tables
    FROM pg_roles r WHERE r.rolname=current_user`);
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.privileged_member || role.owns_product_tables) throw new Error('PostgreSQL application access requires a separate restricted role without database ownership or privileged memberships. Use the explicit owner migration path for administration.');
}

/** Infrastructure failures use bounded public messages; SQL constraint codes remain available internally. */
export function postgresError(error: unknown): unknown {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : '';
  if (['ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENOTFOUND','EHOSTUNREACH','53300','57P03'].includes(code ?? '') || code?.startsWith('08') || /^timeout exceeded when trying to connect$/i.test(message) || /^Connection terminated due to connection timeout$/i.test(message)) return new AppError(503, 'The database is temporarily unavailable or busy. Please retry shortly.');
  return error;
}

export class PostgresDriver implements SQLDriver {
  readonly dialect = 'postgres' as const;
  private readonly storage = transactionStorage<PoolClient>();
  private closed = false;
  private constructor(private readonly pool: Pool) {}
  static async open(connectionString: string, migrate = false, adminOperation = false): Promise<PostgresDriver> {
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
    try { const client = await pool.connect(); try { if (migrate) await migratePostgres(client); else { await verifyPostgres(client); if (!adminOperation) await assertRuntimeRole(client); } } finally { client.release(); } return driver; }
    catch (error) { await pool.end(); throw error; }
  }
  private async query(sql: string, values: SQLValue[] = []): Promise<QueryResult> {
    if (this.closed) throw new Error('Repository is closed.');
    const context = this.storage.getStore();
    if (context && !context.active) throw new Error('Transaction is no longer active.');
    try { return await (context?.resource ?? this.pool).query(postgresSQL(sql), values); }
    catch (error) { throw postgresError(error); }
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
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch (error) { throw postgresError(error); }
    const context = { resource: client, active: true, savepoint: 0 };
    try {
      return await this.storage.run(context, async () => {
        await client.query('BEGIN');
        try { const result = await fn(); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { context.active = false; }
      });
    } finally { context.active = false; client.release(); }
  }
  async close(): Promise<void> { if (!this.closed) { this.closed = true; await this.pool.end(); } }
}
