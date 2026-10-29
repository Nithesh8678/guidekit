/** Opt-in live TigerGraph proof. Uses only synthetic documents; retains its versioned graph evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTigerGraphProvider } from '../packages/graph/src/index.js';

const baseUrl = process.env.TIGERGRAPH_BASE_URL;
if (!baseUrl || (!process.env.TIGERGRAPH_SECRET && !process.env.TIGERGRAPH_TOKEN)) throw new Error('Configure a TigerGraph workspace and server-only credential in .env first.');
const graph = createTigerGraphProvider({ baseUrl, graphName: process.env.TIGERGRAPH_GRAPH_NAME ?? 'GuideKit', secret: process.env.TIGERGRAPH_SECRET, token: process.env.TIGERGRAPH_TOKEN, restppPrefix: process.env.TIGERGRAPH_RESTPP_PREFIX ?? '/restpp' });
assert.equal((await graph.status()).connected, true, 'GuideKit graph queries must be installed and reachable.');
const tenantId = `proof_${randomUUID()}`, agentId = `agent_${randomUUID()}`;
const documents = [{ id: 'invoice_route', title: 'Invoice routing', content: 'Invoice questions use the billing workflow.' }, { id: 'statement_exports', title: 'Statement exports', content: 'Billing statement exports are available to workspace owners.' }];
const counts = await graph.syncVersion({ tenantId, agentId, version: 1, documents, allowedActions: ['create_ticket'] });
assert.deepEqual(await graph.syncVersion({ tenantId, agentId, version: 1, documents, allowedActions: ['create_ticket'] }), counts, 'Identical snapshot retries must be idempotent.');
await graph.syncVersion({ tenantId: `${tenantId}_other`, agentId, version: 1, documents: [{ id: 'foreign_invoice', title: 'Foreign invoice policy', content: 'Invoice billing details from another company must stay isolated.' }], allowedActions: [] });
await graph.syncVersion({ tenantId, agentId, version: 2, documents: [{ id: 'later_policy', title: 'Later policy', content: 'Unrelated shipping procedures.' }], allowedActions: [] });
const evidence = await graph.retrieve({ tenantId, agentId, version: 1, question: 'invoice' });
assert.ok(evidence.citations.some(source => source.documentId === 'invoice_route'), 'Direct invoice source must be retrieved.');
assert.ok(evidence.citations.some(source => source.documentId === 'statement_exports'), 'Graph must retrieve the related source without the question token.');
assert.ok(evidence.paths.some(path => path.nodes[0] === 'invoice_route' && path.nodes[1] === 'billing' && path.nodes[2] === 'statement_exports'), 'Shared billing concept must explain the relationship.');
assert.ok(evidence.citations.every(source => documents.some(doc => doc.id === source.documentId)), 'Tenant and version boundaries must hold.');
const later = await graph.retrieve({ tenantId, agentId, version: 2, question: 'invoice' });
assert.equal(later.citations.length, 0, 'Earlier knowledge must not leak into the later version.');
console.log(JSON.stringify({ verified: true, source: evidence.source, counts, documents: evidence.citations.map(source => source.title), crossDocumentPath: ['Invoice routing', 'billing', 'Statement exports'], tenantIsolation: true, versionIsolation: true, idempotentSync: true }, null, 2));
