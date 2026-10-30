import type { JourneyRequest, PageContext, RunResult } from '../../contracts/src/index';
import type { GuidanceResult } from './guidance';
import { publicLabel, validId } from './security';

export type { JourneyRequest } from '../../contracts/src/index';
export type JourneyReason = JourneyRequest['reason'];
export type JourneyEvidence = JourneyRequest['completed'][number];
export interface JourneyPlan { run: RunResult; page: PageContext; resolve(id: string): HTMLElement | null; routeKey: string; contextRevision?: string; }
export interface JourneyMemory { version: 1; id: string; goal: string; completed: Array<{ targetId: string; evidence: JourneyEvidence['evidence'] }>; savedAt: number; }
interface Callbacks {
  replan(request: JourneyRequest, signal: AbortSignal): Promise<JourneyPlan>;
  onPending(): void;
  onPlan(plan: JourneyPlan): void;
  onChange?(): void;
  onError(message: string): void;
  onEnd?(): void;
}
const fingerprint = (page: PageContext) => JSON.stringify([page.url, page.targets.map(target => [target.id, target.label, target.role])]);
export const journeyGoal = (goal: string): string => publicLabel(goal.replace(/[\u0000-\u001f\u007f]/g, ' ')).trim().slice(0, 1000);
export function semanticRevision(revision: unknown): string | undefined {
  if (revision === undefined) return undefined;
  if (typeof revision === 'number' && Number.isSafeInteger(revision)) return `number:${revision}`;
  if (typeof revision === 'string' && revision.trim() && revision.length <= 160 && !/[\u0000-\u001f\u007f]/.test(revision)) return `string:${revision}`;
  throw new Error('GuideKit context revision must be a nonempty string of at most 160 characters or a safe integer.');
}
export function continuationLimit(value: unknown): number {
  if (value === undefined) return 6;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 24) return value;
  throw new Error('GuideKit maxContinuations must be an integer between 1 and 24.');
}

/** Goal-level coordination. It stores no input values, audio, screenshots or credentials. */
export class JourneyCoordinator {
  readonly id: string;
  readonly goal: string;
  private revision = 0;
  private running = true;
  private paused = false;
  private awaitingHost = false;
  private calls = 0;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interactionTimer: ReturnType<typeof setTimeout> | null = null;
  private interaction = false;
  private expectingTransition = false;
  private inFlight: AbortController | null = null;
  private completed: JourneyEvidence[] = [];
  private recorded = new Set<string>();
  private requested = new Set<string>();
  private pendingReason: JourneyReason | null = null;
  private activeReason: JourneyReason | null = null;
  private baseline: PageContext | null = null;
  private scene: PageContext | null = null;
  private routeKey = '';
  private sceneRoute = '';
  private contextRevision: string | undefined;
  private sceneRevision: string | undefined;
  private readonly maxContinuations: number;
  private disposition: 'continue' | 'needs_input' | 'done' = 'continue';
  private planTargets = new Set<string>();
  private planTargetIndices = new Map<number, string>();

  constructor(goal: string, private readonly callbacks: Callbacks, options: { id?: string; completed?: JourneyEvidence[]; maxContinuations?: number } = {}) {
    this.maxContinuations = continuationLimit(options.maxContinuations);
    this.id = options.id && validId(options.id) ? options.id : `journey_${crypto.randomUUID().replaceAll('-', '')}`;
    this.goal = journeyGoal(goal);
    if (!this.goal) throw new Error('A journey needs a nonempty goal.');
    for (const evidence of options.completed?.slice(0, 24) ?? []) this.completed.push({ ...evidence, label: publicLabel(evidence.label).slice(0, 160), role: evidence.role.slice(0, 40) });
  }
  get active(): boolean { return this.running; }
  get planning(): boolean { return this.inFlight !== null || this.timer !== null; }
  get canContinue(): boolean { return this.disposition === 'continue'; }
  get suspended(): boolean { return this.paused || this.awaitingHost; }
  initial(): JourneyRequest { return this.request('initial'); }
  seed(page: PageContext, route: string, revision?: string): void { this.baseline = page; this.scene = page; this.routeKey = route; this.sceneRoute = route; this.contextRevision = revision; this.sceneRevision = revision; this.expectingTransition = false; }
  memory(): JourneyMemory { return { version: 1, id: this.id, goal: this.goal, completed: this.completed.map(({ targetId, evidence }) => ({ targetId, evidence })), savedAt: Date.now() }; }

  adopt(plan: JourneyPlan): void {
    if (!this.running) return;
    const metadata = plan.run.journey;
    if (!metadata || metadata.id !== this.id || metadata.revision !== this.revision) throw new Error('The journey response did not match the active task.');
    this.seed(plan.page, plan.routeKey, plan.contextRevision);
    this.disposition = metadata?.disposition ?? 'continue';
    this.planTargets = new Set(plan.run.steps.map(step => step.targetId));
    this.planTargetIndices = new Map(plan.run.steps.map((step, index) => [index, step.targetId]));
    this.callbacks.onChange?.();
    if (!plan.run.steps.length && !plan.run.action) this.end();
  }
  record(index: number, evidence: JourneyEvidence): void {
    if (!this.running || !validId(evidence.targetId)) return;
    const key = `${this.revision}:${index}:${evidence.targetId}`;
    if (this.recorded.has(key)) return;
    this.recorded.add(key);
    this.planTargetIndices.delete(index); this.planTargets = new Set(this.planTargetIndices.values());
    this.completed.push({ targetId: evidence.targetId, label: publicLabel(evidence.label).slice(0, 160), role: evidence.role.slice(0, 40), evidence: evidence.evidence });
    this.completed = this.completed.slice(-24);
    this.interaction = true;
    if (this.interactionTimer) clearTimeout(this.interactionTimer);
    this.interactionTimer = setTimeout(() => { this.interaction = false; this.interactionTimer = null; }, 3000);
    this.callbacks.onChange?.();
  }
  reportHostResult(targetId: string, success: boolean): void {
    if (!this.running || !this.planTargets.has(targetId) && !this.completed.some(entry => entry.targetId === targetId)) return;
    if (!success) {
      this.pendingReason = null; this.activeReason = null; this.interaction = false; this.expectingTransition = false;
      if (this.timer) clearTimeout(this.timer); this.timer = null;
      if (this.interactionTimer) clearTimeout(this.interactionTimer); this.interactionTimer = null;
      this.abort(); return;
    }
    const evidence = this.completed.findLast(entry => entry.targetId === targetId);
    if (evidence && evidence.evidence !== 'host_verified') { evidence.evidence = 'host_verified'; this.callbacks.onChange?.(); }
  }
  expectTransition(): void {
    if (!this.running) return;
    this.interaction = true; this.expectingTransition = true; if (this.interactionTimer) clearTimeout(this.interactionTimer);
    this.interactionTimer = setTimeout(() => { this.interaction = false; this.expectingTransition = false; this.interactionTimer = null; }, 30000);
  }
  observe(page: PageContext, routeKey: string, revision?: string): void {
    if (!this.running || this.paused || this.awaitingHost || !this.baseline) return;
    if (this.scene && fingerprint(page) === fingerprint(this.scene) && routeKey === this.sceneRoute && revision === this.sceneRevision) return;
    this.scene = page; this.sceneRoute = routeKey; this.sceneRevision = revision;
    if (fingerprint(page) === fingerprint(this.baseline) && routeKey === this.routeKey && revision === this.contextRevision) return;
    const changedRoute = routeKey !== this.routeKey;
    const previous = new Map(this.baseline.targets.map(target => [target.id, `${target.label}:${target.role}`]));
    const next = new Map(page.targets.map(target => [target.id, `${target.label}:${target.role}`]));
    const lostPlannedControl = [...this.planTargets].some(id => previous.get(id) !== next.get(id));
    const newControls = page.targets.some(target => previous.get(target.id) !== `${target.label}:${target.role}`);
    const semanticProgress = revision !== this.contextRevision && revision !== undefined && this.expectingTransition && this.canContinue;
    if (changedRoute || lostPlannedControl || this.interaction && newControls || semanticProgress) this.schedule('scene_changed');
  }
  segmentFinished(result: GuidanceResult, terminal = false): boolean {
    if (!this.running) return false;
    if (result.reason === 'stopped' || terminal || result.scope === 'goal' || result.verified && this.disposition !== 'continue') { this.end(); return false; }
    // A confirmed intermediate operation can advance; it is not proof of the entire goal.
    if (result.verified) { this.awaitingHost = false; this.pendingReason = null; this.expectTransition(); this.schedule('segment_completed'); return this.running; }
    if (result.reason === 'missing') { this.schedule('target_missing'); return this.running; }
    // Explicit Finish/unknown save outcomes must never trigger another mutation or retry.
    if (this.disposition !== 'continue' || result.message?.startsWith('Guide ended') || result.message?.includes('has not confirmed')) { this.end(); return false; }
    this.schedule('segment_completed'); return this.running;
  }
  resume(): void { if (this.running) this.schedule('user_resume'); }
  setAwaitingHost(waiting: boolean): void {
    if (!this.running || this.awaitingHost === waiting) return;
    this.awaitingHost = waiting;
    if (waiting) { this.pendingReason ??= this.activeReason; if (this.timer) clearTimeout(this.timer); this.timer = null; this.abort(); }
    else if (this.pendingReason && !this.paused) this.schedule(this.pendingReason);
  }
  setPaused(paused: boolean): void {
    if (!this.running) return;
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) { this.pendingReason ??= this.activeReason; if (this.timer) clearTimeout(this.timer); this.timer = null; this.abort(); }
    else if (this.pendingReason) this.schedule(this.pendingReason);
  }
  cancel(): void { this.end(); }

  private request(reason: JourneyReason): JourneyRequest { return { id: this.id, revision: this.revision, goal: this.goal, reason, completed: this.completed.map(entry => ({ ...entry })) }; }
  private schedule(reason: JourneyReason): void {
    if (!this.running) return;
    this.pendingReason = reason;
    if (this.paused || this.awaitingHost) return;
    if (this.timer) clearTimeout(this.timer);
    this.abort();
    this.timer = setTimeout(() => { this.timer = null; void this.replan(); }, 750);
  }
  private abort(): void { ++this.epoch; this.inFlight?.abort(); this.inFlight = null; }
  private async replan(): Promise<void> {
    if (!this.running || this.paused || this.awaitingHost || !this.pendingReason) return;
    const reason = this.pendingReason; this.pendingReason = null;
    this.activeReason = reason;
    const key = `${reason}:${this.scene ? fingerprint(this.scene) : ''}:${this.sceneRoute}:${this.sceneRevision ?? ''}:${this.completed.length}`;
    if (this.requested.has(key)) return;
    if (this.calls >= this.maxContinuations) { this.fail('This task reached its automatic guidance limit. Check your progress, then ask for the next part.'); return; }
    this.calls++; this.revision++;
    const controller = new AbortController(); this.inFlight = controller; const epoch = ++this.epoch;
    this.callbacks.onPending();
    try {
      const plan = await this.callbacks.replan(this.request(reason), controller.signal);
      if (!this.running || this.paused || this.awaitingHost || controller.signal.aborted || epoch !== this.epoch) return;
      this.adopt(plan); this.requested.add(key); this.callbacks.onPlan(plan);
    } catch (error) {
      if (this.running && !controller.signal.aborted && epoch === this.epoch) {
        if (error instanceof DOMException && error.name === 'AbortError') this.schedule('scene_changed');
        else this.fail(error instanceof Error ? error.message.slice(0, 500) : 'The next part of this task could not be planned.');
      }
    } finally { if (epoch === this.epoch) { this.inFlight = null; this.activeReason = null; } }
  }
  private fail(message: string): void { this.end(); this.callbacks.onError(message); }
  private end(): void {
    if (!this.running) return;
    this.running = false; this.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.interactionTimer) clearTimeout(this.interactionTimer);
    this.timer = null; this.interactionTimer = null; this.pendingReason = null; this.activeReason = null; this.callbacks.onEnd?.();
  }
}

export function parseJourneyMemory(value: unknown, now = Date.now()): JourneyMemory | null {
  if (!value || typeof value !== 'object') return null;
  const memory = value as Partial<JourneyMemory>;
  if (memory.version !== 1 || !validId(memory.id) || typeof memory.goal !== 'string' || !memory.goal.trim() || memory.goal.length > 1000 || !Number.isFinite(memory.savedAt) || now - Number(memory.savedAt) > 30 * 60_000 || Number(memory.savedAt) > now + 1000 || !Array.isArray(memory.completed) || memory.completed.length > 24) return null;
  if (!memory.completed.every(entry => entry && validId(entry.targetId) && ['observed', 'manual', 'host_verified'].includes(entry.evidence) && Object.keys(entry).every(key => key === 'targetId' || key === 'evidence'))) return null;
  if (!Object.keys(memory).every(key => ['version', 'id', 'goal', 'completed', 'savedAt'].includes(key))) return null;
  return { version: 1, id: memory.id, goal: journeyGoal(memory.goal), completed: memory.completed.map(entry => ({ ...entry })), savedAt: Number(memory.savedAt) };
}
