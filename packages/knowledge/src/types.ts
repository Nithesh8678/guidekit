/** Server-only knowledge provider contract. Evidence is reference data, never authority. */
export type KnowledgeSource = 'local' | 'tigergraph' | 'postgres';
export interface KnowledgeScope { tenantId: string; agentId: string; version: number; }
export interface KnowledgeSnapshot extends KnowledgeScope {
  documents: Array<{ id: string; title: string; content: string }>;
  allowedActions: string[];
}
export interface KnowledgeEvidence {
  source: KnowledgeSource;
  citations: Array<{ documentId: string; title: string; excerpt: string }>;
  paths: Array<{ nodes: string[]; relation: string }>;
}
export interface KnowledgeProvider {
  readonly id: Exclude<KnowledgeSource, 'local'>;
  status(): Promise<{ source?: KnowledgeSource; configured: boolean; connected: boolean; message: string; mode?: string }>;
  syncVersion(input: KnowledgeSnapshot): Promise<{ vertices?: number; edges?: number; chunks?: number }>;
  retrieve(input: KnowledgeScope & { question: string; limit?: number }): Promise<KnowledgeEvidence>;
  close?(): Promise<void>;
}
