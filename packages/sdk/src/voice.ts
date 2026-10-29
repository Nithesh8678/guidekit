import type { View } from './view';
import type { VoiceOptions } from './types';
import type { SpeechEvents } from './beats';
import { languageTag, orderedVoices, readVoicePreference, recommendedVoice, speechRate, voiceId, voicePreferenceKey, type OutputPreference } from './voices';

interface RecognitionResult { isFinal: boolean; [index: number]: { transcript: string }; }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult }; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
interface Capture {
  generation: number; phase: 'starting' | 'listening' | 'finishing';
  original: string; autoSubmit: boolean; recognition: Recognition | null;
  final: Map<number, string>; timer?: ReturnType<typeof setTimeout>;
}

/** Browser-managed speech recognition. No audio stream, provider key or server voice route. */
export class Voice {
  private capture: Capture | null = null;
  private generation = 0;
  private utterance: SpeechSynthesisUtterance | null = null;
  private enabled = false;
  private destroyed = false;
  private previewing = false;
  private voices: SpeechSynthesisVoice[] = [];
  private readonly synthesis = 'speechSynthesis' in window ? window.speechSynthesis : null;
  private readonly defaultLanguage: string;
  private preference: OutputPreference;
  private readonly voicesChanged = () => { if (!this.destroyed) this.refreshVoices(); };
  private readonly Constructor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  constructor(private readonly view: View, private readonly options: VoiceOptions, private readonly submit: (message: string) => void) {
    this.defaultLanguage = languageTag(options.output?.language) ?? languageTag(document.documentElement.lang) ?? languageTag(navigator.language) ?? 'en-US';
    this.preference = { voiceURI: voiceId(options.output?.voiceURI) ? options.output!.voiceURI! : '', language: this.defaultLanguage, rate: speechRate(options.output?.rate) ? options.output!.rate! : 0.98 };
    if (options.output?.remember !== false) {
      try { const raw = window.localStorage.getItem(voicePreferenceKey); if (raw && raw.length <= 1024) this.preference = readVoicePreference(JSON.parse(raw)) ?? this.preference; } catch { /* Optional origin-local preferences can be unavailable. */ }
    }
    const unavailable = options.provider === 'disabled' ? 'Voice input is disabled for this assistant.' : !window.isSecureContext ? 'Voice input needs HTTPS or localhost. You can type instead.' : !this.Constructor ? 'Speech recognition is unavailable in this browser. Try Chrome or Edge with microphone access, or type your question.' : '';
    if (unavailable) { view.mic.disabled = true; view.mic.title = unavailable; view.mic.setAttribute('aria-label', unavailable); }
    else this.resetMic();
    if (!this.synthesis || typeof SpeechSynthesisUtterance === 'undefined') { view.speaker.disabled = true; view.speaker.title = 'Spoken answers are unavailable in this browser.'; }
    else { view.speaker.title = 'Read answers aloud using your browser'; view.speaker.setAttribute('aria-label', view.speaker.title); }
    view.voiceProvider(options.provider ?? 'browser');
    this.synthesis?.addEventListener?.('voiceschanged', this.voicesChanged);
    this.refreshVoices();
  }
  private chosenVoice(): SpeechSynthesisVoice | null { return this.voices.find(voice => voice.voiceURI === this.preference.voiceURI) ?? recommendedVoice(this.voices, this.preference.language); }
  private playable(): boolean { return Boolean(this.synthesis && typeof SpeechSynthesisUtterance !== 'undefined' && (typeof this.synthesis.getVoices !== 'function' || this.chosenVoice())); }
  private refreshVoices(): void {
    try { this.voices = orderedVoices(this.synthesis?.getVoices?.() ?? [], this.preference.language); } catch { this.voices = []; }
    this.settings();
  }
  private settings(): void {
    const available = Boolean(this.synthesis && typeof SpeechSynthesisUtterance !== 'undefined'), recommended = recommendedVoice(this.voices, this.preference.language), selected = this.voices.find(voice => voice.voiceURI === this.preference.voiceURI);
    const name = (voice: SpeechSynthesisVoice) => voice.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
    const message = !available ? 'Spoken answers are unavailable in this browser. Text chat still works.'
      : typeof this.synthesis?.getVoices !== 'function' ? 'This browser uses its default voice and does not expose a voice list.'
      : !this.voices.length ? 'Waiting for browser voices. Text guidance works while the voice list loads.'
      : this.preference.voiceURI && !selected ? `Your saved voice is unavailable. ${recommended ? `Using ${name(recommended)}.` : 'Choose an available voice.'}`
      : !selected && recommended ? `Automatic: ${name(recommended)}. Preview to find the voice you prefer.`
      : 'Uses browser/device voices. Availability varies; some voices may use a browser online service.';
    this.view.voiceSettings({ available, voices: this.voices.map(voice => ({ id: voice.voiceURI, label: `${name(voice)} · ${voice.lang}${voice.voiceURI === recommended?.voiceURI ? ' · recommended' : ''}` })), selected: selected?.voiceURI ?? '', rate: this.preference.rate, message, previewing: this.previewing, recording: this.active, playable: this.playable() }, {
      choose: id => {
        if (this.destroyed || this.active || !voiceId(id) || id && !this.voices.some(voice => voice.voiceURI === id)) return;
        this.stopSpeaking(); const selected = this.voices.find(voice => voice.voiceURI === id);
        this.preference.voiceURI = id; this.preference.language = languageTag(selected?.lang) ?? this.defaultLanguage; this.persist(); this.refreshVoices();
      },
      rate: rate => { if (this.destroyed || this.active || !speechRate(rate)) return; this.stopSpeaking(); this.preference.rate = rate; this.persist(); this.settings(); },
      preview: () => this.preview()
    });
  }
  private persist(): void { if (this.options.output?.remember !== false) { try { window.localStorage.setItem(voicePreferenceKey, JSON.stringify(this.preference)); } catch { /* Preferences never block speech. */ } } }
  private preview(): void {
    if (this.destroyed || this.active) return;
    if (this.previewing) { this.stopSpeaking(); return; }
    if (navigator.userActivation && !navigator.userActivation.isActive) { this.view.status('Click Preview to hear this browser voice.'); return; }
    this.play('Hi, I’m your website guide. I’ll explain each step as you go.', undefined, true);
  }
  get active(): boolean { return this.capture !== null; }
  start(voiceFlow = true): void {
    if (this.destroyed || this.capture) return;
    if (this.view.mic.disabled) { this.view.status(this.view.mic.title, true); return; }
    if (navigator.userActivation && !navigator.userActivation.isActive) { this.view.status('Click the microphone or press the voice shortcut to allow voice input.', true); return; }
    this.stopSpeaking(); if (voiceFlow && 'speechSynthesis' in window) this.setOutput(true);
    const capture: Capture = { generation: ++this.generation, phase: 'starting', original: this.view.input.value, autoSubmit: this.options.autoSubmit ?? voiceFlow, recognition: null, final: new Map() };
    this.capture = capture; this.view.input.readOnly = true; this.view.busy(true); this.view.voiceRecording(true);
    this.settings();
    this.view.mic.setAttribute('aria-pressed', 'true');
    const finishLabel = capture.autoSubmit ? 'Finish voice input and send question' : 'Finish dictation and review transcript';
    this.view.mic.title = finishLabel; this.view.mic.setAttribute('aria-label', finishLabel);
    this.view.status('Starting browser speech recognition… Allow microphone access. Your browser may process audio online.');
    try {
      const recognition = new this.Constructor!(); capture.recognition = recognition;
      recognition.lang = document.documentElement.lang || navigator.language || 'en-US'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onstart = () => {
        if (!this.current(capture)) return;
        capture.phase = 'listening'; this.clearTimer(capture); capture.timer = setTimeout(() => this.finishInput(), 60000);
        this.view.status(capture.autoSubmit ? 'Listening… Press the shortcut or microphone again to send. Cancel voice or Escape discards it. Your browser may process audio online.' : 'Listening… Press the microphone again to review your transcript. Cancel voice or Escape discards it. Your browser may process audio online.');
      };
      recognition.onresult = event => {
        if (!this.current(capture)) return;
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index]!; const text = result[0]?.transcript ?? '';
          if (typeof text !== 'string') continue;
          if (result.isFinal) capture.final.set(index, text.slice(0, 3001)); else interim += text;
        }
        // Keep final results in their original order without duplicating repeated events.
        if (capture.final.size > 100 || [...capture.final.values()].join(' ').length > 3000) { this.fail(capture, 'Voice input was too long. Nothing was sent. Try a shorter question.'); return; }
        if (interim && capture.phase === 'listening') this.view.status(`Listening: ${interim.slice(0, 150)} · Press the microphone to finish; Escape cancels.`);
      };
      recognition.onerror = event => {
        if (!this.current(capture)) return;
        const message = ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'Microphone access was denied. In Chrome or Edge, allow the microphone in site settings and try again, or type your question.' : event.error === 'audio-capture' ? 'No usable microphone is available. Connect one and try again, or type your question.' : event.error === 'no-speech' ? 'No speech was detected. Nothing was sent. Try again or type your question.' : event.error === 'network' ? 'Browser speech recognition could not connect. Check your network or type your question.' : event.error === 'aborted' ? 'Voice input stopped. Nothing was sent.' : 'Browser speech recognition could not finish. Nothing was sent. Try again or type your question.';
        this.fail(capture, message);
      };
      recognition.onend = () => {
        if (this.current(capture)) this.accept(capture, [...capture.final.entries()].sort(([left], [right]) => left - right).map(([, text]) => text).join(' '));
      };
      capture.timer = setTimeout(() => this.fail(capture, 'Speech recognition did not start. Allow microphone access and try again, or type your question.'), 20000);
      recognition.start();
    } catch { this.fail(capture, 'Browser speech recognition could not start. Try Chrome or Edge with microphone access, or type your question.'); }
  }
  private current(capture: Capture): boolean { return !this.destroyed && this.capture === capture && capture.generation === this.generation; }
  private clearTimer(capture: Capture): void { if (capture.timer) clearTimeout(capture.timer); capture.timer = undefined; }
  finishInput(): void {
    const capture = this.capture; if (!capture || capture.phase === 'finishing') return;
    if (capture.phase === 'starting') { this.stopInput(); this.view.status('Voice input cancelled before listening. Nothing was sent.'); return; }
    capture.phase = 'finishing'; this.clearTimer(capture);
    this.view.status(capture.autoSubmit ? 'Finishing your transcript, then sending your question… Escape cancels.' : 'Finishing your transcript for review… Escape cancels.');
    capture.timer = setTimeout(() => this.fail(capture, 'Browser dictation did not finish in time. Nothing was sent. Please try again.'), 10000);
    try { capture.recognition?.stop(); } catch { this.fail(capture, 'Browser dictation could not finish. Nothing was sent. Please try again.'); }
  }
  private accept(capture: Capture, transcript: string): void {
    if (!this.current(capture)) return;
    const text = transcript.trim(); const combined = `${capture.original}${capture.original && text ? ' ' : ''}${text}`;
    this.stopInput();
    if (!text) { this.view.status('No speech was detected. Nothing was sent. Try again or type your question.', true); return; }
    if (combined.length > 3000) { this.view.input.value = combined.slice(0, 3000); this.view.status('Your question was too long. Review and shorten it before sending.', true); return; }
    this.view.input.value = combined;
    if (capture.autoSubmit) { this.view.input.value = ''; this.submit(combined); }
    else this.view.status('Transcript ready. Review your question, then send it.');
  }
  private fail(capture: Capture, message: string): void { if (!this.current(capture)) return; this.stopInput(); this.view.status(message, true); }
  private resetMic(): void {
    this.view.mic.setAttribute('aria-pressed', 'false'); this.view.mic.title = 'Dictate with your browser, then review your question. Your browser may process audio online.'; this.view.mic.setAttribute('aria-label', this.view.mic.title);
  }
  stopInput(): void {
    ++this.generation; const capture = this.capture; this.capture = null;
    if (capture) {
      this.clearTimer(capture);
      const recognition = capture.recognition;
      if (recognition) { recognition.onstart = null; recognition.onresult = null; recognition.onend = null; recognition.onerror = null; try { recognition.abort(); } catch { /* Already ended. */ } }
      this.view.input.readOnly = false; this.view.busy(false); this.view.voiceRecording(false);
    }
    if (!this.view.mic.disabled) this.resetMic();
    this.settings();
  }
  private setOutput(enabled: boolean): void {
    this.enabled = enabled; this.view.speaker.setAttribute('aria-pressed', String(enabled));
    this.view.speaker.title = enabled ? 'Turn off browser spoken answers' : 'Read answers aloud using your browser'; this.view.speaker.setAttribute('aria-label', this.view.speaker.title);
  }
  toggleOutput(): void {
    if (!('speechSynthesis' in window)) return;
    this.setOutput(!this.enabled); if (!this.enabled) this.stopSpeaking();
    this.view.status(this.enabled ? 'Spoken answers enabled using your browser.' : 'Spoken answers disabled.');
  }
  speak(text: string, events?: SpeechEvents): boolean {
    if (!this.enabled || this.destroyed || !('speechSynthesis' in window)) return false;
    return this.play(text, events);
  }
  private play(text: string, events?: SpeechEvents, preview = false): boolean {
    this.stopSpeaking();
    this.refreshVoices();
    if (!this.playable()) { this.view.status('A browser voice is not ready. You can read the answer or choose a voice in Voice settings.'); return false; }
    try {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 1800)), voice = this.chosenVoice();
      utterance.lang = voice?.lang ?? this.preference.language; utterance.rate = this.preference.rate; if (voice) utterance.voice = voice;
      this.utterance = utterance; this.previewing = preview; this.settings();
      utterance.onstart = () => { if (this.utterance === utterance && !this.destroyed) { this.view.voiceSpeaking(true); events?.onStart(); } };
      utterance.onend = () => { if (this.utterance === utterance) { this.utterance = null; this.previewing = false; this.view.voiceSpeaking(false); this.settings(); events?.onEnd(); } };
      utterance.onerror = () => { if (this.utterance === utterance) { this.utterance = null; this.previewing = false; this.view.voiceSpeaking(false); this.settings(); events?.onError(); this.view.status('Your browser could not play the spoken answer. You can read it above.', true); } };
      this.synthesis!.speak(utterance); return true;
    } catch { this.utterance = null; this.previewing = false; this.settings(); events?.onError(); this.view.status('Spoken answers are unavailable. You can read the answer above.', true); return false; }
  }
  stopSpeaking(): void {
    this.view.voiceSpeaking(false);
    const utterance = this.utterance; this.utterance = null;
    if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
    this.previewing = false; this.settings();
  }
  stop(): void { this.stopInput(); this.stopSpeaking(); }
  destroy(): void { if (this.destroyed) return; this.stop(); this.destroyed = true; this.synthesis?.removeEventListener?.('voiceschanged', this.voicesChanged); }
}
