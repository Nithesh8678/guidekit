import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AsyncRepository, AppError } from '../apps/server/src/repository.js';
import { createPostgresKnowledgeProvider, type KnowledgeProvider } from '../packages/knowledge/src/index.js';
import { assertOffline } from './storage-archive.js';

interface SnapshotRow { agent_id: string; tenant_id: string; number: number; config: string; documents: string; graph_source: string; status: string; }
const identity = (row: SnapshotRow) => JSON.stringify([row.tenant_id, row.agent_id, row.number, row.config, row.documents, row.graph_source, row.status]);
const fingerprint = (rows: SnapshotRow[]) => createHash('sha256').update(JSON.stringify(rows.map(identity))).digest('hex');

/** Build all immutable indexes first; switch their metadata together, without moving active pointers. */
export async function migrateKnowledgeSnapshots(repo: AsyncRepository, provider: KnowledgeProvider, apply = false) {
  if (repo.dialect !== 'postgres' || provider.id !== 'postgres') throw new Error('Knowledge migration requires the PostgreSQL repository and provider.');
  const snapshots = await repo.rows("SELECT a.tenant_id,v.agent_id,v.number,v.config,v.documents,p.graph_source,p.status FROM versions v JOIN agents a ON a.id=v.agent_id JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE p.status='ready' ORDER BY a.tenant_id,v.agent_id,v.number") as unknown as SnapshotRow[];
  const hash = fingerprint(snapshots);
  if (!apply) return { applied: false, versions: snapshots.length, changed: snapshots.filter(row => row.graph_source !== 'postgres').length, chunks: 0, hash };
  const status = await provider.status();
  if (!status.connected) throw new AppError(503, 'PostgreSQL knowledge is not ready. No publication metadata was changed.');
  let chunks = 0;
  for (const row of snapshots) {
    const result = await provider.syncVersion({ tenantId: row.tenant_id, agentId: row.agent_id, version: Number(row.number), documents: JSON.parse(row.documents), allowedActions: JSON.parse(row.config).allowedActions });
    if (!Number.isSafeInteger(result.chunks) || result.chunks! < 1) throw new AppError(502, 'A knowledge snapshot did not prepare all source chunks. No publication metadata was changed.');
    chunks += result.chunks!;
  }
  await repo.transaction(async () => {
    const agents = [...new Map(snapshots.map(row => [row.agent_id, row])).values()];
    for (const row of agents) await repo.lockAgent(row.tenant_id, row.agent_id);
    const current = await repo.rows("SELECT a.tenant_id,v.agent_id,v.number,v.config,v.documents,p.graph_source,p.status FROM versions v JOIN agents a ON a.id=v.agent_id JOIN publication_states p ON p.agent_id=v.agent_id AND p.version=v.number WHERE p.status='ready' ORDER BY a.tenant_id,v.agent_id,v.number") as unknown as SnapshotRow[];
    if (fingerprint(current) !== hash) throw new AppError(409, 'Published knowledge changed during migration. Nothing was activated; rerun while the service is offline.');
    for (const row of snapshots) if (row.graph_source !== 'postgres') {
      const changed = await repo.db.prepare("UPDATE publication_states SET graph_source='postgres' WHERE agent_id=? AND version=? AND status='ready' AND graph_source=?").run(row.agent_id, Number(row.number), row.graph_source);
      if (changed.changes !== 1) throw new AppError(409, 'Publication metadata changed. The metadata transaction was rolled back.');
      await repo.audit(row.tenant_id, 'system', 'knowledge.provider_migrated', row.agent_id, { version: Number(row.number), previousSource: row.graph_source, source: 'postgres' });
    }
  });
  return { applied: true, versions: snapshots.length, changed: snapshots.filter(row => row.graph_source !== 'postgres').length, chunks, hash };
}

async function cli() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, offline: { type: 'boolean' }, 'data-dir': { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run db:knowledge -- [--apply --offline] [--data-dir .data] [--port 4410]\nPrepares indexes before atomically changing ready-version retrieval metadata. Active version pointers and source text are preserved.'); return; }
  const dir = resolve(values['data-dir'] ?? process.env.GUIDEKIT_DATA_DIR ?? '.data');
  if (values.apply) { if (!values.offline) throw new Error('Stop GuideKit and use --offline before applying the knowledge migration.'); await assertOffline(dir, Number(values.port ?? 4410)); }
  if (!process.env.GUIDEKIT_DATABASE_URL || !process.env.GUIDEKIT_KNOWLEDGE_DATABASE_URL) throw new Error('Both runtime database connections are required.');
  const repo = await AsyncRepository.open({ dir, connectionString: process.env.GUIDEKIT_DATABASE_URL });
  const provider = createPostgresKnowledgeProvider({ connectionString: process.env.GUIDEKIT_KNOWLEDGE_DATABASE_URL, cacheDir: process.env.GUIDEKIT_EMBEDDING_CACHE_DIR ?? resolve(dir, 'models'), localFilesOnly: true });
  try { console.log(JSON.stringify(await migrateKnowledgeSnapshots(repo, provider, values.apply), null, 2)); }
  finally { await provider.close?.(); await repo.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cli().catch(() => { console.error('Knowledge migration did not complete. Publications remain on their previous provider unless the entire metadata transaction committed. Check the configured schema, role and model cache.'); process.exitCode = 1; });
