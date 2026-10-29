import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const FILES = ['guidekit.sqlite', 'session.secret'] as const;
const ALLOWED = new Set([...FILES, 'manifest.json', '.gitignore']);
const MAX_DATABASE = 64 * 1024 ** 3;
export interface ArchiveManifest {
  format: 'guidekit-backup'; formatVersion: 1; createdAt: string;
  databaseSchemaVersion: number; sqliteUserVersion: number; pages: number;
  files: Record<(typeof FILES)[number], { bytes: number; sha256: string }>;
}
export interface BackupOptions { dataDir: string; destination: string; }
export interface RestoreOptions {
  archive: string; dataDir: string; offline: boolean; force?: boolean;
  /** Probe the actual configured GuideKit port. The default is 4410. */
  port?: number; safetyBackup?: string;
}
export interface RestoreResult { dataDir: string; safetyBackup?: string; previousDir?: string; }

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function directory(path: string): Promise<void> { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a real directory, not a symlink.'); }
async function regular(path: string, maximum: number): Promise<number> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > maximum) throw new Error('Archive input is not a bounded regular file.');
  return info.size;
}
async function fingerprint(path: string): Promise<{ bytes: number; sha256: string }> {
  const bytes = await regular(path, basename(path) === 'session.secret' ? 65_536 : MAX_DATABASE), hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { bytes, sha256: hash.digest('hex') };
}
function metadata(path: string): { databaseSchemaVersion: number; sqliteUserVersion: number } {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    const checks = db.prepare('PRAGMA quick_check').all();
    if (checks.length !== 1 || Object.values(checks[0]!)[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite integrity checks failed.');
    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
    const userVersion = db.prepare('PRAGMA user_version').get()?.user_version;
    if (!Number.isSafeInteger(version) || Number(version) < 1 || !Number.isSafeInteger(userVersion) || Number(userVersion) < 0) throw new Error('A supported GuideKit schema marker is required.');
    return { databaseSchemaVersion: Number(version), sqliteUserVersion: Number(userVersion) };
  } finally { db.close(); }
}
function overlaps(first: string, second: string): boolean { const path = relative(first, second); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); }
async function privateDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await mkdir(path, { mode: 0o700 });
  try { await chmod(path, 0o700); await writeFile(resolve(path, '.gitignore'), '*\n', { mode: 0o600, flag: 'wx' }); }
  catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
}

/** Online SQLite backup includes committed WAL pages; a filesystem DB copy does not. */
export async function createBackup(options: BackupOptions): Promise<{ archive: string; manifest: ArchiveManifest }> {
  const source = resolve(options.dataDir), destination = resolve(options.destination);
  if (overlaps(source, destination) || overlaps(destination, source)) throw new Error('Backup destination must be outside the data directory.');
  await directory(source);
  const sourceDatabase = resolve(source, 'guidekit.sqlite'), sourceSecret = resolve(source, 'session.secret');
  await regular(sourceDatabase, MAX_DATABASE); await regular(sourceSecret, 65_536);
  const secretBefore = await fingerprint(sourceSecret);
  await privateDirectory(destination);
  let sourceDb: DatabaseSync | undefined;
  try {
    const targetDatabase = resolve(destination, 'guidekit.sqlite');
    // Reserve a private file before the native API opens/overwrites it.
    const file = await open(targetDatabase, 'wx', 0o600); await file.close();
    sourceDb = new DatabaseSync(sourceDatabase, { readOnly: true, timeout: 5000 });
    const pages = await backup(sourceDb, targetDatabase, { rate: 100 }); sourceDb.close(); sourceDb = undefined;
    // Normalize only the NEW snapshot to a single standalone DB, without sidecars.
    const snapshot = new DatabaseSync(targetDatabase, { timeout: 5000 });
    try { snapshot.exec('PRAGMA journal_mode=DELETE'); } finally { snapshot.close(); }
    await chmod(targetDatabase, 0o600);
    const state = metadata(targetDatabase), targetSecret = resolve(destination, 'session.secret');
    await copyFile(sourceSecret, targetSecret, constants.COPYFILE_EXCL); await chmod(targetSecret, 0o600);
    const [database, secret, secretAfter] = await Promise.all([fingerprint(targetDatabase), fingerprint(targetSecret), fingerprint(sourceSecret)]);
    if (secret.sha256 !== secretBefore.sha256 || secretAfter.sha256 !== secretBefore.sha256) throw new Error('The session secret changed during backup. Coordinate rotation and retry.');
    const manifest: ArchiveManifest = { format: 'guidekit-backup', formatVersion: 1, createdAt: new Date().toISOString(), ...state, pages, files: { 'guidekit.sqlite': database, 'session.secret': secret } };
    await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await verifyArchive(destination);
    return { archive: destination, manifest };
  } catch (error) { sourceDb?.close(); await rm(destination, { recursive: true, force: true }); throw error; }
}

export async function verifyArchive(input: string): Promise<ArchiveManifest> {
  const archive = resolve(input); await directory(archive);
  const names = await readdir(archive);
  if (names.length !== ALLOWED.size || names.some(name => !ALLOWED.has(name))) throw new Error('Archive contains missing or unexpected files. Only the DB, session secret and manifest are accepted.');
  const manifestPath = resolve(archive, 'manifest.json'); await regular(manifestPath, 16_384);
  let parsed: unknown; try { parsed = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error('Archive manifest is invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Archive manifest is invalid.');
  const manifest = parsed as ArchiveManifest;
  if (manifest.format !== 'guidekit-backup' || manifest.formatVersion !== 1) throw new Error('Unsupported archive format or version.');
  if (Object.keys(manifest).sort().join(',') !== 'createdAt,databaseSchemaVersion,files,format,formatVersion,pages,sqliteUserVersion' || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isSafeInteger(manifest.databaseSchemaVersion) || manifest.databaseSchemaVersion < 1 || !Number.isSafeInteger(manifest.sqliteUserVersion) || manifest.sqliteUserVersion < 0 || !Number.isSafeInteger(manifest.pages) || manifest.pages < 1 || !manifest.files || typeof manifest.files !== 'object' || Object.keys(manifest.files).sort().join(',') !== [...FILES].sort().join(',')) throw new Error('Archive manifest fields are invalid.');
  for (const name of FILES) {
    const expected = manifest.files[name];
    if (!expected || Object.keys(expected).sort().join(',') !== 'bytes,sha256' || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('Archive checksum record is invalid.');
    const actual = await fingerprint(resolve(archive, name));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`Archive checksum mismatch for ${name}.`);
  }
  await regular(resolve(archive, '.gitignore'), 32);
  if (await readFile(resolve(archive, '.gitignore'), 'utf8') !== '*\n') throw new Error('Archive ignore marker is invalid.');
  const actual = metadata(resolve(archive, 'guidekit.sqlite'));
  if (actual.databaseSchemaVersion !== manifest.databaseSchemaVersion || actual.sqliteUserVersion !== manifest.sqliteUserVersion) throw new Error('Archive schema markers do not match its database.');
  return manifest;
}

async function portInUse(port: number): Promise<boolean> {
  return new Promise((accept, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }); let settled = false;
    const finish = (value: boolean) => { if (settled) return; settled = true; socket.destroy(); accept(value); };
    socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('Could not establish that the service port is offline.')); });
    socket.once('connect', () => finish(true));
    socket.once('error', error => { if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') finish(false); else { socket.destroy(); reject(new Error('Could not establish that the service port is offline.')); } });
  });
}
async function noOpenDatabaseHandles(path: string): Promise<void> {
  if (!await exists(path)) return;
  for (const [command, args] of [['lsof', ['-t', '--', path]], ['fuser', [path]]] as const) {
    try { const result = await execute(command, [...args], { timeout: 3000, maxBuffer: 4096 }); if (result.stdout.trim()) throw new Error('The target database is open. Stop every GuideKit process before restore.'); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      const result = error as { code?: number; stdout?: string; stderr?: string };
      if (result.code === 1 && !result.stdout?.trim() && !result.stderr?.trim()) return;
      if (error instanceof Error && error.message.startsWith('The target database is open.')) throw error;
      throw new Error('Could not inspect open database handles. Restore aborted.');
    }
  }
  throw new Error('Restore of existing data requires lsof or fuser to verify offline database handles.');
}
export async function assertOffline(dataDir: string, port = 4410): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The actual service port must be between 1 and 65535.');
  const lock = resolve(dataDir, '.service.lock');
  if (await exists(lock)) {
    await regular(lock, 4096); let parsed: unknown;
    try { parsed = JSON.parse(await readFile(lock, 'utf8')); } catch { throw new Error('The service lock is invalid. Verify the service is stopped before removing a stale lock.'); }
    const pid = (parsed as { pid?: unknown })?.pid;
    if (!Number.isSafeInteger(pid) || Number(pid) < 1) throw new Error('The service lock has an invalid process ID.');
    try { process.kill(Number(pid), 0); throw new Error('A GuideKit service process is still running. Stop it before restore.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  if (await portInUse(port)) throw new Error('The service port is still listening. Stop GuideKit or supply its actual --port.');
  await noOpenDatabaseHandles(resolve(dataDir, 'guidekit.sqlite'));
}

/** Offline restore never deletes original data; force preserves both a snapshot and the old directory. */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  if (options.offline !== true) throw new Error('Restore requires an explicit --offline acknowledgement after stopping GuideKit.');
  const archive = resolve(options.archive), target = resolve(options.dataDir);
  if (overlaps(archive, target) || overlaps(target, archive)) throw new Error('Restore source and data directory must be separate.');
  const manifest = await verifyArchive(archive), present = await exists(target);
  if (present && !options.force) throw new Error('The target already exists. Use a new directory, or explicitly --force with safety backups.');
  if (present) await directory(target);
  await assertOffline(target, options.port);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  // The server must refuse startup while this sibling lock exists.
  const lockPath = `${target}.restore.lock`, lock = await open(lockPath, 'wx', 0o600);
  const stage = resolve(dirname(target), `.${basename(target)}.restore-${randomUUID()}`);
  let previousDir: string | undefined, safetyBackup: string | undefined, installed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    await privateDirectory(stage);
    for (const name of FILES) { await copyFile(resolve(archive, name), resolve(stage, name), constants.COPYFILE_EXCL); await chmod(resolve(stage, name), 0o600); const copied = await fingerprint(resolve(stage, name)); if (copied.sha256 !== manifest.files[name].sha256 || copied.bytes !== manifest.files[name].bytes) throw new Error('Restored staging checksum mismatch.'); }
    const state = metadata(resolve(stage, 'guidekit.sqlite'));
    if (state.databaseSchemaVersion !== manifest.databaseSchemaVersion) throw new Error('Restored schema verification failed.');
    if (present) {
      safetyBackup = resolve(options.safetyBackup ?? resolve(dirname(target), '.backups', `before-restore-${randomUUID()}`));
      await createBackup({ dataDir: target, destination: safetyBackup });
    }
    await assertOffline(target, options.port);
    if (present) {
      previousDir = `${target}.before-restore-${randomUUID()}`; await rename(target, previousDir); await chmod(previousDir, 0o700);
      const marker = resolve(previousDir, '.gitignore');
      // Retain an existing file/link without ever following or truncating it.
      if (await exists(marker)) await rename(marker, resolve(previousDir, `.gitignore.before-restore-${randomUUID()}`));
      await writeFile(marker, '*\n', { mode: 0o600, flag: 'wx' });
    } else if (await exists(target)) throw new Error('The target appeared during restore. Nothing was replaced.');
    try { await rename(stage, target); installed = true; }
    catch (error) { if (previousDir && !await exists(target)) await rename(previousDir, target); throw error; }
    return { dataDir: target, ...(safetyBackup ? { safetyBackup } : {}), ...(previousDir ? { previousDir } : {}) };
  } catch (error) {
    if (previousDir && !installed && !await exists(target)) await rename(previousDir, target);
    throw error;
  } finally { if (!installed) await rm(stage, { recursive: true, force: true }); await lock.close(); await rm(lockPath, { force: true }); }
}
