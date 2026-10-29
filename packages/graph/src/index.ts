/** Server-only TigerGraph evidence provider. Never import into the browser SDK. */
import { createHash } from 'node:crypto';

export interface TigerGraphConfig {
  /** Origin only, e.g. https://example.i.tgcloud.io. */
  baseUrl: string;
  graphName: string;
  token?: string;
  /** Savanna database secret, sent only to its configured workspace. Use exactly one credential. */
  secret?: string;
  /** '/restpp' for the HTTPS gateway; '' for a direct RESTPP listener. */
  restppPrefix?: string;
  fetch?: typeof fetch;
}
export interface GraphScope { tenantId: string; agentId: string; version: number; }
export interface GraphSnapshot extends GraphScope {
  documents: Array<{ id: string; title: string; content: string }>;
  allowedActions: string[];
}
export interface GraphEvidence {
  citations: Array<{ documentId: string; title: string; excerpt: string }>;
  paths: Array<{ nodes: string[]; relation: string }>;
  source: 'tigergraph';
}
export interface TigerGraphProvider {
  status(): Promise<{ configured: boolean; connected: boolean; graphName?: string; message: string }>;
  syncVersion(input: GraphSnapshot): Promise<{ vertices: number; edges: number }>;
  retrieve(input: GraphScope & { question: string; limit?: number }): Promise<GraphEvidence>;
}

export class TigerGraphError extends Error {
  constructor(public readonly code: 'not_configured' | 'invalid_config' | 'invalid_input' | 'request_failed' | 'invalid_response' | 'snapshot_conflict', message: string) {
    super(message); this.name = 'TigerGraphError';
  }
}

type Attributes = Record<string, { value: string | number | boolean }>;
type Vertex = { type: string; id: string; attributes: Attributes };
type Edge = { fromType: string; fromId: string; type: string; toType: string; toId: string };
type JsonObject = Record<string, unknown>;
const MAX_RESPONSE = 4_000_000, MAX_BATCH = 400_000;
const STOP = new Set('a an and are as at be been being but by can cannot could did do does doing for from had has have how i if in into is it its may me my no not of on or our out please she should so some than that the their them then there these they this those to too up us use using was we were what when where which who why will with would you your document guide page section company question help need want show tell also'.split(' '));
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function fail(code: TigerGraphError['code'], message: string): never { throw new TigerGraphError(code, message); }
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
function identifier(value: string, label: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) fail('invalid_input', `Invalid ${label}.`);
}
function scope(input: GraphScope) {
  identifier(input.tenantId, 'tenant ID'); identifier(input.agentId, 'agent ID');
  if (!Number.isSafeInteger(input.version) || input.version < 1) fail('invalid_input', 'Version must be a positive integer.');
  return hash([input.tenantId, input.agentId, input.version]);
}
/** Bounded, deterministic lexical concepts; no embeddings or LLM extraction. */
export function conceptTerms(text: string, limit = 24): string[] {
  const words = (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])
    .filter(word => word.length > 2 && word.length <= 64 && !STOP.has(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([term]) => term);
}
function snapshot(input: GraphSnapshot) {
  const key = scope(input);
  if (!Array.isArray(input.documents) || input.documents.length > 40 || !Array.isArray(input.allowedActions) || input.allowedActions.length > 30) fail('invalid_input', 'A snapshot supports at most 40 documents and 30 actions.');
  const ids = new Set<string>(); let bytes = 0;
  for (const doc of input.documents) {
    identifier(doc.id, 'document ID');
    if (ids.has(doc.id)) fail('invalid_input', 'Duplicate document ID.'); ids.add(doc.id);
    if (typeof doc.title !== 'string' || doc.title.length < 1 || doc.title.length > 180 || typeof doc.content !== 'string') fail('invalid_input', 'Invalid document title or content.');
    bytes += Buffer.byteLength(doc.content);
  }
  if (bytes > 2_000_000) fail('invalid_input', 'Snapshot source text exceeds 2 MB.');
  input.allowedActions.forEach(action => identifier(action, 'action name'));
  const docs = input.documents.map(({ id, title, content }) => ({ id, title, content })).sort((a, b) => a.id.localeCompare(b.id));
  const actions = [...new Set(input.allowedActions)].sort();
  const manifest = hash([docs, actions]);
  const vertices: Vertex[] = [], edges: Edge[] = [];
  const attrs = (extra: Record<string, string | number | boolean>): Attributes => Object.fromEntries(Object.entries({ scope: key, tenant_id: input.tenantId, agent_id: input.agentId, version: input.version, ...extra }).map(([name, value]) => [name, { value }]));
  const concepts = new Set<string>();
  for (const doc of docs) {
    const docId = hash([key, 'document', doc.id]);
    vertices.push({ type: 'GKDocument', id: docId, attributes: attrs({ document_id: doc.id, title: doc.title }) });
    edges.push({ fromType: 'GKVersion', fromId: key, type: 'GK_HAS_DOCUMENT', toType: 'GKDocument', toId: docId });
    // No overlap: each chunk is independently bounded and all source text is retained.
    for (let offset = 0; offset < Math.max(1, doc.content.length); offset += 900) {
      const content = doc.content.slice(offset, offset + 900), chunkId = hash([key, 'chunk', doc.id, offset]);
      vertices.push({ type: 'GKChunk', id: chunkId, attributes: attrs({ document_id: doc.id, title: doc.title, excerpt: content, ordinal: offset / 900 }) });
      edges.push({ fromType: 'GKDocument', fromId: docId, type: 'GK_HAS_CHUNK', toType: 'GKChunk', toId: chunkId });
      const terms = [...new Set([...conceptTerms(doc.title, 4), ...conceptTerms(content, 20)])];
      for (const term of terms) {
        const conceptId = hash([key, 'concept', term]);
        if (!concepts.has(term)) { concepts.add(term); vertices.push({ type: 'GKConcept', id: conceptId, attributes: attrs({ term }) }); }
        edges.push({ fromType: 'GKChunk', fromId: chunkId, type: 'GK_MENTIONS', toType: 'GKConcept', toId: conceptId });
      }
    }
  }
  for (const name of actions) {
    const actionId = hash([key, 'action', name]);
    vertices.push({ type: 'GKAction', id: actionId, attributes: attrs({ name }) });
    edges.push({ fromType: 'GKVersion', fromId: key, type: 'GK_ALLOWS_ACTION', toType: 'GKAction', toId: actionId });
  }
  const versionVertex = (ready: boolean): Vertex => ({ type: 'GKVersion', id: key, attributes: attrs({ manifest, ready, vertex_count: vertices.length + 1, edge_count: edges.length }) });
  return { key, manifest, vertices, edges, versionVertex };
}

function payload(vertices: Vertex[], edges: Edge[]) {
  type TargetIds = Record<string, object>;
  type TargetTypes = Record<string, TargetIds>;
  type EdgeTypes = Record<string, TargetTypes>;
  type SourceIds = Record<string, EdgeTypes>;
  const result: { vertices: Record<string, Record<string, Attributes>>; edges: Record<string, SourceIds> } = { vertices: {}, edges: {} };
  for (const vertex of vertices) (result.vertices[vertex.type] ??= {})[vertex.id] = vertex.attributes;
  for (const edge of edges) (((((result.edges[edge.fromType] ??= {})[edge.fromId] ??= {})[edge.type] ??= {})[edge.toType] ??= {}))[edge.toId] = {};
  return result;
}

export function createTigerGraphProvider(config?: TigerGraphConfig): TigerGraphProvider {
  if (!config) return {
    status: async () => ({ configured: false, connected: false, message: 'TigerGraph is not configured. Configure a cluster, install the GuideKit schema and queries, and supply a server-side token.' }),
    syncVersion: async () => fail('not_configured', 'TigerGraph is not configured.'),
    retrieve: async () => fail('not_configured', 'TigerGraph is not configured.')
  };
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { return fail('invalid_config', 'TigerGraph baseUrl must be an absolute HTTP(S) origin.'); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) fail('invalid_config', 'TigerGraph baseUrl must be an HTTPS origin, or HTTP loopback for a local cluster.');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.graphName)) fail('invalid_config', 'TigerGraph graphName must be a GSQL identifier.');
  const credential = config.secret ?? config.token;
  if ((!!config.secret === !!config.token) || typeof credential !== 'string' || !credential.trim() || credential.length > 8192 || /[\r\n]/.test(credential)) fail('invalid_config', 'Supply exactly one valid server-side TigerGraph token or database secret.');
  const authorization = `${config.secret ? 'GSQL-Secret' : 'Bearer'} ${credential}`;
  const prefix = config.restppPrefix ?? '/restpp';
  if (prefix !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) fail('invalid_config', 'TigerGraph restppPrefix must be an absolute path without a trailing slash.');
  const fetcher = config.fetch ?? globalThis.fetch;
  const root = `${base.origin}${prefix}`, graphName = config.graphName;
  const syncs = new Map<string, { manifest: string; promise: Promise<{ vertices: number; edges: number }> }>();
  async function request(path: string, body: unknown): Promise<JsonObject[]> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(`${root}${path}`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'GSQL-TIMEOUT': '6000', 'RESPONSE-LIMIT': String(MAX_RESPONSE) }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
      if (!response.ok) fail('request_failed', `TigerGraph request failed (HTTP ${response.status}). Check the cluster, token privileges and installed queries.`);
      const reader = response.body?.getReader();
      if (!reader) fail('invalid_response', 'TigerGraph returned an empty response.');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE) { await reader.cancel(); fail('invalid_response', 'TigerGraph response exceeded the safety limit.'); }
        chunks.push(value);
      }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_response', 'TigerGraph returned invalid JSON.'); }
      if (!object(data) || data.error !== false || !Array.isArray(data.results) || !data.results.every(object)) fail('invalid_response', 'TigerGraph rejected the operation or returned an unexpected response. Check schema/query compatibility.');
      return data.results as JsonObject[];
    } catch (error) {
      if (error instanceof TigerGraphError) throw error;
      // Never surface remote messages, request URLs or transport error text: they can contain credentials.
      return fail('request_failed', controller.signal.aborted ? 'TigerGraph request timed out.' : 'TigerGraph request could not complete. Check the server connection.');
    } finally { clearTimeout(timer); }
  }
  const query = (name: string, params: unknown) => request(`/query/${graphName}/${name}`, params);
  const parameters = (input: GraphScope) => ({ scope: scope(input), tenant_id: input.tenantId, agent_id: input.agentId, version: input.version });
  async function upsert(vertices: Vertex[], edges: Edge[]) {
    const rows = await request(`/graph/${graphName}?ack=all&vertex_must_exist=true`, payload(vertices, edges));
    const acceptedVertices = rows.reduce((sum, row) => sum + (typeof row.accepted_vertices === 'number' ? row.accepted_vertices : 0), 0);
    const acceptedEdges = rows.reduce((sum, row) => sum + (typeof row.accepted_edges === 'number' ? row.accepted_edges : 0), 0);
    if (acceptedVertices !== vertices.length || acceptedEdges !== edges.length) fail('request_failed', 'TigerGraph did not acknowledge every vertex and edge. This version remains unavailable until a complete sync.');
  }
  async function batches<T>(items: T[], send: (batch: T[]) => Promise<void>) {
    let batch: T[] = [], size = 0;
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item)) + 150;
      if (batch.length && size + bytes > MAX_BATCH) { await send(batch); batch = []; size = 0; }
      batch.push(item); size += bytes;
    }
    if (batch.length) await send(batch);
  }
  return {
    async status() {
      try {
        const result = await query('guidekit_status', {});
        if (!result.some(row => row.schema_version === 1)) fail('invalid_response', 'GuideKit TigerGraph schema version is incompatible.');
        return { configured: true, connected: true, graphName, message: 'TigerGraph is connected; GuideKit graph queries are installed. Published-version sync is checked separately.' };
      } catch (error) { return { configured: true, connected: false, graphName, message: error instanceof TigerGraphError ? error.message : 'TigerGraph is unavailable.' }; }
    },
    async syncVersion(input) {
      const built = snapshot(input), params = parameters(input);
      const active = syncs.get(built.key);
      if (active) {
        if (active.manifest !== built.manifest) fail('snapshot_conflict', 'This published version is syncing different graph knowledge. Publish a new version.');
        return active.promise;
      }
      const synchronize = async () => {
      const manifests = await query('guidekit_version', params);
      if (!manifests.some(row => Array.isArray(row.versions))) fail('invalid_response', 'TigerGraph returned no version manifest result.');
      const existing = manifests.flatMap(row => Array.isArray(row.versions) ? row.versions : []);
      if (existing.length > 1) fail('invalid_response', 'TigerGraph returned multiple version manifests.');
      if (existing.length) {
        const vertex = existing[0];
        if (!object(vertex) || !object(vertex.attributes)) fail('invalid_response', 'TigerGraph returned an invalid version manifest.');
        const attrs = vertex.attributes;
        if (attrs.scope !== built.key || attrs.tenant_id !== input.tenantId || attrs.agent_id !== input.agentId || attrs.version !== input.version) fail('invalid_response', 'TigerGraph returned a version outside the requested scope.');
        if (attrs.manifest !== built.manifest) fail('snapshot_conflict', 'This published version already has different graph knowledge. Publish a new version.');
        if (attrs.ready === true) return { vertices: built.vertices.length + 1, edges: built.edges.length };
      }
      await upsert([built.versionVertex(false)], []);
      await batches(built.vertices, vertices => upsert(vertices, []));
      await batches(built.edges, edges => upsert([], edges));
      // Retrieval starts only after all acknowledged batches completed successfully.
      await upsert([built.versionVertex(true)], []);
      return { vertices: built.vertices.length + 1, edges: built.edges.length };
      };
      const promise = synchronize();
      syncs.set(built.key, { manifest: built.manifest, promise });
      try { return await promise; } finally { if (syncs.get(built.key)?.promise === promise) syncs.delete(built.key); }
    },
    async retrieve(input) {
      const params = parameters(input);
      if (typeof input.question !== 'string' || input.question.length > 3000) fail('invalid_input', 'Question exceeds 3000 characters.');
      const limit = input.limit ?? 8;
      if (!Number.isInteger(limit) || limit < 1 || limit > 16) fail('invalid_input', 'Retrieval limit must be between 1 and 16.');
      const terms = conceptTerms(input.question, 12);
      const result = await query('guidekit_retrieve', { ...params, terms, max_results: limit });
      if (!result.some(row => row.version_ready === true)) fail('request_failed', 'This published version has not completed TigerGraph sync. Retry publishing or repair the connection.');
      const rows = result.flatMap(row => Array.isArray(row.evidence) ? row.evidence : []);
      if (rows.length > 16) fail('invalid_response', 'TigerGraph returned too much evidence.');
      const citations: GraphEvidence['citations'] = [], paths: GraphEvidence['paths'] = [];
      const seen = new Set<string>(), seenPaths = new Set<string>();
      for (const row of rows) {
        if (!object(row) || !object(row.attributes)) fail('invalid_response', 'TigerGraph returned invalid evidence.');
        const attrs = row.attributes;
        if (attrs.scope !== params.scope || attrs.tenant_id !== input.tenantId || attrs.agent_id !== input.agentId || attrs.version !== input.version) fail('invalid_response', 'TigerGraph returned evidence outside the requested scope.');
        if (typeof attrs.document_id !== 'string' || typeof attrs.title !== 'string' || typeof attrs.excerpt !== 'string' || attrs.title.length > 180 || attrs.excerpt.length > 900 || !Array.isArray(attrs.paths)) fail('invalid_response', 'TigerGraph returned invalid evidence attributes.');
        identifier(attrs.document_id, 'returned document ID');
        if (!seen.has(attrs.document_id) && citations.length < limit) { citations.push({ documentId: attrs.document_id, title: attrs.title, excerpt: attrs.excerpt }); seen.add(attrs.document_id); }
        for (const path of attrs.paths.slice(0, 16)) {
          if (!object(path) || typeof path.seed_document_id !== 'string' || typeof path.bridge_term !== 'string' || path.bridge_term.length > 64) fail('invalid_response', 'TigerGraph returned an invalid explanation path.');
          identifier(path.seed_document_id, 'path document ID');
          const nodes = [path.seed_document_id, path.bridge_term, attrs.document_id], key = JSON.stringify(nodes);
          if (!seenPaths.has(key) && paths.length < limit * 4) { paths.push({ nodes, relation: path.seed_document_id === attrs.document_id ? 'question-matched document contains this connected concept' : 'documents share a concept through their source chunks' }); seenPaths.add(key); }
        }
      }
      return { citations, paths, source: 'tigergraph' };
    }
  };
}
