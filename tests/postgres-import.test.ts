import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { Repository } from '../apps/server/src/database.js';
import { PostgresDriver } from '../apps/server/src/storage/postgres.js';
import { importSQLiteArchive, postgresImportCli } from '../scripts/postgres-import.js';
import { createBackup } from '../scripts/storage-archive.js';

const testURL = process.env.GUIDEKIT_TEST_POSTGRES_URL;
async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-postgres-import-')), data = join(root, 'source'), archive = join(root, 'archive');
  const repository = new Repository(data);
  const owner = repository.register({ email: 'import-owner@example.invalid', name: 'Original owner', companyName: 'Original company' }, 'synthetic-password-hash-preserved-verbatim');
  const agent = repository.createAgent(owner.tenant.id, { name: 'Original agent', companyName: 'Original company', description: 'Migration verification', instructions: 'Use original sources.', greeting: 'Hello original', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] });
  const document = repository.addDocument(owner.tenant.id, agent.id, { title: 'Original transitions', content: 'Blend neighboring clips with a transition. Preserve original punctuation: \' " ? — and Unicode: தமிழ்.' });
  repository.publish(owner.tenant.id, agent.id, 'tigergraph'); repository.publicationState(agent.id, 1, 'ready', undefined, true);
  repository.updateDocument(owner.tenant.id, agent.id, document.id, { title: 'Current draft', content: 'This is the edited draft, separate from the immutable publication.' });
  const expires = Date.now() + 60_000;
  repository.db.prepare('UPDATE users SET verified_at=?,auth_epoch=7 WHERE id=?').run('2026-10-31T00:00:00.000Z', owner.user.id);
  const session = JSON.stringify({ userId: owner.user.id, tenantId: owner.tenant.id, authEpoch: 7, cookie: { expires: new Date(expires).toISOString(), path: '/' } });
  repository.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run('dashboard-original', session, expires);
  repository.db.prepare('INSERT INTO embed_sessions VALUES (?,?,?,?,?,?,?)').run('embed-original', 'synthetic-token-hash', owner.tenant.id, agent.id, 1, 'http://127.0.0.1:4411', expires);
  repository.db.prepare('INSERT INTO runs (id,session_id,tenant_id,agent_id,request_id,question,answer,status,response,action_name,created_at,duration_ms,error_code,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-original', 'embed-original', owner.tenant.id, agent.id, 'original-request', 'Synthetic private question', 'Synthetic private answer', 'action_succeeded', '{"source":"tigergraph"}', 'synthetic-action', '2026-10-31T00:00:00.000Z', 1234, null, 'synthetic-request-hash');
  repository.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?)').run('receipt-original', 'embed-original', 'run-original', 'synthetic-action', '{"name":"Original"}', 'succeeded', 'Host verified saved data.');
  repository.db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?,?,?,?,?,?)').run('token-original', 'synthetic-reset-hash', 'reset', owner.user.id, owner.tenant.id, 'import-owner@example.invalid', '{"preserve":true}', expires, null, '2026-10-31T00:00:00.000Z');
  repository.audit(owner.tenant.id, owner.user.id, 'test.original', agent.id, { preserve: true });
  return { root, data, archive, repository, owner, agent, document, session, async backup() { return createBackup({ dataDir: data, destination: archive }); }, async close() { repository.close(); await rm(root, { recursive: true, force: true }); } };
}
async function postgresFixture() {
  const url = new URL(testURL!);
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace('-pooler.', '.');
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  const owner = new Pool({ connectionString: url.toString(), max: 1 }), schema = `gk_import_${crypto.randomUUID().replaceAll('-', '')}`;
  await owner.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return { connectionString: url.toString(), async close() { await owner.query(`DROP SCHEMA ${schema} CASCADE`); await owner.end(); } };
}

test('import dry run verifies source data and prints only counts/hashes without connecting or writing', async () => {
  const source = await sourceFixture();
  try {
    await source.backup();
    const before = await readFile(join(source.archive, 'guidekit.sqlite')), secret = await readFile(join(source.archive, 'session.secret'));
    const result = await importSQLiteArchive({ archive: source.archive, connectionString: 'not-a-connection-url' });
    assert.equal(result.applied, false); assert.equal(result.idempotent, false);
    assert.equal(result.counts.users, 1); assert.equal(result.counts.versions, 1); assert.equal(result.counts.receipts, 1);
    assert.match(result.hash, /^[a-f0-9]{64}$/); assert.match(result.tables.users.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-password|private question|import-owner|Original company/);
    assert.deepEqual(await readFile(join(source.archive, 'guidekit.sqlite')), before);
    assert.deepEqual(await readFile(join(source.archive, 'session.secret')), secret);
    assert.deepEqual((await readdir(source.archive)).sort(), ['.gitignore','guidekit.sqlite','manifest.json','session.secret']);
  } finally { await source.close(); }
});

test('import rejects archive tampering and unsupported source tables before target access', async () => {
  const source = await sourceFixture();
  try {
    source.repository.db.exec('CREATE TABLE future_feature (id TEXT PRIMARY KEY)'); await source.backup();
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: 'invalid' }), /unsupported tables/);
    await writeFile(join(source.archive, 'session.secret'), 'tampered');
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: 'invalid', apply: true }), /checksum mismatch/);
  } finally { await source.close(); }
});

test('import rejects inconsistent legacy scope relationships without changing the source', async () => {
  const source = await sourceFixture();
  try {
    source.repository.db.prepare('UPDATE embed_sessions SET tenant_id=?').run('missing-tenant'); await source.backup();
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: 'invalid', apply: true }), /scope or version relationships/);
    assert.equal(source.repository.row('SELECT tenant_id FROM embed_sessions')?.tenant_id, 'missing-tenant');
  } finally { await source.close(); }
});

test('import CLI requires concrete source and explicit offline apply gates', async () => {
  await assert.rejects(postgresImportCli([]), /explicit --archive/);
  await assert.rejects(postgresImportCli(['--archive','synthetic','--apply']), /requires --offline/);
});

test('real PostgreSQL import verifies every field, preserves sessions and is safely idempotent', { skip: !testURL, timeout: 120_000 }, async () => {
  const source = await sourceFixture(), target = await postgresFixture();
  let driver: PostgresDriver | undefined;
  try {
    await source.backup(); const originalBytes = await readFile(join(source.archive, 'guidekit.sqlite'));
    const imported = await importSQLiteArchive({ archive: source.archive, connectionString: target.connectionString, apply: true });
    assert.equal(imported.applied, true); assert.equal(imported.idempotent, false);
    driver = await PostgresDriver.open(target.connectionString);
    const user = await driver.prepare('SELECT * FROM users WHERE id=?').get(source.owner.user.id);
    assert.equal(user?.password_hash, 'synthetic-password-hash-preserved-verbatim'); assert.equal(user?.auth_epoch, 7);
    assert.equal((await driver.prepare('SELECT data FROM dashboard_sessions').get())?.data, source.session);
    const version = await driver.prepare('SELECT documents FROM versions').get();
    assert.equal(JSON.parse(String(version?.documents))[0].content, source.document.content);
    assert.equal((await driver.prepare('SELECT title FROM documents').get())?.title, 'Current draft');
    assert.equal((await driver.prepare('SELECT graph_source FROM publication_states').get())?.graph_source, 'tigergraph');
    assert.equal((await driver.prepare('SELECT token_hash FROM embed_sessions').get())?.token_hash, 'synthetic-token-hash');
    assert.equal((await driver.prepare('SELECT message FROM receipts').get())?.message, 'Host verified saved data.');
    assert.equal((await driver.prepare('SELECT request_hash FROM runs').get())?.request_hash, 'synthetic-request-hash');
    assert.equal((await driver.prepare('SELECT token_hash FROM account_tokens').get())?.token_hash, 'synthetic-reset-hash');
    const again = await importSQLiteArchive({ archive: source.archive, connectionString: target.connectionString, apply: true });
    assert.equal(again.idempotent, true); assert.equal(again.hash, imported.hash);
    await driver.prepare('UPDATE documents SET title=?').run('Preserve later target edits');
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: target.connectionString, apply: true }), /changed since its recorded import/);
    assert.equal((await driver.prepare('SELECT title FROM documents').get())?.title, 'Preserve later target edits');
    assert.deepEqual(await readFile(join(source.archive, 'guidekit.sqlite')), originalBytes);
  } finally { await driver?.close(); await source.close(); await target.close(); }
});

test('real PostgreSQL refuses a populated target without overwriting or recording an import', { skip: !testURL, timeout: 120_000 }, async () => {
  const source = await sourceFixture(), target = await postgresFixture();
  const driver = await PostgresDriver.open(target.connectionString, true);
  try {
    await source.backup(); await driver.prepare('INSERT INTO tenants VALUES (?,?)').run('existing-tenant', 'Preserve this existing tenant');
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: target.connectionString, apply: true }), /not empty/);
    assert.equal((await driver.prepare('SELECT name FROM tenants WHERE id=?').get('existing-tenant'))?.name, 'Preserve this existing tenant');
    assert.equal(Number((await driver.prepare('SELECT COUNT(*) AS count FROM users').get())?.count), 0);
    assert.equal((await driver.prepare("SELECT to_regclass('postgres_imports') AS marker").get())?.marker, null);
  } finally { await driver.close(); await source.close(); await target.close(); }
});

test('real PostgreSQL rolls back a mid-import failure and sanitizes database error details', { skip: !testURL, timeout: 120_000 }, async () => {
  const source = await sourceFixture(), target = await postgresFixture();
  const driver = await PostgresDriver.open(target.connectionString, true);
  try {
    await source.backup();
    await driver.exec("CREATE FUNCTION block_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic secret that must stay out of tool output'; END $$; CREATE TRIGGER fail_import BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION block_import()");
    await assert.rejects(importSQLiteArchive({ archive: source.archive, connectionString: target.connectionString, apply: true }), error => {
      assert.match((error as Error).message, /PostgreSQL import failed/); assert.doesNotMatch((error as Error).message, /synthetic secret/); return true;
    });
    for (const table of ['tenants','users','agents','documents','versions','knowledge_fts','embed_sessions','runs','receipts']) assert.equal(Number((await driver.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())?.count), 0);
    assert.equal((await driver.prepare("SELECT to_regclass('postgres_imports') AS marker").get())?.marker, null);
  } finally { await driver.close(); await source.close(); await target.close(); }
});
