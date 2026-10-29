import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createBackup, restoreBackup, verifyArchive } from '../scripts/storage-archive.js';

const secret = 'synthetic-session-secret-for-disposable-test-fixtures-only'.repeat(2);
async function fixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-archive-test-')), source = join(root, name);
  await mkdir(source, { mode: 0o700 }); await writeFile(join(source, 'session.secret'), secret, { mode: 0o600 });
  const db = new DatabaseSync(join(source, 'guidekit.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (1); CREATE TABLE records(id INTEGER PRIMARY KEY, text TEXT NOT NULL); CREATE TABLE dashboard_sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  db.prepare('INSERT INTO records VALUES (?,?)').run(1, name); db.prepare('INSERT INTO dashboard_sessions VALUES (?,?)').run('synthetic-session', '{"userId":"synthetic-user"}');
  return { root, source, db, close: () => db.close(), cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port.');
  await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); return address.port;
}
function rows(path: string) { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare('SELECT * FROM records ORDER BY id').all(); } finally { db.close(); } }

test('online backup includes committed WAL data, excludes uncommitted writes and unrelated files, and is private', async () => {
  const state = await fixture('committed');
  try {
    await writeFile(join(state.source, '.env'), 'SYNTHETIC_TEST_VALUE=excluded'); await writeFile(join(state.source, 'personal-media.mp4'), 'excluded synthetic bytes');
    state.db.exec('BEGIN IMMEDIATE'); state.db.prepare('INSERT INTO records VALUES (?,?)').run(2, 'uncommitted');
    const archive = join(state.root, 'archive'), result = await createBackup({ dataDir: state.source, destination: archive });
    assert.equal(result.manifest.formatVersion, 1); assert.equal(result.manifest.databaseSchemaVersion, 1); assert.ok(result.manifest.pages > 0);
    assert.deepEqual(rows(join(archive, 'guidekit.sqlite')).map(row => row.text), ['committed']); assert.equal(await readFile(join(archive, 'session.secret'), 'utf8'), secret);
    assert.deepEqual((await readdir(archive)).sort(), ['.gitignore', 'guidekit.sqlite', 'manifest.json', 'session.secret']); assert.equal(await readFile(join(archive, '.gitignore'), 'utf8'), '*\n');
    assert.equal((await stat(archive)).mode & 0o777, 0o700); for (const file of await readdir(archive)) assert.equal((await stat(join(archive, file))).mode & 0o777, 0o600);
    assert.deepEqual(await verifyArchive(archive), result.manifest); await assert.rejects(createBackup({ dataDir: state.source, destination: archive }), /exist/i);
    state.db.exec('ROLLBACK'); assert.deepEqual(state.db.prepare('SELECT * FROM records').all().map(row => row.text), ['committed']);
  } finally { state.close(); await state.cleanup(); }
});

test('restoring to a new offline directory preserves records, sessions, secret and file permissions', async () => {
  const state = await fixture('restored');
  try {
    const archive = join(state.root, 'archive'); await createBackup({ dataDir: state.source, destination: archive }); state.close();
    const target = join(state.root, 'restored-data'), result = await restoreBackup({ archive, dataDir: target, offline: true, port: await freePort() });
    assert.equal(result.dataDir, target); assert.equal(result.previousDir, undefined); assert.deepEqual(rows(join(target, 'guidekit.sqlite')).map(row => row.text), ['restored']);
    const db = new DatabaseSync(join(target, 'guidekit.sqlite'), { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) AS n FROM dashboard_sessions').get()?.n, 1); } finally { db.close(); }
    assert.equal(await readFile(join(target, 'session.secret'), 'utf8'), secret); assert.equal((await stat(target)).mode & 0o777, 0o700); assert.equal((await stat(join(target, 'session.secret'))).mode & 0o777, 0o600);
    await assert.rejects(stat(`${target}.restore.lock`), { code: 'ENOENT' });
  } finally { await state.cleanup(); }
});

test('restore requires offline acknowledgement and never replaces an existing target without force', async () => {
  const state = await fixture('original');
  try {
    const archive = join(state.root, 'archive'); await createBackup({ dataDir: state.source, destination: archive });
    await assert.rejects(restoreBackup({ archive, dataDir: join(state.root, 'new'), offline: false }), /offline/);
    await assert.rejects(restoreBackup({ archive, dataDir: state.source, offline: true }), /already exists/);
    assert.deepEqual(state.db.prepare('SELECT * FROM records').all().map(row => row.text), ['original']);
  } finally { state.close(); await state.cleanup(); }
});

test('forced offline restore retains a verified safety archive and the full previous directory', async () => {
  const state = await fixture('backup-content');
  try {
    const archive = join(state.root, 'archive'); await createBackup({ dataDir: state.source, destination: archive });
    state.db.prepare('UPDATE records SET text=? WHERE id=1').run('newer-original'); state.close();
    await writeFile(join(state.source, 'preserved-extra.txt'), 'keep the full original directory');
    const externalMarker = join(state.root, 'external-marker'); await writeFile(externalMarker, 'keep original marker'); await symlink(externalMarker, join(state.source, '.gitignore'));
    const result = await restoreBackup({ archive, dataDir: state.source, offline: true, force: true, port: await freePort() });
    assert.ok(result.safetyBackup); assert.ok(result.previousDir); await verifyArchive(result.safetyBackup!);
    assert.deepEqual(rows(join(state.source, 'guidekit.sqlite')).map(row => row.text), ['backup-content']);
    assert.deepEqual(rows(join(result.safetyBackup!, 'guidekit.sqlite')).map(row => row.text), ['newer-original']);
    assert.deepEqual(rows(join(result.previousDir!, 'guidekit.sqlite')).map(row => row.text), ['newer-original']);
    assert.equal(await readFile(join(result.previousDir!, 'preserved-extra.txt'), 'utf8'), 'keep the full original directory'); assert.equal(await readFile(join(result.previousDir!, '.gitignore'), 'utf8'), '*\n');
    assert.equal(await readFile(externalMarker, 'utf8'), 'keep original marker');
    const oldMarker = (await readdir(result.previousDir!)).find(name => name.startsWith('.gitignore.before-restore-')); assert.ok(oldMarker); assert.equal((await lstat(join(result.previousDir!, oldMarker!))).isSymbolicLink(), true);
  } finally { await state.cleanup(); }
});

test('live database handles, live service PID and a listening port prevent restore even with force', async () => {
  const state = await fixture('online');
  try {
    const archive = join(state.root, 'archive'); await createBackup({ dataDir: state.source, destination: archive }); const port = await freePort();
    await assert.rejects(restoreBackup({ archive, dataDir: state.source, offline: true, force: true, port }), /database is open|inspect open database handles/);
    await writeFile(join(state.source, '.service.lock'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    await assert.rejects(restoreBackup({ archive, dataDir: state.source, offline: true, force: true, port }), /process is still running/);
    const server = createServer(); await new Promise<void>(accept => server.listen(port, '127.0.0.1', accept));
    try { await assert.rejects(restoreBackup({ archive, dataDir: join(state.root, 'new'), offline: true, port }), /port is still listening/); } finally { await new Promise<void>(accept => server.close(() => accept())); }
  } finally { state.close(); await state.cleanup(); }
});

test('corruption, unknown archive versions, extra files and symlinked inputs are rejected before installation', async () => {
  const state = await fixture('safe');
  try {
    const archive = join(state.root, 'archive'); await createBackup({ dataDir: state.source, destination: archive });
    const manifestPath = join(archive, 'manifest.json'), original = await readFile(manifestPath, 'utf8'), parsed = JSON.parse(original);
    parsed.formatVersion = 999; await writeFile(manifestPath, JSON.stringify(parsed)); await assert.rejects(verifyArchive(archive), /Unsupported archive/); await writeFile(manifestPath, original);
    await writeFile(join(archive, 'session.secret'), 'tampered'); await assert.rejects(restoreBackup({ archive, dataDir: join(state.root, 'target'), offline: true }), /checksum mismatch/); await assert.rejects(stat(join(state.root, 'target')), { code: 'ENOENT' });
    await writeFile(join(archive, 'session.secret'), secret); await writeFile(join(archive, 'unexpected.env'), 'synthetic'); await assert.rejects(verifyArchive(archive), /unexpected files/); await rm(join(archive, 'unexpected.env'));
    await rm(join(archive, 'session.secret')); await symlink(join(state.source, 'session.secret'), join(archive, 'session.secret')); await assert.rejects(verifyArchive(archive), /regular file/);
    await assert.rejects(createBackup({ dataDir: state.source, destination: join(state.source, 'nested-archive') }), /outside the data directory/);
  } finally { state.close(); await state.cleanup(); }
});
