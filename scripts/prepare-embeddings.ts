import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLocalEmbeddingProvider, EMBEDDING_ID } from '../packages/knowledge/src/embeddings.js';
const { values } = parseArgs({ options: { 'cache-dir': { type: 'string' }, help: { type: 'boolean' } }, strict: true });
if (values.help) console.log('Usage: npm run knowledge:prepare -- [--cache-dir PATH]\nDownloads pinned, openly licensed model weights and verifies local CPU inference. Sends no company text or prompts to a remote inference API.');
else {
  const cache = resolve(values['cache-dir'] ?? process.env.GUIDEKIT_EMBEDDING_CACHE_DIR ?? resolve(process.env.GUIDEKIT_DATA_DIR ?? '.data', 'models'));
  const embeddings = createLocalEmbeddingProvider({ cacheDir: cache });
  try {
    const started = performance.now(), result = await embeddings.embed(['GuideKit local knowledge retrieval readiness check.']);
    console.log(JSON.stringify({ ready: true, model: EMBEDDING_ID, dimensions: result[0]!.length, durationMs: Math.round(performance.now() - started) }));
  } catch { console.error('Local model preparation failed. Check access to the pinned model files and writable private cache directory.'); process.exitCode = 1; }
  finally { await embeddings.close?.(); }
}
