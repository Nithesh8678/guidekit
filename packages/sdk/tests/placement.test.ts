import assert from 'node:assert/strict';
import test from 'node:test';
import { placeGuidanceControls, placeGuidanceLabel, type PlacementBox } from '../src/placement';
const area = { left: 0, top: 0, width: 1000, height: 700 }, target = { left: 400, top: 300, width: 160, height: 40 }, size = { width: 180, height: 42 };
const overlaps = (a: PlacementBox, b: PlacementBox) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
test('spatial labels avoid both the target and nearby known control rectangles', () => {
  const first = placeGuidanceLabel(target, size, area), obstacle = { ...first, ...size };
  const next = placeGuidanceLabel(target, size, area, [obstacle], first.anchor);
  assert.equal(overlaps({ ...first, ...size }, target), false); assert.equal(overlaps({ ...next, ...size }, target), false); assert.equal(overlaps({ ...next, ...size }, obstacle), false);
});
test('a safe anchor stays stable during content growth and placement clamps visual viewport offsets', () => {
  const first = placeGuidanceLabel(target, size, area), grown = placeGuidanceLabel(target, { width: 250, height: 60 }, area, [], first.anchor);
  assert.equal(grown.anchor, first.anchor);
  const viewport = { left: 20, top: 70, width: 320, height: 200 }, result = placeGuidanceLabel({ left: 280, top: 225, width: 45, height: 25 }, { width: 296, height: 150 }, viewport);
  assert.ok(result.left >= 32 && result.top >= 82); assert.ok(result.left + 296 <= 328 && result.top + 150 <= 258);
});
test('invalid bounds fail closed and obstacle processing is bounded', () => {
  assert.throws(() => placeGuidanceLabel({ ...target, width: NaN }, size, area));
  assert.throws(() => placeGuidanceLabel(target, { width: 0, height: 20 }, area));
  const invalid = { left: 0, top: 0, width: NaN, height: 20 };
  assert.deepEqual(placeGuidanceLabel(target, size, area, [invalid]), placeGuidanceLabel(target, size, area));
  assert.deepEqual(placeGuidanceLabel(target, size, area, Array(24).fill(invalid).concat([target])), placeGuidanceLabel(target, size, area));
});

test('essential feedback moves with its strip to avoid a mobile retry target', () => {
  const viewport = { left: 0, top: 0, width: 320, height: 740 }, retry = { left: 200, top: 625, width: 100, height: 30 };
  const result = placeGuidanceControls({ width: 250, height: 37 }, viewport, retry, [], { width: 260, height: 52 });
  assert.ok(result.anchor >= 2, 'Bottom strips alone are clear, but their feedback would cover the retry target');
  assert.equal(overlaps(result.footprint, retry), false); assert.equal(overlaps(result.assist!, retry), false);
  assert.ok(result.assist!.left >= 12 && result.assist!.left + result.assist!.width <= 308);
});

test('feedback uses the chosen corner alignment and fits a short offset viewport', () => {
  const right = placeGuidanceControls({ width: 180, height: 37 }, { left: 0, top: 0, width: 320, height: 740 }, null, [], { width: 260, height: 52 });
  assert.equal(right.anchor, 0); assert.equal(right.assist!.left, 48, 'A wide panel aligns to the right edge rather than overflowing from the strip’s left edge');
  const viewport = { left: 20, top: 70, width: 320, height: 140 }, short = placeGuidanceControls({ width: 250, height: 37 }, viewport, null, [], { width: 260, height: 150 });
  assert.ok(short.footprint.top >= 82 && short.footprint.top + short.footprint.height <= 198);
  assert.throws(() => placeGuidanceControls({ width: 180, height: 0 }, viewport, null));
});
