import assert from 'node:assert/strict';
import test from 'node:test';
import { revealDelta, scrollDuration, scrollEase } from '../src/scroll';

test('reveal leaves visible controls alone and scrolls only the nearest clipped edge with breathing room', () => {
  assert.equal(revealDelta(110, 145, 100, 400), 0);
  assert.equal(revealDelta(100, 400, 100, 400), 0);
  assert.equal(revealDelta(80, 115, 100, 400), -48);
  assert.equal(revealDelta(390, 425, 100, 400), 53);
  assert.equal(revealDelta(390, 425, 100, 400, 0), 25);
  assert.equal(revealDelta(120, 140, 100, 130), 14.5);
});

test('oversized controls do not oscillate between edges and invalid ports never request movement', () => {
  assert.equal(revealDelta(70, 900, 100, 400), 0);
  assert.equal(revealDelta(200, 900, 100, 400), 0);
  assert.ok(revealDelta(500, 1200, 100, 400) > 0);
  assert.ok(revealDelta(-800, -100, 100, 400) < 0);
  for (const values of [[0, 10, 20, 20], [0, 10, 20, 10], [10, 0, 20, 30], [NaN, 10, 20, 30], [0, Infinity, 20, 30]]) assert.equal(revealDelta(...values as [number, number, number, number]), 0);
});

test('scroll easing has zero velocity at each end, monotonic progress, and distance-bounded timing', () => {
  assert.equal(scrollEase(-1), 0); assert.equal(scrollEase(0), 0); assert.equal(scrollEase(.5), .5); assert.equal(scrollEase(1), 1); assert.equal(scrollEase(2), 1);
  let previous = 0;
  for (let index = 0; index <= 100; index++) { const value = scrollEase(index / 100); assert.ok(value >= previous && value <= 1); previous = value; }
  assert.ok(scrollEase(.01) < .000001); assert.ok(1 - scrollEase(.99) < .000001);
  assert.equal(scrollDuration(0), 280); assert.equal(scrollDuration(100), 280); assert.equal(scrollDuration(1000), 420); assert.equal(scrollDuration(100000), 780);
});
