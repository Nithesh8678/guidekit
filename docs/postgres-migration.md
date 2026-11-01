# Product database and hybrid knowledge

GuideKit's product architecture is managed PostgreSQL with ordinary full-text search and pgvector. Neon is the current development host. The SDK, host authorization and visual guidance engine do not depend on a graph vendor. SQLite and the TigerGraph adapter remain for explicit migration compatibility; changing a configuration flag never silently changes an existing publication's source.

The application remains local on loopback with its existing authentication and official local inference runtime. This database migration does not publish a multi-customer inference service, enable paid model traffic, or establish production availability.

## Data and retrieval

Product tables hold accounts, memberships, agents, documents, immutable versions, sessions, receipts and audit records. A separate `guidekit_knowledge` schema holds immutable source documents, bounded overlapping chunks and 384-dimensional vectors. Both schemas reside in the same PostgreSQL database. Runtime connections use different restricted roles; the migration owner is never a runtime credential.

Preparation embeds exact source chunks locally using the pinned Apache-2.0 MiniLM model described in [the knowledge package](../packages/knowledge/README.md). Model weights may be downloaded by an explicit operator preparation command; company text is processed locally. Startup warms the same cached model instance used for retrieval. Missing weights, failed embeddings or an incompatible model never silently become keyword-only search.

Retrieval combines full-text matches with exact, tenant/agent/version-scoped cosine similarity and reciprocal rank fusion. Exact scoped search avoids premature shared HNSW indexes and their filter/recall tradeoffs. Up to two complementary passages from a document may contribute within the eight-citation total. All excerpts must match the immutable source. The English model and initial similarity threshold require representative customer evaluation; there is no universal relevance or language-coverage guarantee.

The knowledge role is refused if it owns tables, can bypass RLS, has schema-administration privileges or inherits a privileged role. Forced RLS and restrictive scope policies protect every knowledge table. Scope comes from authenticated server state and is set transaction-locally, never from model output. The product application role is separately checked for privileged flags and table ownership. Product authorization stays in the server; knowledge RLS is an additional boundary.

## Provisioning

Use a dedicated database with no unrelated product tables, a separate development/test environment and a region close to the application. For Neon, roles created through its API/CLI/console inherit `neon_superuser`; create restricted roles through SQL instead. Generate distinct strong passwords and save them directly into an ignored, mode-0600 secret file. Do not paste them into chat, command history or committed SQL.

The following are role attributes, not runnable credentials:

```sql
CREATE ROLE guidekit_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT;
CREATE ROLE guidekit_retrieval LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT;
```

Set each password through a trusted operator connection. An operator-only environment supplies `GUIDEKIT_DATABASE_URL_DIRECT`. The runtime environment supplies `GUIDEKIT_DATABASE_URL` for `guidekit_runtime`, `GUIDEKIT_KNOWLEDGE_DATABASE_URL` for `guidekit_retrieval`, and `GUIDEKIT_KNOWLEDGE_PROVIDER=postgres`. Remote connections verify TLS certificates and hostnames. Use direct connections for migrations; pooled connections are suitable for runtime traffic. Never load the operator environment into `npm start`.

```sh
node --env-file=OPERATOR_ENV --import tsx scripts/postgres-schema.ts
npm run knowledge:prepare
```

The schema command installs versioned schemas and explicit runtime grants. The application performs compatibility checks, not automatic owner-level DDL. `GUIDEKIT_EMBEDDING_CACHE_DIR` can select a persistent cache; its default is `.data/models`.

## Existing SQLite cutover

1. Stop GuideKit and verify its actual service port is offline. Take a new verified `createBackup` archive with the original `session.secret`. Keep a private copy of the original runtime environment.
2. Preview the import. It validates the archive, known schema, all table columns and scoped relationships without contacting PostgreSQL.
3. Import into the empty dedicated PostgreSQL database. One transaction, table locks and complete row-content hashes protect the transfer. An identical replay is accepted only while the imported contents are still identical; later edits intentionally invalidate replay. No target rows are truncated or overwritten.
4. Prepare every ready publication's PostgreSQL index. Only after all preparations succeed does one metadata transaction switch the retrieval source. Immutable content and active version pointers stay unchanged. Failed candidates retain their original provider and history. With PostgreSQL selected, publish a new candidate to prepare that content in PostgreSQL; retrying an old TigerGraph candidate still requires the explicitly enabled legacy TigerGraph provider. A retry never silently switches providers.
5. Start with the runtime environment, verify `/ready`, existing sign-in, publication history, source previews, and a real SDK workflow. Reconnect hosts to the newly built SDK because older SDKs reject unknown evidence sources.

```sh
node --import tsx scripts/postgres-import.ts --archive VERIFIED_ARCHIVE
node --env-file=OPERATOR_ENV --import tsx scripts/postgres-import.ts \
  --archive VERIFIED_ARCHIVE --apply --offline --data-dir .data --port 4410
node --env-file=RUNTIME_ENV --import tsx scripts/migrate-knowledge.ts
node --env-file=RUNTIME_ENV --import tsx scripts/migrate-knowledge.ts \
  --apply --offline --data-dir .data --port 4410
```

The original SQLite database and TigerGraph workspace are not deleted. Before accepting new writes, rollback can restore the original runtime environment and server release against the unchanged SQLite data. After PostgreSQL accepts new writes, simply selecting SQLite would lose those writes; stop traffic and reconcile or restore a verified PostgreSQL backup instead. Do not run both stores as independent live writers.

## Ongoing recovery

The [complete PostgreSQL backup and restore procedure](operations.md#complete-postgresql-backup-and-recovery) covers product records, immutable source text, semantic vectors, import history and the signing secret in one consistent snapshot. Operator credentials stay separate from the runtime. Recovery accepts only an empty separately initialized database and validates all restored row hashes before commit. Keep the pre-cutover SQLite archive for its original point in time; it does not contain later PostgreSQL writes.

## Checks and limits

`npm test` includes the provider's bounded-input and evidence tests. `npm run test:postgres` exercises real SQL when the explicitly disposable `GUIDEKIT_TEST_POSTGRES_URL` and `GUIDEKIT_TEST_KNOWLEDGE_URL` are set. Integration tests require the `guidekit_test` database, use isolated synthetic scopes/schemas, and never connect to the application database by default. Set `GUIDEKIT_TEST_LOCAL_EMBEDDINGS=1` with the prepared cache for the real local-model semantic check. CI provisions a pinned pgvector PostgreSQL service and restricted test role; no live LLM credentials are used.

Existing retrieval evaluation reports recall, precision and reciprocal rank. Maintain representative customer questions, exact feature names, paraphrases, compound tasks, negative questions and cross-tenant probes. Measure retrieval time separately from model planning. Migrating databases alone is not a claim of faster first answers, and keeping normal guidance local remains the main fix for repeated per-step latency.

Sources: [Neon pgvector](https://neon.com/docs/extensions/pgvector), [PostgreSQL hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [Neon role privileges](https://neon.com/docs/manage/roles), [pgvector filtering](https://github.com/pgvector/pgvector#filtering).
