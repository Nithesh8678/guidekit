import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, chunkSource, wellFormed } from '../src/chunks.js';
import { createPostgresKnowledgeProvider, normalizedVectors, EMBEDDING_ID } from '../src/index.js';

test('source chunks preserve exact offsets and cover every character with bounded overlap', () => {
  const source = (`A company guide discusses navigation. A second sentence covers settings.\n\nCanvas tools change the shape of a video. 😀 Use the layout panel.\n\n`).repeat(20);
  const chunks = chunkSource(source);
  assert.ok(chunks.length > 2); assert.equal(chunks[0]!.start, 0); assert.equal(chunks.at(-1)!.end, source.length);
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.excerpt, source.slice(chunk.start, chunk.end)); assert.ok(chunk.excerpt.length <= 900);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk.excerpt)); assert.ok(!/[\uD800-\uDBFF]$/.test(chunk.excerpt));
    if (index) { assert.ok(chunk.start <= chunks[index - 1]!.end); assert.ok(chunks[index - 1]!.end - chunk.start <= 140); }
  }
  assert.deepEqual(chunkSource('  \n '), []);
  assert.deepEqual(chunkSource(''), []);
});

test('paragraph boundary is preferred and long unbroken tokens remain bounded', () => {
  const paragraph = 'x'.repeat(600) + '\n\n' + 'y'.repeat(700);
  assert.equal(chunkSource(paragraph)[0]!.end, 602);
  const long = chunkSource('😀'.repeat(1100));
  assert.ok(long.length >= 3); assert.ok(long.every(chunk => chunk.excerpt.length <= 900 && chunk.excerpt.length % 2 === 0));
  for (const input of [[99, 20], [900, 400], [900.5, 20]] as const) assert.throws(() => chunkSource('source', ...input));
});

test('snapshot manifests are deterministic and bind scope-independent content, actions and model', () => {
  const input = { tenantId: 'tenant', agentId: 'agent', version: 1, documents: [{ id: 'second', title: 'Layout', content: '😀 Change the canvas.' }, { id: 'first', title: 'Clips', content: 'Upload your clips.' }], allowedActions: ['save', 'preview', 'save'] };
  const built = buildSnapshot(input, EMBEDDING_ID);
  assert.equal(built.manifest, buildSnapshot({ ...input, documents: [...input.documents].reverse(), allowedActions: ['preview', 'save'] }, EMBEDDING_ID).manifest);
  assert.notEqual(built.manifest, buildSnapshot(input, EMBEDDING_ID + 'changed').manifest);
  assert.notEqual(built.key, buildSnapshot({ ...input, tenantId: 'other' }, EMBEDDING_ID).key);
  const unicode = built.chunks.find(chunk => chunk.documentId === 'second')!;
  assert.equal(unicode.end, 21); assert.equal(unicode.charEnd, 20);
  for (const patch of [{ version: 0 }, { tenantId: 'bad id' }, { documents: [input.documents[0], input.documents[0]] }, { documents: [{ id: 'doc', title: '', content: 'x' }] }, { documents: [{ id: 'doc', title: 'Bad', content: '\0' }] }, { allowedActions: ['bad action'] }]) assert.throws(() => buildSnapshot({ ...input, ...patch } as typeof input, EMBEDDING_ID));
});

test('vectors require finite values, correct dimensions/count, and nonzero norm', () => {
  const valid = Array(384).fill(0); valid[0] = 4;
  assert.equal(normalizedVectors([valid], 1)[0]![0], 1);
  for (const value of [null, [], [Array(383).fill(1)], [Array(384).fill(0)], [[NaN, ...Array(383).fill(1)]], [[Infinity, ...Array(383).fill(1)]], [Array(384).fill('1')]]) assert.throws(() => normalizedVectors(value, 1));
});

test('source Unicode validation prevents PostgreSQL replacement from changing citation text', () => {
  assert.equal(wellFormed('😀 Source'), true); assert.equal(wellFormed('\uD800'), false); assert.equal(wellFormed('\uDC00'), false);
  assert.throws(() => buildSnapshot({ tenantId: 'tenant', agentId: 'agent', version: 1, allowedActions: [], documents: [{ id: 'doc', title: 'Source', content: '\uD800' }] }, EMBEDDING_ID));
});

test('unconfigured PostgreSQL provider fails explicitly without any local fallback', async () => {
  const provider = createPostgresKnowledgeProvider();
  assert.equal((await provider.status()).configured, false);
  await assert.rejects(provider.retrieve({ tenantId: 't', agentId: 'a', version: 1, question: 'help' }), /not configured/);
  await assert.rejects(provider.syncVersion({ tenantId: 't', agentId: 'a', version: 1, documents: [], allowedActions: [] }), /not configured/);
  for (const connectionString of ['invalid', 'https://db.invalid', 'postgres://db.invalid/test']) assert.throws(() => createPostgresKnowledgeProvider({ connectionString }));
  assert.throws(() => createPostgresKnowledgeProvider({ connectionString: 'postgres://runtime@localhost/db', embeddings: { model: 'bad', dimensions: 12, embed: async () => [] } }));
});
