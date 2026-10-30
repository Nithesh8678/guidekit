import type { Citation, ModelPlan, PublicAgent, RunResult } from '../../contracts/src/index';
import { GuidanceSession, type GuidanceResult, type GuidanceState } from './guidance';
import type { GuideStepResult } from './types';
import { BeatScheduler, type SpeechEvents } from './beats';
import { MotionDirector, type MotionPoint } from './motion';
import type { VoiceSettingsHandlers, VoiceSettingsState } from './voices';

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
.highlight{position:fixed;border:2px solid var(--gk-accent);border-radius:10px;box-shadow:0 0 0 5px #365cf51a,0 0 0 9999px #111d3a08;pointer-events:none;transform-origin:top left}.guide{pointer-events:auto;position:fixed;width:290px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #dbe3f6;box-shadow:0 12px 45px #17213b26;border-radius:16px;padding:14px;animation:gk-appear .18s ease-out}.guide-header{display:flex;align-items:center;justify-content:space-between;gap:8px}.guide-label{color:var(--gk-accent);font-size:11px;font-weight:700}.guide p{font-size:13px;margin:10px 0 9px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:90px;overflow:auto}.guide-controls{display:flex;align-items:center;justify-content:space-between;gap:6px}.guide .icon{width:25px;height:25px}.guide-hint{font-size:10px;line-height:1.4;color:#71809a;margin:8px 0 12px}.guide-tools{display:flex;gap:4px}.guide-auto{font-size:10px;border-radius:7px;padding:5px 8px;color:#6d7890;background:#f0f3f8}.guide-auto[aria-pressed=true]{background:#edf1ff;color:var(--gk-accent)}.guide-progress{display:block;width:100%;height:3px;border:0;border-radius:3px;overflow:hidden;margin-top:9px;appearance:none;accent-color:var(--gk-accent)}.guide-progress::-webkit-progress-bar{background:#edf0f7}.guide-progress::-webkit-progress-value{background:var(--gk-accent);transition:width .18s}.guide-progress::-moz-progress-bar{background:var(--gk-accent)}.guide[data-paused=true] .guide-label{color:#77839b}.guide[data-waiting=true] .guide-hint{color:#926144}.guide-resume{display:block;margin:6px 18px 12px;width:calc(100% - 36px);text-align:left}.guide-pause{font-size:11px;padding:7px 8px;background:transparent;color:#66748c;border-radius:7px}.guide-pause:hover{background:#f0f3fa}
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
    const motion = this.motion, card = element('section', 'guide'), beats = new BeatScheduler();
    card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Visual guidance');
    const head = element('div', 'guide-header'), label = element('span', 'guide-label'), tools = element('div', 'guide-tools');
    tools.append(iconButton('Open chat', 'chat', () => this.open()), iconButton('Stop visual guidance', 'close', () => this.stopGuide())); head.append(label, tools);
    const progress = element('progress', 'guide-progress'); progress.setAttribute('aria-label', 'Guide progress');
    const text = element('p'), hint = element('div', 'guide-hint'); text.setAttribute('aria-live', 'polite'); hint.setAttribute('role', 'status');
    const controls = element('div', 'guide-controls');
    const previous = button('Back', 'secondary', () => session.back()), next = button('Next', 'primary', () => session.next());
    const automatic = button('Auto', 'guide-auto', () => session.setAutomatic(!state?.automatic)); automatic.setAttribute('aria-label', 'Automatic progress'); automatic.setAttribute('aria-pressed', 'true');
    const pause = button('Pause', 'guide-pause', () => { this.handlers.guidePause?.(); session.setPaused(!state?.paused); }); pause.setAttribute('aria-label', 'Pause guide');
    controls.append(previous, automatic, pause, next); card.append(head, progress, text, hint, controls); this.shadow.append(card);
    let state: GuidanceState | null = null, disposed = false, frame = 0, lastIndex = -1, lastNarrated = -1, narration = 0, animateNext = false;
    let cardAnimation: Animation | null = null, observed: HTMLElement | null = null, markReady = false, lastPresented = -1, hasPresented = false, fromChat = true, presentedTarget: HTMLElement | null = null, motionUntil = 0, lastBox = '';
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const viewport = () => ({ left: window.visualViewport?.offsetLeft ?? 0, top: window.visualViewport?.offsetTop ?? 0, width: window.visualViewport?.width ?? document.documentElement.clientWidth, height: window.visualViewport?.height ?? window.innerHeight });
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
    const position = () => {
      frame = 0; if (disposed || this.guideChatOpen || !state) return;
      if (document.hidden) { motion.setVisible(false); return; }
      const area = viewport(), edge = 12, width = area.width, height = area.height;
      card.style.maxHeight = `${Math.max(100, height - edge * 2)}px`; card.style.overflowY = 'auto';
      const current = state.target ? resolve(state.step.targetId) : null;
      if (current !== state.target) { session.refresh(); return; }
      const rect = current?.getBoundingClientRect();
      lastBox = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '';
      const oldCard = card.getBoundingClientRect();
      const cardWidth = card.offsetWidth, cardHeight = card.offsetHeight;
      let cardLeft = area.left + width - cardWidth - edge, cardTop = area.top + height - cardHeight - edge;
      if (rect) {
        const left = clamp(rect.left - 5, area.left + 3, area.left + width - 3), top = clamp(rect.top - 5, area.top + 3, area.top + height - 3);
        const right = clamp(rect.right + 5, left, area.left + width - 3), bottom = clamp(rect.bottom + 5, top, area.top + height - 3);
        const visible = rect.bottom >= area.top && rect.top <= area.top + height && rect.right >= area.left && rect.left <= area.left + width && right - left >= .25 && bottom - top >= .25;
        const box = { left, top, width: right - left, height: bottom - top };
        if (markReady && visible) {
          if (lastPresented !== state.index || presentedTarget !== current) {
            motion.present({ id: `step-${state.index}-${state.step.targetId}`, kind: state.step.annotation ?? 'target', box, index: state.index + 1 }, { animate: !reduced(), first: fromChat || !hasPresented });
            fromChat = false; hasPresented = true; lastPresented = state.index; presentedTarget = current;
          } else motion.updateBounds(box);
        }
        motion.setVisible(visible);
        const candidates = [[rect.right + 14, rect.top], [rect.left - cardWidth - 14, rect.top], [rect.left, rect.bottom + 14], [rect.left, rect.top - cardHeight - 14]];
        let best = Infinity;
        for (const candidate of candidates) {
          const x = clamp(candidate[0]!, area.left + edge, area.left + width - cardWidth - edge), y = clamp(candidate[1]!, area.top + edge, area.top + height - cardHeight - edge);
          const overlap = Math.max(0, Math.min(x + cardWidth, right + 7) - Math.max(x, left - 7)) * Math.max(0, Math.min(y + cardHeight, bottom + 7) - Math.max(y, top - 7));
          const score = overlap * 1000 + Math.hypot(x - candidate[0]!, y - candidate[1]!);
          if (score < best) { best = score; cardLeft = x; cardTop = y; }
        }
      } else motion.setVisible(false);
      card.style.left = `${cardLeft}px`; card.style.top = `${cardTop}px`;
      if (animateNext && lastIndex >= 0 && !reduced() && oldCard.width) {
        cardAnimation?.cancel(); cardAnimation = card.animate([{ transform: `translate(${oldCard.left - cardLeft}px,${oldCard.top - cardTop}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
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
    const reposition = () => { cardAnimation?.cancel(); schedulePosition(); };
    const hostMotion = (event: Event) => {
      if (event.target instanceof Element && state?.target && event.target.contains(state.target)) { motionUntil = performance.now() + 10000; reposition(); }
    };
    const visibility = () => { if (this.cursorDocked) return; motion.setVisible(!document.hidden && !this.guideChatOpen && !!state?.target); if (!document.hidden) schedulePosition(); };
    // WAAPI-only movement emits no DOM mutation or CSS transition event. A
    // four-Hz local check notices it and enables frame tracking while moving.
    const groundingPoll = setInterval(() => {
      if (disposed || document.hidden || this.guideChatOpen || !state || state.paused) return;
      const target = resolve(state.step.targetId);
      if (target !== state.target) { session.refresh(); return; }
      const rect = target?.getBoundingClientRect(), box = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '';
      if (box !== lastBox) schedulePosition();
    }, 250);
    const resize = new ResizeObserver(() => schedulePosition());
    resize.observe(document.documentElement);
    const mutations = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-guidekit-root]')))) schedulePosition(); });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'] });
    const session = new GuidanceSession(steps, resolve, {
      onUpdate: update => {
        if (disposed) return;
        hooks?.state?.(update);
        const changedStep = lastIndex !== update.index; state = update;
        const ownsMotion = !this.guideChatOpen && !this.cursorDocked;
        if (changedStep || update.waiting) { ++narration; markReady = false; lastPresented = -1; beats.cancel(); if (ownsMotion) motion.erase({ animate: false, preserveCursor: true }); this.handlers.guidePause?.(); if (update.waiting) lastNarrated = -1; }
        const focusFirst = lastIndex < 0 && (document.activeElement === this.host || document.activeElement === document.body);
        label.textContent = `Step ${update.index + 1} of ${update.total}`; text.textContent = update.step.text; hint.textContent = update.hint;
        progress.max = update.total; progress.value = update.completed; previous.disabled = update.index === 0;
        next.textContent = update.index === update.total - 1 ? 'Finish guide' : 'Next';
        automatic.setAttribute('aria-pressed', String(update.automatic)); pause.textContent = update.paused ? 'Resume' : 'Pause'; pause.setAttribute('aria-label', update.paused ? 'Resume guide' : 'Pause guide');
        card.dataset.paused = String(update.paused); card.dataset.waiting = String(update.waiting); if (ownsMotion) { motion.setPaused(update.paused); motion.element.style.opacity = update.paused ? '.45' : '1'; }
        if (observed !== update.target) { if (observed) resize.unobserve(observed); observed = update.target; if (observed) resize.observe(observed); }
        if (!this.guideChatOpen) { this.panel.hidden = true; this.launcher.hidden = true; card.hidden = false; }
        if (focusFirst && update.target?.matches('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')) update.target.focus({ preventScroll: true });
        if (changedStep && update.target && !this.guideChatOpen) {
          const rect = update.target.getBoundingClientRect(), area = viewport();
          if (rect.top < area.top + 10 || rect.bottom > area.top + area.height - 10 || rect.left < area.left || rect.right > area.left + area.width) update.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'instant' : 'smooth' });
        }
        if (update.paused) { ++narration; lastNarrated = -1; markReady = false; lastPresented = -1; beats.cancel(); if (ownsMotion) motion.erase({ animate: false, preserveCursor: true }); this.handlers.guidePause?.(); }
        else if (!update.waiting && lastNarrated !== update.index && !this.guideChatOpen) {
          lastNarrated = update.index; const index = update.index, beat = ++narration;
          const currentBeat = () => !disposed && narration === beat && state?.index === index && !state.paused && !this.guideChatOpen;
          beats.start(events => {
            motion.setActivity('waiting');
            const queued = this.handlers.guideStep?.(update.step.text, {
              onStart: () => { if (currentBeat()) { motion.setActivity('speaking'); events.onStart(); } },
              onEnd: () => { if (currentBeat()) { motion.setActivity('pointing'); events.onEnd(); } },
              onError: () => { if (currentBeat()) { motion.setActivity('pointing'); events.onError(); } }
            }) ?? false;
            if (!queued) motion.setActivity('pointing'); return queued;
          }, reason => {
            if (disposed || state?.index !== index || state.paused || this.guideChatOpen) return;
            markReady = true; if (reason === 'unavailable') { this.handlers.guidePause?.(); motion.setActivity('pointing'); } schedulePosition();
          });
        }
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
    this.guideVisibility = visible => { card.hidden = !visible; if (!this.cursorDocked) motion.setVisible(visible); if (!visible) { fromChat = true; beats.cancel(); } else schedulePosition(); };
    this.guideFocus = () => {
      if ((document.activeElement === this.host || document.activeElement === document.body) && state?.target && resolve(state.step.targetId) === state.target && state.target.matches('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')) state.target.focus({ preventScroll: true });
    };
    this.guideCleanup = () => {
      disposed = true; session.destroy(); beats.cancel(); motion.erase({ animate: false, preserveCursor: true }); resize.disconnect(); mutations.disconnect(); clearInterval(groundingPoll); cancelAnimationFrame(frame); cardAnimation?.cancel();
      document.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition);
      for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.removeEventListener(event, hostMotion, true);
      document.removeEventListener('visibilitychange', visibility); card.remove();
    };
    document.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition); window.visualViewport?.addEventListener('resize', reposition); window.visualViewport?.addEventListener('scroll', reposition);
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.addEventListener(event, hostMotion, true);
    document.addEventListener('visibilitychange', visibility);
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
