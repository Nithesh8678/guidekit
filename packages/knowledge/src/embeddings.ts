/** Server-only CPU embeddings. Document/query text never leaves this process. */
import { resolve } from 'node:path';
import { fail, KnowledgeError } from './chunks.js';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_ID = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean:256:v1`;
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  close?(): Promise<void>;
}

/** Reject malformed/zero vectors; normalize once more before crossing the DB boundary. */
export function normalizedVectors(values: unknown, count: number, dimensions = EMBEDDING_DIMENSIONS): number[][] {
  if (!Array.isArray(values) || values.length !== count) fail('embedding_failed', 'The embedding provider returned an invalid batch.');
  return values.map(value => {
    if (!Array.isArray(value) || value.length !== dimensions || !value.every(item => typeof item === 'number' && Number.isFinite(item))) fail('embedding_failed', 'The embedding provider returned an invalid vector.');
    const norm = Math.hypot(...value);
    if (!Number.isFinite(norm) || norm < 1e-12) fail('embedding_failed', 'The embedding provider returned an empty vector.');
    return value.map(item => item / norm);
  });
}

export function createLocalEmbeddingProvider(options: { cacheDir?: string; localFilesOnly?: boolean } = {}): EmbeddingProvider {
  type Extractor = ((text: string[], options: { pooling: string; normalize: boolean; truncation: boolean; max_length: number }) => Promise<{ tolist(): unknown }>) & { dispose(): Promise<void> };
  let extractor: Promise<Extractor> | undefined, closed = false, pending = 0;
  let tail: Promise<unknown> = Promise.resolve();
  async function load(): Promise<Extractor> {
    if (!extractor) {
      extractor = import('@huggingface/transformers').then(async ({ pipeline }) => {
        // A full commit pin fixes both tokenizer and ONNX weights. No remote inference API is used.
        return await pipeline('feature-extraction', EMBEDDING_MODEL, { revision: EMBEDDING_REVISION, dtype: 'q8', device: 'cpu', cache_dir: resolve(options.cacheDir ?? '.data/models'), local_files_only: options.localFilesOnly ?? false }) as unknown as Extractor;
      }).catch(() => { extractor = undefined; return fail('embedding_failed', 'The local embedding model could not load. Prepare the pinned model files in the configured cache and retry.'); });
    }
    return extractor;
  }
  return {
    model: EMBEDDING_ID, dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (closed) fail('embedding_failed', 'The embedding provider is closed.');
      if (!Array.isArray(texts) || texts.length < 1 || texts.length > 16 || texts.some(text => typeof text !== 'string' || !text.trim() || text.includes('\0') || text.length > 3200) || Buffer.byteLength(JSON.stringify(texts)) > 64_000) fail('invalid_input', 'Embedding input exceeds the bounded text batch.');
      if (pending >= 8) fail('embedding_failed', 'The embedding worker is busy. Retry shortly.');
      texts = [...texts];
      pending++;
      const job = tail.then(async () => {
        try {
          const model = await load();
          return normalizedVectors((await model(texts, { pooling: 'mean', normalize: true, truncation: true, max_length: 256 })).tolist(), texts.length);
        } catch (error) { if (error instanceof KnowledgeError) throw error; return fail('embedding_failed', 'Local embedding generation did not complete.'); }
      });
      tail = job.catch(() => undefined);
      try { return await job; } finally { pending--; }
    },
    async close() {
      if (closed) return;
      closed = true; await tail;
      if (extractor) await (await extractor.catch(() => undefined))?.dispose();
    }
  };
}
