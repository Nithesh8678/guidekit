import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUCTION_CADENCE_MS, InstructionCadence, instructionDelay, instructionGraphemes } from '../src/instruction';

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

test('normal painted frames reveal one complete grapheme at a time at a natural proportional cadence', () => {
  const parts = instructionGraphemes('A👨‍👩‍👧‍👦e\u0301🇮🇳👍🏽'.repeat(20))!, cadence = new InstructionCadence(parts, 0), seen: string[] = [];
  let completedAt = 0;
  for (let frame = 0; frame < 1000 && !cadence.complete; frame++) {
    const now = frame * 1000 / 60, grapheme = cadence.advance(now);
    if (grapheme !== null) { seen.push(grapheme); assert.equal(grapheme, parts[seen.length - 1]); completedAt = now; }
  }
  assert.deepEqual(seen, parts); assert.equal(cadence.complete, true);
  const desired = (parts.length - 1) * INSTRUCTION_CADENCE_MS;
  assert.ok(completedAt >= desired && completedAt < desired + 20, 'Frame quantization preserves cadence without speeding through longer instructions');
  assert.equal(cadence.advance(100000), null);
});

test('a stalled frame emits one letter and resets debt instead of catching up in a word or burst', () => {
  const cadence = new InstructionCadence(['A', 'B', 'C', 'D'], 0);
  assert.equal(cadence.advance(0), 'A'); assert.equal(cadence.advance(1000), 'B');
  assert.equal(cadence.advance(1000), null); assert.equal(cadence.advance(1001), null); assert.equal(cadence.advance(1017), null);
  assert.equal(cadence.advance(1022), 'C'); assert.equal(cadence.advance(1044), 'D'); assert.equal(cadence.complete, true);
});

test('punctuation gets a small local pause while emoji and ordinary letters keep the regular cadence', () => {
  assert.equal(instructionDelay('A'), 22); assert.equal(instructionDelay('👩🏽‍💻'), 22); assert.equal(instructionDelay(','), 34); assert.equal(instructionDelay('。'), 66); assert.equal(instructionDelay('\n'), 66);
  const cadence = new InstructionCadence([',', 'A'], 0);
  assert.equal(cadence.advance(0), ','); assert.equal(cadence.advance(33), null); assert.equal(cadence.advance(34), 'A');
});

test('regressing or repeated frame clocks never expose another letter and invalid clocks fail closed', () => {
  const cadence = new InstructionCadence(['A', 'B', 'C'], 0);
  assert.equal(cadence.advance(0), 'A'); assert.equal(cadence.advance(44), 'B');
  assert.equal(cadence.advance(44), null); assert.equal(cadence.advance(20), null); assert.equal(cadence.advance(45), 'C');
  assert.throws(() => new InstructionCadence(['A'], Infinity)); assert.throws(() => cadence.advance(NaN));
  assert.equal(new InstructionCadence([], 0).complete, true);
});
