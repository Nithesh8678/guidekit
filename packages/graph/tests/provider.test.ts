import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTigerGraphProvider, TigerGraphError, type GraphSnapshot } from '../src/index.js';

type V = { v_id: string; v_type: string; attributes: Record<string, unknown> };
type E = { from: string; type: string; to: string };
const ok = (results: unknown[]) => new Response(JSON.stringify({ error: false, results }), { headers: { 'Content-Type': 'application/json' } });

/** Explicit REST contract fixture, not a TigerGraph server or GSQL compiler. */
class GraphFixture {
  vertices = new Map<string, V>(); edges: E[] = []; calls: { url: string; body: any; init: RequestInit }[] = [];
  rejectEdges = false;
  fetch: typeof fetch = async (url, init) => {
    const address = String(url), body = JSON.parse(String(init?.body));
    this.calls.push({ url: address, body, init: init! });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token');
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    if (address.includes('/graph/')) {
      let vertexCount = 0, edgeCount = 0;
      for (const [type, vertices] of Object.entries(body.vertices) as [string, Record<string, any>][]) {
        for (const [id, attrs] of Object.entries(vertices)) {
          this.vertices.set(id, { v_id: id, v_type: type, attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, (v as any).value])) }); vertexCount++;
        }
      }
      if (!this.rejectEdges) for (const sources of Object.values(body.edges) as any[]) for (const [from, relations] of Object.entries(sources)) {
        for (const [type, targets] of Object.entries(relations as any)) for (const ids of Object.values(targets as any) as any[]) for (const to of Object.keys(ids)) {
          if (!this.edges.some(edge => edge.from === from && edge.type === type && edge.to === to)) this.edges.push({ from, type, to }); edgeCount++;
        }
      }
      return ok([{ accepted_vertices: vertexCount, accepted_edges: edgeCount }]);
    }
    if (address.endsWith('/guidekit_status')) return ok([{ schema_version: 1 }]);
    const inScope = (v: V) => v.attributes.scope === body.scope && v.attributes.tenant_id === body.tenant_id && v.attributes.agent_id === body.agent_id && v.attributes.version === body.version;
    const version = [...this.vertices.values()].find(v => v.v_type === 'GKVersion' && v.v_id === body.scope && inScope(v));
    if (address.endsWith('/guidekit_version')) return ok([{ versions: version ? [version] : [] }]);
    if (address.endsWith('/guidekit_retrieve')) {
      if (version?.attributes.ready !== true) return ok([{ version_ready: false }, { evidence: [] }]);
      const concepts = [...this.vertices.values()].filter(v => v.v_type === 'GKConcept' && inScope(v));
      const chunks = [...this.vertices.values()].filter(v => v.v_type === 'GKChunk' && inScope(v));
      const mentions = (chunk: V, concept: V) => this.edges.some(e => e.type === 'GK_MENTIONS' && e.from === chunk.v_id && e.to === concept.v_id);
      const seeds = chunks.filter(chunk => concepts.some(c => body.terms.includes(c.attributes.term) && mentions(chunk, c))).slice(0, 32);
      const bridge = concepts.filter(concept => seeds.some(seed => mentions(seed, concept))).slice(0, 256);
      const evidence = chunks.map(chunk => {
        const related = bridge.filter(c => mentions(chunk, c));
        const paths = related.flatMap(c => seeds.filter(seed => mentions(seed, c)).map(seed => ({ seed_document_id: seed.attributes.document_id, concept: c.attributes.term }))).slice(0, 8);
        return { ...chunk, attributes: { ...chunk.attributes, score: related.length, paths } };
      }).filter(v => v.attributes.score > 0).sort((a, b) => b.attributes.score - a.attributes.score).slice(0, body.max_results);
      return ok([{ version_ready: true }, { evidence }]);
    }
    throw new Error('Unexpected fixture endpoint');
  };
}
const config = (fetch: typeof globalThis.fetch) => ({ baseUrl: 'https://fixture.example', graphName: 'GuideKit', token: 'fixture-token', fetch });
const snapshot = (overrides: Partial<GraphSnapshot> = {}): GraphSnapshot => ({
  tenantId: 'tenant_a', agentId: 'agent_a', version: 1,
  documents: [
    { id: 'invoice', title: 'Invoice help', content: 'An invoice belongs to billing. Billing explains an invoice.' },
    { id: 'export', title: 'Statement export', content: 'Billing statements support CSV export from Settings.' }
  ], allowedActions: ['export_statement'], ...overrides
});

test('retrieves a document through a shared concept despite no question token, with tenant/agent/version isolation', async () => {
  const graph = new GraphFixture(), provider = createTigerGraphProvider(config(graph.fetch));
  const counts = await provider.syncVersion(snapshot());
  assert.ok(counts.vertices > 8 && counts.edges > 8);
  await provider.syncVersion(snapshot({ tenantId: 'tenant_b', documents: [{ id: 'secret', title: 'Private invoice', content: 'invoice billing private-secret' }] }));
  await provider.syncVersion(snapshot({ agentId: 'agent_b', documents: [{ id: 'other_agent', title: 'Other invoice', content: 'invoice billing other-agent-secret' }] }));
  await provider.syncVersion(snapshot({ version: 2, documents: [{ id: 'future', title: 'Future invoice', content: 'invoice billing future-version-secret' }] }));
  const result = await provider.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 1, question: 'invoice' });
  assert.equal(result.source, 'tigergraph');
  assert.deepEqual(new Set(result.citations.map(c => c.documentId)), new Set(['invoice', 'export']));
  const exported = result.citations.find(c => c.documentId === 'export')!;
  assert.ok(!`${exported.title} ${exported.excerpt}`.toLowerCase().includes('invoice'));
  assert.ok(result.paths.some(path => path.nodes.join('/') === 'invoice/billing/export'));
  assert.ok(!JSON.stringify(result).includes('secret'));
  const query = graph.calls.findLast(call => call.url.endsWith('guidekit_retrieve'))!;
  assert.equal(query.url, 'https://fixture.example/restpp/query/GuideKit/guidekit_retrieve');
  assert.deepEqual(query.body.terms, ['invoice']);
  assert.equal(query.body.tenant_id, 'tenant_a'); assert.equal(query.body.version, 1);
  const expectedScope = query.body.scope;
  assert.ok([...graph.vertices.values()].filter(v => v.attributes.scope === expectedScope).every(v => v.attributes.tenant_id === 'tenant_a' && v.attributes.agent_id === 'agent_a' && v.attributes.version === 1));
});

test('sync is idempotent, rejects rewriting a published version, and preserves incomplete readiness on partial acknowledgement', async () => {
  const graph = new GraphFixture(), provider = createTigerGraphProvider(config(graph.fetch));
  await provider.syncVersion(snapshot());
  const count = graph.calls.filter(c => c.url.includes('/graph/')).length;
  await provider.syncVersion(snapshot());
  assert.equal(graph.calls.filter(c => c.url.includes('/graph/')).length, count);
  await assert.rejects(provider.syncVersion(snapshot({ documents: [{ id: 'new', title: 'New content', content: 'Changed' }] })), (e: unknown) => e instanceof TigerGraphError && e.code === 'snapshot_conflict');
  graph.rejectEdges = true;
  await assert.rejects(provider.syncVersion(snapshot({ version: 3 })), /did not acknowledge/);
  assert.equal([...graph.vertices.values()].find(v => v.v_type === 'GKVersion' && v.attributes.version === 3)?.attributes.ready, false);
  await assert.rejects(provider.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 3, question: 'invoice' }), /not completed/);
  graph.rejectEdges = false;
  await provider.syncVersion(snapshot({ version: 3 }));
  assert.equal((await provider.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 3, question: 'invoice' })).citations.length, 2);
});

test('concurrent identical sync shares work and rejects a conflicting in-flight snapshot', async () => {
  const graph = new GraphFixture(), provider = createTigerGraphProvider(config(graph.fetch));
  const first = provider.syncVersion(snapshot());
  const second = provider.syncVersion(snapshot());
  await assert.rejects(provider.syncVersion(snapshot({ allowedActions: [] })), /syncing different/);
  assert.deepEqual(await first, await second);
  assert.equal(graph.calls.filter(c => c.url.endsWith('guidekit_version')).length, 1);
});

test('status verifies the installed schema marker and RESTPP root prefix is explicit', async () => {
  const graph = new GraphFixture();
  const provider = createTigerGraphProvider({ ...config(graph.fetch), baseUrl: 'http://127.0.0.1:9000', restppPrefix: '' });
  assert.equal((await provider.status()).connected, true);
  assert.equal(graph.calls[0].url, 'http://127.0.0.1:9000/query/GuideKit/guidekit_status');
  const wrong = createTigerGraphProvider(config(async () => ok([{ schema_version: 2 }])));
  assert.equal((await wrong.status()).connected, false);
  const offline = createTigerGraphProvider();
  assert.deepEqual(await offline.status(), { configured: false, connected: false, message: 'TigerGraph is not configured. Configure a cluster, install the GuideKit schema and queries, and supply a server-side token.' });
  await assert.rejects(offline.syncVersion(snapshot()), /not configured/);
});

test('configured errors never substitute fixture/local evidence or leak transport secrets', async () => {
  const broken = createTigerGraphProvider(config(async () => { throw new Error('fixture-token private upstream URL'); }));
  const status = await broken.status(); assert.equal(status.configured, true); assert.equal(status.connected, false);
  assert.ok(!status.message.includes('fixture-token'));
  await assert.rejects(broken.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 1, question: 'invoice' }), /could not complete/);
  const rejected = createTigerGraphProvider(config(async () => new Response(JSON.stringify({ error: true, message: 'fixture-token', results: [] }))));
  await assert.rejects(rejected.syncVersion(snapshot()), /rejected the operation/);
  const malformed = createTigerGraphProvider(config(async () => new Response('not json')));
  assert.equal((await malformed.status()).connected, false);
});

test('defense in depth rejects cross-scope graph responses and unbounded requests', async () => {
  const forged = createTigerGraphProvider(config(async () => ok([{ version_ready: true }, { evidence: [{ attributes: { scope: 'wrong', tenant_id: 'tenant_b', agent_id: 'agent_a', version: 1 } }] }])));
  await assert.rejects(forged.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 1, question: 'invoice' }), /outside the requested scope/);
  await assert.rejects(forged.retrieve({ tenantId: 'tenant_a', agentId: 'agent_a', version: 1, question: 'invoice', limit: 999 }), /between 1 and 16/);
  await assert.rejects(forged.syncVersion(snapshot({ documents: [{ id: 'large', title: 'Large', content: 'x'.repeat(2_000_001) }] })), /exceeds 2 MB/);
  for (const patch of [{ graphName: '../bad' }, { baseUrl: 'https://user:secret@fixture.example' }, { baseUrl: 'http://remote.example' }, { baseUrl: 'https://fixture.example/restpp' }, { restppPrefix: '/restpp?bad=1' }, { token: 'secret\nheader' }]) {
    assert.throws(() => createTigerGraphProvider({ ...config(globalThis.fetch), ...patch }), TigerGraphError);
  }
});
