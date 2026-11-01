import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AsyncRepository } from '../apps/server/src/repository.js';
import { migrateKnowledgeSnapshots } from '../scripts/migrate-knowledge.js';
import type { KnowledgeProvider } from '../packages/knowledge/src/types.js';

test('knowledge migration prepares every index before changing version metadata and preserves activation', { skip: !process.env.GUIDEKIT_TEST_POSTGRES_URL, timeout: 120_000 }, async t => {
  const url = new URL(process.env.GUIDEKIT_TEST_POSTGRES_URL!); url.hostname = url.hostname.replace('-pooler.', '.');
  assert.equal(url.pathname, '/guidekit_test');
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const schema = `gk_knowledge_migration_${crypto.randomUUID().replaceAll('-', '')}`;
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-knowledge-migration-'));
  await pool.query(`CREATE SCHEMA ${schema}`); url.searchParams.set('options', `-c search_path=${schema}`);
  const repo = await AsyncRepository.open({ dir, connectionString: url.toString(), migrate: true });
  let calls = 0, failAt = 0, changeDuringSync = false;
  const provider: KnowledgeProvider = { id: 'postgres', status: async () => ({ configured: true, connected: true, message: 'Explicit migration fixture' }), retrieve: async () => { throw new Error('No inference/retrieval in metadata fixture'); }, syncVersion: async input => {
    calls++; if (calls === failAt) throw new Error('Explicit preparation failure');
    if (changeDuringSync) { changeDuringSync = false; await repo.db.prepare("UPDATE versions SET config=? WHERE agent_id=? AND number=?").run(JSON.stringify({ ...JSON.parse(String((await repo.row('SELECT config FROM versions WHERE agent_id=? AND number=?', input.agentId, input.version))!.config)), greeting: 'Concurrent immutable-source fault injection' }), input.agentId, input.version); }
    return { chunks: input.documents.length };
  } };
  try {
    const owner = await repo.register({ email: 'migration@example.invalid', name: 'Migration owner', companyName: 'Migration company' }, 'explicit-synthetic-password-hash');
    const agent = await repo.createAgent(owner.tenant.id, { name: 'Migration guide', companyName: 'Migration company', description: 'Migration test', instructions: 'Use published sources', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] });
    const doc = await repo.addDocument(owner.tenant.id, agent.id, { title: 'Original handbook', content: 'Original immutable policy and workflow evidence.' });
    await repo.publish(owner.tenant.id, agent.id, 'tigergraph'); await repo.publicationState(agent.id, 1, 'ready', undefined, true);
    await repo.updateDocument(owner.tenant.id, agent.id, doc.id, { title: 'Second handbook', content: 'Second immutable policy and workflow evidence.' });
    await repo.publish(owner.tenant.id, agent.id, 'tigergraph'); await repo.publicationState(agent.id, 2, 'ready', undefined, true);
    await repo.activateVersion(owner.tenant.id, agent.id, 1);
    await repo.publish(owner.tenant.id, agent.id, 'tigergraph'); await repo.publicationState(agent.id, 3, 'failed', 'Explicit prior failure');
    const before = await repo.rows('SELECT * FROM versions ORDER BY number');
    await t.test('preview has no provider calls or writes', async () => {
      const preview = await migrateKnowledgeSnapshots(repo, provider); assert.equal(preview.applied, false); assert.equal(preview.versions, 2); assert.equal(preview.changed, 2); assert.equal(calls, 0);
      assert.equal((await repo.agent(owner.tenant.id, agent.id)).publishedVersion, 1);
    });
    await t.test('partial preparation failure leaves every version on its previous provider', async () => {
      failAt = 2; await assert.rejects(migrateKnowledgeSnapshots(repo, provider, true), /preparation failure/);
      assert.deepEqual((await repo.rows('SELECT graph_source FROM publication_states ORDER BY version')).map(row => row.graph_source), ['tigergraph','tigergraph','tigergraph']);
      assert.deepEqual(await repo.rows('SELECT * FROM versions ORDER BY number'), before); failAt = 0;
    });
    await t.test('a changed snapshot is detected before switching sources', async () => {
      changeDuringSync = true; await assert.rejects(migrateKnowledgeSnapshots(repo, provider, true), /changed during migration/);
      assert.deepEqual((await repo.rows('SELECT graph_source FROM publication_states ORDER BY version')).map(row => row.graph_source), ['tigergraph','tigergraph','tigergraph']);
      await repo.db.prepare('UPDATE versions SET config=? WHERE agent_id=? AND number=1').run(String(before[0]!.config), agent.id);
    });
    await t.test('success keeps source bytes, selected version, failed candidates and account credentials', async () => {
      const result = await migrateKnowledgeSnapshots(repo, provider, true); assert.equal(result.changed, 2); assert.equal(result.chunks, 2);
      assert.deepEqual(await repo.rows('SELECT * FROM versions ORDER BY number'), before);
      assert.equal((await repo.agent(owner.tenant.id, agent.id)).publishedVersion, 1);
      assert.deepEqual((await repo.rows('SELECT graph_source,status FROM publication_states ORDER BY version')).map(row => [row.graph_source,row.status]), [['postgres','ready'],['postgres','ready'],['tigergraph','failed']]);
      assert.equal((await repo.row('SELECT password_hash FROM users WHERE id=?', owner.user.id))!.password_hash, 'explicit-synthetic-password-hash');
      const replay = await migrateKnowledgeSnapshots(repo, provider, true); assert.equal(replay.changed, 0);
      assert.equal(Number((await repo.row("SELECT COUNT(*) AS count FROM audit_events WHERE event='knowledge.provider_migrated'"))!.count), 2);
    });
  } finally { await repo.close(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); await rm(dir, { recursive: true, force: true }); }
});
