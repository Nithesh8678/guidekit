import type { View } from './view';
import type { VoiceOptions } from './types';
import type { SpeechEvents } from './beats';

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
  private readonly Constructor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  constructor(private readonly view: View, private readonly options: VoiceOptions, private readonly submit: (message: string) => void) {
    const unavailable = options.provider === 'disabled' ? 'Voice input is disabled for this assistant.' : !window.isSecureContext ? 'Voice input needs HTTPS or localhost. You can type instead.' : !this.Constructor ? 'Speech recognition is unavailable in this browser. Try Chrome or Edge with microphone access, or type your question.' : '';
    if (unavailable) { view.mic.disabled = true; view.mic.title = unavailable; view.mic.setAttribute('aria-label', unavailable); }
    else this.resetMic();
    if (!('speechSynthesis' in window)) { view.speaker.disabled = true; view.speaker.title = 'Spoken answers are unavailable in this browser.'; }
    else { view.speaker.title = 'Read answers aloud using your browser'; view.speaker.setAttribute('aria-label', view.speaker.title); }
    view.voiceProvider(options.provider ?? 'browser');
  }
  get active(): boolean { return this.capture !== null; }
  start(voiceFlow = true): void {
    if (this.destroyed || this.capture) return;
    if (this.view.mic.disabled) { this.view.status(this.view.mic.title, true); return; }
    if (navigator.userActivation && !navigator.userActivation.isActive) { this.view.status('Click the microphone or press the voice shortcut to allow voice input.', true); return; }
    this.stopSpeaking(); if (voiceFlow && 'speechSynthesis' in window) this.setOutput(true);
    const capture: Capture = { generation: ++this.generation, phase: 'starting', original: this.view.input.value, autoSubmit: this.options.autoSubmit ?? voiceFlow, recognition: null, final: new Map() };
    this.capture = capture; this.view.input.readOnly = true; this.view.busy(true); this.view.voiceRecording(true);
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
    this.stopSpeaking();
    try {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 1800)); utterance.lang = document.documentElement.lang || navigator.language || 'en-US'; utterance.rate = 1;
      this.utterance = utterance;
      utterance.onstart = () => { if (this.utterance === utterance && !this.destroyed) { this.view.voiceSpeaking(true); events?.onStart(); } };
      utterance.onend = () => { if (this.utterance === utterance) { this.utterance = null; this.view.voiceSpeaking(false); events?.onEnd(); } };
      utterance.onerror = () => { if (this.utterance === utterance) { this.utterance = null; this.view.voiceSpeaking(false); events?.onError(); this.view.status('Your browser could not play the spoken answer. You can read it above.', true); } };
      window.speechSynthesis.speak(utterance); return true;
    } catch { this.utterance = null; events?.onError(); this.view.status('Spoken answers are unavailable. You can read the answer above.', true); return false; }
  }
  stopSpeaking(): void {
    this.view.voiceSpeaking(false);
    const utterance = this.utterance; this.utterance = null;
    if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  }
  stop(): void { this.stopInput(); this.stopSpeaking(); }
  destroy(): void { this.stop(); this.destroyed = true; }
}
