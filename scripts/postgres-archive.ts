import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PostgresDriver } from '../apps/server/src/storage/postgres.js';
import type { SQLDriver, SQLValue } from '../apps/server/src/storage/driver.js';
import { POSTGRES_PRODUCT_COLUMNS } from './postgres-import.js';
import { assertOffline } from './storage-archive.js';

interface Descriptor { name: string; table: string; columns: readonly string[]; order: string; generated?: readonly string[] }
interface FileDigest { bytes: number; sha256: string }
interface TableDigest { rows: number; sha256: string }
export interface PostgresArchiveManifest {
  format: 'guidekit-postgres-backup'; formatVersion: 1; createdAt: string;
  productSchemaVersion: 1; knowledgeSchemaVersion: 1; importsTablePresent: boolean;
  files: Record<string, FileDigest>; tables: Record<string, TableDigest>;
}
export interface PostgresBackupOptions { connectionString: string; dataDir: string; destination: string; knowledgeSchema?: string }
export interface PostgresRestoreOptions { connectionString: string; archive: string; dataDir: string; offline: boolean; port?: number; knowledgeSchema?: string }
const BATCH = 200, MAX_ROWS = 2_000_000, MAX_FILE = 64 * 1024 ** 3, MAX_LINE = 32 * 1024 ** 2;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const fileName = (descriptor: Descriptor) => `${descriptor.name}.jsonl`;
function descriptors(schema = 'guidekit_knowledge'): Descriptor[] {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Knowledge schema must be a simple PostgreSQL identifier.');
  return [
    ...POSTGRES_PRODUCT_COLUMNS.map(table => table.name === 'knowledge_fts'
      ? { ...table, columns: ['id', ...table.columns, 'search_vector'], generated: ['search_vector'] }
      : table),
    { name: 'postgres_imports', table: 'postgres_imports', columns: ['source_hash','manifest','imported_at'], order: 'source_hash' },
    { name: 'knowledge.metadata', table: `${schema}.metadata`, columns: ['singleton','schema_version'], order: 'singleton' },
    { name: 'knowledge.versions', table: `${schema}.versions`, columns: ['tenant_id','agent_id','version','manifest','embedding_model','dimensions','chunk_count','allowed_actions','ready','created_at'], order: 'tenant_id,agent_id,version' },
    { name: 'knowledge.documents', table: `${schema}.documents`, columns: ['tenant_id','agent_id','version','document_id','title','content','content_hash'], order: 'tenant_id,agent_id,version,document_id' },
    { name: 'knowledge.chunks', table: `${schema}.chunks`, columns: ['tenant_id','agent_id','version','document_id','ordinal','source_start','source_end','source_char_start','source_char_end','title','excerpt','embedding','lexical'], generated: ['lexical'], order: 'tenant_id,agent_id,version,document_id,ordinal' },
  ].map(table => ({ ...table, table: 'table' in table ? table.table : table.name }));
}
function values(descriptor: Descriptor, row: Record<string, unknown>): (string | null)[] {
  return descriptor.columns.map(column => { const value = row[column]; if (value === null || typeof value === 'string') return value; throw new Error('PostgreSQL archive values must be canonical text or null.'); });
}
function aggregate(hashes: string[]): TableDigest { return { rows: hashes.length, sha256: sha(hashes.sort().join('\n')) }; }
function select(descriptor: Descriptor): string { return descriptor.columns.map(column => `${column}::text AS ${column}`).join(','); }
function overlap(a: string, b: string): boolean { const path = relative(a, b); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); }
async function regular(path: string, maximum: number, empty = false): Promise<number> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size) || info.size < (empty ? 0 : 1) || info.size > maximum) throw new Error('PostgreSQL archive requires bounded regular files.');
  return info.size;
}
async function fileDigest(path: string, maximum = MAX_FILE, empty = true): Promise<FileDigest> {
  const bytes = await regular(path, maximum, empty), hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { bytes, sha256: hash.digest('hex') };
}
async function* lines(path: string): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const value of createReadStream(path)) {
    const chunk = value as Buffer;
    let start = 0;
    for (let index = 0; index < chunk.length; index++) if (chunk[index] === 10) {
      const segment = chunk.subarray(start, index);
      if (pending.length + segment.length > MAX_LINE) throw new Error('PostgreSQL archive row exceeds the supported size.');
      const row = pending.length ? Buffer.concat([pending, segment]) : segment;
      if (!row.length) throw new Error('PostgreSQL archive contains an empty row.');
      yield decoder.decode(row); pending = Buffer.alloc(0); start = index + 1;
    }
    const tail = chunk.subarray(start);
    if (pending.length + tail.length > MAX_LINE) throw new Error('PostgreSQL archive row exceeds the supported size.');
    if (tail.length) pending = Buffer.concat([pending, tail]);
  }
  if (pending.length) throw new Error('PostgreSQL archive data must end in a newline.');
}
function parseRow(line: string, descriptor: Descriptor): (string | null)[] {
  let row: unknown; try { row = JSON.parse(line); } catch { throw new Error('PostgreSQL archive row is invalid JSON.'); }
  if (!Array.isArray(row) || row.length !== descriptor.columns.length || row.some(value => value !== null && typeof value !== 'string')) throw new Error('PostgreSQL archive row has incompatible columns or values.');
  return row;
}
async function tableFromFile(path: string, descriptor: Descriptor): Promise<TableDigest> {
  const hashes: string[] = [];
  for await (const line of lines(path)) { if (hashes.length >= MAX_ROWS) throw new Error('PostgreSQL archive exceeds two million rows per table.'); hashes.push(sha(JSON.stringify(parseRow(line, descriptor)))); }
  return aggregate(hashes);
}
async function tableFromDatabase(driver: SQLDriver, descriptor: Descriptor): Promise<TableDigest> {
  const hashes: string[] = [];
  for (let offset = 0; ; offset += BATCH) {
    const rows = await driver.prepare(`SELECT ${select(descriptor)} FROM ${descriptor.table} ORDER BY ${descriptor.order} LIMIT ${BATCH} OFFSET ?`).all(offset);
    for (const row of rows) { if (hashes.length >= MAX_ROWS) throw new Error('PostgreSQL archive exceeds two million rows per table.'); hashes.push(sha(JSON.stringify(values(descriptor, row)))); }
    if (rows.length < BATCH) return aggregate(hashes);
  }
}
function validateManifest(value: unknown): asserts value is PostgresArchiveManifest {
  const manifest = value as PostgresArchiveManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'createdAt,files,format,formatVersion,importsTablePresent,knowledgeSchemaVersion,productSchemaVersion,tables' || manifest.format !== 'guidekit-postgres-backup' || manifest.formatVersion !== 1 || manifest.productSchemaVersion !== 1 || manifest.knowledgeSchemaVersion !== 1 || typeof manifest.importsTablePresent !== 'boolean' || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !manifest.files || !manifest.tables) throw new Error('PostgreSQL archive format or schema is unsupported.');
  if (manifest.files['session.secret']?.bytes < 32 || manifest.files['session.secret']?.bytes > 65_536) throw new Error('PostgreSQL archive signing secret has an invalid size.');
  const tables = descriptors(), names = tables.map(table => table.name).sort(), files = [...tables.map(fileName), 'session.secret'].sort();
  if (Object.keys(manifest.tables).sort().join(',') !== names.join(',') || Object.keys(manifest.files).sort().join(',') !== files.join(',')) throw new Error('PostgreSQL archive manifest has incompatible files or tables.');
  for (const digest of Object.values(manifest.files)) if (!digest || Object.keys(digest).sort().join(',') !== 'bytes,sha256' || !Number.isSafeInteger(digest.bytes) || digest.bytes < 0 || digest.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(digest.sha256)) throw new Error('PostgreSQL archive file digest is invalid.');
  for (const digest of Object.values(manifest.tables)) if (!digest || Object.keys(digest).sort().join(',') !== 'rows,sha256' || !Number.isSafeInteger(digest.rows) || digest.rows < 0 || digest.rows > MAX_ROWS || !/^[a-f0-9]{64}$/.test(digest.sha256)) throw new Error('PostgreSQL archive table digest is invalid.');
}
export async function verifyPostgresArchive(input: string): Promise<PostgresArchiveManifest> {
  const archive = resolve(input), info = await lstat(archive);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('PostgreSQL archive must be a real directory.');
  await regular(resolve(archive, 'manifest.json'), 65_536);
  let parsed: unknown; try { parsed = JSON.parse(await readFile(resolve(archive, 'manifest.json'), 'utf8')); } catch { throw new Error('PostgreSQL archive manifest is invalid JSON.'); }
  validateManifest(parsed);
  const expected = [...Object.keys(parsed.files), 'manifest.json', '.gitignore'].sort();
  if ((await readdir(archive)).sort().join(',') !== expected.join(',')) throw new Error('PostgreSQL archive has missing or unexpected files.');
  await regular(resolve(archive, '.gitignore'), 32);
  if (await readFile(resolve(archive, '.gitignore'), 'utf8') !== '*\n') throw new Error('PostgreSQL archive ignore marker is invalid.');
  for (const [file, expectedDigest] of Object.entries(parsed.files)) {
    const actual = await fileDigest(resolve(archive, file), file === 'session.secret' ? 65_536 : MAX_FILE, file !== 'session.secret');
    if (actual.bytes !== expectedDigest.bytes || actual.sha256 !== expectedDigest.sha256) throw new Error('PostgreSQL archive file checksum mismatch.');
  }
  for (const descriptor of descriptors()) {
    const actual = await tableFromFile(resolve(archive, fileName(descriptor)), descriptor), expectedDigest = parsed.tables[descriptor.name];
    if (actual.rows !== expectedDigest.rows || actual.sha256 !== expectedDigest.sha256) throw new Error('PostgreSQL archive table content verification failed.');
  }
  if (!parsed.importsTablePresent && parsed.tables.postgres_imports.rows !== 0) throw new Error('PostgreSQL archive import metadata is inconsistent.');
  return parsed;
}
const safe = (error: unknown): Error => error && typeof error === 'object' && 'code' in error ? new Error('PostgreSQL archive operation failed. Check owner permissions, connectivity and compatible schemas; database details were withheld.') : error instanceof Error ? error : new Error('PostgreSQL archive operation failed.');

/** Includes product records and immutable semantic vectors in one MVCC snapshot. */
export async function createPostgresBackup(options: PostgresBackupOptions): Promise<{ archive: string; manifest: PostgresArchiveManifest }> {
  const archive = resolve(options.destination), dataDir = resolve(options.dataDir), secretPath = resolve(dataDir, 'session.secret');
  if (overlap(dataDir, archive) || overlap(archive, dataDir)) throw new Error('PostgreSQL backup must be outside the data directory.');
  const secretBefore = await fileDigest(secretPath, 65_536, false), secret = await readFile(secretPath);
  if (secret.length < 32) throw new Error('The session secret is invalid.');
  await mkdir(dirname(archive), { recursive: true, mode: 0o700 }); await mkdir(archive, { mode: 0o700 }); await chmod(archive, 0o700);
  let driver: PostgresDriver | undefined;
  try {
    await writeFile(resolve(archive, '.gitignore'), '*\n', { mode: 0o600, flag: 'wx' });
    driver = await PostgresDriver.open(options.connectionString, false, true);
    const active = driver, tables = descriptors(options.knowledgeSchema);
    const manifest = await driver.transaction(async () => {
      await active.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL row_security=off");
      const knowledge = tables.find(table => table.name === 'knowledge.metadata')!;
      if ((await active.prepare(`SELECT schema_version FROM ${knowledge.table} WHERE singleton=true`).get())?.schema_version !== 1) throw new Error('Knowledge schema is not initialized or compatible.');
      const importsTablePresent = !!(await active.prepare("SELECT to_regclass(quote_ident(current_schema()) || '.postgres_imports') AS marker").get())?.marker;
      const files: Record<string, FileDigest> = {}, digests: Record<string, TableDigest> = {};
      for (const descriptor of tables) {
        const path = resolve(archive, fileName(descriptor)), file = await open(path, 'wx', 0o600), hashes: string[] = [];
        try {
          if (descriptor.name !== 'postgres_imports' || importsTablePresent) for (let offset = 0; ; offset += BATCH) {
            const rows = await active.prepare(`SELECT ${select(descriptor)} FROM ${descriptor.table} ORDER BY ${descriptor.order} LIMIT ${BATCH} OFFSET ?`).all(offset);
            for (const row of rows) { if (hashes.length >= MAX_ROWS) throw new Error('PostgreSQL archive exceeds two million rows per table.'); const line = JSON.stringify(values(descriptor, row)); if (Buffer.byteLength(line) > MAX_LINE) throw new Error('PostgreSQL archive row exceeds the supported size.'); hashes.push(sha(line)); await file.writeFile(`${line}\n`); }
            if (rows.length < BATCH) break;
          }
          await file.sync();
        } finally { await file.close(); }
        digests[descriptor.name] = aggregate(hashes); files[fileName(descriptor)] = await fileDigest(path);
      }
      await writeFile(resolve(archive, 'session.secret'), secret, { mode: 0o600, flag: 'wx' }); files['session.secret'] = await fileDigest(resolve(archive, 'session.secret'), 65_536, false);
      const after = await fileDigest(secretPath, 65_536, false);
      if (after.sha256 !== secretBefore.sha256 || files['session.secret'].sha256 !== secretBefore.sha256) throw new Error('The signing secret changed during backup. Coordinate rotation and retry.');
      return { format: 'guidekit-postgres-backup' as const, formatVersion: 1 as const, createdAt: new Date().toISOString(), productSchemaVersion: 1 as const, knowledgeSchemaVersion: 1 as const, importsTablePresent, files, tables: digests };
    });
    await writeFile(resolve(archive, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await verifyPostgresArchive(archive);
    return { archive, manifest };
  } catch (error) { await rm(archive, { recursive: true, force: true }); throw safe(error); }
  finally { await driver?.close(); }
}

async function insertFile(driver: SQLDriver, archive: string, descriptor: Descriptor): Promise<void> {
  if (descriptor.name === 'knowledge.metadata') return;
  const writable = descriptor.columns.filter(column => !descriptor.generated?.includes(column));
  let batch: SQLValue[][] = [];
  const flush = async () => {
    if (!batch.length) return;
    await driver.prepare(`INSERT INTO ${descriptor.table} (${writable.join(',')}) VALUES ${batch.map(() => `(${writable.map(() => '?').join(',')})`).join(',')}`).run(...batch.flat()); batch = [];
  };
  for await (const line of lines(resolve(archive, fileName(descriptor)))) {
    const row = parseRow(line, descriptor);
    batch.push(writable.map(column => column === 'ready' && descriptor.name === 'knowledge.versions' ? 'false' : row[descriptor.columns.indexOf(column)]));
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}

/** Restore only into separately initialized empty schemas; ready-index triggers remain enforced. */
export async function restorePostgresBackup(options: PostgresRestoreOptions): Promise<{ dataDir: string; tables: Record<string, TableDigest> }> {
  if (options.offline !== true) throw new Error('PostgreSQL restore requires explicit offline acknowledgement.');
  const archive = resolve(options.archive), dataDir = resolve(options.dataDir);
  if (overlap(archive, dataDir) || overlap(dataDir, archive)) throw new Error('PostgreSQL restore archive and data directory must be separate.');
  const manifest = await verifyPostgresArchive(archive), secretPath = resolve(dataDir, 'session.secret');
  await assertOffline(dataDir, options.port);
  let hasSecret = false;
  try { const existing = await fileDigest(secretPath, 65_536, false); hasSecret = true; if (existing.sha256 !== manifest.files['session.secret'].sha256) throw new Error('The target signing secret differs. Use a new data directory; an existing secret is never overwritten.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let driver: PostgresDriver | undefined;
  try {
    driver = await PostgresDriver.open(options.connectionString, false, true);
    const active = driver, tables = descriptors(options.knowledgeSchema);
    await driver.transaction(async () => {
      await active.exec("SET LOCAL timezone='UTC'; SET LOCAL row_security=off");
      await active.prepare("SELECT pg_advisory_xact_lock(hashtext('guidekit:postgres-restore'))").get();
      const importsPresent = !!(await active.prepare("SELECT to_regclass(quote_ident(current_schema()) || '.postgres_imports') AS marker").get())?.marker;
      await active.exec(`LOCK TABLE ${tables.filter(table => table.name !== 'postgres_imports' || importsPresent).map(table => table.table).join(',')} IN ACCESS EXCLUSIVE MODE`);
      for (const descriptor of tables) {
        if (descriptor.name === 'postgres_imports' && !importsPresent) continue;
        const count = Number((await active.prepare(`SELECT COUNT(*) AS count FROM ${descriptor.table}`).get())?.count);
        if (descriptor.name === 'knowledge.metadata') { if (count !== 1 || (await active.prepare(`SELECT schema_version FROM ${descriptor.table} WHERE singleton=true`).get())?.schema_version !== 1) throw new Error('Knowledge schema is not initialized or compatible.'); }
        else if (count) throw new Error('PostgreSQL restore requires empty product and knowledge tables. Existing data was not changed.');
      }
      if (manifest.importsTablePresent && !importsPresent) await active.exec('CREATE TABLE postgres_imports (source_hash TEXT PRIMARY KEY,manifest TEXT NOT NULL,imported_at TEXT NOT NULL)');
      for (const descriptor of tables) if (descriptor.name !== 'postgres_imports' || manifest.importsTablePresent) await insertFile(active, archive, descriptor);
      const versions = tables.find(table => table.name === 'knowledge.versions')!;
      for await (const line of lines(resolve(archive, fileName(versions)))) {
        const row = parseRow(line, versions);
        if (row[versions.columns.indexOf('ready')] === 'true') await active.prepare(`UPDATE ${versions.table} SET ready=true WHERE tenant_id=? AND agent_id=? AND version=?`).run(row[0], row[1], row[2]);
      }
      await active.prepare("SELECT setval(pg_get_serial_sequence('knowledge_fts','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM knowledge_fts").get();
      for (const descriptor of tables) {
        const expected = manifest.tables[descriptor.name];
        const actual = descriptor.name === 'postgres_imports' && !manifest.importsTablePresent ? aggregate([]) : await tableFromDatabase(active, descriptor);
        if (actual.rows !== expected.rows || actual.sha256 !== expected.sha256) throw new Error('Restored PostgreSQL rows failed full-content verification. Restore was rolled back.');
      }
      await verifyPostgresArchive(archive);
      if (!hasSecret) {
        await mkdir(dataDir, { recursive: true, mode: 0o700 }); await chmod(dataDir, 0o700);
        const secret = await readFile(resolve(archive, 'session.secret'));
        if (createHash('sha256').update(secret).digest('hex') !== manifest.files['session.secret'].sha256) throw new Error('Archive signing secret changed during restore.');
        await writeFile(secretPath, secret, { mode: 0o600, flag: 'wx' });
      }
    });
    return { dataDir, tables: manifest.tables };
  } catch (error) {
    // Keep a newly staged verified secret: a lost COMMIT acknowledgement must not discard recovery material.
    throw safe(error);
  }
  finally { await driver?.close(); }
}

export async function postgresArchiveCli(args = process.argv.slice(2)): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { 'data-dir': { type: 'string' }, dest: { type: 'string' }, archive: { type: 'string' }, offline: { type: 'boolean' }, apply: { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: postgres-archive.ts backup --data-dir PATH --dest NEW_PRIVATE_ARCHIVE\n       postgres-archive.ts restore --archive ARCHIVE --data-dir PATH --apply --offline [--port 4410]\nUses GUIDEKIT_DATABASE_URL_DIRECT. Restore requires separately initialized empty product and knowledge schemas.'); return; }
  const connectionString = process.env.GUIDEKIT_DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('PostgreSQL archive operations require GUIDEKIT_DATABASE_URL_DIRECT for the owner connection.');
  if (positionals.length !== 1 || !['backup','restore'].includes(positionals[0])) throw new Error('Choose PostgreSQL backup or restore explicitly.');
  if (!values['data-dir']) throw new Error('Supply the actual --data-dir for the signing secret and offline checks.');
  if (positionals[0] === 'backup') {
    if (!values.dest) throw new Error('Backup requires a new --dest archive directory.');
    const result = await createPostgresBackup({ connectionString, dataDir: values['data-dir'], destination: values.dest });
    console.log(JSON.stringify({ archive: result.archive, tables: result.manifest.tables }));
  } else {
    if (!values.archive || !values.apply || !values.offline) throw new Error('Restore requires --archive, --apply and --offline.');
    console.log(JSON.stringify(await restorePostgresBackup({ connectionString, archive: values.archive, dataDir: values['data-dir'], offline: true, port: values.port === undefined ? undefined : Number(values.port) })));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) postgresArchiveCli().catch(error => { console.error(safe(error).message); process.exitCode = 1; });
