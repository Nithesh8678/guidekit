import type { Citation, ModelPlan, PublicAgent, RunResult } from '../../contracts/src/index';
import { GuidanceSession, type GuidanceResult, type GuidanceState } from './guidance';
import type { GuideStepResult } from './types';
import { BeatScheduler, type SpeechEvents } from './beats';
import { MotionDirector, type MotionPoint } from './motion';
import type { VoiceSettingsHandlers, VoiceSettingsState } from './voices';
import { GuidedReveal, revealedBounds, targetRevealed } from './scroll';
import { isSafeTarget } from './context';
import { placeGuidanceControls, placeGuidanceLabel, type PlacementBox } from './placement';
import { instructionDuration, instructionGraphemes } from './instruction';

const styles = `
:host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17213b;font-size:14px;line-height:1.5;color-scheme:light;--gk-accent:#365cf5}
*{box-sizing:border-box}button,textarea,select{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.5}button:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #a7b8ff;outline-offset:3px}button{border:0}svg{width:18px;height:18px;flex-shrink:0} [hidden]{display:none!important}
.launcher{pointer-events:auto;position:fixed;right:24px;bottom:24px;display:flex;align-items:center;gap:10px;background:var(--gk-accent);color:#fff;border-radius:40px;padding:15px 19px;font-weight:650;box-shadow:0 5px 20px #23386838;transition:transform .18s,box-shadow .18s}.launcher:hover{transform:translateY(-2px);box-shadow:0 8px 24px #23386845}
.panel{pointer-events:auto;position:fixed;right:24px;bottom:24px;width:390px;max-width:calc(100vw - 32px);height:590px;max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#fff;border:1px solid #dfe5f0;border-radius:20px;box-shadow:0 20px 80px #17213b26,0 2px 10px #17213b14;overflow:hidden;animation:gk-appear .16s ease-out}
@keyframes gk-appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.header{display:flex;gap:11px;align-items:center;padding:18px;border-bottom:1px solid #edf0f7;background:#fff}.mark{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;background:var(--gk-accent);border-radius:12px;color:#fff}.identity{flex:1;min-width:0}.name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.company{font-size:11px;color:#6c7890;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon{display:flex;align-items:center;justify-content:center;background:transparent;color:#6c7890;border-radius:8px;width:32px;height:32px;flex-shrink:0}.icon:hover{background:#f0f3fa;color:#17213b}.icon[aria-pressed=true]{background:#eef2ff;color:var(--gk-accent)}
.cursor-dock{background:#edf1ff;background:color-mix(in srgb,var(--gk-accent) 10%,white);color:var(--gk-accent);pointer-events:none}
.voice-settings{border-bottom:1px solid #edf0f7;padding:0 18px;font-size:11px;flex-shrink:0;color:#64718a}.voice-settings summary{cursor:pointer;padding:9px 0;width:fit-content}.voice-settings-body{display:grid;gap:8px;padding:2px 0 12px}.voice-settings label{display:grid;gap:3px;color:#53617b}.voice-settings select{width:100%;min-width:0;border:1px solid #dfe5f0;border-radius:7px;background:#fff;color:#25334c;padding:6px;font-size:11px}.voice-settings-row{display:flex;align-items:end;gap:8px}.voice-settings-row label{flex:1}.voice-settings .secondary{padding:7px 10px;font-size:11px}.voice-settings-note{margin:0;line-height:1.4;font-size:10px;color:#7c889c}
.messages{padding:20px 18px 8px;overflow-y:auto;flex:1;overscroll-behavior:contain;scrollbar-width:thin;background:linear-gradient(#fafbfe,#fff 100px)}.message{margin-bottom:20px;font-size:13px;overflow-wrap:anywhere}.message.user{background:#eef2ff;padding:11px 14px;border-radius:14px 14px 3px 14px;margin-left:32px}.message.assistant{padding-right:8px}.author{text-transform:uppercase;letter-spacing:.1em;font-weight:700;font-size:9px;color:#71809c;margin-bottom:7px}.content{white-space:pre-wrap}.message.error{border-left:3px solid #df7552;padding-left:12px;color:#74452f}.sources{margin-top:12px;font-size:11px;color:#60708d}.sources summary{cursor:pointer;width:fit-content;padding:3px 0}.source{margin:9px 0;padding:10px;background:#f5f7fc;border-radius:8px}.source strong{display:block;margin-bottom:4px;color:#35425b}.source blockquote{margin:0;white-space:pre-wrap}
.status{min-height:29px;padding:3px 18px;color:#6b7891;font-size:11px;overflow-wrap:anywhere}.status[data-error=true]{color:#a1422e}.composer{padding:0 14px 12px}.input-box{border:1px solid #dfe5f0;border-radius:13px;background:#fff;padding:10px 10px 8px;transition:border-color .2s}.input-box:focus-within{border-color:#96aaf8;box-shadow:0 0 0 3px #365cf509}textarea{display:block;width:100%;height:50px;max-height:100px;border:0;resize:none;outline:none!important;background:transparent;color:#17213b;font-size:13px;padding:0 3px;line-height:1.5}textarea::placeholder{color:#8b95a8}.input-tools{display:flex;align-items:center;gap:6px}.hint{flex:1;font-size:10px;color:#8691a5}.send{width:32px;height:32px;border-radius:9px;color:#fff;background:var(--gk-accent);display:grid;place-items:center}.stop{font-size:11px;background:#fff2ed;color:#a54428;border-radius:8px;padding:8px 10px}.footer{font-size:9px;color:#8b95a8;text-align:center;padding:0 12px 11px}.footer b{font-weight:650;color:#66748d}
.action{margin-top:13px;border:1px solid #dfe5f0;border-radius:12px;overflow:hidden;background:#fff}.action-main{padding:13px}.action-title{font-weight:700;font-size:12px}.action-reason{font-size:12px;color:#627089;margin:5px 0 0;white-space:pre-wrap}.action pre{background:#f5f7fb;border-radius:7px;padding:10px;max-height:150px;overflow:auto;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.action-foot{border-top:1px solid #edf0f7;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.primary,.secondary{font-size:12px;font-weight:600;border-radius:8px;padding:8px 11px}.primary{background:var(--gk-accent);color:white}.secondary{background:#f0f3fa;color:#4b5a75}.action-state{font-size:11px;color:#64718a}.action-state[data-success=true]{color:#16815b}.guide-start{margin-top:12px;display:flex;align-items:center;gap:6px;width:fit-content}
.highlight{position:fixed;border:2px solid var(--gk-guide-ink,#b57500);border-radius:10px;pointer-events:none}.guide{pointer-events:auto;position:fixed;width:290px;max-width:calc(100vw - 24px);background:#fff9e8;border:1px solid #dfb66b;box-shadow:0 8px 26px #5d42151c;border-radius:16px;padding:12px}.guide p{font-size:13px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto}.guide-label{font-size:10px;font-weight:600;color:#6d6659;white-space:nowrap}.guide-step-number{font-weight:750;color:#55401a}.guide-step-total{color:#827765;font-weight:500}.guide-tools{display:flex;align-items:center;gap:3px}.guide .icon{width:25px;height:25px;color:#74664d}.guide-pause{font-size:10px;line-height:17px;padding:4px 6px;white-space:nowrap;background:transparent;color:#6e6047;border-radius:7px}.guide-pause:hover,.guide .icon:hover{background:#f5ead0;color:#493718}.guide-resume{display:block;margin:6px 18px 12px;width:calc(100% - 36px);text-align:left}
.guide.guide-expressive{width:80px;padding:0;border:0;background:none;box-shadow:none;overflow:visible;pointer-events:none;animation:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--gk-guide-text:#352707}.guide-surface{position:relative;width:100%;height:100%;pointer-events:auto;border:1px solid #d9a13d;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#fff9e8 0%,#ffe9b4 43%,#ffdb91 100%);box-shadow:inset 0 1px 0 #fffdf3,0 4px 12px #66430c26,0 0 18px #f1b73926;transition:opacity .12s ease-out}.guide[data-gk-arrival=pending] .guide-surface{opacity:0;pointer-events:none}.guide-body{position:relative;padding:9px 12px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.guide-expressive .guide-instruction{font-size:13px;line-height:1.45;font-weight:600;color:var(--gk-guide-text);margin:0;min-height:1.45em;max-height:min(220px,max(36px,calc(100dvh - 112px)));white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}.guide-expressive[data-gk-typing=true] .guide-instruction::after{content:"";display:inline-block;height:.95em;width:2px;vertical-align:-.1em;margin-left:3px;border-radius:2px;background:#9c6f20;animation:gk-caret .65s ease-in-out 2}.guide-instruction-accessible{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.guide-skip{margin:0;padding:4px 6px;background:transparent;color:#806021;font-size:10px;line-height:17px;white-space:nowrap;font-weight:600;border-radius:7px}.guide-skip:hover{color:#49310a}.guide-toolbar{position:fixed;right:12px;bottom:12px;pointer-events:auto;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:5px 7px 5px 11px;border:1px solid #e1d8c5;border-radius:30px;background:#fffdf8f5;box-shadow:0 4px 14px #3f352516}.guide-toolbar .guide-tools{flex-wrap:wrap;min-width:0}.guide-toolbar button{transition:background .15s,color .15s}.guide-assist{position:absolute;right:0;bottom:calc(100% + 8px);width:260px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 76px);overflow:auto;overscroll-behavior:contain;background:#fffdf7;border:1px solid #e1d8c5;border-radius:12px;padding:10px 12px;box-shadow:0 5px 18px #473a211c;font-size:11px;line-height:1.5;color:#756747}.guide-hint{font-size:11px;line-height:1.5;color:#756747;margin:0}.guide[data-paused=true] .guide-surface{box-shadow:0 3px 10px #66430c1c}.guide-measure{position:fixed;visibility:hidden;pointer-events:none;inset:0 auto auto 0;white-space:pre;width:max-content;max-width:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.45;font-weight:600}.guide-rim{position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;padding:1px;background:linear-gradient(110deg,transparent 15%,#fff6cf 40%,#f6b94b 53%,transparent 75%);background-size:240% 100%;opacity:0;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}.guide-expressive[data-gk-typing=true] .guide-rim{animation:gk-rim-sweep 1.15s ease-out 1}@keyframes gk-rim-sweep{0%{background-position:100% 0;opacity:0}18%{opacity:.9}100%{background-position:0 0;opacity:0}}@keyframes gk-caret{0%,100%{opacity:.25}50%{opacity:1}}
@media(max-width:520px){.panel{right:12px;bottom:12px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);width:390px}.launcher{right:16px;bottom:16px}.guide{width:270px}.hint{font-size:9px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
const icons = {
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  guide: '<path d="m4 3 7 18 2-8 8-2L4 3Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 4.8 1c0 1.8-2.3 2-2.3 3.5m0 3h.01"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>'
};
function icon(name: keyof typeof icons): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  // Only static, authored SVG paths enter this parser. All external text uses textContent.
  svg.innerHTML = icons[name]; return svg;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}
function button(label: string, className: string, handler: () => void): HTMLButtonElement {
  const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', handler); return node;
}
function iconButton(label: string, glyph: keyof typeof icons, handler: () => void): HTMLButtonElement {
  const node = button('', 'icon', handler); node.title = label; node.setAttribute('aria-label', label); node.append(icon(glyph)); return node;
}

export interface ActionCard {
  state(message: string, success?: boolean): void;
  executing(): void;
  finished(message: string, success: boolean): void;
  retry(message: string, handler: () => void): void;
}
export interface GuideHooks {
  /** Existing captured public targets only; rectangles are revalidated locally. */
  nearbyTargets?(): readonly HTMLElement[];
  state?(state: GuidanceState): void;
  progress?(index: number, step: ModelPlan['steps'][number], evidence: 'observed' | 'manual' | 'host_verified'): void;
  finish?(result: GuidanceResult): boolean;
}
export class View {
  readonly host = element('div');
  readonly shadow: ShadowRoot;
  readonly input = element('textarea');
  readonly mic: HTMLButtonElement;
  readonly speaker: HTMLButtonElement;
  private readonly launcher: HTMLButtonElement;
  private readonly panel = element('section', 'panel');
  private readonly messages = element('div', 'messages');
  private readonly statusNode = element('div', 'status');
  private readonly send: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly name = element('div', 'name', 'GuideKit');
  private readonly company = element('div', 'company', 'Connecting to your assistant');
  private readonly cursorDock = element('div', 'mark cursor-dock');
  private readonly motion: MotionDirector;
  private readonly dockResize: ResizeObserver;
  private cursorDocked = false;
  private dockFrame = 0;
  private dockUntil = 0;
  private lastDock: MotionPoint | null = null;
  private isBusy = false;
  private recording = false;
  private speaking = false;
  private destroyed = false;
  private previousFocus: HTMLElement | null = null;
  private guideCleanup: (() => void) | null = null;
  private guideSession: GuidanceSession | null = null;
  private guideVisibility: ((visible: boolean) => void) | null = null;
  private guideFocus: (() => void) | null = null;
  private guideChatOpen = false;
  private transitionCleanup: (() => void) | null = null;
  private transitionStop: (() => void) | null = null;
  private readonly resumeGuide: HTMLButtonElement;
  private readonly recoveries = new WeakSet<HTMLElement>();
  private isOpen = false;
  private readonly voiceLabel = element('div', 'footer');
  private readonly voicePreferences = element('details', 'voice-settings');
  private readonly voiceSelect = element('select');
  private readonly voiceRate = element('select');
  private readonly voiceNote = element('p', 'voice-settings-note');
  private readonly voicePreview: HTMLButtonElement;
  private voiceHandlers: VoiceSettingsHandlers | null = null;
  private voiceChoices = '';
  get opened(): boolean { return this.isOpen && !this.panel.hidden; }
  get guiding(): boolean { return (this.guideSession?.active ?? false) || this.transitionStop !== null; }
  voiceProvider(provider: 'browser' | 'disabled'): void {
    this.voiceLabel.textContent = provider === 'browser' ? 'Browser voice · Chrome/Edge · Microphone permission required' : 'Voice input disabled';
  }
  voiceRecording(recording: boolean): void {
    this.recording = recording; this.cursorActivity();
    this.stop.textContent = recording ? 'Cancel voice' : 'Stop';
    this.stop.title = recording ? 'Discard this recording without sending a question' : 'Stop the current request';
  }
  voiceSpeaking(speaking: boolean): void { this.speaking = speaking; this.cursorActivity(); }
  voiceSettings(state: VoiceSettingsState, handlers: VoiceSettingsHandlers): void {
    this.voiceHandlers = handlers;
    const choices = JSON.stringify(state.voices);
    if (choices !== this.voiceChoices) {
      this.voiceChoices = choices; const auto = element('option', '', 'Automatic · recommended'); auto.value = '';
      this.voiceSelect.replaceChildren(auto, ...state.voices.map(voice => { const option = element('option', '', voice.label); option.value = voice.id; return option; }));
    }
    this.voiceSelect.value = state.selected; this.voiceSelect.disabled = !state.available || !state.voices.length || state.recording;
    if (![...this.voiceRate.options].some(option => Number(option.value) === state.rate)) { const option = element('option', '', `${state.rate}×`); option.value = String(state.rate); this.voiceRate.append(option); }
    this.voiceRate.value = String(state.rate); this.voiceRate.disabled = !state.available || state.recording;
    this.voicePreview.textContent = state.previewing ? 'Stop preview' : 'Preview'; this.voicePreview.setAttribute('aria-label', state.previewing ? 'Stop voice preview' : 'Preview voice'); this.voicePreview.disabled = state.recording || !state.previewing && (!state.available || !state.playable);
    this.voiceNote.textContent = state.message;
  }

  constructor(private readonly handlers: { open(): void; close(): void; submit(message: string): void; cancel(): void; mic(): void; speaker(): void; guideStep?(text: string, events: SpeechEvents): boolean; guidePause?(): void; guideFinish?(result: GuidanceResult): void; }) {
    this.host.dataset.guidekitRoot = ''; this.host.dataset.guidekitPrivate = '';
    // aria-hidden's hideOthers (used by Radix) preserves explicit live-region
    // roots. Keep this owned overlay available; only its authored child regions
    // announce updates. Never remove application/private aria-hidden attributes.
    this.host.setAttribute('aria-live', 'off');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = element('style'); style.textContent = styles; this.shadow.append(style);
    this.launcher = button('', 'launcher', handlers.open); this.launcher.append(icon('spark'), element('span', '', 'Ask your assistant')); this.launcher.setAttribute('aria-label', 'Open website assistant');
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', 'Website assistant'); this.panel.hidden = true;
    const header = element('header', 'header'); this.cursorDock.dataset.gkCursorDock = ''; this.cursorDock.setAttribute('aria-hidden', 'true');
    const identity = element('div', 'identity'); identity.append(this.name, this.company);
    this.speaker = iconButton('Read answers aloud', 'sound', handlers.speaker); this.speaker.setAttribute('aria-pressed', 'false');
    header.append(this.cursorDock, identity, this.speaker, iconButton('Close assistant', 'close', handlers.close));
    this.voicePreferences.append(element('summary', '', 'Voice settings'));
    const voiceBody = element('div', 'voice-settings-body'), voiceLabel = element('label', '', 'Spoken voice'), rateLabel = element('label', '', 'Speed'), voiceRow = element('div', 'voice-settings-row');
    this.voiceSelect.setAttribute('aria-label', 'Spoken voice'); this.voiceSelect.addEventListener('change', () => this.voiceHandlers?.choose(this.voiceSelect.value)); voiceLabel.append(this.voiceSelect);
    this.voiceRate.setAttribute('aria-label', 'Voice speed');
    for (const [value, label] of [[0.9, 'Slower · 0.9×'], [0.95, 'Relaxed · 0.95×'], [0.98, 'Balanced · 0.98×'], [1, 'Normal · 1×'], [1.05, 'Brisk · 1.05×'], [1.1, 'Faster · 1.1×']] as const) { const option = element('option', '', label); option.value = String(value); this.voiceRate.append(option); }
    this.voiceRate.addEventListener('change', () => this.voiceHandlers?.rate(Number(this.voiceRate.value))); rateLabel.append(this.voiceRate);
    this.voicePreview = button('Preview', 'secondary', () => this.voiceHandlers?.preview()); this.voicePreview.setAttribute('aria-label', 'Preview voice'); this.voicePreview.disabled = true;
    voiceRow.append(rateLabel, this.voicePreview); voiceBody.append(voiceLabel, voiceRow, this.voiceNote); this.voicePreferences.append(voiceBody);
    this.messages.setAttribute('role', 'log'); this.messages.setAttribute('aria-label', 'Conversation'); this.messages.setAttribute('aria-live', 'polite'); this.messages.setAttribute('aria-relevant', 'additions');
    this.statusNode.setAttribute('role', 'status'); this.statusNode.setAttribute('aria-live', 'polite');
    const form = element('form', 'composer'); const box = element('div', 'input-box');
    this.input.placeholder = 'Ask a question or describe a task…'; this.input.maxLength = 3000; this.input.setAttribute('aria-label', 'Your question'); this.input.rows = 2;
    this.input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
    const tools = element('div', 'input-tools'); this.mic = iconButton('Dictate a question. Your browser may process audio online.', 'mic', handlers.mic); this.mic.setAttribute('aria-pressed', 'false');
    this.send = button('', 'send', () => form.requestSubmit()); this.send.append(icon('send')); this.send.setAttribute('aria-label', 'Send question');
    this.stop = button('Stop', 'stop', handlers.cancel); this.stop.hidden = true;
    tools.append(this.mic, element('span', 'hint', 'Enter to send · Shift Enter for a new line'), this.stop, this.send);
    box.append(this.input, tools); form.append(box);
    form.addEventListener('submit', event => { event.preventDefault(); const message = this.input.value.trim(); if (!message || this.send.disabled) return; this.input.value = ''; handlers.submit(message); });
    const footer = element('div', 'footer'); footer.append(document.createTextNode('Powered by '), element('b', '', 'GuideKit'), document.createTextNode(' · Actions need your approval'));
    this.resumeGuide = button('Resume guide', 'secondary guide-resume', () => {
      const session = this.guideSession;
      if (!session?.active) return;
      this.departDock();
      this.guideChatOpen = false; this.resumeGuide.hidden = true; this.panel.hidden = true; this.launcher.hidden = true;
      session.setPaused(false);
      if (this.guideSession === session && session.active) { this.guideVisibility?.(true); session.refresh(); this.guideFocus?.(); }
    }); this.resumeGuide.hidden = true;
    this.panel.append(header, this.voicePreferences, this.messages, this.statusNode, this.resumeGuide, form, this.voiceLabel, footer); this.shadow.append(this.launcher, this.panel);
    document.body.append(this.host);
    this.motion = new MotionDirector(this.shadow); this.motion.setVisible(false);
    this.dockResize = new ResizeObserver(this.dockLayout); this.dockResize.observe(this.panel);
    window.addEventListener('resize', this.dockLayout); window.visualViewport?.addEventListener('resize', this.dockLayout); window.visualViewport?.addEventListener('scroll', this.dockLayout);
    document.addEventListener('visibilitychange', this.dockLayout);
  }
  configure(agent: PublicAgent): void {
    this.host.style.setProperty('--gk-accent', agent.accentColor); this.name.textContent = agent.name; this.company.textContent = `${agent.companyName} · v${agent.version}`;
    this.launcher.setAttribute('aria-label', `Open ${agent.name}`); this.launcher.querySelector('span')!.textContent = `Ask ${agent.name}`;
    this.message('assistant', agent.greeting);
  }
  open(): void {
    if (!this.isOpen) this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returning = !!this.guideSession?.active;
    if (returning) {
      this.guideChatOpen = true; this.guideSession?.setPaused(true); this.guideVisibility?.(false); this.handlers.guidePause?.(); this.resumeGuide.hidden = false;
    }
    this.isOpen = true; this.panel.hidden = false; this.launcher.hidden = true; this.input.focus({ preventScroll: true }); this.dockCursor(returning);
  }
  close(): void { this.clearGuide(false); this.isOpen = false; this.panel.hidden = true; this.launcher.hidden = false; this.departDock(); this.motion.erase({ animate: false }); this.motion.setVisible(false); if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true }); }
  status(message: string, error = false): void { this.statusNode.textContent = message; this.statusNode.dataset.error = String(error); }
  busy(value: boolean): void { this.isBusy = value; this.cursorActivity(); this.send.disabled = value; this.stop.hidden = !value; this.input.setAttribute('aria-busy', String(value)); }
  message(role: 'user' | 'assistant' | 'error', text: string, citations: Citation[] = []): HTMLElement {
    const message = element('div', `message ${role}`); if (role !== 'user') message.append(element('div', 'author', role === 'error' ? 'Something needs attention' : this.name.textContent ?? 'Assistant'));
    message.append(element('div', 'content', text));
    if (citations.length) {
      const details = element('details', 'sources'); details.append(element('summary', '', `${citations.length} knowledge source${citations.length === 1 ? '' : 's'}`));
      for (const citation of citations) { const source = element('div', 'source'); source.append(element('strong', '', citation.title), element('blockquote', '', citation.excerpt)); details.append(source); }
      message.append(details);
    }
    this.messages.append(message); this.scroll(); return message;
  }
  knowledgeEvidence(container: HTMLElement, knowledge: RunResult['knowledge'], citations: Citation[]): void {
    if (knowledge?.source === 'postgres') {
      container.append(element('div', 'sources', 'Grounded in published company knowledge')); this.scroll(); return;
    }
    if (knowledge?.source !== 'tigergraph') return;
    const titles = new Map(citations.map(citation => [citation.documentId, citation.title]));
    // Show useful connections between cited sources, without self loops or internal IDs.
    const paths = knowledge.paths.filter(path => path.nodes[0] !== path.nodes[2] && titles.has(path.nodes[0]!) && titles.has(path.nodes[2]!)).slice(0, 6);
    if (!paths.length) {
      container.append(element('div', 'sources', 'Knowledge retrieved with TigerGraph')); this.scroll(); return;
    }
    const details = element('details', 'sources'); details.append(element('summary', '', 'TigerGraph relationships'));
    for (const path of paths) {
      const [from, concept, to] = path.nodes;
      const source = element('div', 'source');
      source.append(element('strong', '', `${titles.get(from!)} → ${concept} → ${titles.get(to!)}`), element('div', '', path.relation));
      details.append(source);
    }
    container.append(details); this.scroll();
  }
  guideButton(container: HTMLElement, steps: ModelPlan['steps'], resolve: (id: string) => HTMLElement | null, onMissing: () => void, beforeStart?: () => void, hooks?: GuideHooks): void {
    const start = button('', 'secondary guide-start', () => { beforeStart?.(); this.guide(steps, resolve, onMissing, hooks); }); start.append(icon('guide'), document.createTextNode(`Show me · ${steps.length} step${steps.length === 1 ? '' : 's'}`)); container.append(start);
  }
  recoveryButton(container: HTMLElement, refresh: () => void): void {
    if (this.recoveries.has(container)) return;
    this.recoveries.add(container); container.append(button('Refresh guide', 'secondary guide-start', refresh));
  }
  reportStepResult(targetId: string, result: GuideStepResult): void { this.guideSession?.reportResult(targetId, result); }
  stopGuide(): void { if (this.transitionStop) this.transitionStop(); else this.guideSession?.stop(); }
  journeyTransition(stop: () => void): void {
    this.clearGuide(false); this.departDock(); this.motion.setPaused(false); this.motion.element.style.opacity = '1'; this.motion.setActivity('waiting'); this.motion.setVisible(true);
    this.panel.hidden = true; this.launcher.hidden = true;
    const card = element('section', 'guide'); card.setAttribute('aria-label', 'Continuing your task'); card.style.right = '16px'; card.style.bottom = '16px';
    card.append(element('div', 'guide-label', 'Continuing your task'), element('p', '', 'Reading the next part of this page…'), button('Open chat', 'secondary', this.handlers.open), button('Stop guidance', 'secondary', stop));
    this.shadow.append(card); this.transitionStop = stop; this.transitionCleanup = () => card.remove();
  }
  offerJourneyResume(goal: string, resume: () => void, dismiss: () => void): void {
    const card = this.message('assistant', `Continue your previous task? ${goal}`), controls = element('div', 'action-foot');
    controls.append(button('Resume previous task', 'primary', () => { controls.remove(); resume(); }), button('Dismiss', 'secondary', () => { controls.remove(); dismiss(); })); card.append(controls);
    this.status('A previous task is available. Open the assistant to resume it.');
  }
  offerJourneyMemory(allow: () => void): void {
    const card = this.message('assistant', 'Allow task resume in this tab? Your task goal and completed control IDs will stay here for up to 30 minutes. Form values, audio and session credentials are excluded.'), controls = element('div', 'action-foot');
    controls.append(button('Allow task resume', 'primary', () => { controls.remove(); allow(); }), button('Not now', 'secondary', () => controls.remove())); card.append(controls);
  }
  action(container: HTMLElement, name: string, reason: string, args: Record<string, unknown>, approve: () => void, decline: () => void): ActionCard {
    const card = element('div', 'action'); const main = element('div', 'action-main');
    main.append(element('div', 'action-title', `Approval required · ${name}`), element('p', 'action-reason', reason));
    const details = element('details', 'sources'); details.append(element('summary', '', 'Review action details'), element('pre', '', JSON.stringify(args, null, 2))); main.append(details);
    const foot = element('div', 'action-foot'); const yes = button('Approve and run', 'primary', approve); const no = button('Decline', 'secondary', decline); const state = element('span', 'action-state');
    foot.append(yes, no, state); card.append(main, foot); container.append(card); this.scroll();
    return {
      state: (text, success) => { yes.disabled = true; no.disabled = true; state.textContent = text; state.dataset.success = String(success === true); },
      executing: () => { yes.disabled = true; no.disabled = true; state.textContent = 'Running approved action…'; },
      finished: (text, success) => { foot.replaceChildren(state); state.textContent = text; state.dataset.success = String(success); this.scroll(); },
      retry: (text, retry) => { state.textContent = text; foot.replaceChildren(state, button('Retry recording result', 'secondary', retry)); this.scroll(); }
    };
  }
  guide(steps: ModelPlan['steps'], resolve: (id: string) => HTMLElement | null, onMissing: () => void, hooks?: GuideHooks): void {
    if (this.opened && this.cursorDocked && this.motion.location !== 'flight') this.alignDock(false, true);
    this.clearGuide(false); if (!steps.length) return;
    this.departDock(); this.motion.setPaused(false); this.motion.setVisible(true);
    const motion = this.motion, card = element('section', 'guide guide-expressive'), surface = element('div', 'guide-surface'), body = element('div', 'guide-body'), beats = new BeatScheduler();
    card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Visual guidance');
    const toolbar = element('div', 'guide-toolbar'), label = element('span', 'guide-label'), stepNumber = element('span', 'guide-step-number'), stepTotal = element('span', 'guide-step-total'), tools = element('div', 'guide-tools');
    label.setAttribute('aria-hidden', 'true'); label.append(document.createTextNode('Step '), stepNumber, document.createTextNode(' '), stepTotal);
    const pause = button('Pause', 'guide-pause', () => { this.handlers.guidePause?.(); session.setPaused(!state?.paused); }); pause.setAttribute('aria-label', 'Pause guide');
    let expandedHelp = false;
    const help = iconButton('Show guidance help', 'help', () => { expandedHelp = !expandedHelp; updateHelp(); schedulePosition(); }); help.setAttribute('aria-expanded', 'false');
    tools.append(pause, help, iconButton('Open chat', 'chat', () => this.open()), iconButton('Stop visual guidance', 'close', () => this.stopGuide())); toolbar.append(label, tools);
    // The visual prefix is decorative. Assistive technology receives the whole
    // instruction once, without a live announcement for each typed character.
    const text = element('p', 'guide-instruction'), accessibleText = element('span', 'guide-instruction-accessible'), hint = element('div', 'guide-hint');
    text.setAttribute('aria-hidden', 'true'); accessibleText.setAttribute('role', 'status'); accessibleText.setAttribute('aria-live', 'polite'); accessibleText.setAttribute('aria-atomic', 'true'); hint.setAttribute('role', 'status');
    const skip = button('Show full', 'guide-skip', () => finishInstruction()); skip.setAttribute('aria-label', 'Show full instruction'); skip.hidden = true; tools.insertBefore(skip, pause);
    const measure = element('span', 'guide-measure'); measure.setAttribute('aria-hidden', 'true');
    const rim = element('span', 'guide-rim'); rim.setAttribute('aria-hidden', 'true');
    const assist = element('div', 'guide-assist'); assist.hidden = true; assist.append(hint); toolbar.append(assist);
    body.append(text, accessibleText); surface.append(body, rim); card.append(surface, toolbar); this.shadow.append(card, measure);
    let state: GuidanceState | null = null, disposed = false, frame = 0, lastIndex = -1, lastNarrated = -1, narration = 0, animateNext = false;
    let cardAnimation: Animation | null = null, observed: HTMLElement | null = null, markReady = false, lastPresented = -1, hasPresented = false, fromChat = true, presentedTarget: HTMLElement | null = null, motionUntil = 0, lastBox = '';
    let reveal: GuidedReveal | null = null, revealTarget: HTMLElement | null = null, revealIndex = -1;
    let labelAnimation: Animation | null = null, labelPending = false, arrivalReady = false, presentationGeneration = 0;
    let instructionFrame = 0, instructionStarted = false, instructionStart = 0, instructionCommit = 0, instructionCount = -1, instruction = '', graphemes: string[] | null = null;
    let sizeDirty = true, cardWidth = 80, cardHeight = 0, placementSide = -1, placement = '';
    card.dataset.gkScrollState = 'ready';
    card.dataset.gkTyping = 'false';
    card.dataset.gkArrival = 'pending';
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => motionPreference.matches;
    const viewport = () => ({ left: window.visualViewport?.offsetLeft ?? 0, top: window.visualViewport?.offsetTop ?? 0, width: window.visualViewport?.width ?? document.documentElement.clientWidth, height: window.visualViewport?.height ?? window.innerHeight });
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
    const queueSize = () => { sizeDirty = true; if (!disposed && !document.hidden && !this.guideChatOpen) schedulePosition(); };
    const updateHelp = () => {
      const interrupted = !!state && (state.paused || state.waiting || state.confirmationPending || state.hostPending || state.attention);
      assist.hidden = !expandedHelp && !interrupted;
      help.setAttribute('aria-expanded', String(expandedHelp)); help.setAttribute('aria-label', expandedHelp ? 'Hide guidance help' : 'Show guidance help');
    };
    const updateGuideInk = (target: HTMLElement | null) => {
      // Read only authored CSS background colors on bounded local ancestry.
      // No screenshots, text, values or screenshot-like sampling leave the page.
      let dark = false;
      for (let node = target, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
        const color = getComputedStyle(node).backgroundColor.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
        if (!color || Number(color[4] ?? 1) < .85) continue;
        dark = (Number(color[1]) * .2126 + Number(color[2]) * .7152 + Number(color[3]) * .0722) / 255 < .4; break;
      }
      for (const [name, value] of [['--gk-guide-ink', dark ? '#ffca54' : '#a96900'], ['--gk-guide-badge', '#f2b544'], ['--gk-guide-text', '#352707']]) if (this.host.style.getPropertyValue(name) !== value) this.host.style.setProperty(name, value!);
    };
    const settleStepLabel = () => {
      labelAnimation?.cancel(); labelAnimation = null; labelPending = false; label.style.opacity = '1'; card.dataset.gkStepState = 'presented';
    };
    const prepareStepLabel = () => {
      labelAnimation?.cancel(); labelAnimation = null; labelPending = !reduced(); label.style.opacity = labelPending ? '0' : '1'; card.dataset.gkStepState = labelPending ? 'pending' : 'presented';
    };
    const presentStepLabel = () => {
      if (!labelPending) return;
      labelPending = false; label.style.opacity = '1'; card.dataset.gkStepState = 'presented';
      if (!reduced()) labelAnimation = label.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };
    const finishInstruction = () => {
      cancelAnimationFrame(instructionFrame); instructionFrame = 0; instructionStarted = true;
      text.textContent = instruction; card.dataset.gkTyping = 'false'; skip.hidden = true;
      queueSize();
    };
    const settlePresentation = () => { finishInstruction(); settleStepLabel(); cardAnimation?.cancel(); cardAnimation = null; };
    const prepareInstruction = (value: string) => {
      cancelAnimationFrame(instructionFrame); instructionFrame = 0;
      instruction = value; graphemes = instructionGraphemes(value); instructionStarted = false; instructionCount = -1;
      text.textContent = ''; accessibleText.textContent = `Step ${state!.index + 1} of ${state!.total}. ${value}`; text.scrollTop = 0; card.dataset.gkTyping = 'false'; skip.hidden = true; placementSide = -1;
      if (reduced() || !graphemes?.length) finishInstruction();
      else queueSize();
    };
    const startInstruction = () => {
      if (disposed || !state || !arrivalReady || state.paused || this.guideChatOpen || document.hidden || reveal?.active) return;
      presentStepLabel();
      if (instructionStarted) return;
      instructionStarted = true;
      if (reduced() || !graphemes?.length) { finishInstruction(); return; }
      card.dataset.gkTyping = 'true'; skip.hidden = false; instructionStart = performance.now(); instructionCommit = 0;
      const parts = graphemes, duration = instructionDuration(parts.length);
      const tick = (now: number) => {
        instructionFrame = 0;
        if (disposed) return;
        if (document.hidden || state?.paused || this.guideChatOpen || reduced()) { settlePresentation(); return; }
        const progress = Math.min(1, (now - instructionStart) / duration), count = Math.max(1, Math.floor(parts.length * progress));
        // One coalesced layout at most every 40 ms, never a layout per letter.
        if (progress === 1 || now - instructionCommit >= 40) {
          instructionCommit = now;
          if (count !== instructionCount) { instructionCount = count; text.textContent = parts.slice(0, count).join(''); queueSize(); }
        }
        if (progress < 1) instructionFrame = requestAnimationFrame(tick); else finishInstruction();
      };
      instructionFrame = requestAnimationFrame(tick); queueSize();
    };
    const measureCard = (area: ReturnType<typeof viewport>) => {
      if (!sizeDirty) return false;
      sizeDirty = false;
      const maximum = Math.max(1, Math.min(320, area.width - 24)), minimum = Math.min(80, maximum);
      // Only the current visual prefix participates in measurement. There is no
      // hidden final paragraph reserving its eventual width or height.
      measure.textContent = text.textContent;
      const width = Math.ceil(clamp(measure.getBoundingClientRect().width + 28, minimum, maximum));
      body.style.width = `${Math.max(1, width - 2)}px`; body.style.maxHeight = `${Math.max(100, area.height - 26)}px`;
      const height = Math.ceil(body.getBoundingClientRect().height + 2);
      const changed = width !== cardWidth || height !== cardHeight;
      cardWidth = width; cardHeight = height; card.style.width = `${width}px`; card.style.height = `${height}px`;
      return changed;
    };
    let obstacleCache: { target: HTMLElement; key: string; at: number; boxes: PlacementBox[] } | null = null;
    const publicObstacles = (current: HTMLElement, area: ReturnType<typeof viewport>): PlacementBox[] => {
      const center = current.getBoundingClientRect(), key = `${center.left},${center.top},${center.width},${center.height},${area.left},${area.top},${area.width},${area.height}`, now = performance.now();
      if (obstacleCache?.target === current && obstacleCache.key === key && now - obstacleCache.at < 250) return obstacleCache.boxes;
      const elements = new Set<HTMLElement>();
      for (const step of steps.slice(0, 24)) { const element = resolve(step.targetId); if (element) elements.add(element); }
      try { for (const element of hooks?.nearbyTargets?.().slice(0, 24) ?? []) elements.add(element); } catch { /* Optional host geometry must not stop guidance. */ }
      const boxes: PlacementBox[] = [];
      for (const element of elements) {
        if (element === current || !isSafeTarget(element)) continue;
        const box = revealedBounds(element);
        if (!box) continue;
        boxes.push({ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top });
      }
      const result = boxes.sort((a, b) => Math.hypot(a.left + a.width / 2 - center.left, a.top + a.height / 2 - center.top) - Math.hypot(b.left + b.width / 2 - center.left, b.top + b.height / 2 - center.top)).slice(0, 22);
      obstacleCache = { target: current, key, at: now, boxes: result }; return result;
    };
    const placeToolbar = (area: ReturnType<typeof viewport>, target: PlacementBox | null, nearby: PlacementBox[]): PlacementBox[] => {
      toolbar.style.maxWidth = `${Math.max(1, area.width - 24)}px`;
      assist.style.maxWidth = `${Math.max(1, area.width - 24)}px`; assist.style.maxHeight = `${Math.max(1, area.height - 80)}px`;
      const position = placeGuidanceControls({ width: toolbar.offsetWidth, height: toolbar.offsetHeight }, area, target, nearby, assist.hidden ? undefined : { width: assist.offsetWidth, height: assist.offsetHeight });
      toolbar.style.left = `${position.left}px`; toolbar.style.top = `${position.top}px`; toolbar.style.right = 'auto'; toolbar.style.bottom = 'auto';
      if (position.assist) {
        assist.style.maxHeight = `${position.assist.height}px`; assist.style.left = `${position.assist.left - position.left}px`; assist.style.top = `${position.assist.top - position.top}px`; assist.style.right = 'auto'; assist.style.bottom = 'auto';
      }
      const strip = toolbar.getBoundingClientRect(), feedback = assist.hidden ? null : assist.getBoundingClientRect();
      // Reserve actual laid-out bounds before nearby controls, so the helper's
      // bounded obstacle list can never drop essential status or stop controls.
      return [{ left: strip.left, top: strip.top, width: strip.width, height: strip.height }, ...(feedback?.width && feedback.height ? [{ left: feedback.left, top: feedback.top, width: feedback.width, height: feedback.height }] : [])];
    };
    const position = () => {
      frame = 0; if (disposed || this.guideChatOpen || !state) return;
      if (document.hidden) { reveal?.cancel(); settlePresentation(); motion.setVisible(false); return; }
      const area = viewport(), edge = 12, width = area.width, height = area.height;
      const oldCard = card.getBoundingClientRect(), resized = measureCard(area);
      card.style.maxHeight = `${Math.max(100, height - edge * 2)}px`;
      const current = state.target ? resolve(state.step.targetId) : null;
      if (current !== state.target) { session.refresh(); return; }
      updateGuideInk(current);
      beginReveal();
      const rect = current?.getBoundingClientRect(), clipped = current ? revealedBounds(current) : null;
      const targetVisible = !!current && !!clipped && targetRevealed(current);
      if (!state.paused && !state.waiting) hint.textContent = reveal?.active ? 'Scrolling to this step…' : targetVisible ? state.hint : 'Scroll to this control to continue. I’ll point when it’s visible.';
      updateHelp();
      const nearby = current ? publicObstacles(current, area) : [], toolbarBoxes = placeToolbar(area, targetVisible && rect ? rect : null, nearby);
      lastBox = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '';
      let cardLeft = area.left + width - cardWidth - edge, cardTop = area.top + height - cardHeight - edge;
      if (rect && clipped && !reveal?.active) {
        const left = clamp(clipped.left - 5, area.left + 3, area.left + width - 3), top = clamp(clipped.top - 5, area.top + 3, area.top + height - 3);
        const right = clamp(clipped.right + 5, left, area.left + width - 3), bottom = clamp(clipped.bottom + 5, top, area.top + height - 3);
        const visible = targetVisible && right - left >= .25 && bottom - top >= .25;
        const box = { left, top, width: right - left, height: bottom - top };
        if (visible) narrate();
        if (markReady && visible) {
          if (lastPresented !== state.index || presentedTarget !== current) {
            const index = state.index, target = current, generation = ++presentationGeneration;
            // Set ownership before present(): reduced motion can complete now.
            lastPresented = index; presentedTarget = current;
            motion.present({ id: `step-${index}-${state.step.targetId}`, kind: state.step.annotation ?? 'target', box, index: index + 1 }, { animate: !reduced(), first: fromChat || !hasPresented, onReady: () => {
              if (disposed || !target || !isSafeTarget(target) || generation !== presentationGeneration || state?.index !== index || state.target !== target || state.paused || this.guideChatOpen || document.hidden || resolve(state.step.targetId) !== target) return;
              arrivalReady = true; card.dataset.gkArrival = 'ready'; schedulePosition();
            } });
            fromChat = false; hasPresented = true;
          } else motion.updateBounds(box);
        }
        if (visible && arrivalReady) startInstruction();
        motion.setVisible(visible && !state.paused);
        const badge = motion.element.querySelector('[data-gk-step-badge]')?.getBoundingClientRect();
        const reserved = [...toolbarBoxes, ...(badge?.width && badge.height ? [{ left: badge.left - 3, top: badge.top - 3, width: badge.width + 6, height: badge.height + 6 }] : []), ...nearby];
        const position = placeGuidanceLabel(rect, { width: cardWidth, height: cardHeight }, area, reserved, placementSide);
        cardLeft = position.left; cardTop = position.top; placementSide = position.anchor;
      } else motion.setVisible(false);
      card.style.left = `${cardLeft}px`; card.style.top = `${cardTop}px`;
      const destination = `${cardLeft},${cardTop},${cardWidth},${cardHeight}`;
      if ((resized || animateNext) && placement && destination !== placement && !reduced() && !state.paused && oldCard.width) {
        // Animate actual dimensions, never scale glyphs. Retarget from the
        // current rendered bounds so successive batches remain continuous.
        cardAnimation?.cancel(); cardAnimation = card.animate([
          { left: `${oldCard.left}px`, top: `${oldCard.top}px`, width: `${oldCard.width}px`, height: `${oldCard.height}px` },
          { left: `${cardLeft}px`, top: `${cardTop}px`, width: `${cardWidth}px`, height: `${cardHeight}px` }
        ], { duration: resized ? 140 : 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      placement = destination;
      animateNext = false;
      // Follow actual host transitions/WAAPI transforms only while they run.
      // There is no animation-frame loop in a settled or hidden page.
      if (!document.hidden && current) {
        let moving = false;
        for (let ancestor: HTMLElement | null = current; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.getAnimations().some(animation => animation.playState === 'running')) { moving = true; break; }
        }
        if (moving) { if (!motionUntil) motionUntil = performance.now() + 10000; if (performance.now() < motionUntil) schedulePosition(); }
        else motionUntil = 0;
      }
    };
    const schedulePosition = (animate = false) => { animateNext ||= animate; if (!frame && !disposed) frame = requestAnimationFrame(position); };
    const reposition = () => { obstacleCache = null; cardAnimation?.cancel(); sizeDirty = true; schedulePosition(); };
    const hostMotion = (event: Event) => {
      if (event.target instanceof Element && state?.target && event.target.contains(state.target)) { motionUntil = performance.now() + 10000; reposition(); }
    };
    const visibility = () => {
      // Visibility suspends the retained flight, rather than replacing it. Keep
      // its guarded onReady valid so the label can appear after that flight
      // resumes; pause/chat/step changes still invalidate their presentations.
      if (document.hidden) { settlePresentation(); cancelAnimationFrame(frame); frame = 0; }
      if (this.cursorDocked) return;
      if (document.hidden) { reveal?.cancel(); motion.setVisible(false); } else schedulePosition();
    };
    const preferenceChanged = () => { if (reduced()) settlePresentation(); sizeDirty = true; schedulePosition(); };
    const narrate = () => {
      if (!state || state.paused || state.waiting || reveal?.active || lastNarrated === state.index || this.guideChatOpen) return;
      const update = state; lastNarrated = update.index; const index = update.index, beat = ++narration;
      const currentBeat = () => !disposed && narration === beat && state?.index === index && !state.paused && !this.guideChatOpen && !reveal?.active && resolve(update.step.targetId) === update.target;
      beats.start(events => {
        motion.setActivity('waiting');
        const queued = this.handlers.guideStep?.(update.step.text, {
          onStart: () => { if (currentBeat()) { motion.setActivity('speaking'); events.onStart(); } },
          onEnd: () => { if (currentBeat()) { motion.setActivity('pointing'); events.onEnd(); } },
          onError: () => { if (currentBeat()) { motion.setActivity('pointing'); events.onError(); } }
        }) ?? false;
        if (!queued) motion.setActivity('pointing'); return queued;
      }, reason => {
        if (!currentBeat()) return;
        markReady = true; if (reason === 'unavailable') { this.handlers.guidePause?.(); motion.setActivity('pointing'); } schedulePosition();
      });
    };
    const beginReveal = () => {
      const update = state;
      if (!update?.target || update.waiting || update.paused || this.guideChatOpen || document.hidden || revealIndex === update.index && revealTarget === update.target) return;
      revealIndex = update.index; revealTarget = update.target;
      const index = update.index, target = update.target;
      reveal = new GuidedReveal(target, () => resolve(update.step.targetId), () => !disposed && state?.index === index && state.target === target && !state.paused && !this.guideChatOpen, reduced, result => {
        if (disposed || state?.index !== index || state.target !== target) return;
        card.dataset.gkScrollState = result; hint.textContent = state.hint; schedulePosition();
      });
      reveal.start();
      if (reveal.active) { card.dataset.gkScrollState = 'revealing'; hint.textContent = 'Scrolling to this step…'; motion.setVisible(false); }
    };
    // WAAPI-only movement emits no DOM mutation or CSS transition event. A
    // four-Hz local check notices it and enables frame tracking while moving.
    const groundingPoll = setInterval(() => {
      if (disposed || document.hidden || this.guideChatOpen || !state || state.paused) return;
      const target = resolve(state.step.targetId);
      if (target !== state.target) { session.refresh(); return; }
      const rect = target?.getBoundingClientRect(), box = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '';
      if (box !== lastBox) schedulePosition();
    }, 250);
    const resize = new ResizeObserver(entries => { if (entries.some(entry => entry.target !== card)) sizeDirty = true; schedulePosition(); });
    resize.observe(document.documentElement); resize.observe(card); resize.observe(body);
    const mutations = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-guidekit-root]')))) { obstacleCache = null; schedulePosition(); } });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'] });
    const session = new GuidanceSession(steps, resolve, {
      onUpdate: update => {
        if (disposed) return;
        hooks?.state?.(update);
        const changedStep = lastIndex !== update.index, changedTarget = state?.target !== update.target, resuming = state?.paused && !update.paused; state = update;
        // An explicit Resume can finish a reveal canceled by Pause/Open chat.
        // Geometry updates and manual-scroll interruptions never rearm it.
        if (resuming && card.dataset.gkScrollState === 'cancelled') { revealTarget = null; revealIndex = -1; }
        const ownsMotion = !this.guideChatOpen && !this.cursorDocked;
        if (changedStep || changedTarget || update.waiting) { reveal?.cancel(); ++narration; ++presentationGeneration; markReady = false; lastPresented = -1; lastNarrated = -1; beats.cancel(); if (ownsMotion) motion.erase({ animate: false, preserveCursor: true }); this.handlers.guidePause?.(); }
        const focusFirst = lastIndex < 0 && (document.activeElement === this.host || document.activeElement === document.body);
        stepNumber.textContent = String(update.index + 1); stepTotal.textContent = `of ${update.total}`; hint.textContent = update.hint;
        if (changedStep || changedTarget) { arrivalReady = false; card.dataset.gkArrival = 'pending'; }
        if (changedStep) { prepareStepLabel(); prepareInstruction(update.step.text); }
        if (update.paused || update.waiting) settlePresentation();
        sizeDirty = true;
        pause.textContent = update.paused ? 'Resume' : 'Pause'; pause.setAttribute('aria-label', update.paused ? 'Resume guide' : 'Pause guide');
        card.dataset.paused = String(update.paused); card.dataset.waiting = String(update.waiting); if (ownsMotion) { motion.setPaused(update.paused); motion.element.style.opacity = update.paused ? '.45' : '1'; }
        updateHelp();
        if (observed !== update.target) {
          resize.disconnect(); resize.observe(document.documentElement); resize.observe(card); resize.observe(body); observed = update.target;
          for (let ancestor = observed, depth = 0; ancestor && depth < 64; ancestor = ancestor.parentElement, depth++) resize.observe(ancestor);
        }
        if (!this.guideChatOpen) { this.panel.hidden = true; this.launcher.hidden = true; card.hidden = false; }
        if (focusFirst && update.target?.matches('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')) update.target.focus({ preventScroll: true });
        beginReveal();
        if (update.paused) { reveal?.cancel(); ++narration; ++presentationGeneration; lastNarrated = -1; markReady = false; lastPresented = -1; beats.cancel(); if (ownsMotion) motion.erase({ animate: false, preserveCursor: true }); this.handlers.guidePause?.(); }
        schedulePosition(changedStep && lastIndex >= 0); lastIndex = update.index;
      },
      onFinish: result => {
        if (disposed) return;
        this.clearGuide(false); this.handlers.guidePause?.();
        if (hooks?.finish?.(result)) return;
        this.restoreChat();
        if (result.reason === 'missing') onMissing();
        else if (result.reason === 'completed') { this.status(result.verified ? 'The website confirmed the result. Guidance finished.' : 'Guidance finished. Check the website for confirmation.'); this.handlers.guideFinish?.(result); }
        else this.status('Guidance stopped. You can keep chatting.');
      },
      onComplete: (index, step, evidence) => hooks?.progress?.(index, step, evidence)
    });
    this.guideSession = session; this.guideChatOpen = false; this.resumeGuide.hidden = true;
    this.guideVisibility = visible => { card.hidden = !visible; if (!visible) { ++presentationGeneration; settlePresentation(); reveal?.cancel(); if (!this.cursorDocked) motion.setVisible(false); fromChat = true; beats.cancel(); } else schedulePosition(); };
    this.guideFocus = () => {
      if ((document.activeElement === this.host || document.activeElement === document.body) && state?.target && resolve(state.step.targetId) === state.target && state.target.matches('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')) state.target.focus({ preventScroll: true });
    };
    this.guideCleanup = () => {
      disposed = true; reveal?.cancel(); session.destroy(); beats.cancel(); motion.erase({ animate: false, preserveCursor: true }); resize.disconnect(); mutations.disconnect(); clearInterval(groundingPoll); cancelAnimationFrame(frame); cancelAnimationFrame(instructionFrame); cardAnimation?.cancel(); labelAnimation?.cancel();
      document.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition);
      for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.removeEventListener(event, hostMotion, true);
      document.removeEventListener('visibilitychange', visibility); motionPreference.removeEventListener('change', preferenceChanged); card.remove(); measure.remove();
    };
    document.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition); window.visualViewport?.addEventListener('resize', reposition); window.visualViewport?.addEventListener('scroll', reposition);
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.addEventListener(event, hostMotion, true);
    document.addEventListener('visibilitychange', visibility);
    motionPreference.addEventListener('change', preferenceChanged);
    session.start();
  }
  clearGuide(restoreChat = true): void {
    const hadGuide = !!this.guideSession || !!this.transitionCleanup; this.guideSession = null;
    this.transitionCleanup?.(); this.transitionCleanup = null; this.transitionStop = null;
    const cleanup = this.guideCleanup; this.guideCleanup = null; cleanup?.(); this.guideVisibility = null; this.guideFocus = null; this.guideChatOpen = false; this.resumeGuide.hidden = true;
    if (hadGuide && restoreChat) this.restoreChat();
  }
  destroy(): void {
    this.destroyed = true; this.clearGuide(false); this.departDock(); this.motion.destroy(); this.dockResize.disconnect();
    window.removeEventListener('resize', this.dockLayout); window.visualViewport?.removeEventListener('resize', this.dockLayout); window.visualViewport?.removeEventListener('scroll', this.dockLayout); document.removeEventListener('visibilitychange', this.dockLayout); this.host.remove();
  }
  private cursorActivity(): void { if (this.cursorDocked && !this.destroyed) this.motion.setActivity(this.recording || this.speaking ? 'speaking' : this.isBusy ? 'waiting' : 'pointing'); }
  private restoreChat(): void { this.isOpen = true; this.panel.hidden = false; this.launcher.hidden = true; this.scroll(); this.dockCursor(true); }
  private departDock(): void { this.cursorDocked = false; this.lastDock = null; cancelAnimationFrame(this.dockFrame); this.dockFrame = 0; }
  private dockCursor(animate: boolean): void {
    if (this.destroyed || !this.opened) return;
    this.cursorDocked = true; this.motion.setPaused(false); this.motion.element.style.opacity = '1'; this.cursorActivity(); this.alignDock(animate, true);
    this.dockUntil = performance.now() + 220; this.dockLayout();
  }
  private alignDock(animate: boolean, force = false): void {
    if (this.destroyed || !this.cursorDocked || !this.opened || document.hidden || !this.cursorDock.getClientRects().length) return;
    const rect = this.cursorDock.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (force || !this.lastDock || Math.hypot(point.x - this.lastDock.x, point.y - this.lastDock.y) > .01) { this.motion.dock(point, { animate }); this.lastDock = point; }
    this.motion.setVisible(true);
  }
  private dockLayout = (): void => {
    if (this.destroyed || !this.cursorDocked || !this.opened || document.hidden) return;
    this.alignDock(this.motion.location === 'flight');
    if ((performance.now() < this.dockUntil || this.panel.getAnimations().some(animation => animation.playState === 'running')) && !this.dockFrame) {
      this.dockFrame = requestAnimationFrame(() => { this.dockFrame = 0; this.dockLayout(); });
    }
  };
  private scroll(): void { requestAnimationFrame(() => { this.messages.scrollTop = this.messages.scrollHeight; }); }
}
