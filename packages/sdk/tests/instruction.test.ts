import assert from 'node:assert/strict';
import test from 'node:test';
import { instructionDuration, instructionGraphemes } from '../src/instruction';

test('instruction prefixes preserve emoji, combining marks, flags and complex scripts', () => {
  const text = 'A👨‍👩‍👧‍👦 e\u0301 🇮🇳 👍🏽 தமிழ்';
  const parts = instructionGraphemes(text)!;
  assert.equal(parts.join(''), text);
  for (const cluster of ['👨‍👩‍👧‍👦', 'e\u0301', '🇮🇳', '👍🏽']) assert.ok(parts.includes(cluster));
  for (let index = 0; index <= parts.length; index++) {
    const prefix = parts.slice(0, index).join('');
    assert.ok(text.startsWith(prefix));
    assert.ok(!/[\uD800-\uDBFF]$/.test(prefix), 'Never exposes half a surrogate pair');
  }
});

test('unsupported grapheme segmentation falls back to instant full text', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  try { Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: undefined }); assert.equal(instructionGraphemes('👩🏽‍💻'), null); }
  finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
});

test('instruction timing remains bounded for short and very long instructions', () => {
  assert.equal(instructionDuration(0), 0); assert.equal(instructionDuration(1), 600);
  assert.equal(instructionDuration(100), 1220); assert.equal(instructionDuration(10000), 1500);
  for (const count of [-1, NaN, Infinity]) assert.throws(() => instructionDuration(count));
});
