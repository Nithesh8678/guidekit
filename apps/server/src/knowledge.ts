import type { Citation, RunResult } from '../../../packages/contracts/src/index.js';
import type { TigerGraphProvider } from '../../../packages/graph/src/index.js';
import { Repository, AppError } from './database.js';

export async function retrieveEvidence(repo: Repository, graph: TigerGraphProvider | undefined, tenantId: string, agentId: string, version: number, question: string): Promise<{ citations: Citation[]; knowledge: NonNullable<RunResult['knowledge']> }> {
  const published = repo.published(agentId, version);
  if (published.tenantId !== tenantId) throw new AppError(404, 'Knowledge snapshot not found.');
  if (published.graphSource === 'tigergraph' && !graph) throw new AppError(503, 'This publication requires TigerGraph. Restore the server configuration.');
  if (!graph) return { citations: repo.retrieve(tenantId, agentId, version, question), knowledge: { source: 'local', paths: [] } };
  let evidence;
  try { evidence = await graph.retrieve({ tenantId, agentId, version, question, limit: 8 }); }
  catch { throw new AppError(502, 'TigerGraph knowledge retrieval could not complete. Check the integration and sync this published version before retrying.'); }
  const sources = new Map(published.documents.map(document => [document.id, document]));
  if (evidence.source !== 'tigergraph' || evidence.citations.length > 8 || evidence.paths.length > 32 || evidence.citations.some(citation => {
    const source = sources.get(citation.documentId);
    return !source || source.title !== citation.title || citation.excerpt.length < 1 || citation.excerpt.length > 900 || !source.content.includes(citation.excerpt);
  }) || evidence.paths.some(path => path.nodes.length !== 3 || !sources.has(path.nodes[0]!) || !sources.has(path.nodes[2]!) || path.nodes[1]!.length > 64 || path.relation.length > 250)) throw new AppError(502, 'TigerGraph returned evidence outside this published knowledge snapshot. No answer was generated.');
  return { citations: evidence.citations, knowledge: { source: 'tigergraph', paths: evidence.paths } };
}
