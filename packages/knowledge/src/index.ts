/** Server-only tenant-scoped PostgreSQL keyword + exact vector retrieval. */
import { Pool, type PoolClient } from 'pg';
import type { KnowledgeProvider, KnowledgeScope, KnowledgeSnapshot } from './types.js';
import { buildSnapshot, digest, fail, identifier, KnowledgeError, validateScope } from './chunks.js';
import { createLocalEmbeddingProvider, EMBEDDING_DIMENSIONS, normalizedVectors, type EmbeddingProvider } from './embeddings.js';
import { KNOWLEDGE_SCHEMA_VERSION } from './schema.js';
export { KnowledgeError, chunkSource } from './chunks.js';
export { createLocalEmbeddingProvider, EMBEDDING_ID, EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_DIMENSIONS, normalizedVectors, type EmbeddingProvider } from './embeddings.js';
export { installPostgresKnowledgeSchema, POSTGRES_KNOWLEDGE_SCHEMA } from './schema.js';
export type { KnowledgeProvider, KnowledgeSnapshot, KnowledgeScope, KnowledgeEvidence } from './types.js';

export interface PostgresKnowledgeConfig {
  connectionString: string;
  /** Explicit injected implementation for tests or independently versioned local providers. */
  embeddings?: EmbeddingProvider;
  maxPoolSize?: number;
  cacheDir?: string;
  localFilesOnly?: boolean;
}
const safeError = (error: unknown): KnowledgeError => error instanceof KnowledgeError ? error : new KnowledgeError('request_failed', 'PostgreSQL knowledge could not complete. Check server-side connection, schema and restricted role configuration.');
const scopeValues = (scope: KnowledgeScope) => [scope.tenantId, scope.agentId, scope.version];
const vector = (value: number[]) => `[${value.join(',')}]`;

export function createPostgresKnowledgeProvider(config?: PostgresKnowledgeConfig): KnowledgeProvider {
  if (!config) return {
    id: 'postgres', status: async () => ({ source: 'postgres', configured: false, connected: false, mode: 'hybrid', message: 'PostgreSQL knowledge is not configured. Set a restricted server-side knowledge connection and run the separate schema migration.' }),
    syncVersion: async () => fail('not_configured', 'PostgreSQL knowledge is not configured.'), retrieve: async () => fail('not_configured', 'PostgreSQL knowledge is not configured.')
  };
  let url: URL;
  try { url = new URL(config.connectionString); } catch { return fail('invalid_config', 'Invalid PostgreSQL knowledge connection.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username) fail('invalid_config', 'Invalid PostgreSQL knowledge connection.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // node-postgres honors sslmode from the URL. Require certificate/hostname verification remotely.
  if (!loopback) { url.searchParams.set('sslmode', 'verify-full'); url.searchParams.delete('sslcert'); url.searchParams.delete('sslkey'); url.searchParams.delete('sslrootcert'); }
  if (config.maxPoolSize !== undefined && (!Number.isInteger(config.maxPoolSize) || config.maxPoolSize < 1 || config.maxPoolSize > 10)) fail('invalid_config', 'Knowledge pool size must be between 1 and 10.');
  const embeddings = config.embeddings ?? createLocalEmbeddingProvider({ cacheDir: config.cacheDir, localFilesOnly: config.localFilesOnly });
  if (!embeddings.model || embeddings.model.length > 300 || embeddings.dimensions !== EMBEDDING_DIMENSIONS) fail('invalid_config', 'Knowledge embeddings require a versioned 384-dimensional model.');
  const pool = new Pool({ connectionString: url.toString(), max: config.maxPoolSize ?? 4, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, query_timeout: 30_000, statement_timeout: 20_000, application_name: 'guidekit-knowledge' });
  // A transient idle-pool error must not crash the server or print a connection string.
  pool.on('error', () => undefined);
  const syncing = new Map<string, { manifest: string; promise: Promise<{ chunks: number }> }>();
  let closed = false;
  async function assertRuntime(client: PoolClient) {
    const result = await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
      EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls) AND pg_has_role(current_user,p.oid,'MEMBER')) AS privileged_member,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='guidekit_knowledge' AND c.relname IN('versions','documents','chunks') AND c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER')) AS protected_tables
      FROM pg_roles r WHERE r.rolname=current_user`);
    const role = result.rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.privileged_member || role.protected_tables !== 3) fail('invalid_config', 'PostgreSQL knowledge requires a separate restricted runtime role and forced row-level security. Owner, privileged and migration connections are refused.');
    const schema = await client.query('SELECT schema_version FROM guidekit_knowledge.metadata WHERE singleton=true');
    if (schema.rows[0]?.schema_version !== KNOWLEDGE_SCHEMA_VERSION) fail('invalid_config', 'PostgreSQL knowledge schema version is incompatible.');
  }
  async function scoped<T>(scope: KnowledgeScope, task: (client: PoolClient) => Promise<T>): Promise<T> {
    validateScope(scope); if (closed) fail('request_failed', 'PostgreSQL knowledge is closed.');
    let client: PoolClient;
    try { client = await pool.connect(); } catch { return fail('request_failed', 'PostgreSQL knowledge connection could not open.'); }
    try {
      await client.query('BEGIN'); await assertRuntime(client);
      await client.query(`SELECT set_config('guidekit.tenant_id',$1,true),set_config('guidekit.agent_id',$2,true),set_config('guidekit.version',$3,true)`, [scope.tenantId, scope.agentId, String(scope.version)]);
      const value = await task(client); await client.query('COMMIT'); return value;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw safeError(error); } finally { client.release(); }
  }
  async function readVersion(client: PoolClient, scope: KnowledgeScope) {
    return (await client.query('SELECT manifest,embedding_model,dimensions,chunk_count,ready FROM guidekit_knowledge.versions WHERE tenant_id=$1 AND agent_id=$2 AND version=$3', scopeValues(scope))).rows[0];
  }
  function verifyVersion(row: Record<string, unknown> | undefined, manifest?: string): boolean {
    if (!row) return false;
    if (manifest && row.manifest !== manifest) fail('snapshot_conflict', 'This published version already has different knowledge. Publish a new version.');
    if (row.embedding_model !== embeddings.model || row.dimensions !== EMBEDDING_DIMENSIONS) fail('snapshot_conflict', 'This publication uses another embedding model. Publish a new version before changing models.');
    return row.ready === true;
  }
  return {
    id: 'postgres',
    async status() {
      try {
        const client = await pool.connect(); try { await assertRuntime(client); } finally { client.release(); }
        return { source: 'postgres', configured: true, connected: true, mode: 'hybrid', message: 'PostgreSQL keyword and semantic knowledge retrieval is connected. Published snapshots and local embedding readiness are checked during preparation.' };
      } catch (error) { return { source: 'postgres', configured: true, connected: false, mode: 'hybrid', message: safeError(error).message }; }
    },
    async syncVersion(input: KnowledgeSnapshot) {
      const built = buildSnapshot(input, embeddings.model), active = syncing.get(built.key);
      if (active) { if (active.manifest !== built.manifest) fail('snapshot_conflict', 'This published version is preparing different knowledge. Publish a new version.'); return active.promise; }
      const sync = async () => {
        const ready = await scoped(input, async client => verifyVersion(await readVersion(client, input), built.manifest));
        if (ready) return { chunks: built.chunks.length };
        const vectors: number[][] = [];
        for (let offset = 0; offset < built.chunks.length; offset += 8) {
          const texts = built.chunks.slice(offset, offset + 8).map(chunk => `${chunk.title}\n${chunk.excerpt}`);
          try { vectors.push(...normalizedVectors(await embeddings.embed(texts), texts.length)); } catch (error) { if (error instanceof KnowledgeError) throw error; fail('embedding_failed', 'Local embedding preparation did not complete. This publication remains unavailable.'); }
        }
        return scoped(input, async client => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [built.key]);
          if (verifyVersion(await readVersion(client, input), built.manifest)) return { chunks: built.chunks.length };
          const scope = scopeValues(input);
          await client.query('INSERT INTO guidekit_knowledge.versions(tenant_id,agent_id,version,manifest,embedding_model,dimensions,chunk_count,allowed_actions) VALUES($1,$2,$3,$4,$5,384,$6,$7::jsonb)', [...scope, built.manifest, embeddings.model, built.chunks.length, JSON.stringify(built.actions)]);
          for (const document of built.documents) await client.query('INSERT INTO guidekit_knowledge.documents(tenant_id,agent_id,version,document_id,title,content,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7)', [...scope, document.id, document.title, document.content, document.hash]);
          for (let offset = 0; offset < built.chunks.length; offset += 40) {
            const values: unknown[] = [...scope], rows: string[] = [];
            for (let index = offset; index < Math.min(offset + 40, built.chunks.length); index++) {
              const chunk = built.chunks[index]!, first = values.length + 1;
              values.push(chunk.documentId, chunk.ordinal, chunk.start, chunk.end, chunk.charStart, chunk.charEnd, chunk.title, chunk.excerpt, vector(vectors[index]!));
              rows.push(`($1,$2,$3,${Array.from({ length: 9 }, (_, index) => `$${first + index}${index === 8 ? '::vector' : ''}`).join(',')})`);
            }
            await client.query(`INSERT INTO guidekit_knowledge.chunks(tenant_id,agent_id,version,document_id,ordinal,source_start,source_end,source_char_start,source_char_end,title,excerpt,embedding) VALUES${rows.join(',')}`, values);
          }
          const count = await client.query('SELECT count(*)::int AS count FROM guidekit_knowledge.chunks WHERE tenant_id=$1 AND agent_id=$2 AND version=$3', scope);
          if (count.rows[0]?.count !== built.chunks.length) fail('invalid_response', 'PostgreSQL did not prepare all source chunks.');
          await client.query('UPDATE guidekit_knowledge.versions SET ready=true WHERE tenant_id=$1 AND agent_id=$2 AND version=$3 AND manifest=$4', [...scope, built.manifest]);
          return { chunks: built.chunks.length };
        });
      };
      const promise = sync(); syncing.set(built.key, { manifest: built.manifest, promise });
      try { return await promise; } finally { if (syncing.get(built.key)?.promise === promise) syncing.delete(built.key); }
    },
    async retrieve(input) {
      validateScope(input);
      if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 3000 || input.question.includes('\0')) fail('invalid_input', 'A retrieval question must contain 1–3000 characters.');
      const limit = input.limit ?? 8;
      if (!Number.isInteger(limit) || limit < 1 || limit > 16) fail('invalid_input', 'Retrieval limit must be between 1 and 16.');
      // Fail on missing/model-incompatible snapshots before running local inference.
      await scoped(input, async client => { if (!verifyVersion(await readVersion(client, input))) fail('not_ready', 'This published version has not completed PostgreSQL knowledge preparation.'); });
      let embedded: number[];
      try { embedded = normalizedVectors(await embeddings.embed([input.question]), 1)[0]!; } catch (error) { if (error instanceof KnowledgeError) throw error; return fail('embedding_failed', 'Local query embedding did not complete. No keyword-only fallback was used.'); }
      return scoped(input, async client => {
        if (!verifyVersion(await readVersion(client, input))) fail('not_ready', 'This publication is unavailable.');
        const result = await client.query(`WITH scoped AS MATERIALIZED (
          SELECT c.* FROM guidekit_knowledge.chunks c WHERE c.tenant_id=$1 AND c.agent_id=$2 AND c.version=$3
        ), query AS (SELECT websearch_to_tsquery('english',$4) || websearch_to_tsquery('simple',$4) AS q),
        lexical AS (SELECT document_id,ordinal,row_number() OVER(ORDER BY ts_rank_cd(lexical,q) DESC,document_id,ordinal) AS rank FROM scoped,query WHERE lexical @@ q ORDER BY ts_rank_cd(lexical,q) DESC,document_id,ordinal LIMIT $6),
        semantic AS (SELECT document_id,ordinal,row_number() OVER(ORDER BY embedding <=> $5::vector,document_id,ordinal) AS rank FROM scoped WHERE 1-(embedding <=> $5::vector)>=0.35 ORDER BY embedding <=> $5::vector,document_id,ordinal LIMIT $6),
        fused AS (SELECT coalesce(l.document_id,s.document_id) AS document_id,coalesce(l.ordinal,s.ordinal) AS ordinal,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0) AS score FROM lexical l FULL OUTER JOIN semantic s USING(document_id,ordinal)),
        ranked AS (SELECT c.*,f.score,row_number() OVER(PARTITION BY c.document_id ORDER BY f.score DESC,c.ordinal) AS document_rank FROM fused f JOIN scoped c USING(document_id,ordinal))
        SELECT r.tenant_id,r.agent_id,r.version,r.document_id,r.title,r.excerpt,r.source_start,r.source_end,
          (r.title=d.title AND r.excerpt=substring(d.content FROM r.source_char_start+1 FOR r.source_char_end-r.source_char_start)) AS grounded
        FROM ranked r JOIN guidekit_knowledge.documents d USING(tenant_id,agent_id,version,document_id) WHERE r.document_rank=1 ORDER BY r.score DESC,r.document_id LIMIT $7`, [...scopeValues(input), input.question, vector(embedded), Math.min(64, limit * 4), limit]);
        const citations = result.rows.map(row => {
          if (row.tenant_id !== input.tenantId || row.agent_id !== input.agentId || row.version !== input.version || row.grounded !== true || typeof row.document_id !== 'string' || typeof row.title !== 'string' || typeof row.excerpt !== 'string' || row.title.length > 180 || row.excerpt.length > 900 || !Number.isInteger(row.source_start) || !Number.isInteger(row.source_end) || row.source_end <= row.source_start || row.excerpt.length !== row.source_end - row.source_start) fail('invalid_response', 'PostgreSQL returned ungrounded or out-of-scope evidence.');
          identifier(row.document_id, 'returned document ID');
          return { documentId: row.document_id, title: row.title, excerpt: row.excerpt };
        });
        return { source: 'postgres' as const, citations, paths: [] };
      });
    },
    async close() { if (closed) return; closed = true; await Promise.allSettled([...syncing.values()].map(value => value.promise)); await pool.end(); await embeddings.close?.(); }
  };
}
