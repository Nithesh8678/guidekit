import assert from 'node:assert/strict';
import test from 'node:test';
import { Assistant } from '../src/controller';

test('Escape discards plain voice chat and closes it, while retaining paused or interrupted Guide goals', () => {
  const escape = Assistant.prototype as unknown as { escapeVoice(): void };
  for (const scenario of [{ guiding: false, journey: false, close: 1 }, { guiding: true, journey: false, close: 0 }, { guiding: false, journey: true, close: 0 }, { guiding: true, journey: true, close: 0 }]) {
    let cancels = 0, stops = 0, closes = 0;
    const assistant = { view: { guiding: scenario.guiding }, journey: { active: scenario.journey }, hold: { cancel() { cancels++; } }, voice: { stopInput() { stops++; assistant.view.guiding = false; assistant.journey.active = false; } }, close() { closes++; } };
    escape.escapeVoice.call(assistant);
    assert.equal(cancels, 1); assert.equal(stops, 1); assert.equal(closes, scenario.close, JSON.stringify(scenario));
  }
});
