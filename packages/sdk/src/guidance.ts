import type { ModelPlan } from '../../contracts/src/index';
import { isSafeTarget } from './context';
import type { GuideStepResult } from './types';

type Step = ModelPlan['steps'][number];
export interface GuidanceState {
  index: number;
  total: number;
  completed: number;
  step: Step;
  target: HTMLElement | null;
  hint: string;
  automatic: boolean;
  paused: boolean;
  waiting: boolean;
  confirmationPending: boolean;
  hostPending: boolean;
}
export interface GuidanceResult { reason: 'completed' | 'stopped' | 'missing'; verified: boolean; message?: string; scope?: 'step' | 'goal'; }
interface Callbacks { onUpdate(state: GuidanceState): void; onFinish(result: GuidanceResult): void; onComplete?(index: number, step: Step, evidence: 'observed' | 'manual' | 'host_verified'): void; }
type HostResult = GuideStepResult;
interface Observation { target: HTMLElement; kind: 'text' | 'textarea' | 'choice'; ready: boolean; timer: ReturnType<typeof setTimeout> | null; }
const quietMs = 1200;
const recoveryMs = 1200;
const confirmationMs = 30000;
const events = ['input', 'change', 'focusin', 'focusout', 'compositionstart', 'compositionend', 'click', 'submit'] as const;

function input(target: HTMLElement): target is HTMLInputElement { return target.tagName === 'INPUT'; }
function textarea(target: HTMLElement): target is HTMLTextAreaElement { return target.tagName === 'TEXTAREA'; }
function choice(target: HTMLElement): boolean { return target.tagName === 'SELECT' || (input(target) && ['checkbox', 'radio', 'range', 'color', 'date', 'datetime-local', 'month', 'time', 'week'].includes(target.type)); }
function clickable(target: HTMLElement): boolean { return ['BUTTON', 'A', 'SUMMARY'].includes(target.tagName) || (input(target) && ['button', 'submit', 'reset', 'image'].includes(target.type)) || ['button', 'link', 'tab', 'menuitem'].includes(target.getAttribute('role') ?? ''); }
function enabled(target: HTMLElement): boolean { return !target.matches(':disabled') && target.getAttribute('aria-disabled') !== 'true' && !('readOnly' in target && target.readOnly); }
function valid(target: HTMLElement): boolean {
  if (!isSafeTarget(target) || !enabled(target) || (target.getAttribute('aria-invalid') ?? 'false') !== 'false') return false;
  if ('validity' in target && !(target as HTMLInputElement).validity.valid) return false;
  if ((textarea(target) || (input(target) && !choice(target) && !clickable(target))) && !target.value.trim()) return false;
  return true;
}
function formFor(target: HTMLElement): HTMLFormElement | null {
  if (!('form' in target)) return null;
  const form = (target as HTMLButtonElement).form;
  return form && ['submit', 'image'].includes((target as HTMLButtonElement).type) ? form : null;
}
function validForm(form: HTMLFormElement): boolean {
  // Inspect validity without dispatching the native invalid events from checkValidity().
  return Array.from(form.elements).every(element => !('willValidate' in element) || !(element as HTMLInputElement).willValidate || ((element as HTMLInputElement).validity.valid && element.getAttribute('aria-invalid') !== 'true'));
}
function guideControl(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : target && 'parentElement' in target && target.parentElement instanceof HTMLElement ? target.parentElement : null;
  return Boolean(element?.closest('[data-guidekit-root]'));
}
function pageControl(target: EventTarget | null): target is HTMLElement { return target instanceof HTMLElement && !guideControl(target) && isSafeTarget(target) && enabled(target) && (input(target) || textarea(target) || choice(target) || clickable(target)); }

/** Local, bounded observation of the known controls in a guide. Never reads values into callbacks. */
export class GuidanceSession {
  private readonly steps: ModelPlan['steps'];
  private running = false;
  private destroyed = false;
  private index = 0;
  private automatic = true;
  private paused = false;
  private completed = new Set<number>();
  private edited = new Map<number, HTMLElement>();
  private composing = new WeakSet<HTMLElement>();
  private observations = new Map<number, Observation>();
  private target: HTMLElement | null = null;
  private document: Document | null = null;
  private observer: MutationObserver | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private waitingForResult = false;
  private hostPending = false;
  private hostMessage = '';
  private confirmationTimeout = confirmationMs;
  private failure = '';
  private submitted: { index: number; nextBefore: HTMLElement | null } | null = null;
  private clicked: { index: number; target: HTMLElement; nextBefore: HTMLElement | null } | null = null;
  private deferredResult: { id: string; atIndex: number; result: HostResult } | null = null;
  private lastState: GuidanceState | null = null;

  constructor(steps: ModelPlan['steps'], private readonly resolve: (id: string) => HTMLElement | null, private readonly callbacks: Callbacks) { this.steps = steps.map(step => ({ ...step })); }
  get active(): boolean { return this.running; }

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    if (!this.steps.length) { this.finish({ reason: 'completed', verified: false }); return; }
    this.document = this.safeTarget(0)?.ownerDocument ?? document;
    for (const name of events) this.document.addEventListener(name, this.onEvent, true);
    this.observer = new MutationObserver(records => {
      if (records.some(record => !guideControl(record.target))) this.refresh();
    });
    this.observer.observe(this.document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'aria-invalid', 'aria-disabled', 'aria-hidden', 'inert', 'hidden', 'style', 'class', 'data-guidekit-private', 'data-guidekit-id', 'data-guidekit-label', 'aria-label', 'aria-labelledby', 'role', 'title', 'placeholder', 'name', 'id', 'autocomplete', 'type'] });
    this.refresh();
  }

  next(): void {
    if (!this.running) return;
    this.forgetObservation(this.index);
    this.edited.delete(this.index);
    this.recordCompletion(this.index, 'manual');
    if (this.index === this.steps.length - 1) { this.finish({ reason: 'completed', verified: false, message: 'Guide ended without a confirmed website result.' }); return; }
    this.move(this.index + 1);
  }
  back(): void { if (this.running) this.move(Math.max(0, this.index - 1), false); }
  setAutomatic(value: boolean): void {
    if (!this.running) return;
    this.automatic = value; this.cancelStepTimer(); this.emit();
    if (value && !this.paused) { this.applyDeferredResult(); this.refresh(); this.resumeObservation(); }
  }
  setPaused(value: boolean): void {
    if (!this.running) return;
    this.paused = value; this.cancelStepTimer();
    if (value && this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    if (value) this.clearConfirmationTimer();
    if (!value && this.automatic) this.applyDeferredResult();
    this.refresh();
    if (!value && this.automatic) this.resumeObservation();
  }

  reportResult(targetId: string, result: HostResult): void {
    if (!this.running) return;
    const index = this.steps[this.index]?.targetId === targetId ? this.index : this.steps.at(-1)?.targetId === targetId ? this.steps.length - 1 : -1;
    if (index < 0 || (index !== this.index && index !== this.steps.length - 1)) return;
    if ('status' in result) {
      if (index !== this.index || result.status !== 'pending' || result.timeoutMs !== undefined && (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 300000)) return;
      this.cancelStepTimer(); this.submitted = null; this.clicked = null; this.deferredResult = null;
      this.forgetObservation(this.index);
      if (!this.hostPending) { this.clearConfirmationTimer(); this.confirmationTimeout = result.timeoutMs ?? 120000; }
      this.hostPending = true; this.waitingForResult = true; this.failure = '';
      this.hostMessage = result.message?.trim().slice(0, 240) || 'The website is working. I’ll wait for its confirmation…';
      this.refresh(); return;
    }
    this.clearConfirmationTimer();
    if (this.paused || !this.automatic) { this.deferredResult = { id: targetId, atIndex: this.index, result: { ...result } }; return; }
    this.cancelStepTimer(); this.submitted = null; this.clicked = null;
    if (!result.success) {
      if (index !== this.index) return;
      this.waitingForResult = false;
      this.hostPending = false; this.hostMessage = ''; this.confirmationTimeout = confirmationMs;
      this.failure = result.message?.trim().slice(0, 240) || 'The website could not complete that action. Try again.';
      this.refresh(); return;
    }
    this.hostPending = false; this.hostMessage = ''; this.confirmationTimeout = confirmationMs;
    if (index === this.steps.length - 1 || result.scope === 'goal') { this.recordCompletion(index, 'host_verified'); this.finish({ reason: 'completed', verified: true, message: result.message?.trim().slice(0, 240) || 'The website confirmed the result.', ...(result.scope ? { scope: result.scope } : {}) }); return; }
    this.complete('host_verified');
  }

  refresh(): void {
    if (!this.running) return;
    if (this.clicked && this.automatic && !this.paused && this.index < this.steps.length - 1 && this.safeTarget(this.index) !== this.clicked.target && !this.clicked.target.closest('[data-guidekit-private], [data-guidekit-root]')) {
      const next = this.safeTarget(this.index + 1);
      if (next && next !== this.clicked.nextBefore) { this.complete(); return; }
    }
    if (this.submitted && this.automatic && !this.paused && this.index < this.steps.length - 1) {
      const next = this.safeTarget(this.index + 1);
      if (next && next !== this.submitted.nextBefore) { this.complete(); return; }
    }
    const target = this.safeTarget(this.index);
    if (target !== this.target) { this.cancelStepTimer(); this.target = target; }
    if (this.observations.get(this.index)?.target !== target) this.forgetObservation(this.index);
    if (target || this.waitingForResult) {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    } else if (!this.recoveryTimer && !this.paused) {
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        if (!this.running || this.paused) return;
        if (this.safeTarget(this.index)) this.refresh();
        else this.finish({ reason: 'missing', verified: false, message: 'This control is no longer available. Ask for an updated guide.' });
      }, recoveryMs);
    }
    if (this.waitingForResult) this.awaitConfirmation();
    this.emit();
  }
  stop(reason: 'stopped' | 'missing' = 'stopped'): void { if (this.running) this.finish({ reason, verified: false }); }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.stop(); this.cleanup(); }

  private safeTarget(index: number): HTMLElement | null {
    const step = this.steps[index]; if (!step) return null;
    try { const target = this.resolve(step.targetId); return target && isSafeTarget(target) ? target : null; } catch { return null; }
  }
  private move(index: number, consume = true): void {
    this.cancelStepTimer();
    this.clearConfirmationTimer();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null; this.index = index; this.target = null; this.waitingForResult = false; this.hostPending = false; this.hostMessage = ''; this.confirmationTimeout = confirmationMs; this.failure = ''; this.submitted = null; this.clicked = null; this.lastState = null;
    this.refresh();
    if (consume) this.resumeObservation();
  }
  private recordCompletion(index: number, evidence: 'observed' | 'manual' | 'host_verified'): void {
    const fresh = !this.completed.has(index); this.completed.add(index);
    if (fresh || evidence === 'host_verified') this.callbacks.onComplete?.(index, { ...this.steps[index]! }, evidence);
  }
  private complete(evidence: 'observed' | 'manual' | 'host_verified' = 'observed'): void {
    if (!this.running || this.paused || !this.automatic) return;
    this.forgetObservation(this.index);
    this.edited.delete(this.index);
    this.recordCompletion(this.index, evidence);
    let next = this.steps.findIndex((_, index) => index > this.index && !this.completed.has(index));
    if (next < 0) next = this.steps.findIndex((_, index) => !this.completed.has(index));
    if (next < 0) this.finish({ reason: 'completed', verified: false, message: 'All guidance steps were followed. No website result was independently confirmed.' });
    else this.move(next);
  }
  private applyDeferredResult(): void { const pending = this.deferredResult; this.deferredResult = null; if (pending && pending.atIndex === this.index) this.reportResult(pending.id, pending.result); }
  private clearConfirmationTimer(): void { if (this.confirmationTimer) clearTimeout(this.confirmationTimer); this.confirmationTimer = null; }
  private awaitConfirmation(): void {
    if (!this.running || this.paused || !this.waitingForResult || this.confirmationTimer || this.deferredResult) return;
    this.confirmationTimer = setTimeout(() => {
      this.confirmationTimer = null;
      if (!this.running || this.paused || !this.waitingForResult) return;
      this.finish({ reason: 'completed', verified: false, message: 'The website has not confirmed the result. Check the website before trying again.' });
    }, this.confirmationTimeout);
  }
  private forgetObservation(index: number): void { const previous = this.observations.get(index); if (previous?.timer) clearTimeout(previous.timer); this.observations.delete(index); }
  private remember(index: number, target: HTMLElement, kind: Observation['kind'], ready: boolean): void {
    this.forgetObservation(index);
    const observation: Observation = { target, kind, ready, timer: null };
    this.observations.set(index, observation);
    if (kind === 'text' && !ready && valid(target) && !this.composing.has(target)) {
      observation.timer = setTimeout(() => {
        observation.timer = null;
        if (!this.running || this.observations.get(index) !== observation) return;
        if (this.safeTarget(index) !== target || !valid(target) || this.composing.has(target)) { this.forgetObservation(index); if (index === this.index) this.refresh(); return; }
        observation.ready = true;
        if (this.index === index && this.automatic && !this.paused) this.complete();
      }, quietMs);
    }
    if (ready && index === this.index) this.consumeObservation();
  }
  private consumeObservation(): void {
    if (!this.running || this.paused || !this.automatic) return;
    const observation = this.observations.get(this.index);
    if (!observation?.ready || this.composing.has(observation.target)) return;
    if (this.safeTarget(this.index) !== observation.target || !valid(observation.target)) { this.forgetObservation(this.index); return; }
    this.later(observation.target, 0, () => this.complete());
  }
  private resumeObservation(): void {
    if (!this.running || this.paused || !this.automatic) return;
    const observation = this.observations.get(this.index);
    if (!observation) return;
    if (this.safeTarget(this.index) !== observation.target || !valid(observation.target) || this.composing.has(observation.target)) return;
    if (!observation.ready && !observation.timer && observation.kind === 'text') this.remember(this.index, observation.target, 'text', false);
    else this.consumeObservation();
  }
  private cancelStepTimer(): void { this.epoch++; if (this.stepTimer) clearTimeout(this.stepTimer); this.stepTimer = null; }
  private later(target: HTMLElement, delay: number, callback: () => void): void {
    this.cancelStepTimer(); if (!this.automatic || this.paused) return;
    const epoch = this.epoch; const index = this.index;
    this.stepTimer = setTimeout(() => {
      this.stepTimer = null;
      if (!this.running || this.paused || !this.automatic || epoch !== this.epoch || index !== this.index) return;
      if (this.safeTarget(index) !== target || !valid(target) || this.composing.has(target)) { this.refresh(); return; }
      callback();
    }, delay);
  }
  private emit(): void {
    if (!this.running) return;
    const target = this.target;
    let hint = 'Follow this step, then choose Next.';
    if (target) {
      if (textarea(target)) hint = 'Write your text, then leave the field to continue.';
      else if (choice(target)) hint = 'Make your selection. I’ll follow your changes.';
      else if (input(target) && !clickable(target)) hint = 'Type here. I’ll move on when you finish.';
      else if (clickable(target)) hint = this.index === this.steps.length - 1 ? 'Click this control. I’ll wait for the website to confirm the result.' : 'Click this control to continue.';
    }
    if (this.waitingForResult) hint = 'Waiting for the website to confirm the result…';
    if (this.hostPending) hint = this.hostMessage;
    if (this.failure) hint = this.failure;
    if (!target && !this.waitingForResult) hint = 'This control changed. Waiting for the page…';
    if (!this.automatic) hint = 'Automatic progress is off. Follow this step, then choose Next.';
    if (this.paused) hint = 'Guidance is paused. Resume when you’re ready.';
    const state: GuidanceState = { index: this.index, total: this.steps.length, completed: this.completed.size, step: { ...this.steps[this.index]! }, target, hint, automatic: this.automatic, paused: this.paused, waiting: this.waitingForResult || !target, confirmationPending: this.waitingForResult, hostPending: this.hostPending };
    if (this.lastState && Object.entries(state).every(([key, value]) => key === 'step' || this.lastState?.[key as keyof GuidanceState] === value)) return;
    this.lastState = state; this.callbacks.onUpdate(state);
  }

  private onEvent = (event: Event): void => {
    if (!this.running || event.isTrusted === false || guideControl(event.target) || this.hostPending) return;
    if (event.type === 'submit') { this.onSubmit(event); return; }
    if (!(event.target instanceof HTMLElement)) return;
    const source = event.target;
    const matches = this.steps.flatMap((_, index) => { const target = this.safeTarget(index); return target === source || (event.type === 'click' && Boolean(target && clickable(target) && target.contains(source))) ? [index] : []; });
    const index = matches.includes(this.index) ? this.index : matches.sort((left, right) => Math.abs(left - this.index) - Math.abs(right - this.index) || right - left)[0] ?? -1;
    if (index < 0) return;
    if ((event.type === 'focusin' || event.type === 'input') && index < this.index) this.move(index, false);
    const target = this.safeTarget(index); if (!target || !enabled(target)) return;
    if (event.type === 'focusin') { if (index === this.index) { this.cancelStepTimer(); this.resumeObservation(); } return; }
    if (event.type === 'compositionstart') { this.composing.add(target); this.forgetObservation(index); if (index === this.index) this.cancelStepTimer(); return; }
    if (event.type === 'compositionend') {
      this.composing.delete(target);
      if (this.edited.get(index) === target && input(target) && !choice(target) && !clickable(target) && valid(target)) this.remember(index, target, 'text', false);
      return;
    }
    if (event.type === 'input') {
      if (index === this.index) { this.cancelStepTimer(); this.clearConfirmationTimer(); this.failure = ''; this.waitingForResult = false; }
      this.completed.delete(index); this.edited.set(index, target); this.deferredResult = null; this.submitted = null;
      if ((event as InputEvent).isComposing) this.composing.add(target);
      if (textarea(target)) this.remember(index, target, 'textarea', false);
      else if (input(target) && !choice(target) && !clickable(target)) this.remember(index, target, 'text', false);
      else if (choice(target)) this.remember(index, target, 'choice', false);
      this.emit(); return;
    }
    if (event.type === 'change') {
      this.forgetObservation(index); this.completed.delete(index); this.edited.set(index, target); this.deferredResult = null;
      if (!valid(target) || this.composing.has(target)) return;
      if (index === this.index) this.failure = '';
      if (choice(target)) this.remember(index, target, 'choice', true);
      else if (textarea(target)) this.remember(index, target, 'textarea', true);
      else if (input(target) && !clickable(target)) this.remember(index, target, 'text', false);
      return;
    }
    if (event.type === 'focusout') {
      const destination = (event as FocusEvent).relatedTarget;
      if (guideControl(destination)) {
        const observation = this.observations.get(index);
        if (observation?.timer) { clearTimeout(observation.timer); observation.timer = null; }
        if (index === this.index) this.cancelStepTimer();
        return;
      }
      if (this.edited.get(index) === target && valid(target) && !this.composing.has(target)) {
        if (textarea(target)) this.remember(index, target, 'textarea', true);
        else if (input(target) && !choice(target) && !clickable(target) && destination !== target && pageControl(destination)) this.remember(index, target, 'text', true);
      }
      return;
    }
    if (index !== this.index) return;
    if (event.type === 'click' && clickable(target) && valid(target) && this.automatic && !this.paused) {
      this.failure = ''; this.cancelStepTimer();
      const form = formFor(target);
      if (form && !validForm(form)) { this.failure = 'Finish the required fields before saving.'; this.emit(); return; }
      if (form || index === this.steps.length - 1) { this.waitingForResult = true; this.awaitConfirmation(); this.emit(); }
      else {
        this.clicked = { index, target, nextBefore: this.safeTarget(index + 1) };
        const epoch = this.epoch;
        this.stepTimer = setTimeout(() => {
          this.stepTimer = null;
          if (!this.running || this.paused || !this.automatic || epoch !== this.epoch || this.index !== index) return;
          if (this.safeTarget(index) === target && valid(target)) this.complete();
          else this.refresh();
        }, 0);
      }
    }
  };

  private onSubmit(event: Event): void {
    if (!this.automatic || this.paused) return;
    const target = this.safeTarget(this.index); const form = target ? formFor(target) : null;
    if (!form || event.target !== form || !validForm(form)) return;
    this.cancelStepTimer(); this.waitingForResult = true; this.failure = '';
    this.awaitConfirmation();
    this.submitted = { index: this.index, nextBefore: this.safeTarget(this.index + 1) };
    this.emit();
    // A newly displayed next known control is evidence that a nonfinal form step advanced.
    if (this.index < this.steps.length - 1) {
      const epoch = this.epoch;
      this.stepTimer = setTimeout(() => { this.stepTimer = null; if (this.running && epoch === this.epoch) this.refresh(); }, 0);
    }
  }
  private finish(result: GuidanceResult): void { if (!this.running) return; this.running = false; this.cleanup(); this.callbacks.onFinish(result); }
  private cleanup(): void {
    this.cancelStepTimer();
    this.clearConfirmationTimer();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.observer?.disconnect(); this.observer = null;
    if (this.document) for (const name of events) this.document.removeEventListener(name, this.onEvent, true);
    for (const index of this.observations.keys()) this.forgetObservation(index);
    this.edited.clear();
    this.document = null; this.target = null; this.submitted = null; this.clicked = null; this.deferredResult = null;
  }
}
