import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { SessionData } from 'express-session';
import type { AgentConfig } from '../packages/contracts/src/index.js';
import { AsyncRepository, RepositorySessionStore } from '../apps/server/src/repository.js';
import { Repository } from '../apps/server/src/database.js';
import { postgresSQL } from '../apps/server/src/storage/postgres.js';

const config: AgentConfig = { name: 'Storage guide', companyName: 'Storage company', description: 'Storage verification', instructions: 'Use published sources.', greeting: 'How can I help?', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] };
const testURL = process.env.GUIDEKIT_TEST_POSTGRES_URL;
function gate() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }

async function fixture(dialect: 'sqlite' | 'postgres') {
  const directory = await mkdtemp(join(tmpdir(), `guidekit-${dialect}-storage-`));
  let owner: Pool | undefined, schema: string | undefined, connectionString: string | undefined;
  try {
    if (dialect === 'postgres') {
      const directURL = new URL(testURL!);
      // Transaction poolers reject search_path startup options; isolated schemas use the direct endpoint.
      if (directURL.hostname.endsWith('.neon.tech')) directURL.hostname = directURL.hostname.replace('-pooler.', '.');
      if (directURL.searchParams.get('sslmode') === 'require') directURL.searchParams.set('sslmode', 'verify-full');
      owner = new Pool({ connectionString: directURL.toString(), max: 1 });
      schema = `gk_test_${crypto.randomUUID().replaceAll('-', '')}`;
      await owner.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(directURL); url.searchParams.set('options', `-c search_path=${schema}`); connectionString = url.toString();
      await assert.rejects(AsyncRepository.open({ dir: directory, connectionString }), /not initialized/);
    }
    const repository = await AsyncRepository.open({ dir: directory, connectionString, migrate: true });
    return { repository, directory, connectionString, async close() { await repository.close(); if (owner && schema) await owner.query(`DROP SCHEMA ${schema} CASCADE`); await owner?.end(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { if (owner && schema) await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await owner?.end(); await rm(directory, { recursive: true, force: true }); throw error; }
}

for (const dialect of ['sqlite', 'postgres'] as const) {
  test(`${dialect}: shared asynchronous product repository`, { skip: dialect === 'postgres' && !testURL, timeout: 120_000 }, async t => {
    const state = await fixture(dialect), repo = state.repository;
    try {
      const a = await repo.register({ email: 'a@example.invalid', name: 'Owner A', companyName: 'Tenant A' }, 'hash-a');
      const b = await repo.register({ email: 'b@example.invalid', name: 'Owner B', companyName: 'Tenant B' }, 'hash-b');
      const agent = await repo.createAgent(a.tenant.id, config);
      const doc = await repo.addDocument(a.tenant.id, agent.id, { title: 'Transitions handbook', content: 'Select transitions to blend neighboring clips. The trial lasts seventeen days.' });
      await t.test('tenant ownership and aliases are preserved', async () => {
        assert.equal((await repo.workspace(a.user.id))?.tenant.id, a.tenant.id);
        assert.equal((await repo.workspace(a.user.id, b.tenant.id)), null);
        assert.deepEqual(await repo.listAgents(b.tenant.id), []);
        await assert.rejects(repo.agent(b.tenant.id, agent.id), /Agent not found/);
        await assert.rejects(repo.documents(b.tenant.id, agent.id), /Agent not found/);
        await assert.rejects(repo.publish(b.tenant.id, agent.id), /Agent not found/);
        assert.equal((await repo.row('SELECT name AS accountName FROM users WHERE id=?', a.user.id))?.accountName, 'Owner A');
      });
      await t.test('concurrent publications allocate distinct versions and pin immutable knowledge', async () => {
        const publications = await Promise.all([repo.publish(a.tenant.id, agent.id), repo.publish(a.tenant.id, agent.id)]);
        assert.deepEqual(publications.map(item => item.number).sort(), [1, 2]);
        assert.equal((await repo.published(agent.id)).version, 2);
        await repo.updateDocument(a.tenant.id, agent.id, doc.id, { title: 'Updated transitions', content: 'The trial now lasts thirty one days. Blend clips with transitions.' });
        await repo.updateAgent(a.tenant.id, agent.id, { ...config, greeting: 'Changed greeting' });
        const pinned = await repo.published(agent.id, 1);
        assert.equal(pinned.config.greeting, config.greeting);
        assert.equal(pinned.documents[0].content, doc.content);
        assert.equal((await repo.retrieve(a.tenant.id, agent.id, 1, 'blend clips transitions'))[0]?.documentId, doc.id);
        await assert.rejects(repo.retrieve(b.tenant.id, agent.id, 1, 'transitions'), /Agent not found/);
      });
      await t.test('a delayed index completion cannot undo activation or unpublishing', async () => {
        const preparing = await repo.publish(a.tenant.id, agent.id, 'postgres');
        assert.equal(preparing.graphSource, 'postgres'); assert.equal(preparing.status, 'preparing');
        await assert.rejects(repo.published(agent.id, preparing.number), /preparing its knowledge/);
        await repo.activateVersion(a.tenant.id, agent.id, 1);
        await repo.publicationState(agent.id, preparing.number, 'ready', undefined, true);
        assert.equal((await repo.published(agent.id)).version, 1);
        const later = await repo.publish(a.tenant.id, agent.id, 'postgres');
        await repo.unpublish(a.tenant.id, agent.id);
        await repo.publicationState(agent.id, later.number, 'ready', undefined, true);
        await assert.rejects(repo.published(agent.id), /no published version/);
        await repo.activateVersion(a.tenant.id, agent.id, later.number);
        assert.equal((await repo.published(agent.id)).version, later.number);
      });
      await t.test('async rollback cannot swallow an unrelated request into its transaction', async () => {
        await repo.db.exec('CREATE TABLE tx_probe (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
        const entered = gate(), release = gate();
        const tx = repo.transaction(async () => {
          await repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('transaction', 'must roll back'); entered.resolve();
          await release.promise; throw new Error('intentional rollback');
        });
        const rejected = assert.rejects(tx, /intentional rollback/);
        await entered.promise;
        const unrelated = repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('unrelated', 'must survive');
        release.resolve();
        await rejected; await unrelated;
        assert.deepEqual((await repo.rows('SELECT id FROM tx_probe ORDER BY id')).map(row => row.id), ['unrelated']);
        await repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('after', 'rollback completed before rejecting');
      });
      await t.test('nested savepoint failure leaves its outer transaction usable', async () => {
        await repo.transaction(async () => {
          await repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('outer', 'retained');
          await assert.rejects(repo.transaction(async () => { await repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('inner', 'removed'); throw new Error('savepoint rollback'); }), /savepoint rollback/);
          await repo.db.prepare('INSERT INTO tx_probe VALUES (?,?)').run('outer-after', 'retained');
        });
        assert.equal(await repo.row('SELECT id FROM tx_probe WHERE id=?', 'inner'), undefined);
        assert.ok(await repo.row('SELECT id FROM tx_probe WHERE id=?', 'outer-after'));
      });
      await t.test('nullable token predicates and account-session operations are portable', async () => {
        await repo.db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?,?,?,?,NULL,?)').run('tok-test', 'token-hash', 'verify', a.user.id, null, 'a@example.invalid', '{}', Date.now() + 60000, new Date().toISOString());
        assert.equal((await repo.db.prepare('UPDATE account_tokens SET consumed_at=? WHERE tenant_id IS ? AND consumed_at IS NULL').run(new Date().toISOString(), null)).changes, 1);
        await repo.db.prepare('INSERT OR REPLACE INTO dashboard_sessions VALUES (?,?,?)').run('json-session', JSON.stringify({ userId: a.user.id }), Date.now() + 60000);
        assert.equal((await repo.db.prepare("DELETE FROM dashboard_sessions WHERE json_extract(data,'$.userId')=?").run(a.user.id)).changes, 1);
        assert.equal((await repo.db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)').run(a.user.id, a.tenant.id, 'viewer', new Date().toISOString())).changes, 0);
      });
      await t.test('session persistence completes before callbacks and delayed touch never resurrects logout', async () => {
        const store = new RepositorySessionStore(repo), data = { cookie: { expires: new Date(Date.now() + 60000) }, userId: a.user.id } as unknown as SessionData;
        await new Promise<void>((resolve, reject) => store.set('session-test', data, error => error ? reject(error) : resolve()));
        const saved = await new Promise<SessionData | null | undefined>((resolve, reject) => store.get('session-test', (error, value) => error ? reject(error) : resolve(value)));
        assert.equal(saved?.userId, a.user.id);
        await new Promise<void>((resolve, reject) => store.destroy('session-test', error => error ? reject(error) : resolve()));
        await new Promise<void>((resolve, reject) => store.touch('session-test', data, error => error ? reject(error) : resolve()));
        assert.equal(await repo.row('SELECT id FROM dashboard_sessions WHERE id=?', 'session-test'), undefined);
      });
      await t.test('session signing secret persists across verified database reopen', async () => {
        const secret = await readFile(join(state.directory, 'session.secret'), 'utf8');
        const another = await AsyncRepository.open({ dir: state.directory, connectionString: state.connectionString });
        try { assert.equal(another.sessionSecret, secret); assert.equal(another.sessionSecret, repo.sessionSecret); assert.equal((await another.workspace(a.user.id))?.tenant.id, a.tenant.id); }
        finally { await another.close(); }
      });
    } finally { await state.close(); }
  });
}

test('legacy SQLite accounts and immutable versions survive the async schema add-on', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-legacy-async-'));
  const legacy = new Repository(directory);
  const owner = legacy.register({ email: 'legacy@example.invalid', name: 'Original owner', companyName: 'Original tenant' }, 'original-password-hash');
  const agent = legacy.createAgent(owner.tenant.id, config);
  const document = legacy.addDocument(owner.tenant.id, agent.id, { title: 'Original source', content: 'Preserve the original published source.' });
  legacy.publish(owner.tenant.id, agent.id, 'tigergraph'); legacy.publicationState(agent.id, 1, 'ready', undefined, true);
  const secret = legacy.sessionSecret; legacy.close();
  const repo = await AsyncRepository.open({ dir: directory });
  try {
    assert.equal(repo.sessionSecret, secret);
    assert.equal((await repo.workspace(owner.user.id))?.user.name, 'Original owner');
    assert.equal((await repo.row('SELECT password_hash FROM users WHERE id=?', owner.user.id))?.password_hash, 'original-password-hash');
    assert.equal((await repo.published(agent.id)).graphSource, 'tigergraph');
    assert.equal((await repo.version(owner.tenant.id, agent.id, 1)).documents[0].id, document.id);
    assert.equal((await repo.publish(owner.tenant.id, agent.id, 'postgres')).number, 2);
    assert.equal(Number((await repo.row('SELECT MAX(version) AS version FROM schema_migrations'))?.version), 3);
  } finally { await repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test('PostgreSQL translation preserves bound values, quoted punctuation and public aliases', () => {
  assert.equal(postgresSQL("SELECT '?' AS literal,t.id AS tenantId FROM tenants t WHERE t.id=? AND (? IS NULL OR t.id=?)"), "SELECT '?' AS literal,t.id AS \"tenantId\" FROM tenants t WHERE t.id=$1 AND (CAST($2 AS TEXT) IS NULL OR t.id=$3)");
  assert.equal(postgresSQL("UPDATE account_tokens SET consumed_at=? WHERE tenant_id IS ?"), 'UPDATE account_tokens SET consumed_at=$1 WHERE tenant_id IS NOT DISTINCT FROM $2');
  assert.match(postgresSQL('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)'), /ON CONFLICT DO NOTHING$/);
  assert.throws(() => postgresSQL('INSERT OR REPLACE INTO users VALUES (?)'), /Unsupported SQL replace/);
});
