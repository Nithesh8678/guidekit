import type { AgentVersion } from '../../../packages/contracts/src/index.js';
import type { TigerGraphProvider } from '../../../packages/graph/src/index.js';
import type { KnowledgeProvider } from '../../../packages/knowledge/src/types.js';
import type { AsyncRepository } from './repository.js';
import { Repository, AppError } from './database.js';
import { asKnowledgeProvider, knowledgeName, requireKnowledgeProvider } from './knowledge.js';

export interface PublicationResult { version: AgentVersion; activeVersion: number | null; vertices?: number; edges?: number; chunks?: number; }

/** Durable snapshots; network preparation never runs inside a database transaction. */
export class Publications {
  private readonly jobs = new Map<string, Promise<PublicationResult>>();
  private readonly publishing = new Set<string>();
  private readonly initialized: Promise<void>;
  private readonly provider?: KnowledgeProvider;
  constructor(private readonly repo: AsyncRepository | Repository, provider?: KnowledgeProvider | TigerGraphProvider, private readonly fallback?: KnowledgeProvider) {
    this.provider = asKnowledgeProvider(provider);
    // Recovery preserves every snapshot's source and active pointer. Changing the
    // selected provider never silently changes already-published retrieval semantics.
    this.initialized = this.initialize();
  }
  private async initialize(): Promise<void> {
    await this.repo.db.prepare("UPDATE publication_states SET status='failed',error='Preparation was interrupted. Retry this version.',completed_at=NULL WHERE status IN ('preparing','syncing')").run();
    await this.repo.db.prepare('UPDATE publication_states SET legacy=0 WHERE legacy=1').run();
  }
  async ready(): Promise<void> { await this.initialized; }
  async publish(tenantId: string, agentId: string, authorize?: () => Promise<void>): Promise<PublicationResult> {
    // Reserve before any await so two requests in this process cannot both create
    // candidate versions while the first is awaiting database I/O.
    if (this.publishing.has(agentId) || [...this.jobs.keys()].some(key => key.startsWith(`${agentId}:`))) throw new AppError(409, 'This agent is preparing a version. Wait for it to finish before publishing again.');
    this.publishing.add(agentId);
    try {
      await this.initialized; await this.repo.agent(tenantId, agentId);
      const source = this.provider?.id ?? 'local';
      if (this.repo instanceof Repository && source === 'postgres') throw new AppError(503, 'PostgreSQL publications require the async repository.');
      const version = await this.authorized(authorize, async () => this.repo instanceof Repository ? this.repo.publish(tenantId, agentId, source as 'local' | 'tigergraph') : await this.repo.publish(tenantId, agentId, source));
      return this.provider ? await this.prepare(tenantId, agentId, version.number, true, authorize) : { version, activeVersion: (await this.repo.agent(tenantId, agentId)).publishedVersion };
    } finally { this.publishing.delete(agentId); }
  }
  prepare(tenantId: string, agentId: string, number: number, activate = true, authorize?: () => Promise<void>): Promise<PublicationResult> {
    const key = `${agentId}:${tenantId}:${number}`;
    const active = this.jobs.get(key); if (active) return active;
    const work = async (): Promise<PublicationResult> => {
      await this.initialized;
      const snapshot = await this.repo.version(tenantId, agentId, number), source = snapshot.version.graphSource;
      const wasReady = snapshot.version.status === 'ready';
      let counts: { vertices?: number; edges?: number; chunks?: number } | undefined;
      try {
        if (!wasReady) await this.authorized(authorize, async () => this.repo.publicationState(agentId, number, source === 'local' ? 'preparing' : 'syncing'));
        const provider = requireKnowledgeProvider(source, [this.provider, this.fallback].filter((value): value is KnowledgeProvider => !!value));
        if (provider) counts = await provider.syncVersion({ tenantId, agentId, version: number, documents: snapshot.documents, allowedActions: snapshot.config.allowedActions });
        await this.authorized(authorize, async () => this.repo.publicationState(agentId, number, 'ready', undefined, activate));
      } catch (error) {
        if (error instanceof AppError && [401, 403].includes(error.status)) {
          if (!wasReady) await this.repo.publicationState(agentId, number, 'failed', 'Workspace access changed during preparation. An editor can retry this immutable version.');
          throw error;
        }
        if (!wasReady) await this.repo.publicationState(agentId, number, 'failed', `Knowledge preparation could not complete. Check ${knowledgeName(source)} and retry this immutable version.`);
        else throw new AppError(502, `${knowledgeName(source)} could not verify this existing snapshot. The active version has not been changed.`);
      }
      return { version: (await this.repo.version(tenantId, agentId, number)).version, activeVersion: (await this.repo.agent(tenantId, agentId)).publishedVersion, ...counts };
    };
    const promise = Promise.resolve().then(work); this.jobs.set(key, promise);
    void promise.finally(() => { if (this.jobs.get(key) === promise) this.jobs.delete(key); }).catch(() => undefined);
    return promise;
  }
  private async authorized<T>(authorize: (() => Promise<void>) | undefined, operation: () => Promise<T>): Promise<T> {
    if (!authorize) return operation();
    if (this.repo instanceof Repository) throw new AppError(503, 'Guarded publications require the async repository.');
    return this.repo.transaction(async () => { await authorize(); return operation(); });
  }
  async activate(tenantId: string, agentId: string, number: number, authorize?: () => Promise<void>): Promise<void> {
    await this.initialized;
    const snapshot = await this.repo.version(tenantId, agentId, number);
    requireKnowledgeProvider(snapshot.version.graphSource, [this.provider, this.fallback].filter((value): value is KnowledgeProvider => !!value));
    await this.authorized(authorize, async () => this.repo.activateVersion(tenantId, agentId, number));
  }
  async close(): Promise<void> { await this.initialized; await Promise.allSettled(this.jobs.values()); }
}
