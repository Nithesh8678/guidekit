import type { PageContext, PublicAgent, RunResult } from '../../contracts/src/index';
import type { GuideKitInstance, GuideStepResult, MountOptions, RegisteredAction } from './types';
import { compileAction, endpointOrigin, parsePublicAgent, parseRun, record, safeContext, validId, type CompiledAction } from './security';
import { ContextCollector } from './context';
import { View, type ActionCard } from './view';
import { Voice } from './voice';

interface Session { token: string; expiresAt: number; agent: PublicAgent; }
interface PendingAction {
  run: RunResult; action: NonNullable<RunResult['action']>; registered: CompiledAction; card: ActionCard;
  controller: AbortController; started: boolean; terminal: boolean;
  outcome?: { status: 'succeeded' | 'failed' | 'cancelled'; message: string };
  reporting?: Promise<void>;
  token: string;
  expiresAt: number;
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
  private explicitContext: Record<string, unknown> = {};
  private active: AbortController | null = null;
  private pending: PendingAction | null = null;
  private generation = 0;
  private intent = 0;
  private destroyed = false;
  private configuredVersion: number | null = null;
  private readonly keyboard: (event: KeyboardEvent) => void;

  constructor(private readonly options: MountOptions) {
    if (!validId(options.agentId)) throw new Error('GuideKit needs a valid published agent ID.');
    this.endpoint = endpointOrigin(options.endpoint);
    for (const [name, action] of Object.entries(options.actions ?? {})) this.registerAction(name, action);
    this.view = new View({ open: () => this.open(), close: () => this.close(), submit: message => { void this.ask(message); }, cancel: () => { void this.cancel(); }, mic: () => this.toggleVoice(false), speaker: () => this.voice.toggleOutput(), guideStep: (text, events) => this.voice.speak(text, events), guidePause: () => this.voice.stopSpeaking(), guideFinish: result => {
      const message = result.message || (result.verified ? 'The website confirmed this step. Your guide is complete.' : 'Guide finished. Check the website for confirmation of any changes.');
      this.view.message('assistant', message); this.voice.speak(message); this.emit('guide-finished', { verified: result.verified });
    } });
    this.voice = new Voice(this.view, options.voice ?? {}, message => { void this.ask(message); });
    const parts = (options.hotkey ?? 'mod+shift+k').toLowerCase().split('+'); const key = parts.at(-1);
    this.keyboard = event => {
      if (event.key === 'Escape' && this.view.guiding && !this.voice.active) { event.preventDefault(); this.view.stopGuide(); this.voice.stopSpeaking(); return; }
      if (event.key === 'Escape' && (this.view.opened || this.voice.active)) { event.preventDefault(); this.close(); return; }
      const mod = parts.includes('mod');
      if (event.key.toLowerCase() !== key || event.repeat || (mod ? !(event.metaKey || event.ctrlKey) : event.metaKey !== parts.includes('meta') || event.ctrlKey !== parts.includes('ctrl')) || event.altKey !== parts.includes('alt') || event.shiftKey !== parts.includes('shift')) return;
      event.preventDefault(); this.open();
      if (options.voice?.hotkeyStartsListening !== false) this.toggleVoice(true);
    };
    document.addEventListener('keydown', this.keyboard);
    this.view.status('Connecting to your published assistant…');
    this.ready = this.ensureSession().then(session => { if (!this.voice.active) this.view.status('Ready. Ask anything about this website.'); return session.agent; }).catch(error => { if (!this.destroyed) { this.view.status(messageOf(error), true); this.view.message('error', `${messageOf(error)} You can retry by sending a question.`); } throw error; });
    // Auto-install must not produce an unhandled rejection when a server is offline.
    void this.ready.catch(() => undefined);
  }
  registerAction(name: string, action: RegisteredAction): void {
    if (!this.actions.has(name) && this.actions.size >= 30) throw new Error('Register at most 30 GuideKit actions.');
    this.actions.set(name, compileAction(name, action));
  }
  setContext(context: Record<string, unknown>): void { this.explicitContext = safeContext(context); }
  open(): void { if (!this.destroyed) this.view.open(); }
  startVoice(): void { if (!this.destroyed) { this.open(); if (!this.voice.active) { void this.cancel(false); this.voice.start(true); } } }
  stopVoice(): void { if (!this.destroyed) this.voice.finishInput(); }
  reportStepResult(targetId: string, result: GuideStepResult): void {
    if (this.destroyed || !validId(targetId) || !record(result) || typeof result.success !== 'boolean' || (result.message !== undefined && (typeof result.message !== 'string' || result.message.length > 1000))) return;
    this.view.reportStepResult(targetId, result);
  }
  private toggleVoice(voiceFlow: boolean): void {
    if (this.voice.active) this.voice.finishInput();
    else { void this.cancel(false); this.voice.start(voiceFlow); }
  }
  close(): void { if (this.destroyed) return; void this.cancel(); this.view.close(); }
  destroy(): void {
    if (this.destroyed) return;
    void this.cancel(); this.destroyed = true; this.lifetime.abort(); this.voice.destroy(); this.view.destroy(); document.removeEventListener('keydown', this.keyboard);
  }
  async getPageContext(): Promise<PageContext> {
    return this.collectPageContext(new ContextCollector());
  }
  private async collectPageContext(collector: ContextCollector, signal?: AbortSignal): Promise<PageContext> {
    const session = await this.ensureSession();
    signal?.throwIfAborted();
    const context = this.options.getContext ? await this.options.getContext() : {};
    signal?.throwIfAborted();
    return collector.collect(this.actions, session.agent.allowedActions, { ...this.explicitContext, ...safeContext(context) });
  }
  async ask(message: string): Promise<RunResult | null> {
    if (this.destroyed) return null;
    const text = message.trim(); if (!text || text.length > 3000) { this.view.status('Please enter a question of at most 3000 characters.', true); return null; }
    const intent = ++this.intent;
    await this.cancel(false, true);
    if (this.destroyed || intent !== this.intent) return null;
    const generation = ++this.generation; const controller = new AbortController(); this.active = controller;
    this.voice.stop(); this.view.open(); this.view.busy(true); this.view.message('user', text); this.view.status('Reading the current page and company knowledge…');
    try {
      const session = await this.ensureSession();
      if (controller.signal.aborted) return null;
      const collector = new ContextCollector();
      const page = await this.collectPageContext(collector, controller.signal);
      if (controller.signal.aborted) return null;
      const documentPath = `${location.origin}${location.pathname}`;
      const result = parseRun(await this.json('/api/embed/session/ask', { message: text, page, requestId: crypto.randomUUID() }, session.token, controller.signal, 150_000));
      if (this.destroyed || generation !== this.generation || controller.signal.aborted) return null;
      if (`${location.origin}${location.pathname}` !== documentPath) throw new Error('The page changed while the assistant was thinking. Ask again for the current page.');
      if (result.version !== session.agent.version) throw new Error('The assistant version changed unexpectedly. Reload this page to reconnect.');
      const knownTargets = new Set(page.targets.map(target => target.id));
      if (result.steps.some(step => !knownTargets.has(step.targetId))) throw new Error('The assistant referred to a control that was not shared. Ask again for the current page.');
      const container = this.view.message('assistant', result.answer, result.citations);
      this.view.knowledgeEvidence(container, result.knowledge, result.citations);
      if (result.steps.length) {
        const resolve = (id: string) => collector.resolve(id);
        const missing = () => { this.view.status('That control changed or is no longer visible. Ask again to refresh the guide.', true); this.view.recoveryButton(container, () => { void this.ask(text); }); this.emit('target-missing', { runId: result.runId }); };
        this.view.guideButton(container, result.steps, resolve, missing, result.action ? () => { void this.cancel(false); } : undefined);
        if (!result.action) this.view.guide(result.steps, resolve, missing);
      }
      if (result.action) this.propose(result, container, session);
      if (!result.steps.length || result.action) this.voice.speak(result.answer);
      this.view.status(result.action ? 'Review the proposed action before approving it.' : this.view.guiding ? 'Guidance is following your progress on the page.' : 'Ready for your next question.');
      this.emit('response', { runId: result.runId, version: result.version }); return result;
    } catch (error) {
      if (!this.destroyed && generation === this.generation && !controller.signal.aborted) { this.view.message('error', messageOf(error)); this.view.status('Your request did not finish. You can try again.', true); this.emit('error', { message: messageOf(error) }); }
      return null;
    } finally {
      if (generation === this.generation) { this.active = null; this.view.busy(false); }
    }
  }
  private async cancel(announce = true, preserveIntent = false): Promise<void> {
    if (!preserveIntent) ++this.intent;
    const wasActive = Boolean(this.active || this.pending);
    ++this.generation; this.active?.abort(); this.active = null; this.view.clearGuide(); this.voice.stop(); this.view.busy(false);
    const pending = this.pending;
    if (pending && !pending.terminal) {
      pending.controller.abort();
      if (!pending.outcome) pending.outcome = { status: 'cancelled', message: pending.started ? 'The visitor cancelled the action. The host must verify whether any work completed.' : 'The visitor declined or cancelled the action before execution.' };
      await this.report(pending);
    }
    if (announce && wasActive && !this.destroyed) this.view.status('Stopped. No further action will be started.');
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
    const pending: PendingAction = { run, action, registered, controller: new AbortController(), started: false, terminal: false, token: session.token, expiresAt: session.expiresAt, card: null as unknown as ActionCard };
    pending.card = this.view.action(container, action.name, action.reason, action.arguments, () => { void this.execute(pending); }, () => { void this.finish(pending, 'cancelled', 'The visitor declined this action.'); }); this.pending = pending;
  }
  private async execute(pending: PendingAction): Promise<void> {
    if (this.pending !== pending || pending.started || pending.terminal || pending.outcome || this.destroyed) return;
    if (pending.expiresAt <= Date.now() + 1000) {
      await this.finish(pending, 'cancelled', 'This approval expired before execution. Ask again to review a fresh action.');
      return;
    }
    pending.started = true; pending.card.executing(); this.view.busy(true); this.view.status('Running your approved action…');
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
    } finally { request.cleanup(); if (!this.destroyed) this.view.busy(false); }
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
        if (this.pending === pending) this.pending = null;
        if (!this.destroyed) { this.view.status(outcome.status === 'succeeded' ? 'The website verified that your action completed.' : outcome.message, outcome.status === 'failed'); this.emit('action-result', { runId: pending.run.runId, receiptId: pending.action.receiptId, status: outcome.status }); }
      } catch {
        pending.card.retry('The website returned an outcome, but it could not be recorded. Check the website before retrying the task.', () => { void this.report(pending); });
        if (!this.destroyed) this.view.status('Could not record the action outcome. Use “Retry recording result”.', true);
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
        if (response.status === 401 && token === this.session?.token) this.session = null;
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
