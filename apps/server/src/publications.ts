import type { AgentVersion } from '../../../packages/contracts/src/index.js';
import type { TigerGraphProvider } from '../../../packages/graph/src/index.js';
import { Repository, AppError } from './database.js';

export interface PublicationResult { version: AgentVersion; activeVersion: number | null; vertices?: number; edges?: number; }

/** Durable snapshots; network preparation never runs inside a SQLite transaction. */
export class Publications {
  private readonly jobs = new Map<string, Promise<PublicationResult>>();
  constructor(private readonly repo: Repository, private readonly graph?: TigerGraphProvider) {
    // A process interruption is recoverable; it must not leave a false forever-syncing state.
    repo.db.prepare("UPDATE publication_states SET status='failed',error='Preparation was interrupted. Retry this version.',completed_at=NULL WHERE status IN ('preparing','syncing')").run();
    const legacy = repo.rows(`SELECT p.agent_id,p.version,a.tenant_id,a.published_version FROM publication_states p JOIN agents a ON a.id=p.agent_id WHERE p.legacy=1${graph ? " OR p.graph_source='local'" : ''}`);
    repo.transaction(() => {
      for (const row of legacy) repo.db.prepare('UPDATE publication_states SET legacy=0,graph_source=?,status=?,error=? WHERE agent_id=? AND version=?').run(graph ? 'tigergraph' : 'local', graph ? 'failed' : 'ready', graph ? 'This earlier snapshot needs graph verification. Retry preparation.' : null, String(row.agent_id), Number(row.version));
    });
    // Preserve the active pointer and verify its existing immutable snapshot after upgrade.
    for (const row of legacy.filter(row => graph && row.published_version === row.version)) void this.prepare(String(row.tenant_id), String(row.agent_id), Number(row.version), false).catch(() => undefined);
  }
  async publish(tenantId: string, agentId: string): Promise<PublicationResult> {
    this.repo.agent(tenantId, agentId);
    if ([...this.jobs.keys()].some(key => key.startsWith(`${agentId}:`))) throw new AppError(409, 'This agent is preparing a version. Wait for it to finish before publishing again.');
    const version = this.repo.publish(tenantId, agentId, this.graph ? 'tigergraph' : 'local');
    return this.graph ? this.prepare(tenantId, agentId, version.number, true) : { version, activeVersion: this.repo.agent(tenantId, agentId).publishedVersion };
  }
  prepare(tenantId: string, agentId: string, number: number, activate = true): Promise<PublicationResult> {
    const snapshot = this.repo.version(tenantId, agentId, number), key = `${agentId}:${number}`;
    const active = this.jobs.get(key); if (active) return active;
    const source = this.graph ? 'tigergraph' : snapshot.version.graphSource;
    const wasReady = snapshot.version.status === 'ready' && snapshot.version.graphSource === source;
    const work = async (): Promise<PublicationResult> => {
      this.repo.db.prepare('UPDATE publication_states SET graph_source=? WHERE agent_id=? AND version=?').run(source, agentId, number);
      if (!wasReady) this.repo.publicationState(agentId, number, this.graph ? 'syncing' : 'preparing');
      let counts: { vertices: number; edges: number } | undefined;
      try {
        if (this.graph) counts = await this.graph.syncVersion({ tenantId, agentId, version: number, documents: snapshot.documents, allowedActions: snapshot.config.allowedActions });
        else if (snapshot.version.graphSource === 'tigergraph') throw new AppError(503, 'This version requires TigerGraph. Restore its server configuration before retrying.');
        this.repo.publicationState(agentId, number, 'ready', undefined, activate);
      } catch {
        if (!wasReady) this.repo.publicationState(agentId, number, 'failed', 'Knowledge preparation could not complete. Check TigerGraph and retry this immutable version.');
        else throw new AppError(502, 'TigerGraph could not verify this existing snapshot. The active version has not been changed.');
      }
      return { version: this.repo.version(tenantId, agentId, number).version, activeVersion: this.repo.agent(tenantId, agentId).publishedVersion, ...counts };
    };
    // Start in a microtask so the promise is registered before any synchronous completion.
    const promise = Promise.resolve().then(work); this.jobs.set(key, promise);
    void promise.finally(() => { if (this.jobs.get(key) === promise) this.jobs.delete(key); }).catch(() => undefined);
    return promise;
  }
  activate(tenantId: string, agentId: string, number: number): void {
    const snapshot = this.repo.version(tenantId, agentId, number);
    if (snapshot.version.graphSource === 'tigergraph' && !this.graph) throw new AppError(503, 'This version requires TigerGraph. Restore its server configuration before activating.');
    if (this.graph && snapshot.version.graphSource !== 'tigergraph') throw new AppError(409, 'Prepare this version in TigerGraph before activating.');
    this.repo.activateVersion(tenantId, agentId, number);
  }
  async close(): Promise<void> { await Promise.allSettled(this.jobs.values()); }
}
