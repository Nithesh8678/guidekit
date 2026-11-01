import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, stat, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { AsyncRepository } from '../apps/server/src/repository.js';
import { POSTGRES_KNOWLEDGE_SCHEMA } from '../packages/knowledge/src/schema.js';
import { createPostgresBackup, restorePostgresBackup, verifyPostgresArchive } from '../scripts/postgres-archive.js';

const testURL = process.env.GUIDEKIT_TEST_POSTGRES_URL;
const config = { name: 'Archive agent', companyName: 'Archive company', description: 'Archive verification', instructions: 'Use published sources.', greeting: 'Original greeting', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] };
const content = 'Choose transitions to blend neighboring clips smoothly.';
const vector = `[${Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0).join(',')}]`;
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
async function fixture(root: string, label: string) {
  const url = new URL(testURL!);
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace('-pooler.', '.');
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  const ownerPool = new Pool({ connectionString: url.toString(), max: 1 });
  const id = crypto.randomUUID().replaceAll('-', ''), product = `gk_archive_${id}`, knowledge = `gk_vectors_${id}`;
  await ownerPool.query(`CREATE SCHEMA ${product}`);
  url.searchParams.set('options', `-c search_path=${product},public`);
  const directory = join(root, label), repository = await AsyncRepository.open({ dir: directory, connectionString: url.toString(), migrate: true });
  await repository.db.exec(POSTGRES_KNOWLEDGE_SCHEMA.replaceAll('guidekit_knowledge', knowledge));
  return { directory, repository, knowledge, product, ownerPool, url, async close(role?: string) { await repository.close(); await ownerPool.query(`DROP SCHEMA ${knowledge} CASCADE; DROP SCHEMA ${product} CASCADE`); if (role) await ownerPool.query(`DROP ROLE ${role}`); await ownerPool.end(); } };
}
async function seed(state: Awaited<ReturnType<typeof fixture>>) {
  const repo = state.repository, owner = await repo.register({ email: 'archive-owner@example.invalid', name: 'Original owner', companyName: 'Original tenant' }, 'synthetic-password-hash');
  const agent = await repo.createAgent(owner.tenant.id, config), document = await repo.addDocument(owner.tenant.id, agent.id, { title: 'Transitions handbook', content });
  const version = await repo.publish(owner.tenant.id, agent.id, 'postgres'); await repo.publicationState(agent.id, version.number, 'ready', undefined, true);
  const scope = [owner.tenant.id, agent.id, version.number];
  await repo.db.prepare(`INSERT INTO ${state.knowledge}.versions(tenant_id,agent_id,version,manifest,embedding_model,dimensions,chunk_count,allowed_actions) VALUES(?,?,?,?,'synthetic-versioned-embedding',384,1,'[]')`).run(...scope, 'a'.repeat(64));
  await repo.db.prepare(`INSERT INTO ${state.knowledge}.documents VALUES(?,?,?,?,?,?,?)`).run(...scope, document.id, document.title, content, createHash('sha256').update(content).digest('hex'));
  await repo.db.prepare(`INSERT INTO ${state.knowledge}.chunks(tenant_id,agent_id,version,document_id,ordinal,source_start,source_end,source_char_start,source_char_end,title,excerpt,embedding) VALUES(?,?,?,?,0,0,?,0,?,?,?,?)`).run(...scope, document.id, content.length, content.length, document.title, content, vector);
  await repo.db.prepare(`UPDATE ${state.knowledge}.versions SET ready=true`).run();
  await repo.db.exec('CREATE TABLE postgres_imports(source_hash TEXT PRIMARY KEY,manifest TEXT NOT NULL,imported_at TEXT NOT NULL)');
  await repo.db.prepare('INSERT INTO postgres_imports VALUES (?,?,?)').run('b'.repeat(64), '{"synthetic":true}', '2026-10-31T00:00:00.000Z');
  return { owner, agent, document, version };
}

test('logical PostgreSQL archive captures a coherent full snapshot and restores immutable semantic retrieval', { skip: !testURL, timeout: 180_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-postgres-archive-'));
  const source = await fixture(root, 'source'), target = await fixture(root, 'target');
  try {
    const seeded = await seed(source), archive = join(root, 'archive');
    const backupPromise = createPostgresBackup({ connectionString: source.url.toString(), dataDir: source.directory, destination: archive, knowledgeSchema: source.knowledge });
    // First data file proves the repeatable-read transaction has acquired its snapshot.
    for (let attempt = 0; ; attempt++) {
      try { await stat(join(archive, 'tenants.jsonl')); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (attempt > 1500) throw new Error('Backup did not acquire its snapshot.'); await delay(10);
    }
    await source.repository.transaction(async () => {
      await source.repository.db.prepare('UPDATE users SET name=? WHERE id=?').run('Changed after snapshot', seeded.owner.user.id);
      await source.repository.updateAgent(seeded.owner.tenant.id, seeded.agent.id, { ...config, greeting: 'Changed after snapshot' });
    });
    const backup = await backupPromise;
    await t.test('backup is consistent during writes and includes vectors, generated lexical fields and import history', async () => {
      assert.equal(backup.manifest.tables['knowledge.chunks'].rows, 1); assert.equal(backup.manifest.tables.postgres_imports.rows, 1);
      assert.equal((await source.repository.row('SELECT name FROM users'))?.name, 'Changed after snapshot');
      assert.equal(JSON.parse((await readFile(join(archive, 'users.jsonl'), 'utf8')).trim())[3], 'Original owner');
      assert.equal(JSON.parse(JSON.parse((await readFile(join(archive, 'agents.jsonl'), 'utf8')).trim())[2]).greeting, 'Original greeting');
      assert.equal((await stat(archive)).mode & 0o777, 0o700);
      for (const file of await readdir(archive)) assert.equal((await stat(join(archive, file))).mode & 0o777, 0o600);
      assert.deepEqual(await verifyPostgresArchive(archive), backup.manifest);
      assert.doesNotMatch(JSON.stringify(backup.manifest), /synthetic-password|archive-owner|Original owner/);
    });
    await t.test('restore replays knowledge readiness last, preserves source digests and actual similarity search', async () => {
      // Empty target has its independently created signing secret: use a new local directory for restore.
      const restoreDir = join(root, 'restored-data');
      const restored = await restorePostgresBackup({ connectionString: target.url.toString(), archive, dataDir: restoreDir, offline: true, port: await freePort(), knowledgeSchema: target.knowledge });
      assert.deepEqual(restored.tables, backup.manifest.tables);
      assert.equal(await readFile(join(restoreDir, 'session.secret'), 'utf8'), source.repository.sessionSecret);
      assert.equal((await target.repository.row('SELECT password_hash FROM users'))?.password_hash, 'synthetic-password-hash');
      assert.equal((await target.repository.row('SELECT name FROM users'))?.name, 'Original owner');
      const lexical = await target.repository.row(`SELECT excerpt FROM ${target.knowledge}.chunks WHERE lexical @@ plainto_tsquery('simple',?)`, 'transitions');
      assert.equal(lexical?.excerpt, content);
      const semantic = await target.repository.row(`SELECT excerpt,1-(embedding <=> ?::vector) AS similarity FROM ${target.knowledge}.chunks ORDER BY embedding <=> ?::vector LIMIT 1`, vector, vector);
      assert.equal(semantic?.excerpt, content); assert.equal(Number(semantic?.similarity), 1);
      assert.equal((await target.repository.row(`SELECT ready::int AS ready FROM ${target.knowledge}.versions`))?.ready, 1);
      await assert.rejects(target.repository.db.prepare(`UPDATE ${target.knowledge}.documents SET title=?`).run('Mutation must fail'), /immutable/);
      await assert.rejects(restorePostgresBackup({ connectionString: target.url.toString(), archive, dataDir: restoreDir, offline: true, port: await freePort(), knowledgeSchema: target.knowledge }), /empty product and knowledge tables/);
      assert.equal((await target.repository.row('SELECT name FROM users'))?.name, 'Original owner');
    });
    await t.test('checksums, explicit offline acknowledgement and existing signing secrets are enforced before restore', async () => {
      await assert.rejects(restorePostgresBackup({ connectionString: 'invalid', archive, dataDir: join(root, 'unused'), offline: false }), /explicit offline/);
      const bad = join(root, 'tampered'); await cp(archive, bad, { recursive: true }); await writeFile(join(bad, 'knowledge.chunks.jsonl'), 'tampered\n');
      await assert.rejects(verifyPostgresArchive(bad), /checksum mismatch/);
      await assert.rejects(restorePostgresBackup({ connectionString: 'invalid', archive, dataDir: target.directory, offline: true, port: await freePort(), knowledgeSchema: target.knowledge }), /signing secret differs/);
    });
  } finally { await source.close(); await target.close(); await rm(root, { recursive: true, force: true }); }
});

test('logical PostgreSQL backup fails closed for RLS-limited operator credentials', { skip: !testURL, timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-postgres-archive-rls-')), source = await fixture(root, 'source');
  const role = `gk_backup_${crypto.randomUUID().replaceAll('-', '')}`, password = randomBytes(24).toString('hex');
  let created = false;
  try {
    await seed(source);
    await source.ownerPool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`); created = true;
    await source.ownerPool.query(`GRANT USAGE ON SCHEMA ${source.product},${source.knowledge} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${source.product},${source.knowledge} TO ${role}`);
    const url = new URL(source.url); url.username = role; url.password = password;
    const destination = join(root, 'must-not-exist');
    await assert.rejects(createPostgresBackup({ connectionString: url.toString(), dataDir: source.directory, destination, knowledgeSchema: source.knowledge }), /archive operation failed/);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  } finally { await source.close(created ? role : undefined); await rm(root, { recursive: true, force: true }); }
});


test('logical PostgreSQL restore rejects missing offline acknowledgement before reading input', async () => {
  await assert.rejects(restorePostgresBackup({ connectionString: 'invalid', archive: 'not-read', dataDir: 'not-written', offline: false }), /explicit offline/);
});

test('logical PostgreSQL archive rejects unknown manifest formats without database access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-postgres-archive-invalid-'));
  try { await writeFile(join(root, 'manifest.json'), JSON.stringify({ format: 'unknown', formatVersion: 999 })); await assert.rejects(verifyPostgresArchive(root), /unsupported/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('logical PostgreSQL restore rolls back product and vector rows after a late index insertion failure', { skip: !testURL, timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidekit-postgres-archive-rollback-')), source = await fixture(root, 'source'), target = await fixture(root, 'target');
  try {
    await seed(source); const archive = join(root, 'archive');
    await createPostgresBackup({ connectionString: source.url.toString(), dataDir: source.directory, destination: archive, knowledgeSchema: source.knowledge });
    await target.repository.db.exec(`CREATE FUNCTION ${target.knowledge}.fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sensitive synthetic payload must be withheld'; END $$; CREATE TRIGGER abort_restore BEFORE INSERT ON ${target.knowledge}.chunks FOR EACH ROW EXECUTE FUNCTION ${target.knowledge}.fail_restore()`);
    const dataDir = join(root, 'no-committed-secret');
    await assert.rejects(restorePostgresBackup({ connectionString: target.url.toString(), archive, dataDir, offline: true, port: await freePort(), knowledgeSchema: target.knowledge }), error => { assert.match((error as Error).message, /archive operation failed/); assert.doesNotMatch((error as Error).message, /sensitive synthetic/); return true; });
    for (const table of ['tenants','users','agents','documents','versions','knowledge_fts','publication_states',`${target.knowledge}.versions`,`${target.knowledge}.documents`,`${target.knowledge}.chunks`]) assert.equal(Number((await target.repository.row(`SELECT COUNT(*) AS count FROM ${table}`))?.count), 0);
    assert.equal(Number((await target.repository.row(`SELECT COUNT(*) AS count FROM ${target.knowledge}.metadata`))?.count), 1);
    await assert.rejects(stat(join(dataDir, 'session.secret')), { code: 'ENOENT' });
  } finally { await source.close(); await target.close(); await rm(root, { recursive: true, force: true }); }
});
