import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyArchive, assertOffline } from './storage-archive.js';
import { PostgresDriver } from '../apps/server/src/storage/postgres.js';
import type { SQLDriver, SQLRow, SQLValue } from '../apps/server/src/storage/driver.js';

/** Fixed, audited transfer schema. No identifier or SQL fragment comes from archive data. */
const TABLES = [
  { name: 'tenants', columns: ['id','name'], order: 'id' },
  { name: 'users', columns: ['id','tenant_id','email','name','password_hash','verified_at','auth_epoch'], numbers: ['auth_epoch'], order: 'id' },
  { name: 'dashboard_sessions', columns: ['id','data','expires'], numbers: ['expires'], order: 'id' },
  { name: 'agents', columns: ['id','tenant_id','config','published_version','created_at','updated_at','release_epoch'], numbers: ['published_version','release_epoch'], order: 'id' },
  { name: 'documents', columns: ['id','agent_id','title','content','created_at'], order: 'id' },
  { name: 'versions', columns: ['agent_id','number','config','documents','created_at'], numbers: ['number'], order: 'agent_id,number' },
  { name: 'publication_states', columns: ['agent_id','version','status','graph_source','error','completed_at','activation_epoch','legacy'], numbers: ['version','activation_epoch','legacy'], order: 'agent_id,version' },
  { name: 'knowledge_fts', columns: ['tenant_id','agent_id','version','document_id','title','content'], numbers: ['version'], order: 'id' },
  { name: 'embed_sessions', columns: ['id','token_hash','tenant_id','agent_id','version','origin','expires'], numbers: ['version','expires'], order: 'id' },
  { name: 'runs', columns: ['id','session_id','tenant_id','agent_id','request_id','question','answer','status','response','action_name','created_at','duration_ms','error_code','request_hash'], numbers: ['duration_ms'], order: 'id' },
  { name: 'receipts', columns: ['id','session_id','run_id','action_name','arguments','status','message'], order: 'id' },
  { name: 'memberships', columns: ['user_id','tenant_id','role','created_at'], order: 'user_id,tenant_id' },
  { name: 'account_tokens', columns: ['id','token_hash','purpose','user_id','tenant_id','email','payload','expires','consumed_at','created_at'], numbers: ['expires'], order: 'id' },
  { name: 'audit_events', columns: ['id','tenant_id','actor_id','event','resource_id','details','created_at'], order: 'id' },
] as const;
type Table = (typeof TABLES)[number];
export interface TableFingerprint { rows: number; sha256: string }
export interface PostgreSQLImportResult {
  applied: boolean; idempotent: boolean; hash: string; archiveHash: string;
  counts: Record<string, number>; tables: Record<string, TableFingerprint>;
}
export interface PostgreSQLImportOptions { archive: string; connectionString: string; apply?: boolean }
const MAX_ROWS_PER_TABLE = 2_000_000;
const BATCH = 200;
const hash = (input: string) => createHash('sha256').update(input).digest('hex');
function normalize(table: Table, row: Record<string, unknown>): SQLValue[] {
  const numeric: readonly string[] = 'numbers' in table ? table.numbers : [];
  return table.columns.map(column => {
    const value = row[column];
    if (value === null) return null;
    if (numeric.includes(column)) {
      const integer = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
      if (typeof integer !== 'number' || !Number.isSafeInteger(integer)) throw new Error(`Archive has an unsafe numeric value in ${table.name}.${column}.`);
      return integer;
    }
    if (typeof value !== 'string') throw new Error(`Archive has an incompatible value in ${table.name}.${column}.`);
    return value;
  });
}
function fingerprint(rows: string[]): TableFingerprint { return { rows: rows.length, sha256: hash(rows.sort().join('\n')) }; }
function rowHash(table: Table, row: Record<string, unknown>): string { return hash(JSON.stringify(normalize(table, row))); }
function sourceState(source: DatabaseSync): Record<string, TableFingerprint> {
  const allowed = new Set<string>([...TABLES.map(table => table.name), 'schema_migrations', 'repository_migrations', 'knowledge_fts_data', 'knowledge_fts_idx', 'knowledge_fts_content', 'knowledge_fts_docsize', 'knowledge_fts_config']);
  const names = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name));
  if (names.some(name => !allowed.has(name))) throw new Error('The source contains unsupported tables. Use a compatible explicit migration; nothing was imported.');
  const result: Record<string, TableFingerprint> = {};
  for (const table of TABLES) {
    const columns = source.prepare(`PRAGMA table_info(${table.name})`).all().map(row => String(row.name)).sort();
    if (columns.join(',') !== [...table.columns].sort().join(',')) throw new Error(`The source ${table.name} schema is incompatible. Nothing was imported.`);
    const rows: string[] = [];
    for (const row of source.prepare(`SELECT ${table.columns.join(',')} FROM ${table.name}`).iterate()) {
      if (rows.length >= MAX_ROWS_PER_TABLE) throw new Error('This importer supports up to two million rows per table. Use a streaming migration for larger databases.');
      rows.push(rowHash(table, row));
    }
    result[table.name] = fingerprint(rows);
  }
  return result;
}
function validateScope(source: DatabaseSync): void {
  const checks = [
    'SELECT e.id FROM embed_sessions e LEFT JOIN agents a ON a.id=e.agent_id LEFT JOIN versions v ON v.agent_id=e.agent_id AND v.number=e.version WHERE a.id IS NULL OR a.tenant_id<>e.tenant_id OR v.agent_id IS NULL LIMIT 1',
    'SELECT r.id FROM runs r LEFT JOIN embed_sessions e ON e.id=r.session_id WHERE e.id IS NULL OR e.tenant_id<>r.tenant_id OR e.agent_id<>r.agent_id LIMIT 1',
    'SELECT r.id FROM receipts r LEFT JOIN runs run ON run.id=r.run_id WHERE run.id IS NULL OR run.session_id<>r.session_id LIMIT 1',
    'SELECT k.document_id FROM knowledge_fts k LEFT JOIN agents a ON a.id=k.agent_id LEFT JOIN versions v ON v.agent_id=k.agent_id AND v.number=k.version WHERE a.id IS NULL OR a.tenant_id<>k.tenant_id OR v.agent_id IS NULL LIMIT 1',
    'SELECT a.id FROM agents a LEFT JOIN versions v ON v.agent_id=a.id AND v.number=a.published_version WHERE a.published_version IS NOT NULL AND v.agent_id IS NULL LIMIT 1',
  ];
  if (checks.some(query => source.prepare(query).get())) throw new Error('Source scope or version relationships are inconsistent. Nothing was imported.');
  for (const version of source.prepare('SELECT agent_id,number,documents FROM versions').iterate()) {
    let documents: { id: string; title: string; content: string }[];
    try { documents = JSON.parse(String(version.documents)); if (!Array.isArray(documents)) throw new Error(); }
    catch { throw new Error('Source version snapshots contain invalid documents. Nothing was imported.'); }
    const documentMap = new Map(documents.map(document => [document.id, document]));
    for (const chunk of source.prepare('SELECT document_id,title,content FROM knowledge_fts WHERE agent_id=? AND version=?').iterate(String(version.agent_id), Number(version.number))) {
      const document = documentMap.get(String(chunk.document_id));
      if (!document || typeof document.content !== 'string' || document.title !== chunk.title || !document.content.includes(String(chunk.content))) throw new Error('Source citations do not match their immutable published documents. Nothing was imported.');
    }
  }
}
async function targetState(driver: SQLDriver): Promise<Record<string, TableFingerprint>> {
  const result: Record<string, TableFingerprint> = {};
  for (const table of TABLES) {
    const hashes: string[] = [];
    for (let offset = 0; ; offset += BATCH) {
      const rows = await driver.prepare(`SELECT ${table.columns.join(',')} FROM ${table.name} ORDER BY ${table.order} LIMIT ${BATCH} OFFSET ?`).all(offset);
      for (const row of rows) { if (hashes.length >= MAX_ROWS_PER_TABLE) throw new Error('Target table exceeds the supported import verification size.'); hashes.push(rowHash(table, row)); }
      if (rows.length < BATCH) break;
    }
    result[table.name] = fingerprint(hashes);
  }
  return result;
}
async function copyTable(driver: SQLDriver, source: DatabaseSync, table: Table): Promise<void> {
  let values: SQLValue[][] = [];
  const write = async () => {
    if (!values.length) return;
    const placeholders = values.map(() => `(${table.columns.map(() => '?').join(',')})`).join(',');
    await driver.prepare(`INSERT INTO ${table.name} (${table.columns.join(',')}) VALUES ${placeholders}`).run(...values.flat());
    values = [];
  };
  // The source archive is held in a read-only SQLite snapshot for the complete import.
  for (const row of source.prepare(`SELECT ${table.columns.join(',')} FROM ${table.name}`).iterate()) {
    values.push(normalize(table, row)); if (values.length >= BATCH) await write();
  }
  await write();
}
function sameTables(left: Record<string, TableFingerprint>, right: Record<string, TableFingerprint>): boolean { return TABLES.every(table => left[table.name]?.rows === right[table.name]?.rows && left[table.name]?.sha256 === right[table.name]?.sha256); }

/** Verified archive -> empty target only. It never writes the source or changes runtime configuration. */
export async function importSQLiteArchive(options: PostgreSQLImportOptions): Promise<PostgreSQLImportResult> {
  const archive = resolve(options.archive), manifest = await verifyArchive(archive);
  if (manifest.databaseSchemaVersion !== 3) throw new Error('This importer requires an archived GuideKit SQLite schema version 3. Upgrade a copy using a compatible release first.');
  const source = new DatabaseSync(resolve(archive, 'guidekit.sqlite'), { readOnly: true, timeout: 5000 });
  let driver: PostgresDriver | undefined;
  try {
    source.exec('BEGIN');
    const tables = sourceState(source); validateScope(source);
    const counts = Object.fromEntries(Object.entries(tables).map(([name, value]) => [name, value.rows]));
    const archiveHash = hash(JSON.stringify(manifest.files));
    const contentHash = hash(JSON.stringify({ format: 'guidekit-sqlite-to-postgres-1', tables, sessionSecret: manifest.files['session.secret'].sha256 }));
    const result: PostgreSQLImportResult = { applied: false, idempotent: false, hash: contentHash, archiveHash, counts, tables };
    if (!options.apply) { await verifyArchive(archive); return result; }
    driver = await PostgresDriver.open(options.connectionString, true);
    const activeDriver = driver;
    return await driver.transaction(async () => {
      await activeDriver.prepare("SELECT pg_advisory_xact_lock(hashtext('guidekit:sqlite-import'))").get();
      // Block concurrent product writers; the operator must also stop the application before apply.
      await activeDriver.exec(`LOCK TABLE ${TABLES.map(table => table.name).join(',')} IN ACCESS EXCLUSIVE MODE`);
      await activeDriver.exec('CREATE TABLE IF NOT EXISTS postgres_imports (source_hash TEXT PRIMARY KEY,manifest TEXT NOT NULL,imported_at TEXT NOT NULL)');
      const previous = await activeDriver.prepare('SELECT source_hash,manifest FROM postgres_imports').all();
      if (previous.length) {
        if (previous.length !== 1 || previous[0].source_hash !== contentHash) throw new Error('Target records a different import. Existing data was not changed.');
        const current = await targetState(activeDriver);
        if (!sameTables(tables, current)) throw new Error('Target changed since its recorded import. Existing data was not changed.');
        await verifyArchive(archive);
        return { ...result, applied: true, idempotent: true };
      }
      for (const table of TABLES) {
        const count = Number((await activeDriver.prepare(`SELECT COUNT(*) AS count FROM ${table.name}`).get())?.count);
        if (count) throw new Error('Target database is not empty. Import requires a new empty database; existing data was not changed.');
      }
      for (const table of TABLES) await copyTable(activeDriver, source, table);
      const imported = await targetState(activeDriver);
      if (!sameTables(tables, imported)) throw new Error('Imported rows failed full-content verification. The import was rolled back.');
      await verifyArchive(archive);
      await activeDriver.prepare('INSERT INTO postgres_imports VALUES (?,?,?)').run(contentHash, JSON.stringify({ format: 1, archiveHash, tables, secretHash: manifest.files['session.secret'].sha256 }), new Date().toISOString());
      return { ...result, applied: true };
    });
  } catch (error) {
    // Provider messages/details can contain account emails, row contents or endpoint credentials.
    if (error && typeof error === 'object' && 'code' in error) throw new Error('PostgreSQL import failed. No source data was changed; verify target permissions, connectivity and schema compatibility.');
    throw error;
  } finally { source.close(); await driver?.close(); }
}

export async function postgresImportCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { archive: { type: 'string' }, apply: { type: 'boolean' }, offline: { type: 'boolean' }, 'data-dir': { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: node --import tsx scripts/postgres-import.ts --archive VERIFIED_ARCHIVE [--apply --offline --data-dir PATH --port 4410]\nDry run prints table counts and content hashes only. Apply requires GUIDEKIT_DATABASE_URL_DIRECT for an empty target and a stopped application.'); return; }
  if (!values.archive) throw new Error('Import requires an explicit --archive path.');
  if (values.apply && !values.offline) throw new Error('Apply requires --offline after stopping GuideKit.');
  const connectionString = process.env.GUIDEKIT_DATABASE_URL_DIRECT;
  if (values.apply && !connectionString) throw new Error('Apply requires GUIDEKIT_DATABASE_URL_DIRECT for the owner migration connection.');
  if (values.apply) await assertOffline(values['data-dir'] ?? values.archive, values.port === undefined ? 4410 : Number(values.port));
  const result = await importSQLiteArchive({ archive: values.archive, connectionString: connectionString ?? '', apply: values.apply });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) postgresImportCli().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed.'); process.exitCode = 1; });
