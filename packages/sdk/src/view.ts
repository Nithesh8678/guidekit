import type { Citation, ModelPlan, PublicAgent } from '../../contracts/src/index';

const styles = `
:host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17213b;font-size:14px;line-height:1.5;color-scheme:light;--gk-accent:#365cf5}
*{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.5}button:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #a7b8ff;outline-offset:3px}button{border:0}svg{width:18px;height:18px;flex-shrink:0} [hidden]{display:none!important}
.launcher{pointer-events:auto;position:fixed;right:24px;bottom:24px;display:flex;align-items:center;gap:10px;background:var(--gk-accent);color:#fff;border-radius:40px;padding:15px 19px;font-weight:650;box-shadow:0 5px 20px #23386838;transition:transform .18s,box-shadow .18s}.launcher:hover{transform:translateY(-2px);box-shadow:0 8px 24px #23386845}
.panel{pointer-events:auto;position:fixed;right:24px;bottom:24px;width:390px;max-width:calc(100vw - 32px);height:590px;max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#fff;border:1px solid #dfe5f0;border-radius:20px;box-shadow:0 20px 80px #17213b26,0 2px 10px #17213b14;overflow:hidden;animation:gk-appear .16s ease-out}
@keyframes gk-appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.header{display:flex;gap:11px;align-items:center;padding:18px;border-bottom:1px solid #edf0f7;background:#fff}.mark{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;background:var(--gk-accent);border-radius:12px;color:#fff}.identity{flex:1;min-width:0}.name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.company{font-size:11px;color:#6c7890;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon{display:flex;align-items:center;justify-content:center;background:transparent;color:#6c7890;border-radius:8px;width:32px;height:32px;flex-shrink:0}.icon:hover{background:#f0f3fa;color:#17213b}.icon[aria-pressed=true]{background:#eef2ff;color:var(--gk-accent)}
.messages{padding:20px 18px 8px;overflow-y:auto;flex:1;overscroll-behavior:contain;scrollbar-width:thin;background:linear-gradient(#fafbfe,#fff 100px)}.message{margin-bottom:20px;font-size:13px;overflow-wrap:anywhere}.message.user{background:#eef2ff;padding:11px 14px;border-radius:14px 14px 3px 14px;margin-left:32px}.message.assistant{padding-right:8px}.author{text-transform:uppercase;letter-spacing:.1em;font-weight:700;font-size:9px;color:#71809c;margin-bottom:7px}.content{white-space:pre-wrap}.message.error{border-left:3px solid #df7552;padding-left:12px;color:#74452f}.sources{margin-top:12px;font-size:11px;color:#60708d}.sources summary{cursor:pointer;width:fit-content;padding:3px 0}.source{margin:9px 0;padding:10px;background:#f5f7fc;border-radius:8px}.source strong{display:block;margin-bottom:4px;color:#35425b}.source blockquote{margin:0;white-space:pre-wrap}
.status{min-height:29px;padding:3px 18px;color:#6b7891;font-size:11px;overflow-wrap:anywhere}.status[data-error=true]{color:#a1422e}.composer{padding:0 14px 12px}.input-box{border:1px solid #dfe5f0;border-radius:13px;background:#fff;padding:10px 10px 8px;transition:border-color .2s}.input-box:focus-within{border-color:#96aaf8;box-shadow:0 0 0 3px #365cf509}textarea{display:block;width:100%;height:50px;max-height:100px;border:0;resize:none;outline:none!important;background:transparent;color:#17213b;font-size:13px;padding:0 3px;line-height:1.5}textarea::placeholder{color:#8b95a8}.input-tools{display:flex;align-items:center;gap:6px}.hint{flex:1;font-size:10px;color:#8691a5}.send{width:32px;height:32px;border-radius:9px;color:#fff;background:var(--gk-accent);display:grid;place-items:center}.stop{font-size:11px;background:#fff2ed;color:#a54428;border-radius:8px;padding:8px 10px}.footer{font-size:9px;color:#8b95a8;text-align:center;padding:0 12px 11px}.footer b{font-weight:650;color:#66748d}
.action{margin-top:13px;border:1px solid #dfe5f0;border-radius:12px;overflow:hidden;background:#fff}.action-main{padding:13px}.action-title{font-weight:700;font-size:12px}.action-reason{font-size:12px;color:#627089;margin:5px 0 0;white-space:pre-wrap}.action pre{background:#f5f7fb;border-radius:7px;padding:10px;max-height:150px;overflow:auto;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.action-foot{border-top:1px solid #edf0f7;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.primary,.secondary{font-size:12px;font-weight:600;border-radius:8px;padding:8px 11px}.primary{background:var(--gk-accent);color:white}.secondary{background:#f0f3fa;color:#4b5a75}.action-state{font-size:11px;color:#64718a}.action-state[data-success=true]{color:#16815b}.guide-start{margin-top:12px;display:flex;align-items:center;gap:6px;width:fit-content}
.highlight{position:fixed;border:2px solid var(--gk-accent);border-radius:10px;box-shadow:0 0 0 5px #365cf51a,0 0 0 9999px #111d3a08;pointer-events:none;transition:width .08s,height .08s}.guide{pointer-events:auto;position:fixed;width:300px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #dbe3f6;box-shadow:0 12px 45px #17213b26;border-radius:14px;padding:15px}.guide-header{display:flex;align-items:center;justify-content:space-between;gap:8px}.guide-label{color:var(--gk-accent);font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.09em}.guide p{font-size:13px;margin:8px 0 14px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto}.guide-controls{display:flex;align-items:center;justify-content:space-between;gap:8px}.guide .icon{width:24px;height:24px}.guide-hint{font-size:9px;color:#7b869c;margin-top:10px}
@media(max-width:520px){.panel{right:12px;bottom:12px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);width:390px}.launcher{right:16px;bottom:16px}.guide{width:270px}.hint{font-size:9px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
const icons = {
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  guide: '<path d="m4 3 7 18 2-8 8-2L4 3Z"/>'
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
  private previousFocus: HTMLElement | null = null;
  private guideCleanup: (() => void) | null = null;
  private isOpen = false;
  private readonly voiceLabel = element('div', 'footer');
  get opened(): boolean { return this.isOpen; }
  voiceProvider(provider: 'browser' | 'disabled'): void {
    this.voiceLabel.textContent = provider === 'browser' ? 'Browser voice · Chrome/Edge · Microphone permission required' : 'Voice input disabled';
  }
  voiceRecording(recording: boolean): void {
    this.stop.textContent = recording ? 'Cancel voice' : 'Stop';
    this.stop.title = recording ? 'Discard this recording without sending a question' : 'Stop the current request';
  }

  constructor(handlers: { open(): void; close(): void; submit(message: string): void; cancel(): void; mic(): void; speaker(): void; }) {
    this.host.dataset.guidekitRoot = ''; this.host.dataset.guidekitPrivate = '';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = element('style'); style.textContent = styles; this.shadow.append(style);
    this.launcher = button('', 'launcher', handlers.open); this.launcher.append(icon('spark'), element('span', '', 'Ask your assistant')); this.launcher.setAttribute('aria-label', 'Open website assistant');
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', 'Website assistant'); this.panel.hidden = true;
    const header = element('header', 'header'); const mark = element('div', 'mark'); mark.append(icon('spark'));
    const identity = element('div', 'identity'); identity.append(this.name, this.company);
    this.speaker = iconButton('Read answers aloud', 'sound', handlers.speaker); this.speaker.setAttribute('aria-pressed', 'false');
    header.append(mark, identity, this.speaker, iconButton('Close assistant', 'close', handlers.close));
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
    this.panel.append(header, this.messages, this.statusNode, form, this.voiceLabel, footer); this.shadow.append(this.launcher, this.panel);
    document.body.append(this.host);
  }
  configure(agent: PublicAgent): void {
    this.host.style.setProperty('--gk-accent', agent.accentColor); this.name.textContent = agent.name; this.company.textContent = `${agent.companyName} · v${agent.version}`;
    this.launcher.setAttribute('aria-label', `Open ${agent.name}`); this.launcher.querySelector('span')!.textContent = `Ask ${agent.name}`;
    this.message('assistant', agent.greeting);
  }
  open(): void {
    if (!this.isOpen) this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.isOpen = true; this.panel.hidden = false; this.launcher.hidden = true; this.input.focus({ preventScroll: true });
  }
  close(): void { this.isOpen = false; this.panel.hidden = true; this.launcher.hidden = false; this.clearGuide(); if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true }); }
  status(message: string, error = false): void { this.statusNode.textContent = message; this.statusNode.dataset.error = String(error); }
  busy(value: boolean): void { this.send.disabled = value; this.stop.hidden = !value; this.input.setAttribute('aria-busy', String(value)); }
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
  guideButton(container: HTMLElement, steps: ModelPlan['steps'], resolve: (id: string) => HTMLElement | null, onMissing: () => void): void {
    const start = button('', 'secondary guide-start', () => this.guide(steps, resolve, onMissing)); start.append(icon('guide'), document.createTextNode(`Show me · ${steps.length} step${steps.length === 1 ? '' : 's'}`)); container.append(start);
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
  guide(steps: ModelPlan['steps'], resolve: (id: string) => HTMLElement | null, onMissing: () => void): void {
    this.clearGuide(); if (!steps.length) return;
    const ring = element('div', 'highlight'); const card = element('section', 'guide'); card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Visual guidance');
    const head = element('div', 'guide-header'); const label = element('span', 'guide-label'); head.append(label, iconButton('Stop visual guidance', 'close', () => this.clearGuide()));
    const text = element('p'); text.setAttribute('aria-live', 'polite'); const controls = element('div', 'guide-controls');
    let index = 0; let frame = 0; let stopped = false;
    const previous = button('Back', 'secondary', () => select(index - 1)); const next = button('Next', 'primary', () => { if (index === steps.length - 1) { this.clearGuide(); this.status('Guidance finished. Actions still require your approval.'); } else select(index + 1); });
    controls.append(previous, next); card.append(head, text, controls, element('div', 'guide-hint', 'Follow the guide at your pace. No automatic clicks.')); this.shadow.append(ring, card);
    const position = () => {
      if (stopped) return;
      const target = resolve(steps[index]!.targetId);
      if (!target) { this.clearGuide(); onMissing(); return; }
      const rect = target.getBoundingClientRect(); const width = document.documentElement.clientWidth; const height = window.innerHeight;
      const left = Math.max(3, Math.min(width - 3, rect.left - 5)); const top = Math.max(3, Math.min(height - 3, rect.top - 5));
      const right = Math.max(left, Math.min(width - 3, rect.right + 5)); const bottom = Math.max(top, Math.min(height - 3, rect.bottom + 5));
      ring.style.left = `${left}px`; ring.style.top = `${top}px`; ring.style.width = `${right - left}px`; ring.style.height = `${bottom - top}px`;
      ring.hidden = rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width;
      const cardWidth = card.offsetWidth; const cardHeight = card.offsetHeight;
      let cardLeft = Math.max(12, Math.min(width - cardWidth - 12, rect.left));
      let cardTop = rect.bottom + 14;
      if (cardTop + cardHeight > height - 12) cardTop = rect.top - cardHeight - 14;
      if (cardTop < 12) { cardTop = Math.max(12, Math.min(height - cardHeight - 12, rect.top)); cardLeft = rect.right + 14 + cardWidth < width - 12 ? rect.right + 14 : Math.max(12, rect.left - cardWidth - 14); }
      card.style.left = `${cardLeft}px`; card.style.top = `${Math.max(12, Math.min(height - cardHeight - 12, cardTop))}px`;
      frame = requestAnimationFrame(position);
    };
    const select = (value: number) => {
      index = Math.max(0, Math.min(steps.length - 1, value)); const step = steps[index]!;
      const target = resolve(step.targetId); if (!target) { this.clearGuide(); onMissing(); return; }
      label.textContent = `Step ${index + 1} of ${steps.length}`; text.textContent = step.text; previous.disabled = index === 0; next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    this.guideCleanup = () => { stopped = true; cancelAnimationFrame(frame); ring.remove(); card.remove(); };
    select(0); if (!stopped) position();
  }
  clearGuide(): void { this.guideCleanup?.(); this.guideCleanup = null; }
  destroy(): void { this.clearGuide(); this.host.remove(); }
  private scroll(): void { requestAnimationFrame(() => { this.messages.scrollTop = this.messages.scrollHeight; }); }
}
