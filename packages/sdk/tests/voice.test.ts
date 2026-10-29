import assert from 'node:assert/strict';
import test from 'node:test';
import { Voice } from '../src/voice';
import type { View } from '../src/view';

// Explicit SpeechRecognition/SpeechSynthesis doubles: these verify lifecycle,
// never claim that physical microphone, audio playback, or remote recognition ran.
class Recognition {
  static instances: Recognition[] = [];
  static throwOnStart = false;
  lang = ''; continuous = false; interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  stopped = 0; aborted = 0;
  constructor() { Recognition.instances.push(this); }
  start() { if (Recognition.throwOnStart) throw new Error('synthetic start error'); }
  stop() { this.stopped++; }
  abort() { this.aborted++; }
  result(text: string, final: boolean, index = 0) { this.onresult?.({ resultIndex: index, results: { length: index + 1, [index]: { isFinal: final, 0: { transcript: text } } } }); }
}
class Utterance { onend: (() => void) | null = null; onerror: (() => void) | null = null; lang = ''; rate = 1; constructor(readonly text: string) {} }
function environment(options: { supported?: boolean; secure?: boolean; gesture?: boolean } = {}) {
  Recognition.instances = []; Recognition.throwOnStart = false;
  const statuses: string[] = []; const submissions: string[] = []; const attributes = new Map<string, string>(); const spoken: Utterance[] = []; let speechCancelled = 0;
  const mic = { disabled: false, title: '', setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const view = { mic, speaker: { disabled: false, title: '', setAttribute: (name: string, value: string) => attributes.set(`speaker:${name}`, value) }, input: { value: '', readOnly: false }, status: (text: string) => statuses.push(text), voiceProvider() {}, voiceRecording() {}, busy() {} } as unknown as View;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: { isSecureContext: options.secure ?? true, ...(options.supported === false ? {} : { webkitSpeechRecognition: Recognition }), speechSynthesis: { speak: (utterance: Utterance) => spoken.push(utterance), cancel: () => { speechCancelled++; } } }, SpeechSynthesisUtterance: Utterance, navigator: { userActivation: { isActive: options.gesture ?? true }, language: 'en-US' }, document: { documentElement: { lang: 'en-IN' } } })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  return { view, statuses, submissions, attributes, spoken, speechCancelled: () => speechCancelled, submit: (message: string) => submissions.push(message), restore: () => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

test('browser voice question starts on gesture, finishes once, submits only final text, and enables browser TTS', () => {
  const state = environment(); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(); const recognition = Recognition.instances[0]!;
    assert.equal(recognition.lang, 'en-IN'); assert.equal(recognition.continuous, true); assert.equal(voice.active, true); assert.equal(state.view.input.readOnly, true);
    recognition.onstart?.(); recognition.result('interim not submitted', false); assert.deepEqual(state.submissions, []);
    recognition.result('Find the settings', true); recognition.result('Find the settings', true); // duplicate callback must not duplicate text
    voice.finishInput(); voice.finishInput(); assert.equal(recognition.stopped, 1); assert.match(state.view.mic.title, /send question/);
    recognition.onend?.(); assert.deepEqual(state.submissions, ['Find the settings']); assert.equal(voice.active, false); assert.equal(state.view.input.readOnly, false); assert.equal(state.attributes.get('aria-pressed'), 'false');
    voice.speak('Settings are in the menu.'); assert.equal(state.spoken[0]?.text, 'Settings are in the menu.'); assert.equal(state.attributes.get('speaker:aria-pressed'), 'true');
  } finally { voice.destroy(); state.restore(); }
});

test('microphone dictation preserves the existing draft and leaves final transcript for review by default', () => {
  const state = environment(); state.view.input.value = 'Please'; const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(false); const recognition = Recognition.instances[0]!; recognition.onstart?.(); recognition.result('open settings', true); voice.finishInput(); assert.match(state.view.mic.title, /review transcript/); recognition.onend?.();
    assert.equal(state.view.input.value, 'Please open settings'); assert.deepEqual(state.submissions, []); assert.match(state.statuses.at(-1)!, /Review/);
    voice.speak('Not spoken without enabling output'); assert.equal(state.spoken.length, 0);
  } finally { voice.destroy(); state.restore(); }
});

test('autoSubmit false also makes shortcut voice review the transcript', () => {
  const state = environment(); const voice = new Voice(state.view, { autoSubmit: false }, state.submit);
  try { voice.start(); const recognition = Recognition.instances[0]!; recognition.onstart?.(); recognition.result('Review this', true); recognition.onend?.(); assert.equal(state.view.input.value, 'Review this'); assert.deepEqual(state.submissions, []); }
  finally { voice.destroy(); state.restore(); }
});

test('cancel during permission prompt aborts recognition and discards delayed start, result and end callbacks', () => {
  const state = environment(); state.view.input.value = 'Existing draft'; const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(); const recognition = Recognition.instances[0]!; const start = recognition.onstart; const result = recognition.onresult; const end = recognition.onend;
    voice.stopInput(); assert.equal(recognition.aborted, 1); const count = state.statuses.length;
    start?.(); result?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: 'must not send' } } } }); end?.();
    assert.equal(voice.active, false); assert.deepEqual(state.submissions, []); assert.equal(state.view.input.value, 'Existing draft'); assert.equal(state.statuses.length, count);
  } finally { voice.destroy(); state.restore(); }
});

test('cancel after finish and destroy both discard late final callbacks without submitting', () => {
  const state = environment(); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(); const first = Recognition.instances[0]!; first.onstart?.(); first.result('Do not send', true); voice.finishInput(); const oldEnd = first.onend; voice.stopInput(); oldEnd?.();
    voice.start(); const second = Recognition.instances[1]!; second.onstart?.(); second.result('Also do not send', true); const late = second.onend; voice.destroy(); late?.(); voice.start();
    assert.deepEqual(state.submissions, []); assert.equal(Recognition.instances.length, 2); assert.equal(second.aborted, 1);
  } finally { voice.destroy(); state.restore(); }
});

test('permission denial, network error and start failure clean up and expose honest recovery guidance', () => {
  const state = environment(); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(); Recognition.instances[0]!.onerror?.({ error: 'not-allowed' }); assert.equal(voice.active, false); assert.match(state.statuses.at(-1)!, /allow the microphone in site settings/); assert.equal(state.view.input.readOnly, false);
    voice.start(); Recognition.instances[1]!.onerror?.({ error: 'network' }); assert.match(state.statuses.at(-1)!, /network/); assert.equal(voice.active, false);
    Recognition.throwOnStart = true; voice.start(); assert.match(state.statuses.at(-1)!, /could not start/); assert.equal(voice.active, false); assert.deepEqual(state.submissions, []);
  } finally { voice.destroy(); state.restore(); }
});

test('unsupported, insecure and disabled voice stay disabled with a reason; missing gesture cannot start recognition', () => {
  for (const options of [{ supported: false }, { secure: false }, { disabled: true }]) {
    const state = environment(options); const voice = new Voice(state.view, 'disabled' in options ? { provider: 'disabled' } : {}, state.submit);
    try { voice.start(); assert.equal(state.view.mic.disabled, true); assert.ok(state.view.mic.title.length > 20); assert.equal(Recognition.instances.length, 0); }
    finally { voice.destroy(); state.restore(); }
  }
  const state = environment({ gesture: false }); const voice = new Voice(state.view, {}, state.submit);
  try { voice.start(); assert.equal(Recognition.instances.length, 0); assert.match(state.statuses.at(-1)!, /Click the microphone/); } finally { voice.destroy(); state.restore(); }
});

test('ending with only interim speech never submits and keeps the original draft', () => {
  const state = environment(); state.view.input.value = 'Keep this'; const voice = new Voice(state.view, {}, state.submit);
  try { voice.start(); const recognition = Recognition.instances[0]!; recognition.onstart?.(); recognition.result('not final', false); recognition.onend?.(); assert.deepEqual(state.submissions, []); assert.equal(state.view.input.value, 'Keep this'); assert.match(state.statuses.at(-1)!, /Nothing was sent/); }
  finally { voice.destroy(); state.restore(); }
});

test('speaking another answer detaches old callbacks and cancel/destroy stop browser TTS', () => {
  const state = environment(); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.toggleOutput(); voice.speak('First answer'); const first = state.spoken[0]!; const oldEnd = first.onend;
    voice.speak('Second answer'); assert.equal(first.onend, null); oldEnd?.(); voice.stopSpeaking(); assert.equal(state.speechCancelled(), 2);
    voice.speak('Third answer'); voice.destroy(); assert.equal(state.speechCancelled(), 3); assert.equal(state.spoken[2]!.onerror, null);
  } finally { voice.destroy(); state.restore(); }
});

test('startup, 60-second listening and finalization timeouts stop recognition and discard late final results', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const state = environment(); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.start(); const pending = Recognition.instances[0]!; context.mock.timers.tick(20000); assert.equal(voice.active, false); assert.equal(pending.aborted, 1); assert.match(state.statuses.at(-1)!, /did not start/);
    voice.start(); const listening = Recognition.instances[1]!; listening.onstart?.(); listening.result('Never completed', true); context.mock.timers.tick(60000); assert.equal(listening.stopped, 1); assert.equal(voice.active, true);
    const late = listening.onend; context.mock.timers.tick(10000); assert.equal(voice.active, false); assert.equal(listening.aborted, 1); assert.match(state.statuses.at(-1)!, /did not finish in time/); late?.(); assert.deepEqual(state.submissions, []);
  } finally { voice.destroy(); state.restore(); context.mock.timers.reset(); }
});
