import assert from 'node:assert/strict';
import test from 'node:test';
import { Voice } from '../src/voice';
import type { View } from '../src/view';
import { readVoicePreference, voicePreferenceKey, type VoiceSettingsHandlers, type VoiceSettingsState } from '../src/voices';

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
class Utterance { onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; lang = ''; rate = 1; voice: SpeechSynthesisVoice | null = null; constructor(readonly text: string) {} }
const speechVoice = (voiceURI: string, name: string, lang = 'en-IN', isDefault = false) => ({ voiceURI, name, lang, default: isDefault, localService: true } as SpeechSynthesisVoice);
function environment(options: { supported?: boolean; secure?: boolean; gesture?: boolean; voices?: SpeechSynthesisVoice[]; storage?: Map<string, string>; storageBlocked?: boolean; language?: string } = {}) {
  Recognition.instances = []; Recognition.throwOnStart = false;
  const statuses: string[] = []; const submissions: string[] = []; const attributes = new Map<string, string>(); const spoken: Utterance[] = []; let speechCancelled = 0;
  const mic = { disabled: false, title: '', setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const speaking: boolean[] = [], listeners = new Set<() => void>(), storage = options.storage ?? new Map<string, string>(); let voices = options.voices ?? [speechVoice('samantha-enhanced', 'Samantha (Enhanced)')], settings!: VoiceSettingsState, handlers!: VoiceSettingsHandlers;
  const view = { mic, speaker: { disabled: false, title: '', setAttribute: (name: string, value: string) => attributes.set(`speaker:${name}`, value) }, input: { value: '', readOnly: false }, status: (text: string) => statuses.push(text), voiceProvider() {}, voiceRecording() {}, voiceSpeaking(value: boolean) { speaking.push(value); }, voiceSettings(state: VoiceSettingsState, events: VoiceSettingsHandlers) { settings = state; handlers = events; }, busy() {} } as unknown as View;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: { isSecureContext: options.secure ?? true, ...(options.supported === false ? {} : { webkitSpeechRecognition: Recognition }), localStorage: { getItem(key: string) { if (options.storageBlocked) throw new Error('Storage blocked'); return storage.get(key) ?? null; }, setItem(key: string, value: string) { if (options.storageBlocked) throw new Error('Storage blocked'); storage.set(key, value); } }, speechSynthesis: { getVoices: () => voices, addEventListener: (_name: string, callback: () => void) => listeners.add(callback), removeEventListener: (_name: string, callback: () => void) => listeners.delete(callback), speak: (utterance: Utterance) => spoken.push(utterance), cancel: () => { speechCancelled++; } } }, SpeechSynthesisUtterance: Utterance, navigator: { userActivation: { isActive: options.gesture ?? true }, language: 'en-US' }, document: { documentElement: { lang: options.language ?? 'en-IN' } } })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  return { view, statuses, submissions, attributes, spoken, speaking, storage, settings: () => settings, handlers: () => handlers, listenerCount: () => listeners.size, voices(next: SpeechSynthesisVoice[]) { voices = next; for (const listener of [...listeners]) listener(); }, speechCancelled: () => speechCancelled, submit: (message: string) => submissions.push(message), restore: () => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
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

test('narration callbacks follow actual playback and reject cancelled speech', () => {
  const state = environment(); const voice = new Voice(state.view, {}, state.submit); const events: string[] = [];
  const callbacks = { onStart: () => events.push('start'), onEnd: () => events.push('end'), onError: () => events.push('error') };
  try {
    assert.equal(voice.speak('Muted', callbacks), false); voice.toggleOutput();
    assert.equal(voice.speak('Step one', callbacks), true); assert.deepEqual(events, []);
    const first = state.spoken[0]!; first.onstart?.(); assert.deepEqual(events, ['start']); assert.equal(state.speaking.at(-1), true); const late = first.onend;
    voice.stopSpeaking(); late?.(); assert.equal(first.onstart, null); assert.deepEqual(events, ['start']); assert.equal(state.speaking.at(-1), false);
    voice.speak('Step two', callbacks); state.spoken[1]!.onstart?.(); state.spoken[1]!.onend?.(); assert.deepEqual(events, ['start', 'start', 'end']);
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

test('automatic output prefers a matching-language enhanced voice over a default novelty voice without changing recognition', () => {
  const state = environment({ voices: [speechVoice('zarvox', 'Zarvox', 'en-IN', true), speechVoice('rishi', 'Rishi'), speechVoice('enhanced', 'Samantha (Enhanced)', 'en-US'), speechVoice('foreign', 'Microsoft Natural', 'fr-FR')] });
  const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.toggleOutput(); assert.equal(voice.speak('A normal guide answer.'), true); assert.equal(state.spoken[0]!.voice?.voiceURI, 'enhanced'); assert.equal(state.spoken[0]!.lang, 'en-US'); assert.equal(state.spoken[0]!.rate, 0.98);
    voice.start(false); assert.equal(Recognition.instances[0]!.lang, 'en-IN'); assert.equal(state.storage.size, 0);
  } finally { voice.destroy(); state.restore(); }
});

test('generic English output favors Samantha over regional default Rishi while explicit regions and visitor choices win', () => {
  const voices = [speechVoice('rishi', 'Rishi', 'en-IN', true), speechVoice('samantha', 'Samantha', 'en-US'), speechVoice('daniel', 'Daniel', 'en-GB')];
  for (const [language, expected] of [['en', 'samantha'], ['en-IN', 'rishi']] as const) {
    const state = environment({ voices, language }); const voice = new Voice(state.view, {}, state.submit);
    try {
      voice.toggleOutput(); voice.speak('Regional output preference'); assert.equal(state.spoken[0]!.voice?.voiceURI, expected);
      state.handlers().choose('daniel'); voice.speak('Explicit visitor preference'); assert.equal(state.spoken[1]!.voice?.voiceURI, 'daniel');
      voice.start(false); assert.equal(Recognition.instances[0]!.lang, language);
    } finally { voice.destroy(); state.restore(); }
  }
  const state = environment({ voices, language: 'en', storage: new Map([[voicePreferenceKey, JSON.stringify({ voiceURI: '', language: 'en', rate: 0.95 })]]) });
  const voice = new Voice(state.view, { output: { language: 'en-IN' } }, state.submit);
  try { voice.toggleOutput(); voice.speak('Explicit host region'); assert.equal(state.spoken[0]!.voice?.voiceURI, 'rishi'); }
  finally { voice.destroy(); state.restore(); }
  const restored = environment({ voices, language: 'en', storage: new Map([[voicePreferenceKey, JSON.stringify({ voiceURI: '', language: 'en', rate: 0.95 })]]) });
  const automatic = new Voice(restored.view, {}, restored.submit);
  try { automatic.toggleOutput(); automatic.speak('Older rate-only preference'); assert.equal(restored.spoken[0]!.voice?.voiceURI, 'samantha'); }
  finally { automatic.destroy(); restored.restore(); }
});

test('empty voice lists use text until a late voiceschanged event supplies a usable voice', () => {
  const state = environment({ voices: [] }); const voice = new Voice(state.view, {}, state.submit);
  try {
    voice.toggleOutput(); assert.equal(voice.speak('Text-only while loading'), false); assert.equal(state.spoken.length, 0); assert.equal(state.settings().playable, false); assert.equal(state.listenerCount(), 1);
    state.voices([speechVoice('late', 'Google English', 'en-GB')]); assert.equal(state.settings().playable, true); assert.equal(voice.speak('Loaded voice'), true); assert.equal(state.spoken[0]!.voice?.voiceURI, 'late');
    const handlers = state.handlers(); voice.destroy(); assert.equal(state.listenerCount(), 0); handlers.preview(); assert.equal(state.spoken.length, 1); state.voices([speechVoice('later', 'Another voice')]); assert.equal(state.spoken.length, 1);
  } finally { voice.destroy(); state.restore(); }
});

test('explicit choice and speed apply to preview and narration, and preview never starts recognition or enables future output', () => {
  const state = environment({ voices: [speechVoice('first', 'Samantha'), speechVoice('chosen', 'Google UK English', 'en-GB')] }); const voice = new Voice(state.view, {}, state.submit);
  try {
    state.handlers().choose('chosen'); state.handlers().rate(0.95); state.handlers().preview();
    assert.equal(state.spoken.length, 1); assert.equal(state.spoken[0]!.voice?.voiceURI, 'chosen'); assert.equal(state.spoken[0]!.rate, 0.95); assert.equal(state.settings().previewing, true); assert.equal(Recognition.instances.length, 0); assert.deepEqual(state.submissions, []);
    state.spoken[0]!.onstart?.(); state.spoken[0]!.onend?.(); assert.equal(state.settings().previewing, false); assert.equal(voice.speak('Still muted'), false);
    assert.deepEqual(JSON.parse(state.storage.get(voicePreferenceKey)!), { voiceURI: 'chosen', language: 'en-GB', rate: 0.95 });
    voice.toggleOutput(); const events: string[] = []; voice.speak('Next guide step', { onStart: () => events.push('start'), onEnd: () => events.push('end'), onError: () => events.push('error') }); assert.deepEqual(events, []);
    assert.equal(state.spoken[1]!.voice?.voiceURI, 'chosen'); state.spoken[1]!.onstart?.(); assert.deepEqual(events, ['start']); state.spoken[1]!.onend?.(); assert.deepEqual(events, ['start', 'end']);
  } finally { voice.destroy(); state.restore(); }
});

test('a removed saved voice falls back honestly and returns if available again; preferences remain strictly bounded', () => {
  const storage = new Map([[voicePreferenceKey, JSON.stringify({ voiceURI: 'remembered', language: 'en-IN', rate: 1 })]]), state = environment({ storage, voices: [speechVoice('fallback', 'Samantha')] }); const voice = new Voice(state.view, {}, state.submit);
  try {
    assert.match(state.settings().message, /saved voice is unavailable/); voice.toggleOutput(); voice.speak('Fallback'); assert.equal(state.spoken[0]!.voice?.voiceURI, 'fallback');
    state.voices([speechVoice('remembered', 'Rishi'), speechVoice('fallback', 'Samantha')]); voice.speak('Restored'); assert.equal(state.spoken[1]!.voice?.voiceURI, 'remembered'); assert.equal(state.spoken[1]!.rate, 1);
    state.handlers().choose('unknown'); state.handlers().rate(40); assert.equal(JSON.parse(storage.get(voicePreferenceKey)!).voiceURI, 'remembered');
    assert.equal(readVoicePreference({ voiceURI: 'x', language: 'en', rate: '1' }), null); assert.equal(readVoicePreference({ voiceURI: 'x', language: 'en', rate: 1, transcript: 'private' }), null); assert.equal(readVoicePreference({ voiceURI: 'x'.repeat(301), language: 'en', rate: 1 }), null);
  } finally { voice.destroy(); state.restore(); }
});

test('preview cancellation discards stale audio callbacks, stays disabled while dictating and tolerates blocked storage', () => {
  const state = environment({ storageBlocked: true }); const voice = new Voice(state.view, { output: { rate: 0.95 } }, state.submit);
  try {
    state.handlers().preview(); const first = state.spoken[0]!, late = first.onstart; state.handlers().preview(); assert.equal(state.settings().previewing, false); assert.equal(first.onstart, null); late?.(); assert.equal(state.speaking.at(-1), false);
    state.handlers().choose('samantha-enhanced'); state.handlers().rate(1); voice.start(false); assert.equal(state.settings().recording, true); state.handlers().preview(); assert.equal(state.spoken.length, 1); assert.equal(Recognition.instances.length, 1);
    voice.destroy(); assert.equal(state.listenerCount(), 0); assert.equal(state.storage.size, 0);
  } finally { voice.destroy(); state.restore(); }
});

test('host remember:false ignores saved preferences and a novelty-only list never auto-selects its default', () => {
  const state = environment({ voices: [speechVoice('novelty', 'Zarvox', 'en-IN', true)], storage: new Map([[voicePreferenceKey, JSON.stringify({ voiceURI: 'novelty', language: 'en-IN', rate: 1.2 })]]) });
  const voice = new Voice(state.view, { output: { remember: false, rate: 0.95 } }, state.submit);
  try {
    voice.toggleOutput(); assert.equal(voice.speak('Use text rather than novelty by default'), false); assert.equal(state.settings().rate, 0.95);
    state.handlers().choose('novelty'); state.handlers().preview(); assert.equal(state.spoken[0]!.voice?.voiceURI, 'novelty'); assert.equal(state.spoken[0]!.rate, 0.95);
    assert.equal(JSON.parse(state.storage.get(voicePreferenceKey)!).rate, 1.2);
  } finally { voice.destroy(); state.restore(); }
});
