import type { AssistantContext, AssistantMode, PageContext, PublicAgent, RunResult, VisualScene } from '../../contracts/src/index';
import type { GuideContextOptions, GuideKitInstance, GuideStepResult, MountOptions, RegisteredAction } from './types';
import { compileAction, endpointOrigin, parsePublicAgent, parseRun, record, safeContext, validId, type CompiledAction } from './security';
import { ContextCollector, TargetIdentityAllocator, parseGuideTargets } from './context';
import { View, type ActionCard, type GuideHooks } from './view';
import { Voice, type VoiceEnding, type VoicePhase } from './voice';
import { continuationLimit, JourneyCoordinator, parseJourneyMemory, semanticRevision, type JourneyMemory, type JourneyPlan, type JourneyRequest } from './journey';
import { SceneObserver, routeKey } from './scene';
import { ControlHold } from './control-hold';
import type { SessionPhase } from './session-types';
import { matchVisualFocus } from './visual-focus';

interface Session { token: string; expiresAt: number; agent: PublicAgent; }
interface PageSnapshot { page: PageContext; resolve(id: string): HTMLElement | null; routeKey: string; contextRevision?: string; }
const snapshotKey = (snapshot: PageSnapshot) => JSON.stringify([snapshot.routeKey, snapshot.contextRevision, snapshot.page.targets.map(target => [target.id, target.label, target.role])]);
interface PendingAction {
  run: RunResult; action: NonNullable<RunResult['action']>; registered: CompiledAction; card: ActionCard;
  controller: AbortController; started: boolean; terminal: boolean;
  outcome?: { status: 'succeeded' | 'failed' | 'cancelled'; message: string };
  reporting?: Promise<void>;
  token: string;
  expiresAt: number;
  owner: number;
}
function requestController(signal: AbortSignal | undefined, timeout: number): { controller: AbortController; cleanup(): void } {
  const controller = new AbortController(); const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), timeout);
  return { controller, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message.slice(0, 700) : 'The request could not finish. Please try again.'; }

export class Assistant implements GuideKitInstance {
  readonly ready: Promise<PublicAgent>;
  private readonly endpoint: string;
  private readonly actions = new Map<string, CompiledAction>();
  private readonly view: View;
  private readonly voice: Voice;
  private readonly lifetime = new AbortController();
  private session: Session | null = null;
  private connecting: Promise<Session> | null = null;
  private preparing: Promise<void> | null = null;
  private preparedAt = 0;
  private explicitContext: Record<string, unknown> = {};
  private explicitContextKey = '{}';
  private readonly guideTargets: NonNullable<MountOptions['guideTargets']>;
  private contextRevision: string | undefined;
  private active: AbortController | null = null;
  private pending: PendingAction | null = null;
  private generation = 0;
  private intent = 0;
  private destroyed = false;
  private configuredVersion: number | null = null;
  private journey: JourneyCoordinator | null = null;
  private sceneObserver: SceneObserver | null = null;
  private readonly pageHide = () => this.saveJourney();
  private resumeAllowed = false;
  private resumeOffered = false;
  private readonly keyboard: (event: KeyboardEvent) => void;
  private readonly identities = new TargetIdentityAllocator();
  private sessionActive = false;
  private sessionEpoch = 0;
  private sessionLifetime: AbortController | null = null;
  private mode: AssistantMode = 'guide';
  private phase: SessionPhase = 'inactive';
  private readonly hold: ControlHold;
  private voiceOwner: number | null = null;
  private resumeAfterVoice = false;
  private latestSnapshot: PageSnapshot | null = null;
  private lastVisual: { scene: VisualScene; runId: string; token: string } | null = null;
  private inferenceTail: Promise<void> = Promise.resolve();
  private readonly holdKeydown = (event: KeyboardEvent) => { if (!this.privateFocus(event.target)) this.hold.keydown(event); else this.hold.cancel(); };
  private readonly holdKeyup = (event: KeyboardEvent) => this.hold.keyup(event);
  private readonly holdWheel = (event: WheelEvent) => this.hold.wheel(event);
  private readonly interruptHold = () => this.hold.cancel();
  private readonly blur = () => { this.hold.cancel(); if (this.voice.active) this.voice.stopInput(); };
  private readonly visibility = () => { if (document.hidden) this.blur(); this.publishSessionState(); };

  constructor(private readonly options: MountOptions) {
    if (!validId(options.agentId)) throw new Error('GuideKit needs a valid published agent ID.');
    if (options.targetMode !== undefined && !['auto', 'explicit'].includes(options.targetMode)) throw new Error('GuideKit targetMode must be auto or explicit.');
    this.guideTargets = parseGuideTargets(options.guideTargets, options.targetMode ?? 'auto');
    continuationLimit(options.journey?.maxContinuations);
    this.endpoint = endpointOrigin(options.endpoint);
    for (const [name, action] of Object.entries(options.actions ?? {})) this.registerAction(name, action);
    this.view = new View({ open: () => this.open(), close: () => this.close(), mode: (mode: AssistantMode) => this.setMode(mode), stopSession: () => this.stopSession(), submit: message => { void this.ask(message); }, cancel: () => { if (this.voice.active) this.voice.stopInput(); else void this.cancel(); }, mic: () => this.toggleVoice(false), speaker: () => this.voice.toggleOutput(), guideStep: (text, events) => this.voice.speak(text, events), guidePause: () => this.voice.stopSpeaking(), guideFinish: result => {
      const message = result.message || (result.verified ? 'The website confirmed this step. Your guide is complete.' : 'Guide finished. Check the website for confirmation of any changes.');
      this.view.message('assistant', message); this.voice.speak(message); this.setPhase('observing'); this.emit('guide-finished', { verified: result.verified });
    } });
    this.voice = new Voice(this.view, options.voice ?? {}, message => { void this.ask(message); }, { phase: (phase, ending) => this.voicePhase(phase, ending) });
    this.hold = new ControlHold({ enabled: () => this.sessionActive && !this.destroyed && !document.hidden && !this.voice.active && !this.view.mic.disabled && !this.privateFocus(document.activeElement), start: () => this.beginVoice(true, true, false), finish: () => this.voice.finishInput(), cancel: () => this.voice.stopInput() });
    const parts = (options.hotkey ?? 'mod+shift+k').toLowerCase().split('+'); const key = parts.at(-1);
    this.keyboard = event => {
      if (event.key === 'Escape' && this.voice.active) { event.preventDefault(); this.escapeVoice(); return; }
      if (event.key === 'Escape' && this.view.guiding) { event.preventDefault(); this.view.stopGuide(); this.voice.stopSpeaking(); return; }
      if (event.key === 'Escape' && (this.view.opened || this.voice.active)) { event.preventDefault(); this.close(); return; }
      if (!event.isTrusted || event.isComposing) return;
      const mod = parts.includes('mod');
      if (event.key.toLowerCase() !== key || event.repeat || (mod ? !(event.metaKey || event.ctrlKey) : event.metaKey !== parts.includes('meta') || event.ctrlKey !== parts.includes('ctrl')) || event.altKey !== parts.includes('alt') || event.shiftKey !== parts.includes('shift')) return;
      event.preventDefault();
      if (options.voice?.hotkeyStartsListening !== false) this.toggleVoice(true); else this.open();
    };
    document.addEventListener('keydown', this.keyboard);
    window.addEventListener('pagehide', this.pageHide);
    this.publishSessionState();
    this.view.status('Connecting to your published assistant…');
    this.ready = this.ensureSession().then(session => { if (!this.sessionActive || this.phase === 'observing') this.view.status('Ready. Ask anything about this website.'); this.offerJourneyResume(); return session.agent; }).catch(error => { if (!this.destroyed) { this.view.status(messageOf(error), true); this.view.message('error', `${messageOf(error)} You can retry by sending a question.`); } throw error; });
    // Auto-install must not produce an unhandled rejection when a server is offline.
    void this.ready.catch(() => undefined);
  }
  registerAction(name: string, action: RegisteredAction): void {
    if (!this.actions.has(name) && this.actions.size >= 30) throw new Error('Register at most 30 GuideKit actions.');
    this.actions.set(name, compileAction(name, action));
  }
  setContext(context: Record<string, unknown>, options?: GuideContextOptions): void {
    const revision = semanticRevision(options?.revision);
    const clean = safeContext(context), key = JSON.stringify(clean);
    // Revision-aware hosts often publish their snapshot on every render. An
    // identical public snapshot must not restart the scene reader's settle
    // timer. Without a supplied revision, a call remains an explicit refresh
    // signal for hosts whose getContext() reads state outside this object.
    if (revision !== undefined && revision === this.contextRevision && key === this.explicitContextKey) return;
    this.explicitContext = clean; this.explicitContextKey = key;
    if (revision !== undefined) this.contextRevision = revision;
    this.sceneObserver?.refresh();
  }
  private privateFocus(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || target === this.view.host || this.view.host.contains(target)) return false;
    return Boolean(target.closest('[data-guidekit-private],[inert],input[type="password"],input[type="hidden"],input[type="file"],[contenteditable]:not([contenteditable="false"])')) || /(?:password|cc-|credit|transaction|one-time-code|webauthn)/i.test(target.getAttribute('autocomplete') ?? '') || /(?:password|passphrase|secret|token|credential|credit.?card|cvv|cvc|ssn)/i.test(`${target.getAttribute('name') ?? ''} ${target.id}`);
  }
  private publishSessionState(): void {
    this.view.sessionState({ active: this.sessionActive, mode: this.mode, phase: this.sessionActive ? this.phase : 'inactive', observing: this.sessionActive && this.sceneObserver !== null && !document.hidden });
  }
  private setPhase(phase: SessionPhase, owner?: number, busy = ['starting', 'listening', 'finalizing', 'reading', 'thinking'].includes(phase)): void {
    if (this.destroyed || owner !== undefined && owner !== this.generation) return;
    this.phase = this.sessionActive ? phase : 'inactive'; this.view.busy(this.sessionActive && busy); this.publishSessionState();
  }
  startSession(mode: AssistantMode = this.mode): void {
    if (this.destroyed) return;
    if (!['guide', 'explain'].includes(mode)) throw new Error('GuideKit mode must be guide or explain.');
    if (this.sessionActive) { if (mode !== this.mode) this.setMode(mode); return; }
    this.mode = mode; this.sessionActive = true; this.sessionEpoch++; this.sessionLifetime = new AbortController();
    document.addEventListener('keydown', this.holdKeydown, true); document.addEventListener('keyup', this.holdKeyup, true);
    document.addEventListener('wheel', this.holdWheel, { capture: true, passive: true });
    document.addEventListener('pointerdown', this.interruptHold, true); document.addEventListener('compositionstart', this.interruptHold, true);
    document.addEventListener('visibilitychange', this.visibility); window.addEventListener('blur', this.blur);
    this.watchActiveSession(); this.setPhase('observing'); this.prepareRuntime();
    if (mode === 'guide') this.view.hideVisual(); else this.restoreVisual();
  }
  setMode(mode: AssistantMode): void {
    if (this.destroyed) return;
    if (!['guide', 'explain'].includes(mode)) throw new Error('GuideKit mode must be guide or explain.');
    if (!this.sessionActive) { this.startSession(mode); return; }
    if (mode === this.mode) return;
    this.mode = mode; this.voiceOwner = null; this.hold.cancel(); void this.cancel(false); this.view.clearGuide(false);
    if (mode === 'guide') this.view.hideVisual(); else this.restoreVisual();
    this.setPhase('observing');
  }
  stopSession(): void {
    if (this.destroyed) return;
    this.sessionActive = false; this.sessionEpoch++; this.sessionLifetime?.abort(); this.sessionLifetime = null; this.voiceOwner = null; this.hold.cancel();
    document.removeEventListener('keydown', this.holdKeydown, true); document.removeEventListener('keyup', this.holdKeyup, true);
    document.removeEventListener('wheel', this.holdWheel, true);
    document.removeEventListener('pointerdown', this.interruptHold, true); document.removeEventListener('compositionstart', this.interruptHold, true);
    document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('blur', this.blur);
    this.sceneObserver?.destroy(); this.sceneObserver = null; this.latestSnapshot = null;
    void this.cancel(false); this.lastVisual = null; this.view.clearVisual(); this.view.clearGuide(false); this.setPhase('inactive');
  }
  private restoreVisual(): void {
    const previous = this.lastVisual; if (!previous || previous.token !== this.session?.token) return;
    const owner = this.generation, epoch = this.sessionEpoch;
    void this.view.presentVisual(previous.scene, previous.runId).then(() => { if (this.sessionActive && this.mode === 'explain' && this.generation === owner && this.sessionEpoch === epoch) this.setPhase('presenting', owner); }).catch(() => { /* Keep the last valid scene; a new request can retry its renderer. */ });
  }
  open(): void {
    if (this.destroyed) return;
    this.startSession();
    const journey = this.journey;
    if (journey?.active && journey.planning) {
      journey.setPaused(true); this.view.clearGuide(true); this.setPhase('paused');
      this.view.offerJourneyResume(journey.goal, () => { if (this.journey === journey && journey.active) { this.view.journeyTransition(() => { void this.cancel(); }); journey.setPaused(false); this.setPhase('thinking'); } }, () => journey.cancel());
    }
    this.view.open(); this.prepareRuntime();
  }
  private voicePhase(phase: VoicePhase, ending?: VoiceEnding): void {
    const owner = this.voiceOwner;
    if (owner === null || owner !== this.generation || !this.sessionActive || this.destroyed) return;
    if (phase !== 'idle') { this.setPhase(phase, owner); return; }
    this.voiceOwner = null;
    if (ending === 'submitted') { this.setPhase('reading', owner); return; }
    if (ending === 'review') { this.setPhase(this.journey?.active ? 'paused' : 'observing', owner); return; }
    if (this.resumeAfterVoice && this.journey?.active) {
      this.view.resumeGuidance(); this.journey.setPaused(false);
      if (this.latestSnapshot) this.journey.observe(this.latestSnapshot.page, this.latestSnapshot.routeKey, this.latestSnapshot.contextRevision);
      if (!this.view.guiding && !this.journey.planning) this.journey.resume();
      this.setPhase('presenting', owner);
    } else this.setPhase(ending === 'error' ? 'error' : this.journey?.active ? 'paused' : this.lastVisual && this.mode === 'explain' ? 'presenting' : 'observing', owner);
    this.resumeAfterVoice = false;
  }
  private escapeVoice(): void {
    // Paused/hidden guide sessions are still real goals. Decide before voice
    // cleanup can resume that guide or finish a deferred host result.
    const preserveGuide = this.view.guiding || Boolean(this.journey?.active);
    this.hold.cancel(); this.voice.stopInput();
    if (!preserveGuide) this.close();
  }
  private beginVoice(voiceFlow: boolean, hold = false, openChat = true): boolean {
    if (this.destroyed || this.voice.active) return false;
    this.startSession();
    const journey = this.journey; this.resumeAfterVoice = !!journey?.active && !journey.suspended;
    ++this.generation; this.active?.abort(); this.active = null; this.view.cancelVisualPresentation();
    const pending = this.pending;
    if (pending && !pending.terminal) {
      pending.controller.abort(); pending.outcome ??= { status: 'cancelled', message: pending.started ? 'Voice interrupted this action. The website must verify whether any work completed.' : 'The visitor interrupted this approval with voice input.' };
      void this.report(pending);
    }
    if (journey?.active) journey.setPaused(true);
    this.view.pauseGuidance();
    if (openChat) this.view.open();
    this.voiceOwner = this.generation; this.voice.start(voiceFlow, hold);
    if (!this.voice.active && this.voiceOwner !== null) { this.voiceOwner = null; this.setPhase('error'); }
    return this.voice.active;
  }
  private prepareRuntime(): void {
    if (this.destroyed || this.preparing || Date.now() - this.preparedAt < 10_000) return;
    this.preparedAt = Date.now();
    const signal = this.sessionLifetime?.signal ?? this.lifetime.signal;
    this.preparing = this.ensureSession().then(async session => {
      if (this.destroyed || signal.aborted) return;
      // Preparation only starts an idle worker. No question, page context,
      // microphone input or model turn is sent, and older servers may omit it.
      await this.json('/api/embed/session/prepare', {}, session.token, signal, 5_000);
    }).catch(() => { /* Best effort; opening and asking must never wait for preparation. */ }).finally(() => { this.preparing = null; });
  }
  startVoice(): void { if (!this.destroyed) this.beginVoice(true); }
  stopVoice(): void { if (!this.destroyed) this.voice.finishInput(); }
  reportStepResult(targetId: string, result: GuideStepResult): void {
    if (this.destroyed || !validId(targetId) || !record(result) || (result.message !== undefined && (typeof result.message !== 'string' || result.message.length > 1000))) return;
    if ('status' in result) {
      if (result.status !== 'pending' || result.timeoutMs !== undefined && (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 300000)) return;
    } else {
      if (typeof result.success !== 'boolean' || result.scope !== undefined && !['step', 'goal'].includes(result.scope)) return;
      this.journey?.reportHostResult(targetId, result.success);
    }
    this.view.reportStepResult(targetId, result);
  }
  private toggleVoice(voiceFlow: boolean): void {
    if (this.voice.active) this.voice.finishInput();
    else this.beginVoice(voiceFlow);
  }
  close(): void { if (this.destroyed) return; this.stopSession(); this.view.close(); }
  destroy(): void {
    if (this.destroyed) return;
    this.stopSession(); this.hold.destroy(); this.destroyed = true; this.lifetime.abort(); this.voice.destroy(); this.view.destroy(); document.removeEventListener('keydown', this.keyboard); window.removeEventListener('pagehide', this.pageHide);
  }
  async getPageContext(): Promise<PageContext> {
    return this.collectPageContext(this.collector());
  }
  private collector(): ContextCollector { return new ContextCollector(this.options.targetMode, this.guideTargets.length ? this.guideTargets : undefined, this.identities); }
  private async collectPageContext(collector: ContextCollector, signal?: AbortSignal): Promise<PageContext> {
    const session = await this.ensureSession();
    signal?.throwIfAborted();
    const read = requestController(signal, 3000); let abort!: () => void;
    let context: Record<string, unknown>;
    try {
      context = this.options.getContext ? await Promise.race([Promise.resolve().then(() => this.options.getContext!()), new Promise<never>((_, reject) => { abort = () => reject(read.controller.signal.reason ?? new DOMException('Context read stopped.', 'AbortError')); if (read.controller.signal.aborted) abort(); else read.controller.signal.addEventListener('abort', abort, { once: true }); })]) : {};
    } finally { read.controller.signal.removeEventListener('abort', abort); read.cleanup(); }
    signal?.throwIfAborted();
    return collector.collect(this.actions, session.agent.allowedActions, { ...this.explicitContext, ...safeContext(context) });
  }
  private async readSnapshot(signal?: AbortSignal): Promise<PageSnapshot> {
    const revision = this.contextRevision, route = routeKey(), collector = this.collector();
    const page = await this.collectPageContext(collector, signal); signal?.throwIfAborted();
    if (revision !== this.contextRevision || route !== routeKey()) throw new DOMException('The scene changed while reading context.', 'AbortError');
    return { page, routeKey: route, contextRevision: revision, resolve: id => collector.resolve(id) };
  }
  private assistantContext(session: Session, mode = this.mode): AssistantContext {
    const result: AssistantContext = { mode, capabilities: { scene3d: 1 } }, previous = this.lastVisual;
    if (mode !== 'explain' || !previous || previous.token !== session.token) return result;
    const selection = this.view.visualSelection();
    if (!selection || selection.sceneId !== previous.scene.id) return result;
    result.sceneRunId = previous.runId;
    if (selection.selectedObjectId && previous.scene.objects.some(object => object.id === selection.selectedObjectId)) result.selectedObjectId = selection.selectedObjectId;
    return result;
  }
  private invalidateVisualSession(nextToken?: string): void {
    const previous = this.lastVisual;
    if (!previous || previous.token === nextToken) return;
    this.lastVisual = null; this.view.clearVisual();
    if (!this.destroyed && this.sessionActive) {
      const message = 'Your previous model belonged to an earlier assistant session and has been cleared. Ask for a new explanation before referring to its parts.';
      this.view.message('assistant', message); this.view.status(message, true);
      if (this.mode === 'explain' && !this.active && !this.voice.active) this.setPhase('error');
      this.emit('visual-session-expired', { sceneId: previous.scene.id });
    }
  }
  private async requestPlan(payload: unknown, token: string, signal: AbortSignal): Promise<RunResult> {
    const previous = this.inferenceTail; let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; }); this.inferenceTail = previous.catch(() => undefined).then(() => done);
    let aborted!: () => void;
    try {
      await Promise.race([previous, new Promise<never>((_, reject) => { aborted = () => reject(signal.reason ?? new DOMException('Stopped.', 'AbortError')); if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true }); })]);
      signal.throwIfAborted(); return parseRun(await this.json('/api/embed/session/ask', payload, token, signal, 150_000));
    } finally { signal.removeEventListener('abort', aborted); release(); }
  }
  async ask(message: string): Promise<RunResult | null> {
    if (this.destroyed) return null;
    const text = message.trim(); if (!text || text.length > 3000) { this.view.status('Please enter a question of at most 3000 characters.', true); return null; }
    this.startSession();
    const mode = this.mode, epoch = this.sessionEpoch, visualAtStart = this.lastVisual, intent = ++this.intent;
    await this.cancel(false, true);
    if (this.destroyed || intent !== this.intent || !this.sessionActive || epoch !== this.sessionEpoch) return null;
    const generation = ++this.generation, controller = new AbortController(); this.active = controller;
    const current = () => !this.destroyed && this.sessionActive && this.sessionEpoch === epoch && generation === this.generation && this.mode === mode && !controller.signal.aborted;
    this.view.open(); this.setPhase('reading', generation); this.view.message('user', text); this.view.status('Reading the current public page and company knowledge…');
    try {
      const session = await this.ensureSession(); controller.signal.throwIfAborted();
      if (mode === 'explain' && visualAtStart && this.lastVisual !== visualAtStart) {
        if (current()) { this.setPhase('error', generation); this.view.status('Your model’s assistant session changed. Ask for a new explanation before referring to its parts.', true); }
        return null;
      }
      const previous = this.lastVisual;
      const focus = mode === 'explain' && previous?.token === session.token && this.view.visualSelection()?.sceneId === previous.scene.id ? matchVisualFocus(text, previous.scene) : null;
      if (focus && current() && this.view.focusVisualObject(focus.id)) {
        const answer = focus.description || `Focused on ${focus.label}.`;
        this.view.message('assistant', answer); this.voice.speak(answer); this.setPhase('presenting', generation);
        if (current()) this.view.status(`Focused on ${focus.label}. Ask a follow-up or select another part.`);
        this.emit('visual-focus', { sceneId: previous!.scene.id, objectId: focus.id, source: 'local' });
        return null;
      }
      let snapshot = await this.readSnapshot(controller.signal); this.latestSnapshot = snapshot;
      const journey = mode === 'guide' && this.options.journey?.enabled !== false ? this.createJourney(text) : null;
      for (let attempt = 0; attempt < 2; attempt++) {
        journey?.seed(snapshot.page, snapshot.routeKey, snapshot.contextRevision);
        this.setPhase('thinking', generation);
        const result = await this.requestPlan({ message: text, page: snapshot.page, requestId: crypto.randomUUID(), assistant: this.assistantContext(session, mode), ...(journey ? { journey: journey.initial() } : {}) }, session.token, controller.signal);
        if (!current()) return null;
        if (this.session?.token !== session.token || result.version !== session.agent.version) throw new Error('The assistant session or version changed. Ask again to reconnect.');
        if (mode === 'explain') {
          if (result.action || result.steps.length) throw new Error('Explain mode cannot perform website actions or start a guide.');
          const container = this.view.message('assistant', result.answer, result.citations); this.view.knowledgeEvidence(container, result.knowledge, result.citations);
          this.setPhase('presenting', generation);
          if (result.visual) {
            const acknowledgement = await this.view.presentVisual(result.visual, result.runId);
            if (!current() || this.session?.token !== session.token) return null;
            if (acknowledgement.sceneId !== result.visual.id) throw new Error('The visual renderer did not confirm this explanation.');
            this.lastVisual = { scene: result.visual, runId: result.runId, token: session.token };
          }
          this.voice.speak(result.answer); this.setPhase(this.lastVisual ? 'presenting' : 'observing', generation);
          if (current()) this.view.status(this.lastVisual ? 'Your explanation is ready. Ask a follow-up or select a part of the model.' : 'Your explanation is ready. Ask a follow-up, or request an interactive model.');
        } else {
          const fresh = await this.readSnapshot(controller.signal); this.latestSnapshot = fresh;
          if (!current()) return null;
          if (snapshotKey(snapshot) !== snapshotKey(fresh)) {
            if (attempt === 0) { snapshot = fresh; this.view.status('The page changed. Updating the guide for its current controls…'); continue; }
            throw new Error('The page is still changing. Wait for it to settle, then ask again.');
          }
          this.validatePlanTargets(result, fresh.page);
          const plan = { ...fresh, run: result }; journey?.adopt(plan); this.renderPlan(plan, journey);
          this.setPhase(result.steps.length || result.action ? 'presenting' : 'observing', generation);
        }
        this.emit('response', { runId: result.runId, version: result.version, mode }); return result;
      }
      return null;
    } catch (error) {
      if (current()) { this.journey?.cancel(); this.view.message('error', messageOf(error)); this.view.status('Your request did not finish. You can try again.', true); this.setPhase('error', generation); this.emit('error', { message: messageOf(error) }); }
      return null;
    } finally {
      if (this.active === controller) { this.active = null; if (current() && ['reading', 'thinking'].includes(this.phase)) this.setPhase('observing', generation); }
    }
  }
  private async cancel(announce = true, preserveIntent = false): Promise<void> {
    if (!preserveIntent) ++this.intent;
    const wasActive = Boolean(this.active || this.pending);
    ++this.generation; this.voiceOwner = null; this.journey?.cancel(); this.journey = null;
    this.active?.abort(); this.active = null; this.view.cancelVisualPresentation(); this.view.clearGuide(); this.voice.stop(); this.setPhase('observing');
    const pending = this.pending;
    if (pending && !pending.terminal) {
      pending.controller.abort();
      if (!pending.outcome) pending.outcome = { status: 'cancelled', message: pending.started ? 'The visitor cancelled the action. The host must verify whether any work completed.' : 'The visitor declined or cancelled the action before execution.' };
      await this.report(pending);
    }
    if (announce && wasActive && !this.destroyed) this.view.status('Stopped. No further action will be started.');
  }
  private createJourney(goal: string, memory?: JourneyMemory, page?: PageContext): JourneyCoordinator {
    const completed = memory?.completed.map(entry => { const target = page?.targets.find(target => target.id === entry.targetId); return { ...entry, label: target?.label ?? 'Previously completed step', role: target?.role ?? 'region' }; });
    const journey = new JourneyCoordinator(goal, {
      replan: (request, signal) => this.replanJourney(request, signal),
      onPending: () => {
        if (this.destroyed || this.journey !== journey) return;
        ++this.generation; this.active?.abort(); this.active = null; this.voice.stopSpeaking(); this.setPhase('thinking');
        this.view.journeyTransition(() => { void this.cancel(); }); this.emit('journey-planning', { id: journey.id });
      },
      onPlan: plan => { if (!this.destroyed && this.journey === journey) { this.renderPlan(plan, journey); this.setPhase('presenting'); this.emit('response', { runId: plan.run.runId, version: plan.run.version }); } },
      onChange: () => this.saveJourney(),
      onEnd: () => { if (this.journey === journey) { this.forgetJourney(); if (!this.active && !this.voice.active) this.setPhase('observing'); } },
      onError: message => { if (!this.destroyed && this.journey === journey) { this.view.clearGuide(true); this.setPhase('error'); this.view.message('error', message); this.view.status(message, true); this.emit('error', { message }); } }
    }, { id: memory?.id, completed, maxContinuations: this.options.journey?.maxContinuations });
    this.journey = journey;
    if (this.options.journey?.resume === 'session' && !this.resumeAllowed && !this.resumeOffered) {
      this.resumeOffered = true;
      this.view.offerJourneyMemory(() => { this.resumeAllowed = true; try { sessionStorage.setItem(`${this.memoryKey()}:consent`, '1'); } catch { /* Storage may be blocked. */ } this.saveJourney(); });
    }
    return journey;
  }
  private watchActiveSession(): void {
    if (!this.sessionActive || this.sceneObserver) return;
    const epoch = this.sessionEpoch, snapshots = new WeakMap<PageContext, PageSnapshot>();
    this.sceneObserver = new SceneObserver(async signal => {
      const snapshot = await this.readSnapshot(signal); snapshots.set(snapshot.page, snapshot); return snapshot.page;
    }, page => {
      if (this.destroyed || !this.sessionActive || epoch !== this.sessionEpoch) return;
      const snapshot = snapshots.get(page); if (!snapshot) return;
      this.latestSnapshot = snapshot;
      if (this.mode === 'guide' && !this.voice.active && !this.active && this.journey?.active && !this.journey.suspended) this.journey.observe(page, snapshot.routeKey, snapshot.contextRevision);
    }, () => !this.destroyed && this.sessionActive && epoch === this.sessionEpoch);
    this.sceneObserver.refresh(); this.publishSessionState();
  }
  private async replanJourney(request: JourneyRequest, signal: AbortSignal): Promise<JourneyPlan> {
    if (!this.sessionActive || this.mode !== 'guide') throw new DOMException('Guidance session stopped.', 'AbortError');
    const epoch = this.sessionEpoch, session = await this.ensureSession(); signal.throwIfAborted();
    const snapshot = await this.readSnapshot(signal); this.latestSnapshot = snapshot;
    const run = await this.requestPlan({ message: request.goal, page: snapshot.page, requestId: crypto.randomUUID(), journey: request, assistant: this.assistantContext(session, 'guide') }, session.token, signal);
    signal.throwIfAborted();
    if (!this.sessionActive || this.sessionEpoch !== epoch || this.mode !== 'guide' || this.session?.token !== session.token) throw new DOMException('Guidance session changed.', 'AbortError');
    const fresh = await this.readSnapshot(signal); this.latestSnapshot = fresh;
    if (snapshotKey(snapshot) !== snapshotKey(fresh)) {
      this.journey?.observe(fresh.page, fresh.routeKey, fresh.contextRevision); throw new DOMException('The scene changed.', 'AbortError');
    }
    if (run.version !== session.agent.version) throw new Error('The next guide did not match this page or published assistant.');
    this.validatePlanTargets(run, fresh.page);
    return { ...fresh, run };
  }
  private validatePlanTargets(run: RunResult, page: PageContext): void {
    const visible = new Set(page.targets.map(target => target.id));
    const known = new Set([...visible, ...(page.guideTargets ?? []).map(target => target.id)]);
    if (run.steps.some(step => !known.has(step.targetId)) || run.steps[0] && !visible.has(run.steps[0].targetId)) throw new Error('The assistant referred to a control that was not shared or is not ready. Ask again for the current page.');
  }
  private renderPlan(plan: JourneyPlan, journey: JourneyCoordinator | null): void {
    const { run, page, resolve } = plan;
    const container = this.view.message('assistant', run.answer, run.citations); this.view.knowledgeEvidence(container, run.knowledge, run.citations);
    const current = () => journey !== null && this.journey === journey && journey.active;
    // Preserve the original safe control's native-submit boundary even if its
    // result arrives while paused, without a captured click, or after removal.
    const finalTarget = run.steps.length ? resolve(run.steps.at(-1)!.targetId) : null;
    let finalNativeSubmit = Boolean(finalTarget && 'form' in finalTarget && (finalTarget as HTMLButtonElement).form && ['submit', 'image'].includes((finalTarget as HTMLButtonElement).type));
    let submitting = false;
    let nearbyAnchorId = run.steps[0]?.targetId ?? '', cachedAnchorId = '', nearbyReadAt = -Infinity, nearbyIds: string[] = [];
    const nearbyTargets = () => {
      const at = performance.now();
      if (nearbyAnchorId !== cachedAnchorId || at - nearbyReadAt >= 250) {
        const anchor = resolve(nearbyAnchorId)?.getBoundingClientRect();
        const area = window.visualViewport;
        const left = area?.offsetLeft ?? 0, top = area?.offsetTop ?? 0;
        const width = area?.width ?? document.documentElement.clientWidth, height = area?.height ?? innerHeight;
        const x = anchor ? anchor.left + anchor.width / 2 : left + width / 2, y = anchor ? anchor.top + anchor.height / 2 : top + height / 2;
        // Reuse only already-shared public identities. No extra DOM discovery or
        // text collection; rank at most 160 controls and retain at most 24 IDs.
        nearbyIds = page.targets.slice(0, 160).flatMap(target => {
          const element = resolve(target.id); if (!element) return [];
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.right > left && box.bottom > top && box.left < left + width && box.top < top + height
            ? [{ id: target.id, distance: Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y) }] : [];
        }).sort((a, b) => a.distance - b.distance).slice(0, 24).map(target => target.id);
        cachedAnchorId = nearbyAnchorId; nearbyReadAt = at;
      }
      return nearbyIds.flatMap(id => { const target = resolve(id); return target ? [target] : []; });
    };
    const progress: NonNullable<GuideHooks['progress']> = (index, step, evidence) => { if (!current()) return; const target = page.targets.find(target => target.id === step.targetId) ?? page.guideTargets?.find(target => target.id === step.targetId); if (target) { journey!.record(index, { targetId: target.id, label: target.label, role: target.role, evidence }); this.sceneObserver?.refresh(); } };
    const hooks: GuideHooks = {
      nearbyTargets,
      progress,
      state: state => {
        nearbyAnchorId = state.step.targetId;
        if (!current()) return;
        // A catalog's final control may mount after the plan was adopted. Once
        // observed, retain the same native-submit boundary even while paused
        // or if the host later removes/relabels that control during saving.
        if (state.index === run.steps.length - 1 && state.target && 'form' in state.target && (state.target as HTMLButtonElement).form && ['submit', 'image'].includes((state.target as HTMLButtonElement).type)) finalNativeSubmit = true;
        if (!state.confirmationPending) submitting = false;
        else if (state.target && 'form' in state.target && (state.target as HTMLButtonElement).form && ['submit', 'image'].includes((state.target as HTMLButtonElement).type)) submitting = true;
        if (!this.voice.active && !this.active && !journey!.planning) this.setPhase(state.paused ? 'paused' : 'presenting');
        journey!.setPaused(state.paused); journey!.setAwaitingHost(state.hostPending || state.confirmationPending && (submitting || !journey!.canContinue));
        if (state.confirmationPending && !state.hostPending && journey!.canContinue && !submitting) { progress(state.index, state.step, 'observed'); journey!.expectTransition(); }
        this.sceneObserver?.refresh();
      },
      finish: result => {
        if (!current()) return false;
        // A deferred verified result finishes only after the visitor resumes
        // local guidance. It may finish before emitting its unpaused state.
        if (result.verified) journey!.setPaused(false);
        const handled = journey!.segmentFinished(result, result.scope === 'goal' || (submitting || finalNativeSubmit) && result.scope !== 'step');
        if (handled) { this.view.journeyTransition(() => { void this.cancel(); }); this.sceneObserver?.refresh(); } return handled;
      }
    };
    const missing = () => { this.view.status('That control changed or is no longer visible. Ask again to refresh the guide.', true); this.view.recoveryButton(container, () => { void this.ask(journey?.goal ?? run.answer); }); this.emit('target-missing', { runId: run.runId }); };
    if (run.steps.length) {
      this.view.guideButton(container, run.steps, resolve, missing, run.action ? () => { void this.cancel(false); } : undefined, hooks);
      if (!run.action) this.view.guide(run.steps, resolve, missing, hooks);
    } else this.view.clearGuide(true);
    if (run.action && this.session) { journey?.setPaused(true); this.propose(run, container, this.session); }
    if (!run.steps.length || run.action) this.voice.speak(run.answer);
    this.view.status(run.action ? 'Review the proposed action before approving it.' : this.view.guiding ? 'Guidance is following your progress on the page.' : 'Ready for your next question.');
  }
  private memoryKey(): string { return `guidekit:journey:${this.endpoint}:${this.options.agentId}`; }
  private forgetJourney(): void { if (this.options.journey?.resume === 'session') { try { sessionStorage.removeItem(this.memoryKey()); } catch { /* Storage may be blocked. */ } } }
  private saveJourney(): void {
    if (this.options.journey?.resume !== 'session' || !this.resumeAllowed || !this.journey?.active) return;
    try { sessionStorage.setItem(this.memoryKey(), JSON.stringify(this.journey.memory())); } catch { /* Session-only resume is optional. */ }
  }
  private offerJourneyResume(): void {
    if (this.destroyed || this.options.journey?.resume !== 'session') return;
    let memory: JourneyMemory | null = null;
    try { this.resumeAllowed = sessionStorage.getItem(`${this.memoryKey()}:consent`) === '1'; const raw = sessionStorage.getItem(this.memoryKey()); if (raw && this.resumeAllowed) memory = parseJourneyMemory(JSON.parse(raw)); } catch { /* Storage may be blocked. */ }
    if (!memory) { this.forgetJourney(); return; }
    const previous = memory;
    this.view.offerJourneyResume(previous.goal, () => { void this.resumeJourney(previous); }, () => this.forgetJourney());
  }
  private async resumeJourney(memory: JourneyMemory): Promise<void> {
    this.startSession('guide');
    const intent = ++this.intent;
    await this.cancel(false, true); if (this.destroyed || intent !== this.intent) return;
    const controller = new AbortController(); this.active = controller;
    try {
      const page = await this.collectPageContext(this.collector(), controller.signal);
      if (this.destroyed || intent !== this.intent || controller.signal.aborted) return;
      const journey = this.createJourney(memory.goal, memory, page); journey.seed(page, routeKey(), this.contextRevision); this.watchActiveSession(); this.view.journeyTransition(() => { void this.cancel(); }); journey.resume();
    } catch (error) { if (!this.destroyed && intent === this.intent && !controller.signal.aborted) { this.view.clearGuide(true); this.view.message('error', messageOf(error)); } }
    finally { if (this.active === controller) this.active = null; }
  }
  private propose(run: RunResult, container: HTMLElement, session: Session): void {
    const action = run.action!; const registered = this.actions.get(action.name);
    if (!registered || !session.agent.allowedActions.includes(action.name)) {
      this.view.message('error', 'This action is not registered and permitted on this website. Ask for step-by-step guidance instead.');
      void this.json('/api/embed/session/action-result', { receiptId: action.receiptId, status: 'failed', message: 'The host did not register this permitted action.' }, session.token).catch(() => undefined); return;
    }
    let allowed = false;
    try { allowed = Boolean(registered.validate(action.arguments)) && (registered.definition.validate?.(action.arguments) ?? true); } catch { /* Rejected by host validation. */ }
    if (!allowed) {
      this.view.message('error', 'The proposed action did not pass this website’s validation. Nothing was executed.');
      void this.json('/api/embed/session/action-result', { receiptId: action.receiptId, status: 'failed', message: 'Action arguments did not pass host JSON Schema or permission validation.' }, session.token).catch(() => undefined); return;
    }
    const pending: PendingAction = { run, action, registered, controller: new AbortController(), started: false, terminal: false, token: session.token, expiresAt: session.expiresAt, owner: this.generation, card: null as unknown as ActionCard };
    pending.card = this.view.action(container, action.name, action.reason, action.arguments, () => { void this.execute(pending); }, () => { void this.finish(pending, 'cancelled', 'The visitor declined this action.'); }); this.pending = pending;
  }
  private async execute(pending: PendingAction): Promise<void> {
    if (this.pending !== pending || pending.started || pending.terminal || pending.outcome || this.destroyed || this.voice.active || pending.owner !== this.generation) return;
    if (pending.expiresAt <= Date.now() + 1000) {
      await this.finish(pending, 'cancelled', 'This approval expired before execution. Ask again to review a fresh action.');
      return;
    }
    pending.started = true; pending.card.executing(); this.setPhase('presenting', pending.owner, true); this.view.status('Running your approved action…');
    const request = requestController(pending.controller.signal, pending.registered.definition.timeoutMs ?? 30_000);
    try {
      if (!pending.registered.validate(pending.action.arguments) || pending.registered.definition.validate && !pending.registered.definition.validate(pending.action.arguments)) throw new Error('This action is no longer permitted by the website. Nothing was executed.');
      const result = await Promise.race([
        Promise.resolve().then(() => pending.registered.definition.execute(pending.action.arguments, { signal: request.controller.signal, idempotencyKey: pending.action.receiptId })),
        new Promise<never>((_, reject) => { const aborted = () => reject(request.controller.signal.reason ?? new DOMException('Action stopped.', 'AbortError')); if (request.controller.signal.aborted) aborted(); else request.controller.signal.addEventListener('abort', aborted, { once: true }); })
      ]);
      if (pending.outcome || pending.terminal) return;
      if (!record(result) || typeof result.success !== 'boolean' || typeof result.message !== 'string' || !result.message.trim()) throw new Error('The website did not return a verified outcome. Check the website before retrying.');
      await this.finish(pending, result.success ? 'succeeded' : 'failed', result.message.slice(0, 1000));
    } catch (error) {
      if (!pending.outcome && !pending.terminal) await this.finish(pending, pending.controller.signal.aborted ? 'cancelled' : 'failed', request.controller.signal.aborted ? 'The action stopped or timed out. Check the website before retrying; the host may have completed some work.' : messageOf(error));
    } finally { request.cleanup(); if (!this.destroyed && pending.owner === this.generation) this.setPhase('observing', pending.owner); }
  }
  private async finish(pending: PendingAction, status: 'succeeded' | 'failed' | 'cancelled', message: string): Promise<void> {
    if (pending.terminal || pending.outcome) return;
    pending.outcome = { status, message }; if (status === 'cancelled') pending.controller.abort();
    await this.report(pending);
  }
  private async report(pending: PendingAction): Promise<void> {
    if (pending.terminal || !pending.outcome) return;
    if (pending.reporting) return pending.reporting;
    const outcome = pending.outcome;
    pending.reporting = (async () => {
      pending.card.state('Recording the verified outcome…');
      try {
        // Deliberately independent of the inference/lifetime signal: cancellation is itself a terminal receipt.
        await this.json('/api/embed/session/action-result', { receiptId: pending.action.receiptId, ...outcome }, pending.token, undefined, 12_000);
        pending.terminal = true; pending.card.finished(outcome.message, outcome.status === 'succeeded');
        if (this.journey?.id === pending.run.journey?.id) this.journey?.cancel();
        if (this.pending === pending) this.pending = null;
        if (!this.destroyed && pending.owner === this.generation) this.view.status(outcome.status === 'succeeded' ? 'The website verified that your action completed.' : outcome.message, outcome.status === 'failed');
        if (!this.destroyed) this.emit('action-result', { runId: pending.run.runId, receiptId: pending.action.receiptId, status: outcome.status });
      } catch {
        pending.card.retry('The website returned an outcome, but it could not be recorded. Check the website before retrying the task.', () => { void this.report(pending); });
        if (!this.destroyed && pending.owner === this.generation) this.view.status('Could not record the action outcome. Use “Retry recording result”.', true);
      } finally { pending.reporting = undefined; }
    })();
    return pending.reporting;
  }
  private async ensureSession(): Promise<Session> {
    if (this.destroyed) throw new Error('This assistant was removed.');
    if (this.session && this.session.expiresAt > Date.now() + 30_000) return this.session;
    if (this.connecting) return this.connecting;
    this.connecting = this.json(`/api/embed/${encodeURIComponent(this.options.agentId)}/session`, {}, undefined, this.lifetime.signal, 15_000).then(value => {
      if (!record(value) || typeof value.token !== 'string' || value.token.length < 10 || value.token.length > 4000 || !['string', 'number'].includes(typeof value.expiresAt)) throw new Error('The server returned an invalid assistant session.');
      const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : Date.parse(value.expiresAt as string); if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('The assistant session has expired. Please try again.');
      const agent = parsePublicAgent(value.agent); if (agent.id !== this.options.agentId) throw new Error('The assistant session does not match this website.');
      const session = { token: value.token, expiresAt, agent }; this.session = session;
      // Compare the acknowledged scene itself: a prior 401 may already have
      // removed this.session, without making its old scene safe to carry over.
      this.invalidateVisualSession(session.token);
      if (this.configuredVersion !== agent.version && !this.destroyed) { this.view.configure(agent); this.configuredVersion = agent.version; this.emit('mounted', { agentId: agent.id, version: agent.version }); }
      return session;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private async json(path: string, payload: unknown, token?: string, signal?: AbortSignal, timeout = 12_000): Promise<unknown> {
    const request = requestController(signal, timeout);
    try {
      const response = await fetch(`${this.endpoint}${path}`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload), signal: request.controller.signal });
      const contentLength = Number(response.headers.get('content-length')); if (contentLength > 1_000_000) throw new Error('The server returned too much data.');
      const raw = await response.text(); if (raw.length > 1_000_000) throw new Error('The server returned too much data.');
      let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('The assistant server did not return JSON. Check the SDK endpoint.'); }
      if (!response.ok) {
        if (response.status === 401 && token === this.session?.token) { this.session = null; this.invalidateVisualSession(); }
        throw new Error(record(value) && typeof value.error === 'string' ? value.error.slice(0, 700) : `The assistant request failed (${response.status}).`);
      }
      return value;
    } catch (error) {
      if (request.controller.signal.aborted && !signal?.aborted) throw new Error('The assistant request timed out. Please try again.');
      if (error instanceof TypeError) throw new Error('Cannot connect to the assistant. Check the server, allowed website origin, and network.');
      throw error;
    } finally { request.cleanup(); }
  }
  private emit(name: string, detail: Record<string, unknown>): void { document.dispatchEvent(new CustomEvent(`guidekit:${name}`, { detail })); }
}
