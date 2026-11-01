import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresKnowledgeProvider, createLocalEmbeddingProvider, installPostgresKnowledgeSchema, type EmbeddingProvider, type KnowledgeSnapshot } from '../src/index.js';

const ownerUrl = process.env.GUIDEKIT_TEST_POSTGRES_URL, runtimeUrl = process.env.GUIDEKIT_TEST_KNOWLEDGE_URL;
const enabled = !!ownerUrl && !!runtimeUrl;
function fixtureEmbeddings(): EmbeddingProvider {
  return { model: 'explicit-test-fixture-v1', dimensions: 384, async embed(texts) { return texts.map(text => { const v = Array(384).fill(0); v[/invoice|payment|deadline/i.test(text) ? 1 : 0] = 1; return v; }); } };
}
const unique = () => randomUUID().replaceAll('-', '_');
const scopedQuery = async (pool: Pool, snapshot: KnowledgeSnapshot, sql: string, values: unknown[] = []) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query("SELECT set_config('guidekit.tenant_id',$1,true),set_config('guidekit.agent_id',$2,true),set_config('guidekit.version',$3,true)", [snapshot.tenantId, snapshot.agentId, String(snapshot.version)]); const rows = await client.query(sql, values); await client.query('COMMIT'); return rows; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

test('PostgreSQL hybrid retrieval: immutable atomic snapshots, exact grounded sources and RLS isolation', { skip: !enabled }, async t => {
  assert.equal(new URL(ownerUrl!).pathname, '/guidekit_test', 'Integration tests require the explicitly disposable test database.');
  await installPostgresKnowledgeSchema({ connectionString: ownerUrl!, runtimeRole: decodeURIComponent(new URL(runtimeUrl!).username) });
  const provider = createPostgresKnowledgeProvider({ connectionString: runtimeUrl!, embeddings: fixtureEmbeddings() });
  const owner = new Pool({ connectionString: ownerUrl, max: 1 }), runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
  const snapshot: KnowledgeSnapshot = { tenantId: `test_${unique()}`, agentId: 'agent', version: 1, allowedActions: ['save'], documents: [{ id: 'transition', title: 'Dissolve transitions', content: '😀 Open Transitions. Choose Dissolve and add a gradual fade between two clips.' }, { id: 'billing', title: 'ExportPreset42 payment deadline', content: 'Invoices must be paid within 30 days. This billing policy explains payment deadlines.' }] };
  try {
    assert.equal((await provider.status()).connected, true);
    await t.test('incomplete versions fail, repeated sync is idempotent and publication content is immutable', async () => {
      await assert.rejects(provider.retrieve({ ...snapshot, question: 'blend movies' }), /not completed/);
      const [first, second] = await Promise.all([provider.syncVersion(snapshot), provider.syncVersion(snapshot)]);
      assert.equal(first.chunks, 2); assert.deepEqual(second, first);
      const counts = await scopedQuery(runtime, snapshot, 'SELECT count(*)::int AS count FROM guidekit_knowledge.chunks'); assert.equal(counts.rows[0].count, 2);
      await assert.rejects(provider.syncVersion({ ...snapshot, documents: [{ ...snapshot.documents[0]!, content: 'Changed publication' }] }), /different knowledge/);
      await assert.rejects(scopedQuery(owner, snapshot, "UPDATE guidekit_knowledge.versions SET manifest=repeat('f',64) WHERE tenant_id=$1 AND agent_id=$2 AND version=$3", [snapshot.tenantId, snapshot.agentId, snapshot.version]), /immutable/);
    });
    await t.test('semantic paraphrase and exact lexical product names produce grounded deduplicated citations', async () => {
      const semantic = await provider.retrieve({ ...snapshot, question: 'make one movie gently blend into another' });
      assert.equal(semantic.source, 'postgres'); assert.deepEqual(semantic.paths, []);
      assert.deepEqual(semantic.citations.map(c => c.documentId), ['transition']); assert.equal(semantic.citations[0]!.excerpt, snapshot.documents[0]!.content);
      const lexical = await provider.retrieve({ ...snapshot, question: 'ExportPreset42', limit: 1 }); assert.equal(lexical.citations[0]!.documentId, 'billing');
      const punctuation = await provider.retrieve({ ...snapshot, question: "' OR 1=1; DROP TABLE documents; --", limit: 1 }); assert.equal(punctuation.citations.length <= 1, true);
      assert.equal((await provider.status()).connected, true);
    });
    await t.test('transactions isolate identical document IDs across tenants, agents and versions; unscoped SQL is denied', async () => {
      const others = [{ ...snapshot, tenantId: `other_${unique()}` }, { ...snapshot, agentId: 'other_agent' }, { ...snapshot, version: 2 }].map(item => ({ ...item, documents: [{ id: 'transition', title: 'Other scope', content: 'This source belongs to another tenant, agent or publication.' }] }));
      await Promise.all(others.map(item => provider.syncVersion(item)));
      const runs = await Promise.all(Array.from({ length: 12 }, (_, index) => { const scope = index % 2 ? others[index % 3]! : snapshot; return provider.retrieve({ ...scope, question: 'blend movies' }).then(result => ({ scope, result })); }));
      for (const { scope, result } of runs) assert.equal(result.citations[0]?.title, scope === snapshot ? 'Dissolve transitions' : 'Other scope');
      const rows = await runtime.query('SELECT document_id FROM guidekit_knowledge.chunks'); assert.deepEqual(rows.rows, []);
      await owner.query('CREATE POLICY test_accidental_allow ON guidekit_knowledge.chunks USING(true) WITH CHECK(true)');
      try { assert.deepEqual((await runtime.query('SELECT document_id FROM guidekit_knowledge.chunks')).rows, [], 'The restrictive boundary must survive a broad permissive policy.'); }
      finally { await owner.query('DROP POLICY test_accidental_allow ON guidekit_knowledge.chunks'); }
      const scoped = await scopedQuery(runtime, snapshot, 'SELECT DISTINCT tenant_id,agent_id,version FROM guidekit_knowledge.chunks'); assert.deepEqual(scoped.rows, [{ tenant_id: snapshot.tenantId, agent_id: snapshot.agentId, version: 1 }]);
      await assert.rejects(scopedQuery(runtime, snapshot, "INSERT INTO guidekit_knowledge.versions(tenant_id,agent_id,version,manifest,embedding_model,dimensions,chunk_count,allowed_actions) VALUES($1,'agent',1,repeat('a',64),'fixture',384,0,'[]')", [`forged_${unique()}`]), /row-level security/);
    });
    await t.test('owner connection and changed embedding model are refused; embedding failure cannot partially publish', async () => {
      const privileged = createPostgresKnowledgeProvider({ connectionString: ownerUrl!, embeddings: fixtureEmbeddings() });
      try { assert.equal((await privileged.status()).connected, false); await assert.rejects(privileged.retrieve({ ...snapshot, question: 'blend' }), /restricted runtime role/); } finally { await privileged.close?.(); }
      const changed = createPostgresKnowledgeProvider({ connectionString: runtimeUrl!, embeddings: { ...fixtureEmbeddings(), model: 'changed-model-v2' } });
      try { await assert.rejects(changed.retrieve({ ...snapshot, question: 'blend' }), /another embedding model/); } finally { await changed.close?.(); }
      const broken = createPostgresKnowledgeProvider({ connectionString: runtimeUrl!, embeddings: { ...fixtureEmbeddings(), embed: async () => { throw new Error('Synthetic embedding failure'); } } });
      const incomplete = { ...snapshot, version: 3 };
      try {
        await assert.rejects(broken.retrieve({ ...snapshot, question: 'ExportPreset42' }), /No keyword-only fallback/);
        await assert.rejects(broken.syncVersion(incomplete), /embedding preparation/);
      } finally { await broken.close?.(); }
      const absent = await scopedQuery(runtime, incomplete, 'SELECT ready FROM guidekit_knowledge.versions'); assert.deepEqual(absent.rows, []);
      await provider.syncVersion(incomplete); assert.equal((await provider.retrieve({ ...incomplete, question: 'blend' })).citations[0]!.documentId, 'transition');
    });
    await t.test('a database failure during chunk insertion rolls back the entire publication and can be retried', async () => {
      const candidate = { ...snapshot, version: 4, documents: [{ id: 'long_source', title: 'Clip workflow', content: 'Open the clips panel. Then add a transition. '.repeat(60) }] };
      // Deliberate fault injection exists only in the isolated /guidekit_test schema.
      await owner.query(`CREATE FUNCTION guidekit_knowledge.test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${snapshot.tenantId}' AND NEW.version=4 AND NEW.ordinal=1 THEN RAISE EXCEPTION 'Synthetic chunk insertion fault'; END IF; RETURN NEW; END $$`);
      await owner.query('CREATE TRIGGER test_fail_insert BEFORE INSERT ON guidekit_knowledge.chunks FOR EACH ROW EXECUTE FUNCTION guidekit_knowledge.test_fail_insert()');
      try {
        await assert.rejects(provider.syncVersion(candidate), /could not complete/);
        for (const table of ['versions', 'documents', 'chunks']) assert.deepEqual((await scopedQuery(runtime, candidate, `SELECT tenant_id FROM guidekit_knowledge.${table}`)).rows, []);
      } finally {
        await owner.query('DROP TRIGGER test_fail_insert ON guidekit_knowledge.chunks'); await owner.query('DROP FUNCTION guidekit_knowledge.test_fail_insert()');
      }
      assert.ok((await provider.syncVersion(candidate)).chunks! > 1);
      assert.equal((await provider.retrieve({ ...candidate, question: 'clips' })).citations[0]!.documentId, 'long_source');
    });
  } finally { await provider.close?.(); await owner.end(); await runtime.end(); }
});

test('real pinned local embeddings retrieve a paraphrase through PostgreSQL pgvector', { skip: !enabled || process.env.GUIDEKIT_TEST_LOCAL_EMBEDDINGS !== '1' }, async () => {
  const embeddings = createLocalEmbeddingProvider({ cacheDir: process.env.GUIDEKIT_EMBEDDING_CACHE_DIR, localFilesOnly: true });
  const provider = createPostgresKnowledgeProvider({ connectionString: runtimeUrl!, embeddings });
  const snapshot = { tenantId: `semantic_${unique()}`, agentId: 'agent', version: 1, allowedActions: [], documents: [{ id: 'dissolve', title: 'Dissolve transitions', content: 'Blend two clips with a dissolve transition. Open Transitions and choose Dissolve to make the end of one clip gradually fade into the beginning of the next.' }, { id: 'billing', title: 'Billing policy', content: 'Set an invoice payment deadline of 30 days. Update your billing address in Account settings.' }] };
  try {
    await provider.syncVersion(snapshot);
    const result = await provider.retrieve({ ...snapshot, question: 'Combine videos so one fades smoothly into the next.', limit: 2 });
    assert.equal(result.citations[0]!.documentId, 'dissolve'); assert.equal(result.source, 'postgres'); assert.equal(result.citations[0]!.excerpt, snapshot.documents[0]!.content);
    console.log(JSON.stringify({ check: 'real-local-pgvector-paraphrase', model: embeddings.model, firstSource: result.citations[0]!.documentId, citationCount: result.citations.length }));
  } finally { await provider.close?.(); }
});
