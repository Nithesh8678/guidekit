import type { View } from './view';

interface RecognitionResult { isFinal: boolean; [index: number]: { transcript: string }; }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult }; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export class Voice {
  private recognition: Recognition | null = null;
  private recording = false;
  private speaking = false;
  private enabled = false;
  private destroyed = false;
  private original = '';
  private readonly Constructor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  constructor(private readonly view: View) {
    if (!this.Constructor || !window.isSecureContext) {
      view.mic.disabled = true; view.mic.title = !window.isSecureContext ? 'Voice input needs HTTPS or localhost. You can type instead.' : 'Voice input is unavailable in this browser. You can type instead.';
      view.mic.setAttribute('aria-label', view.mic.title);
    }
    if (!('speechSynthesis' in window)) { view.speaker.disabled = true; view.speaker.title = 'Spoken answers are unavailable in this browser.'; }
  }
  toggleInput(): void {
    if (this.destroyed || !this.Constructor || !window.isSecureContext) return;
    if (this.recording) { this.recognition?.stop(); return; }
    this.stopSpeaking(); this.original = this.view.input.value;
    const recognition = new this.Constructor(); this.recognition = recognition;
    recognition.lang = document.documentElement.lang || navigator.language || 'en-US'; recognition.continuous = false; recognition.interimResults = true;
    let final = '';
    recognition.onresult = event => {
      if (this.destroyed || this.recognition !== recognition) return;
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]!;
        if (result.isFinal) final += `${result[0]?.transcript ?? ''} `; else interim += result[0]?.transcript ?? '';
      }
      this.view.input.value = `${this.original}${this.original ? ' ' : ''}${final}${interim}`.slice(0, 3000);
      this.view.status(interim ? `Listening: ${interim.slice(0, 150)}` : 'Review your question, then send it.');
    };
    recognition.onerror = event => {
      if (this.destroyed || this.recognition !== recognition) return;
      const message = ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'Microphone access was denied. Allow it in browser settings or type your question.' : event.error === 'audio-capture' ? 'No microphone is available. You can type your question.' : event.error === 'no-speech' ? 'No speech was detected. Try again or type your question.' : event.error === 'aborted' ? 'Dictation stopped.' : 'Voice input could not connect. You can type your question.';
      this.view.status(message, event.error !== 'aborted');
    };
    recognition.onend = () => {
      if (this.destroyed || this.recognition !== recognition) return;
      this.recording = false; this.recognition = null; this.view.mic.setAttribute('aria-pressed', 'false'); this.view.mic.title = 'Dictate a question. Your browser may process audio online.';
      if (final) this.view.status('Review your question, then send it.');
    };
    try {
      recognition.start(); this.recording = true; this.view.mic.setAttribute('aria-pressed', 'true'); this.view.mic.title = 'Stop dictation'; this.view.status('Listening… Your browser may process audio online.');
    } catch { this.recognition = null; this.recording = false; this.view.status('Voice input could not start. You can type your question.', true); }
  }
  toggleOutput(): void {
    if (!('speechSynthesis' in window)) return;
    this.enabled = !this.enabled; this.view.speaker.setAttribute('aria-pressed', String(this.enabled));
    this.view.speaker.title = this.enabled ? 'Turn off spoken answers' : 'Read answers aloud';
    if (!this.enabled) this.stopSpeaking(); this.view.status(this.enabled ? 'Spoken answers enabled.' : 'Spoken answers disabled.');
  }
  speak(text: string): void {
    if (!this.enabled || this.destroyed || !('speechSynthesis' in window)) return;
    this.stopSpeaking(); const utterance = new SpeechSynthesisUtterance(text.slice(0, 1800)); utterance.lang = document.documentElement.lang || navigator.language || 'en-US'; utterance.rate = 1;
    this.speaking = true; utterance.onend = () => { this.speaking = false; }; utterance.onerror = () => { this.speaking = false; };
    window.speechSynthesis.speak(utterance);
  }
  stopInput(): void {
    const recognition = this.recognition; this.recognition = null; this.recording = false;
    if (recognition) { recognition.onresult = null; recognition.onend = null; recognition.onerror = null; try { recognition.abort(); } catch { /* Already ended. */ } }
    this.view.mic.setAttribute('aria-pressed', 'false');
  }
  stopSpeaking(): void { if (this.speaking && 'speechSynthesis' in window) window.speechSynthesis.cancel(); this.speaking = false; }
  stop(): void { this.stopInput(); this.stopSpeaking(); }
  destroy(): void { this.stop(); this.destroyed = true; }
}
