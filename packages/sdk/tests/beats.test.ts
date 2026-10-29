import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatScheduler, type SpeechEvents } from '../src/beats';

test('visual beat starts with actual playback; text-only releases immediately', () => {
  const beats = new BeatScheduler(); const releases: string[] = []; let audio!: SpeechEvents;
  beats.start(events => { audio = events; return true; }, reason => releases.push(reason));
  assert.equal(releases.length, 0); audio.onStart(); audio.onStart(); audio.onEnd(); assert.deepEqual(releases, ['speech']);
  beats.start(() => false, reason => releases.push(reason)); assert.deepEqual(releases, ['speech', 'text']); beats.cancel();
});
test('interruption rejects old playback and timeout callbacks', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const beats = new BeatScheduler(); const releases: string[] = []; let old!: SpeechEvents; let next!: SpeechEvents;
  beats.start(events => { old = events; return true; }, reason => releases.push(`old:${reason}`));
  beats.start(events => { next = events; return true; }, reason => releases.push(`next:${reason}`));
  old.onStart(); old.onError(); context.mock.timers.tick(2499); assert.equal(releases.length, 0);
  next.onStart(); context.mock.timers.tick(10000); assert.deepEqual(releases, ['next:speech']);
  beats.start(events => { old = events; return true; }, reason => releases.push(reason)); beats.cancel(); old.onEnd(); context.mock.timers.tick(10000);
  assert.deepEqual(releases, ['next:speech']); context.mock.timers.reset();
});
test('unavailable audio falls back once without inventing a playback start', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const beats = new BeatScheduler(); const releases: string[] = []; let audio!: SpeechEvents;
  beats.start(events => { audio = events; return true; }, reason => releases.push(reason)); context.mock.timers.tick(2500); audio.onStart(); assert.deepEqual(releases, ['unavailable']);
  beats.start(events => { events.onError(); return true; }, reason => releases.push(reason)); assert.deepEqual(releases, ['unavailable', 'unavailable']);
  beats.cancel(); context.mock.timers.reset();
});
