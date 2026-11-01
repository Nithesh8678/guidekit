import { createHash } from 'node:crypto';
import type { KnowledgeSnapshot, KnowledgeScope } from './types.js';

export class KnowledgeError extends Error {
  constructor(public readonly code: 'invalid_config' | 'not_configured' | 'invalid_input' | 'snapshot_conflict' | 'not_ready' | 'request_failed' | 'invalid_response' | 'embedding_failed', message: string) { super(message); this.name = 'KnowledgeError'; }
}
export function fail(code: KnowledgeError['code'], message: string): never { throw new KnowledgeError(code, message); }
export function identifier(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) fail('invalid_input', `Invalid ${label}.`);
}
export function validateScope(input: KnowledgeScope): void {
  identifier(input.tenantId, 'tenant ID'); identifier(input.agentId, 'agent ID');
  if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 2_147_483_647) fail('invalid_input', 'Version must be a positive 32-bit integer.');
}
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const wellFormed = (value: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export interface SourceChunk { ordinal: number; start: number; end: number; excerpt: string; }

/** Exact UTF-16 source offsets, paragraph/sentence boundaries, and bounded context overlap. */
export function chunkSource(source: string, maxLength = 900, overlap = 140): SourceChunk[] {
  if (typeof source !== 'string' || !Number.isInteger(maxLength) || maxLength < 100 || maxLength > 2000 || !Number.isInteger(overlap) || overlap < 0 || overlap > maxLength / 3) fail('invalid_input', 'Invalid chunking input.');
  const chunks: SourceChunk[] = []; let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maxLength);
    if (end < source.length) {
      const window = source.slice(start, end), minimum = Math.floor(maxLength * 0.55);
      const paragraph = window.lastIndexOf('\n\n');
      const boundaries = [...window.matchAll(/[.!?](?:["')\]]*)\s+/gu)];
      const sentence = boundaries.length ? boundaries.at(-1)!.index! + boundaries.at(-1)![0].length : -1;
      const word = window.lastIndexOf(' ');
      if (paragraph >= minimum) end = start + paragraph + 2;
      else if (sentence >= minimum) end = start + sentence;
      else if (word >= minimum) end = start + word + 1;
      // Never split a Unicode surrogate pair.
      if (/^[\uDC00-\uDFFF]$/.test(source[end] ?? '')) end--;
    }
    const excerpt = source.slice(start, end);
    if (excerpt.trim()) chunks.push({ ordinal: chunks.length, start, end, excerpt });
    if (end === source.length) break;
    let next = Math.max(start + 1, end - overlap);
    const overlapBoundary = source.indexOf(' ', next);
    if (overlapBoundary >= next && overlapBoundary < end) next = overlapBoundary + 1;
    if (/^[\uDC00-\uDFFF]$/.test(source[next] ?? '')) next++;
    start = next;
  }
  return chunks;
}

export function buildSnapshot(input: KnowledgeSnapshot, embeddingModel: string) {
  validateScope(input);
  if (!Array.isArray(input.documents) || input.documents.length > 40 || !Array.isArray(input.allowedActions) || input.allowedActions.length > 30) fail('invalid_input', 'A snapshot supports at most 40 documents and 30 actions.');
  const ids = new Set<string>(); let bytes = 0;
  for (const document of input.documents) {
    identifier(document.id, 'document ID');
    if (ids.has(document.id)) fail('invalid_input', 'Duplicate document ID.'); ids.add(document.id);
    if (typeof document.title !== 'string' || !document.title.trim() || document.title.length > 180 || typeof document.content !== 'string' || document.content.includes('\0') || document.title.includes('\0') || !wellFormed(document.title) || !wellFormed(document.content)) fail('invalid_input', 'Invalid source document.');
    bytes += Buffer.byteLength(document.content);
  }
  if (bytes > 2_000_000) fail('invalid_input', 'Snapshot source text exceeds 2 MB.');
  input.allowedActions.forEach(action => identifier(action, 'action name'));
  const documents = input.documents.map(({ id, title, content }) => ({ id, title, content, hash: digest(content) })).sort((a, b) => a.id.localeCompare(b.id));
  const actions = [...new Set(input.allowedActions)].sort();
  const chunks = documents.flatMap(document => {
    // PostgreSQL substring counts Unicode code points; browser/source offsets count UTF-16.
    const positions = new Uint32Array(document.content.length + 1); let chars = 0;
    for (let offset = 0; offset < document.content.length;) {
      positions[offset] = chars;
      const width = (document.content.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
      if (width === 2) positions[offset + 1] = chars;
      offset += width; positions[offset] = ++chars;
    }
    return chunkSource(document.content).map(chunk => ({ ...chunk, charStart: positions[chunk.start]!, charEnd: positions[chunk.end]!, documentId: document.id, title: document.title }));
  });
  if (chunks.length > 5000) fail('invalid_input', 'Snapshot exceeds 5000 source chunks.');
  return { documents, actions, chunks, manifest: digest([documents, actions, embeddingModel]), key: digest([input.tenantId, input.agentId, input.version]) };
}
