import type { Citation, RunResult } from '../../../packages/contracts/src/index.js';
import type { TigerGraphProvider } from '../../../packages/graph/src/index.js';
import type { KnowledgeProvider, KnowledgeSource } from '../../../packages/knowledge/src/types.js';
import type { AsyncRepository } from './repository.js';
import type { Repository } from './database.js';
import { AppError } from './database.js';

/** Keep the old graph injection usable for migration and existing integrations. */
export function asKnowledgeProvider(provider?: KnowledgeProvider | TigerGraphProvider): KnowledgeProvider | undefined {
  if (!provider) return undefined;
  return 'id' in provider ? provider : { id: 'tigergraph', status: () => provider.status(), syncVersion: input => provider.syncVersion(input), retrieve: input => provider.retrieve(input) };
}
export const knowledgeName = (source: KnowledgeSource) => source === 'postgres' ? 'PostgreSQL' : source === 'tigergraph' ? 'TigerGraph' : 'Local search';
export type KnowledgeProviderInput = KnowledgeProvider | TigerGraphProvider | readonly KnowledgeProvider[];
export function configuredKnowledgeProviders(provider?: KnowledgeProviderInput): readonly KnowledgeProvider[] {
  if (!provider) return [];
  if (Array.isArray(provider)) return provider;
  const normalized = asKnowledgeProvider(provider as KnowledgeProvider | TigerGraphProvider);
  return normalized ? [normalized] : [];
}
export function requireKnowledgeProvider(source: KnowledgeSource, providers?: KnowledgeProviderInput): KnowledgeProvider | undefined {
  const provider = configuredKnowledgeProviders(providers).find(provider => provider.id === source);
  if (source === 'local') return undefined;
  if (!provider || provider.id !== source) throw new AppError(503, `This publication requires ${knowledgeName(source)}. Restore its server configuration or explicitly migrate the publication.`);
  return provider;
}

export async function retrieveEvidence(repo: AsyncRepository | Repository, provider: KnowledgeProviderInput | undefined, tenantId: string, agentId: string, version: number, question: string): Promise<{ citations: Citation[]; knowledge: NonNullable<RunResult['knowledge']> }> {
  const published = await repo.published(agentId, version);
  if (published.tenantId !== tenantId) throw new AppError(404, 'Knowledge snapshot not found.');
  const selected = requireKnowledgeProvider(published.graphSource, provider);
  if (!selected) return { citations: await repo.retrieve(tenantId, agentId, version, question), knowledge: { source: 'local', paths: [] } };
  let evidence;
  try { evidence = await selected.retrieve({ tenantId, agentId, version, question, limit: 8 }); }
  catch { throw new AppError(502, `${knowledgeName(selected.id)} knowledge retrieval could not complete. Check the integration and sync this published version before retrying.`); }
  const sources = new Map(published.documents.map(document => [document.id, document]));
  if (evidence.source !== selected.id || evidence.citations.length > 8 || evidence.paths.length > 32 || evidence.citations.some(citation => {
    const source = sources.get(citation.documentId);
    return !source || source.title !== citation.title || citation.excerpt.length < 1 || citation.excerpt.length > 900 || !source.content.includes(citation.excerpt);
  }) || evidence.paths.some(path => path.nodes.length !== 3 || !sources.has(path.nodes[0]!) || !sources.has(path.nodes[2]!) || path.nodes[1]!.length > 64 || path.relation.length > 250)) throw new AppError(502, `${knowledgeName(selected.id)} returned evidence outside this published knowledge snapshot. No answer was generated.`);
  return { citations: evidence.citations, knowledge: { source: selected.id, paths: evidence.paths } };
}
