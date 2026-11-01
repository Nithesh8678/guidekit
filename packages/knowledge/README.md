# GuideKit knowledge providers

The product knowledge path uses PostgreSQL full-text search and pgvector cosine retrieval. TigerGraph remains a separately configured compatibility provider for historical published versions. There is no automatic provider or keyword-only fallback.

## Setup and authorization

Run `installPostgresKnowledgeSchema({ connectionString: directMigrationUrl, runtimeRole })` with a separate migration connection. The named login role must already exist. The runtime uses its own pooled connection and receives only schema usage, metadata reads, snapshot select/insert, and version state update privileges. It must have no `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, or `CREATEDB`, membership in privileged/table-owner roles, table ownership, or CREATE privileges on the knowledge or public schema. The same checks cover parent roles reachable through membership, including NOINHERIT roles that could be selected with SET ROLE. Creating a role through a hosted dashboard/API does **not** prove that it is restricted; inspect its actual PostgreSQL privilege flags and memberships.

All source tables enforce and force RLS with tenant, agent, and immutable version set through transaction-local `set_config` parameters. A restrictive scope policy keeps the boundary in place even if an extra permissive policy is accidentally added. SQL also includes all three scope predicates. Every operation rechecks the role and schema; a privileged connection fails closed. Connection strings stay server-side, remote TLS verifies the certificate and hostname, and transport errors never expose connection text.

## Retrieval and publication

`createPostgresKnowledgeProvider({ connectionString, cacheDir?, localFilesOnly?, embeddings? })` implements `KnowledgeProvider`. `embeddings` is an explicit dependency injection point for independently versioned implementations and test fixtures; the default is the real local model below.

Snapshots hold at most 40 documents, 2 MB of source text, 30 allowed action names and 5,000 chunks. Paragraph/sentence boundaries and bounded overlap preserve exact original excerpts. Both UTF-16 source offsets and Unicode character offsets are retained. Query-time SQL verifies every returned excerpt against the original published document, then the server independently verifies citations against its immutable snapshot.

The content/action/model manifest is deterministic. Identical sync calls are idempotent; a different manifest for an existing version requires a new publication. Embeddings finish before the write transaction. The manifest, documents, chunks and ready state commit atomically, so a failed batch never exposes a partial publication. Ready snapshots have database immutability guards. Application publication/job state persists separately and retains actionable retry errors after interruption.

Queries combine bounded stemmed keyword matches with exact cosine search over only the requested tenant/agent/version. The semantic candidate floor is 0.35; reciprocal rank fusion merges candidates and retains at most two distinct, non-overlapping chunks per source document within the overall retrieval budget. This is an initial retrieval configuration to evaluate on customer questions, not an established accuracy guarantee. No shared approximate global index is used. PostgreSQL evidence returns `source: 'postgres'`, grounded citations, and `paths: []`; it does not invent graph relationships.

## Local embedding model

- Runtime: `@huggingface/transformers` 4.3.2, CPU ONNX inference.
- Model: [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), ONNX export of [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
- Pinned model/tokenizer revision: `751bff37182d3f1213fa05d7196b954e230abad9`.
- Configuration: q8, mean pooling, normalized 384 dimensions, 256-token truncation. The full configuration is included in the stored model ID. The full source still remains in keyword retrieval and citations even when tokenization truncates an embedding input.
- Upstream model license: [Apache 2.0](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/README.md). Retain upstream attribution and license notices when redistributing model files; model cache files are not committed or shipped in the browser SDK.
- First use may download public model/tokenizer artifacts into the configured cache. Document and question text stays in this Node process; there is no remote inference endpoint or paid API key. Prepare the cache during deployment and select `localFilesOnly: true` when runtime downloads are disallowed.

Embedding calls accept at most 16 bounded texts and 64 KB per batch, serialize CPU work, and cap pending calls at eight. All vectors must be finite, nonzero, 384-dimensional and normalized. Index/query model mismatch, inference failure, and exhausted capacity fail explicitly.

## Verification

`packages/knowledge/tests/knowledge.test.ts` covers chunk fidelity, Unicode boundaries, manifest stability, malformed inputs and vector validation. `postgres.integration.test.ts` only enables with `GUIDEKIT_TEST_POSTGRES_URL` (migration owner) and `GUIDEKIT_TEST_KNOWLEDGE_URL` (restricted runtime), and refuses databases other than `/guidekit_test`. It tests actual SQL/RLS isolation, immutability, failure/retry, parameterized queries, broad-policy defense, and transaction rollback. Fixture embedding vectors are explicitly test-only. Set `GUIDEKIT_TEST_LOCAL_EMBEDDINGS=1` and `GUIDEKIT_EMBEDDING_CACHE_DIR` to also run the real cached local model through pgvector and retrieve a semantic paraphrase.
