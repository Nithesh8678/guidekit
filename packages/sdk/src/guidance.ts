import type { ModelPlan } from '../../contracts/src/index';
import { isSafeTarget } from './context';

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
}
export interface GuidanceResult { reason: 'completed' | 'stopped' | 'missing'; verified: boolean; message?: string; }
interface Callbacks { onUpdate(state: GuidanceState): void; onFinish(result: GuidanceResult): void; }
interface HostResult { success: boolean; message?: string; }
const quietMs = 1200;
const recoveryMs = 1200;
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
function guideControl(target: EventTarget | null): boolean { return target instanceof HTMLElement && Boolean(target.closest('[data-guidekit-root]')); }

/** Local, bounded observation of the known controls in a guide. Never reads values into callbacks. */
export class GuidanceSession {
  private readonly steps: ModelPlan['steps'];
  private running = false;
  private destroyed = false;
  private index = 0;
  private automatic = true;
  private paused = false;
  private completed = new Set<number>();
  private edited = new WeakSet<HTMLElement>();
  private composing = new WeakSet<HTMLElement>();
  private target: HTMLElement | null = null;
  private document: Document | null = null;
  private observer: MutationObserver | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private waitingForResult = false;
  private failure = '';
  private submitted: { index: number; nextBefore: HTMLElement | null } | null = null;
  private deferredResult: { id: string; result: HostResult } | null = null;
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
    this.observer.observe(this.document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'aria-invalid', 'aria-disabled', 'aria-hidden', 'inert', 'hidden', 'style', 'class', 'data-guidekit-private', 'data-guidekit-id'] });
    this.refresh();
  }

  next(): void {
    if (!this.running) return;
    this.completed.add(this.index);
    if (this.index === this.steps.length - 1) { this.finish({ reason: 'completed', verified: false, message: 'Guide ended without a confirmed website result.' }); return; }
    this.move(this.index + 1);
  }
  back(): void { if (this.running) this.move(Math.max(0, this.index - 1)); }
  setAutomatic(value: boolean): void {
    if (!this.running) return;
    this.automatic = value; this.cancelStepTimer(); this.emit();
    if (value && !this.paused) this.applyDeferredResult();
  }
  setPaused(value: boolean): void {
    if (!this.running) return;
    this.paused = value; this.cancelStepTimer(); this.emit();
    if (!value && this.automatic) this.applyDeferredResult();
  }

  reportResult(targetId: string, result: HostResult): void {
    if (!this.running) return;
    const index = this.steps.findIndex(step => step.targetId === targetId);
    if (index < 0 || (index !== this.index && index !== this.steps.length - 1)) return;
    if (this.paused || !this.automatic) { this.deferredResult = { id: targetId, result: { ...result } }; return; }
    this.cancelStepTimer(); this.submitted = null;
    if (!result.success) {
      if (index !== this.index) return;
      this.waitingForResult = false;
      this.failure = result.message?.trim().slice(0, 240) || 'The website could not complete that action. Try again.';
      this.emit(); return;
    }
    if (index === this.steps.length - 1) { this.finish({ reason: 'completed', verified: true, message: 'The website confirmed the result.' }); return; }
    this.complete();
  }

  refresh(): void {
    if (!this.running) return;
    if (this.submitted && this.automatic && !this.paused && this.index < this.steps.length - 1) {
      const next = this.safeTarget(this.index + 1);
      if (next && next !== this.submitted.nextBefore) { this.complete(); return; }
    }
    const target = this.safeTarget(this.index);
    if (target !== this.target) { this.cancelStepTimer(); this.target = target; }
    if (target) {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    } else if (!this.recoveryTimer) {
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        if (!this.running) return;
        if (this.safeTarget(this.index)) this.refresh();
        else this.finish({ reason: 'missing', verified: false, message: 'This control is no longer available. Ask for an updated guide.' });
      }, recoveryMs);
    }
    this.emit();
  }
  stop(reason: 'stopped' | 'missing' = 'stopped'): void { if (this.running) this.finish({ reason, verified: false }); }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.stop(); this.cleanup(); }

  private safeTarget(index: number): HTMLElement | null {
    const step = this.steps[index]; if (!step) return null;
    try { const target = this.resolve(step.targetId); return target && isSafeTarget(target) ? target : null; } catch { return null; }
  }
  private move(index: number): void {
    this.cancelStepTimer();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null; this.index = index; this.target = null; this.waitingForResult = false; this.failure = ''; this.submitted = null; this.lastState = null;
    this.refresh();
  }
  private complete(): void {
    if (!this.running || this.paused || !this.automatic) return;
    this.completed.add(this.index);
    let next = this.steps.findIndex((_, index) => index > this.index && !this.completed.has(index));
    if (next < 0) next = this.steps.findIndex((_, index) => !this.completed.has(index));
    if (next < 0) this.finish({ reason: 'completed', verified: false, message: 'All guidance steps were followed. No website result was independently confirmed.' });
    else this.move(next);
  }
  private applyDeferredResult(): void { const pending = this.deferredResult; this.deferredResult = null; if (pending) this.reportResult(pending.id, pending.result); }
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
    if (this.failure) hint = this.failure;
    if (!target) hint = 'This control changed. Waiting for the page…';
    if (!this.automatic) hint = 'Automatic progress is off. Follow this step, then choose Next.';
    if (this.paused) hint = 'Guidance is paused. Resume when you’re ready.';
    const state: GuidanceState = { index: this.index, total: this.steps.length, completed: this.completed.size, step: { ...this.steps[this.index]! }, target, hint, automatic: this.automatic, paused: this.paused, waiting: this.waitingForResult || !target };
    if (this.lastState && Object.entries(state).every(([key, value]) => key === 'step' || this.lastState?.[key as keyof GuidanceState] === value)) return;
    this.lastState = state; this.callbacks.onUpdate(state);
  }

  private onEvent = (event: Event): void => {
    if (!this.running || event.isTrusted === false || guideControl(event.target)) return;
    if (event.type === 'submit') { this.onSubmit(event); return; }
    if (!(event.target instanceof HTMLElement)) return;
    const source = event.target;
    const index = this.steps.findIndex((_, index) => { const target = this.safeTarget(index); return target === source || (event.type === 'click' && Boolean(target && clickable(target) && target.contains(source))); });
    if (index < 0) return;
    if ((event.type === 'focusin' || event.type === 'input') && index < this.index) this.move(index);
    if (index !== this.index) return;
    const target = this.safeTarget(index); if (!target || !enabled(target)) return;
    if (event.type === 'focusin') { this.cancelStepTimer(); return; }
    if (event.type === 'compositionstart') { this.composing.add(target); this.cancelStepTimer(); return; }
    if (event.type === 'compositionend') {
      this.composing.delete(target);
      if (this.edited.has(target) && input(target) && !choice(target) && !clickable(target) && valid(target)) this.later(target, quietMs, () => this.complete());
      return;
    }
    if (event.type === 'input') {
      this.cancelStepTimer(); this.completed.delete(index); this.edited.add(target); this.failure = ''; this.waitingForResult = false;
      if ((event as InputEvent).isComposing) this.composing.add(target);
      if (input(target) && !choice(target) && !clickable(target) && valid(target) && !this.composing.has(target)) this.later(target, quietMs, () => this.complete());
      this.emit(); return;
    }
    if (event.type === 'change') {
      if (!valid(target) || this.composing.has(target)) return;
      this.completed.delete(index); this.edited.add(target); this.failure = '';
      if (choice(target) || textarea(target)) this.later(target, 0, () => this.complete());
      else if (input(target) && !clickable(target)) this.later(target, quietMs, () => this.complete());
      return;
    }
    if (event.type === 'focusout') {
      if (guideControl((event as FocusEvent).relatedTarget)) { this.cancelStepTimer(); return; }
      if (textarea(target) && this.edited.has(target) && valid(target) && !this.composing.has(target)) this.later(target, 0, () => this.complete());
      return;
    }
    if (event.type === 'click' && clickable(target) && valid(target) && this.automatic && !this.paused) {
      this.failure = ''; this.cancelStepTimer();
      const form = formFor(target);
      if (form && !validForm(form)) { this.failure = 'Finish the required fields before saving.'; this.emit(); return; }
      if (form || index === this.steps.length - 1) { this.waitingForResult = true; this.emit(); }
      else this.later(target, 0, () => this.complete());
    }
  };

  private onSubmit(event: Event): void {
    if (!this.automatic || this.paused) return;
    const target = this.safeTarget(this.index); const form = target ? formFor(target) : null;
    if (!form || event.target !== form || !validForm(form)) return;
    this.cancelStepTimer(); this.waitingForResult = true; this.failure = '';
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
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.observer?.disconnect(); this.observer = null;
    if (this.document) for (const name of events) this.document.removeEventListener(name, this.onEvent, true);
    this.document = null; this.target = null; this.submitted = null; this.deferredResult = null;
  }
}
