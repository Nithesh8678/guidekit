import { isSafeTarget } from './context';

interface Bounds { left: number; top: number; right: number; bottom: number; }
interface Port { element: HTMLElement | null; bounds: Bounds; x: boolean; y: boolean; scaleX: number; scaleY: number; }
interface Move { element: HTMLElement | null; left: number; top: number; fromLeft: number; fromTop: number; }
export type RevealResult = 'ready' | 'interrupted' | 'cancelled';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clips = /^(auto|scroll|hidden|clip)$/;
const scrolls = /^(auto|scroll|hidden)$/;
const epsilon = .75;

/** Nearest edge, with no oscillation for a target larger than its scrollport. */
export function revealDelta(start: number, end: number, min: number, max: number, margin = 28): number {
  if (![start, end, min, max, margin].every(Number.isFinite) || end < start || max <= min || margin < 0) return 0;
  const oversized = end - start > max - min;
  if (oversized && start < max && end > min || start >= min - epsilon && end <= max + epsilon) return 0;
  const inset = Math.min(margin, (max - min) * .15);
  return start < min ? start - min - inset : end > max ? end - max + inset : 0;
}
/** Smooth acceleration and braking, bounded independently of document length. */
export function scrollEase(progress: number): number { const t = clamp(progress, 0, 1); return t < .5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2; }
export function scrollDuration(distance: number): number { return clamp(240 + Math.max(0, distance) * .18, 280, 780); }
function length(value: string, size: number): number {
  const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? Math.max(0, parsed * (value.endsWith('%') ? size / 100 : 1)) : 0;
}
function padded(bounds: Bounds, style: CSSStyleDeclaration, scaleX = 1, scaleY = 1): Bounds {
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  // Keep malformed/extreme author offsets from inverting the usable port.
  return {
    left: bounds.left + Math.min(width * .45, length(style.scrollPaddingLeft, width / scaleX) * scaleX),
    right: bounds.right - Math.min(width * .45, length(style.scrollPaddingRight, width / scaleX) * scaleX),
    top: bounds.top + Math.min(height * .45, length(style.scrollPaddingTop, height / scaleY) * scaleY),
    bottom: bounds.bottom - Math.min(height * .45, length(style.scrollPaddingBottom, height / scaleY) * scaleY)
  };
}
function viewport(): Bounds {
  const view = window.visualViewport, left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
  return { left, top, right: left + (view?.width ?? document.documentElement.clientWidth), bottom: top + (view?.height ?? window.innerHeight) };
}
function ports(target: HTMLElement): Port[] {
  const result: Port[] = [];
  for (let ancestor = target.parentElement, depth = 0; ancestor && depth < 64; ancestor = ancestor.parentElement, depth++) {
    if (ancestor === document.scrollingElement || ancestor === document.documentElement) continue;
    const style = getComputedStyle(ancestor), x = clips.test(style.overflowX), y = clips.test(style.overflowY);
    if (!x && !y) continue;
    const rect = ancestor.getBoundingClientRect(), scaleX = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1, scaleY = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1;
    if (scaleX <= 0 || scaleY <= 0) continue;
    const left = rect.left + ancestor.clientLeft * scaleX, top = rect.top + ancestor.clientTop * scaleY;
    const bounds = padded({ left, top, right: left + ancestor.clientWidth * scaleX, bottom: top + ancestor.clientHeight * scaleY }, style, scaleX, scaleY);
    // An unclipped axis inherits the viewport, not the ancestor's content box.
    const view = viewport(); if (!x) { bounds.left = view.left; bounds.right = view.right; } if (!y) { bounds.top = view.top; bounds.bottom = view.bottom; }
    result.push({ element: ancestor, bounds, x: scrolls.test(style.overflowX), y: scrolls.test(style.overflowY), scaleX, scaleY });
  }
  result.push({ element: null, bounds: padded(viewport(), getComputedStyle(document.documentElement)), x: true, y: true, scaleX: 1, scaleY: 1 });
  return result;
}
function intersection(target: HTMLElement): Bounds {
  const rect = target.getBoundingClientRect(), bounds: Bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  for (const port of ports(target)) {
    bounds.left = Math.max(bounds.left, port.bounds.left); bounds.top = Math.max(bounds.top, port.bounds.top);
    bounds.right = Math.min(bounds.right, port.bounds.right); bounds.bottom = Math.min(bounds.bottom, port.bounds.bottom);
  }
  return bounds;
}
/** Annotation geometry uses the same clipping boundaries as automatic reveal. */
export function revealedBounds(target: HTMLElement): Bounds | null {
  const bounds = intersection(target);
  return bounds.right - bounds.left > epsilon && bounds.bottom - bounds.top > epsilon ? bounds : null;
}
export function targetRevealed(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && ports(target).every(({ bounds }) =>
    revealDelta(rect.left, rect.right, bounds.left, bounds.right, 0) === 0 && revealDelta(rect.top, rect.bottom, bounds.top, bounds.bottom, 0) === 0);
}
function plannedMoves(target: HTMLElement): Move[] {
  const rect = target.getBoundingClientRect(), projected = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, margin = getComputedStyle(target), moves: Move[] = [];
  const chain = ports(target).map(port => {
    const root = document.scrollingElement ?? document.documentElement;
    const maxX = port.element ? Math.max(0, port.element.scrollWidth - port.element.clientWidth) : Math.max(0, root.scrollWidth - document.documentElement.clientWidth);
    const maxY = port.element ? Math.max(0, port.element.scrollHeight - port.element.clientHeight) : Math.max(0, root.scrollHeight - document.documentElement.clientHeight);
    const rtl = port.element && getComputedStyle(port.element).direction === 'rtl';
    return { ...port, fromLeft: port.element?.scrollLeft ?? window.scrollX, fromTop: port.element?.scrollTop ?? window.scrollY, minLeft: rtl ? -maxX : 0, maxLeft: rtl ? 0 : maxX, maxTop: maxY };
  });
  for (let index = 0; index < chain.length; index++) {
    const port = chain[index]!, { fromLeft, fromTop } = port, bounds = { ...port.bounds };
    // A tall inner panel may fit the control while an outer clip hides it.
    // Constrain its usable area by what each outer port can actually reveal;
    // remaining outer travel permits the normal below-the-page window case.
    for (const outer of chain.slice(index + 1)) {
      bounds.left = Math.max(bounds.left, outer.bounds.left - (outer.x ? outer.fromLeft - outer.minLeft : 0) * outer.scaleX);
      bounds.right = Math.min(bounds.right, outer.bounds.right + (outer.x ? outer.maxLeft - outer.fromLeft : 0) * outer.scaleX);
      bounds.top = Math.max(bounds.top, outer.bounds.top - (outer.y ? outer.fromTop : 0) * outer.scaleY);
      bounds.bottom = Math.min(bounds.bottom, outer.bounds.bottom + (outer.y ? outer.maxTop - outer.fromTop : 0) * outer.scaleY);
    }
    const dx = port.x ? revealDelta(projected.left, projected.right, bounds.left, bounds.right, 28 + Math.max(length(margin.scrollMarginLeft, 1), length(margin.scrollMarginRight, 1))) / port.scaleX : 0;
    const dy = port.y ? revealDelta(projected.top, projected.bottom, bounds.top, bounds.bottom, 28 + Math.max(length(margin.scrollMarginTop, 1), length(margin.scrollMarginBottom, 1))) / port.scaleY : 0;
    // Chromium's RTL scrollLeft is negative; retain its native coordinate range.
    const left = clamp(fromLeft + dx, port.minLeft, port.maxLeft), top = clamp(fromTop + dy, 0, port.maxTop);
    projected.left -= (left - fromLeft) * port.scaleX; projected.right -= (left - fromLeft) * port.scaleX;
    projected.top -= (top - fromTop) * port.scaleY; projected.bottom -= (top - fromTop) * port.scaleY;
    if (Math.abs(left - fromLeft) > epsilon || Math.abs(top - fromTop) > epsilon) moves.push({ element: port.element, fromLeft, fromTop, left, top });
  }
  return moves;
}
function write(move: Move, progress: number): void {
  const left = move.fromLeft + (move.left - move.fromLeft) * progress, top = move.fromTop + (move.top - move.fromTop) * progress;
  if (move.element) move.element.scrollTo({ left, top, behavior: 'instant' }); else window.scrollTo({ left, top, behavior: 'instant' });
}

/** One cancelable local reveal. No focus, values, model calls, or idle frame loop. */
export class GuidedReveal {
  active = false;
  private frame = 0;
  private deadline = 0;
  private pass = 0;
  private finished = false;
  constructor(private readonly target: HTMLElement, private readonly current: () => HTMLElement | null, private readonly allowed: () => boolean, private readonly reduced: () => boolean, private readonly complete: (result: RevealResult) => void) {}
  start(): void {
    if (this.finished || this.active) return;
    if (!this.valid()) { this.finish('cancelled'); return; }
    const moves = targetRevealed(this.target) ? [] : plannedMoves(this.target);
    if (!moves.length) { this.finish('ready'); return; }
    this.active = true; this.deadline = performance.now() + 2300;
    document.addEventListener('wheel', this.interrupt, { capture: true, passive: true }); document.addEventListener('touchmove', this.interrupt, { capture: true, passive: true });
    document.addEventListener('pointerdown', this.pointer, true); document.addEventListener('keydown', this.key, true);
    if (this.reduced()) {
      for (let pass = 0, next = moves; pass < 3 && this.valid() && next.length; pass++, next = plannedMoves(this.target)) for (const move of next) write(move, 1);
      this.finish(this.valid() ? 'ready' : 'cancelled'); return;
    }
    this.animate(moves);
  }
  cancel(): void { if (!this.finished) this.finish('cancelled'); }
  private valid(): boolean { return this.allowed() && !document.hidden && isSafeTarget(this.target) && this.current() === this.target; }
  private animate(moves: Move[]): void {
    const started = performance.now(), duration = Math.min(scrollDuration(Math.max(...moves.map(move => Math.hypot(move.left - move.fromLeft, move.top - move.fromTop)))), this.deadline - started);
    ++this.pass;
    const tick = (now: number) => {
      this.frame = 0;
      if (!this.valid()) { this.finish('cancelled'); return; }
      const progress = this.reduced() || duration <= 0 ? 1 : clamp((now - started) / duration, 0, 1);
      for (const move of moves) write(move, scrollEase(progress));
      if (progress < 1) this.frame = requestAnimationFrame(tick); else this.settle();
    };
    this.frame = requestAnimationFrame(tick);
  }
  private settle(): void {
    // Remeasure after layout/scroll observers have run, then correct a changing
    // nested layout at most twice. The whole operation has a fixed deadline.
    let stable = 0, previous = this.target.getBoundingClientRect();
    const check = () => {
      this.frame = 0;
      if (!this.valid()) { this.finish('cancelled'); return; }
      const rect = this.target.getBoundingClientRect();
      stable = Math.abs(rect.left - previous.left) < epsilon && Math.abs(rect.top - previous.top) < epsilon && Math.abs(rect.width - previous.width) < epsilon && Math.abs(rect.height - previous.height) < epsilon ? stable + 1 : 0; previous = rect;
      if (performance.now() >= this.deadline) { this.finish('ready'); return; }
      if (stable < 2) { this.frame = requestAnimationFrame(check); return; }
      const next = targetRevealed(this.target) ? [] : plannedMoves(this.target);
      if (next.length && this.pass < 3) this.animate(next); else this.finish('ready');
    };
    this.frame = requestAnimationFrame(check);
  }
  private interrupt = (): void => this.finish('interrupted');
  private pointer = (event: PointerEvent): void => { if (!(event.target instanceof Element && event.target.closest('[data-guidekit-root]'))) this.interrupt(); };
  private key = (event: KeyboardEvent): void => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape'].includes(event.key)) this.interrupt(); };
  private finish(result: RevealResult): void {
    if (this.finished) return;
    this.finished = true; this.active = false; cancelAnimationFrame(this.frame); this.frame = 0;
    document.removeEventListener('wheel', this.interrupt, true); document.removeEventListener('touchmove', this.interrupt, true); document.removeEventListener('pointerdown', this.pointer, true); document.removeEventListener('keydown', this.key, true);
    this.complete(result);
  }
}
