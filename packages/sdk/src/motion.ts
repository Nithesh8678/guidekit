/** Local browser rendering only. CSS pixels, no page actions and no OS cursor control. */
export interface MotionPoint { x: number; y: number; }
export interface MotionBox { left: number; top: number; width: number; height: number; }
export type AnnotationKind = 'target' | 'ring' | 'frame' | 'arrow' | 'underline' | 'number';
export type CursorActivity = 'pointing' | 'speaking' | 'waiting';
export type CursorLocation = 'docked' | 'flight' | 'target';
export interface AnnotationCommand { id: string; kind: AnnotationKind; box: MotionBox; label?: string; index?: number; }
export interface PresentOptions { animate?: boolean; first?: boolean; pace?: number; onReady?: () => void; }
export interface BoundsOptions { animate?: boolean; }
export interface DockOptions extends BoundsOptions { onReady?: () => void; }
export interface EraseOptions extends BoundsOptions { preserveCursor?: boolean; }
export interface MotionOptions {
  reducedMotion?: boolean;
  /** Injectable monotonic clock/frame scheduler for deterministic tests. */
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}
export const MOTION = Object.freeze({ strokeWidth: 3.5, glowRadius: 12, glowOpacity: 0.65, frameMs: 550, moveMs: 500, eraseMs: 400, firstWaitMs: 450, penEasing: [0.35, 0.2, 0.55, 0.95] as const, editEasing: [0.455, 0.03, 0.515, 0.955] as const });
const MAX_COORDINATE = 1_000_000, MAX_SIZE = 100_000;
const kinds = new Set<AnnotationKind>(['target', 'ring', 'frame', 'arrow', 'underline', 'number']);
const svgNamespace = 'http://www.w3.org/2000/svg';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
function finite(value: number, name: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite.`); return value; }
function point(value: MotionPoint): MotionPoint {
  if (!value || Math.abs(finite(value.x, 'x')) > MAX_COORDINATE || Math.abs(finite(value.y, 'y')) > MAX_COORDINATE) throw new RangeError('Point exceeds the annotation bounds.');
  return { x: value.x, y: value.y };
}
export function validateBox(box: MotionBox): MotionBox {
  if (!box) throw new TypeError('A CSS pixel box is required.');
  const result = { left: finite(box.left, 'left'), top: finite(box.top, 'top'), width: finite(box.width, 'width'), height: finite(box.height, 'height') };
  if (Math.abs(result.left) > MAX_COORDINATE || Math.abs(result.top) > MAX_COORDINATE || result.width < 0.25 || result.height < 0.25 || result.width > MAX_SIZE || result.height > MAX_SIZE || Math.abs(result.left + result.width) > MAX_COORDINATE || Math.abs(result.top + result.height) > MAX_COORDINATE) throw new RangeError('Invalid or excessive annotation bounds.');
  return result;
}
export function smoothstep(progress: number): number { const value = clamp(finite(progress, 'progress'), 0, 1); return value * value * (3 - 2 * value); }
export function penDurationMs(length: number, pace = 1): number {
  if (finite(length, 'length') < 0 || finite(pace, 'pace') <= 0 || pace > 4) throw new RangeError('Invalid pen timing.');
  return clamp(0.25 + length / 1400, 0.3, 1.4) * 1000 * Math.max(pace, 0.35);
}
export function cursorFlightDurationMs(distance: number): number { if (finite(distance, 'distance') < 0) throw new RangeError('Distance must be nonnegative.'); return clamp(distance / 800, 0.6, 1.4) * 1000; }
export function releaseDelayMs(distance: number, first = false): number { if (finite(distance, 'distance') < 0) throw new RangeError('Distance must be nonnegative.'); return first ? MOTION.firstWaitMs : distance >= 110 ? Math.min(550, 200 + distance / 2.4) : 0; }

/** Invert the Bezier's x coordinate, rather than treating its parameter as time. */
export function cubicBezier(progress: number, controls: readonly [number, number, number, number] = MOTION.penEasing): number {
  const value = clamp(finite(progress, 'progress'), 0, 1);
  if (controls.some(control => !Number.isFinite(control) || control < 0 || control > 1)) throw new RangeError('Invalid easing controls.');
  if (value === 0 || value === 1) return value;
  const sample = (time: number, first: number, second: number) => 3 * (1 - time) ** 2 * time * first + 3 * (1 - time) * time ** 2 * second + time ** 3;
  let low = 0, high = 1;
  for (let index = 0; index < 20; index++) { const middle = (low + high) / 2; if (sample(middle, controls[0], controls[2]) < value) low = middle; else high = middle; }
  return sample((low + high) / 2, controls[1], controls[3]);
}

export interface CursorPose extends MotionPoint { rotation: number; scale: number; glowRadius: number; progress: number; }
export interface CursorFlight { start: MotionPoint; end: MotionPoint; control: MotionPoint; startedAt: number; durationMs: number; fromRotation?: number; fromScale?: number; }
export function createFlight(start: MotionPoint, end: MotionPoint, startedAt: number): CursorFlight {
  const from = point(start), to = point(end), distance = Math.hypot(to.x - from.x, to.y - from.y);
  return { start: from, end: to, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - Math.min(distance * 0.2, 80) }, startedAt: finite(startedAt, 'startedAt'), durationMs: cursorFlightDurationMs(distance) };
}
export function sampleFlight(flight: CursorFlight, now: number): CursorPose {
  const progress = clamp((finite(now, 'now') - flight.startedAt) / flight.durationMs, 0, 1), time = smoothstep(progress), inverse = 1 - time;
  const tangent = { x: 2 * inverse * (flight.control.x - flight.start.x) + 2 * time * (flight.end.x - flight.control.x), y: 2 * inverse * (flight.control.y - flight.start.y) + 2 * time * (flight.end.y - flight.control.y) };
  let rotation = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI + 90, scale = 1 + 0.3 * Math.sin(Math.PI * progress);
  if (flight.fromRotation !== undefined) { const delta = ((rotation - flight.fromRotation + 180) % 360 + 360) % 360 - 180; rotation = flight.fromRotation + delta * time; }
  if (flight.fromScale !== undefined) scale = mix(flight.fromScale, scale, time);
  return { x: inverse ** 2 * flight.start.x + 2 * inverse * time * flight.control.x + time ** 2 * flight.end.x, y: inverse ** 2 * flight.start.y + 2 * inverse * time * flight.control.y + time ** 2 * flight.end.y, rotation, scale, glowRadius: 8 + (scale - 1) * 20, progress };
}
/** A retarget keeps the current presentation position, angle and scale. */
export function retargetFlight(flight: CursorFlight, end: MotionPoint, now: number): CursorFlight {
  const current = sampleFlight(flight, Math.max(flight.startedAt, finite(now, 'now')));
  return { ...createFlight(current, end, now), fromRotation: current.rotation, fromScale: current.scale };
}

export interface AnnotationPath { d: string; length: number; }
export interface AnnotationGeometry { paths: AnnotationPath[]; length: number; label: { x: number; y: number; text: string } | null; }
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) { state ^= seed.charCodeAt(index); state = Math.imul(state, 16777619); }
  return () => { state += 0x6d2b79f5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
const number = (value: number) => String(Math.round(value * 1000) / 1000);
function curve(start: MotionPoint, control: MotionPoint, end: MotionPoint): AnnotationPath {
  let length = 0, previous = start;
  for (let index = 1; index <= 24; index++) { const time = index / 24, inverse = 1 - time, current = { x: inverse ** 2 * start.x + 2 * inverse * time * control.x + time ** 2 * end.x, y: inverse ** 2 * start.y + 2 * inverse * time * control.y + time ** 2 * end.y }; length += Math.hypot(current.x - previous.x, current.y - previous.y); previous = current; }
  return { d: `M${number(start.x)} ${number(start.y)} Q${number(control.x)} ${number(control.y)} ${number(end.x)} ${number(end.y)}`, length: Math.max(0.001, length) };
}
function validateCommand(command: AnnotationCommand): AnnotationCommand {
  if (!command || typeof command.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(command.id) || !kinds.has(command.kind)) throw new TypeError('Invalid semantic annotation command.');
  if (command.label !== undefined && (typeof command.label !== 'string' || command.label.length > 120 || /[\u0000-\u001f]/.test(command.label))) throw new TypeError('Annotation labels must be bounded plain text.');
  if (command.index !== undefined && (!Number.isInteger(command.index) || command.index < 1 || command.index > 99)) throw new RangeError('Annotation number must be between 1 and 99.');
  return { ...command, box: validateBox(command.box) };
}
/** Stable local geometry is prepared once per semantic/bounds change, never randomly per frame. */
export function annotationGeometry(input: AnnotationCommand): AnnotationGeometry {
  const command = validateCommand(input), { width, height } = command.box, random = seeded(`${command.id}:${command.kind}`), paths: AnnotationPath[] = [];
  const wobble = () => (random() - 0.5) * 1.4, bow = () => (random() - 0.5) * Math.min(2.5, Math.min(width, height) * 0.04);
  const line = (x1: number, y1: number, x2: number, y2: number) => paths.push(curve({ x: x1, y: y1 }, { x: (x1 + x2) / 2 + bow(), y: (y1 + y2) / 2 + bow() }, { x: x2, y: y2 }));
  if (command.kind === 'ring' || command.kind === 'number') {
    const center = command.kind === 'number' ? { x: 0, y: 0 } : { x: width / 2, y: height / 2 }, radiusX = command.kind === 'number' ? 14 : width / 2 + 6, radiusY = command.kind === 'number' ? 14 : height / 2 + 6;
    const count = 16, points = Array.from({ length: count }, (_, index) => { const angle = index / count * Math.PI * 2 - Math.PI / 2; return { x: center.x + Math.cos(angle) * (radiusX + wobble()), y: center.y + Math.sin(angle) * (radiusY + wobble()) }; });
    for (let index = 0; index < count; index++) { const current = points[index]!, next = points[(index + 1) % count]!, angle = (index + 0.5) / count * Math.PI * 2 - Math.PI / 2; paths.push(curve(current, { x: center.x + Math.cos(angle) * radiusX / Math.cos(Math.PI / count), y: center.y + Math.sin(angle) * radiusY / Math.cos(Math.PI / count) }, next)); }
  } else if (command.kind === 'frame') {
    line(-6, -6, width + 6, -6); line(width + 6, -6, width + 6, height + 6); line(width + 6, height + 6, -6, height + 6); line(-6, height + 6, -6, -6);
  } else if (command.kind === 'target') {
    const length = Math.min(20, Math.max(7, Math.min(width, height) * 0.3));
    for (const [x, y, directionX, directionY] of [[-5, -5, 1, 1], [width + 5, -5, -1, 1], [width + 5, height + 5, -1, -1], [-5, height + 5, 1, -1]]) {
      paths.push({ d: `M${number(x! + directionX! * length)} ${number(y!)} Q${number(x! + wobble())} ${number(y! + wobble())} ${number(x!)} ${number(y! + directionY! * length)}`, length: length * 1.65 });
    }
  } else if (command.kind === 'underline') {
    line(0, height + 6, width, height + 6 + wobble());
  } else {
    const end = { x: width / 2, y: height / 2 }, start = { x: -Math.min(70, width / 2 + 24), y: -Math.min(45, height / 2 + 16) }, control = { x: start.x * 0.25, y: start.y - 12 };
    paths.push(curve(start, control, end)); const angle = Math.atan2(end.y - control.y, end.x - control.x), size = 12;
    line(end.x - Math.cos(angle - 0.5) * size, end.y - Math.sin(angle - 0.5) * size, end.x, end.y); line(end.x, end.y, end.x - Math.cos(angle + 0.5) * size, end.y - Math.sin(angle + 0.5) * size);
  }
  const label = command.kind === 'number' ? { x: 0, y: 0, text: String(command.index ?? 1) } : command.label ? { x: 0, y: -18, text: command.label } : null;
  return { paths, length: paths.reduce((sum, path) => sum + path.length, 0), label };
}

interface BoxMove { from: MotionBox; to: MotionBox; startedAt: number; durationMs: number; }
interface Mark {
  command: AnnotationCommand; geometry: AnnotationGeometry; group: SVGGElement; ink: SVGPathElement[]; glow: SVGPathElement[]; text: SVGTextElement;
  box: MotionBox; move: BoxMove | null; releaseAt: number; durationMs: number; revealed: number; ready: boolean; waitForArrival: boolean; onReady?: () => void;
}
interface Erasing { mark: Mark; startedAt: number; }
const sameBox = (first: MotionBox, second: MotionBox) => first.left === second.left && first.top === second.top && first.width === second.width && first.height === second.height;
const boxAt = (move: BoxMove, now: number): MotionBox => { const progress = move.durationMs ? cubicBezier((now - move.startedAt) / move.durationMs, MOTION.editEasing) : 1; return { left: mix(move.from.left, move.to.left, progress), top: mix(move.from.top, move.to.top, progress), width: mix(move.from.width, move.to.width, progress), height: mix(move.from.height, move.to.height, progress) }; };
const anchor = (box: MotionBox): MotionPoint => ({ x: box.left + 8, y: box.top + 12 });
let instanceId = 0;

/** One retained SVG surface, at most two marks during erase, and one frame callback. */
export class MotionDirector {
  readonly element: SVGSVGElement;
  private readonly document: Document;
  private readonly clock: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly cursor: SVGGElement;
  private readonly cursorGlow: SVGPathElement;
  private readonly pointing: SVGGElement;
  private readonly waveform: SVGGElement;
  private readonly spinner: SVGGElement;
  private readonly activityAnimations: SVGElement[] = [];
  private activity: CursorActivity = 'pointing';
  private readonly media: MediaQueryList | null;
  private current: Mark | null = null;
  private erasing: Erasing | null = null;
  private flight: CursorFlight | null = null;
  private cursorPose: CursorPose | null = null;
  private cursorRetained = false;
  private cursorLocation: CursorLocation = 'docked';
  private dockTarget: MotionPoint | null = null;
  private dockReady: (() => void) | undefined;
  private visible = true;
  private paused = false;
  private reduced: boolean;
  private destroyed = false;
  private frame: number | null = null;
  private frameEpoch = 0;
  private suspendedAt: number | null = null;
  private lastNow = -Infinity;
  private generation = 0;
  private frames = 0;
  private lastFrameAt: number | null = null;
  private maxFrameDeltaMs = 0;
  private timings = { penDurationMs: 0, flightDurationMs: 0, releaseDelayMs: 0 };
  private readonly filterId: string;

  constructor(shadow: ShadowRoot, options: MotionOptions = {}) {
    this.document = shadow.ownerDocument;
    const window = this.document.defaultView;
    if (!window && (!options.now || !options.requestFrame || !options.cancelFrame)) throw new Error('MotionDirector needs a browser frame scheduler.');
    this.clock = options.now ?? (() => window!.performance.now()); this.requestFrame = options.requestFrame ?? (callback => window!.requestAnimationFrame(callback)); this.cancelFrame = options.cancelFrame ?? (handle => window!.cancelAnimationFrame(handle));
    this.media = options.reducedMotion === undefined && window?.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = options.reducedMotion ?? this.media?.matches ?? false;
    this.element = this.svg('svg'); this.element.setAttribute('data-gk-annotation', ''); this.element.setAttribute('class', 'gk-annotation'); this.element.setAttribute('aria-hidden', 'true'); this.element.setAttribute('focusable', 'false');
    Object.assign(this.element.style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', color: 'var(--gk-accent, #365cf5)' });
    const definitions = this.svg('defs'), filter = this.svg('filter'), blur = this.svg('feGaussianBlur');
    this.filterId = `gk-motion-glow-${++instanceId}`; filter.setAttribute('id', this.filterId); filter.setAttribute('x', '-100%'); filter.setAttribute('y', '-100%'); filter.setAttribute('width', '300%'); filter.setAttribute('height', '300%'); blur.setAttribute('stdDeviation', String(MOTION.glowRadius)); filter.append(blur); definitions.append(filter);
    this.cursor = this.svg('g'); this.cursor.setAttribute('data-gk-cursor', ''); this.cursor.setAttribute('opacity', '0');
    this.cursor.setAttribute('data-gk-cursor-mode', this.activity);
    this.cursor.setAttribute('data-gk-cursor-location', this.cursorLocation);
    this.pointing = this.svg('g'); this.pointing.setAttribute('data-gk-cursor-surface', 'pointing');
    this.waveform = this.svg('g'); this.waveform.setAttribute('data-gk-cursor-surface', 'speaking');
    this.spinner = this.svg('g'); this.spinner.setAttribute('data-gk-cursor-surface', 'waiting');
    const animationStyles = this.svg('style'); animationStyles.textContent = '@keyframes gk-motion-wave{from{transform:scaleY(.55)}to{transform:scaleY(1)}}@keyframes gk-motion-spin{to{transform:rotate(360deg)}}';
    const triangle = this.svg('path'); triangle.setAttribute('d', 'M0 -10 L8 10 L0 6 L-8 10 Z'); triangle.setAttribute('fill', 'currentColor'); triangle.setAttribute('stroke', 'white'); triangle.setAttribute('stroke-width', '1.2');
    this.cursorGlow = triangle.cloneNode(false) as SVGPathElement; this.cursorGlow.setAttribute('stroke', 'none'); this.cursorGlow.setAttribute('opacity', String(MOTION.glowOpacity)); this.cursorGlow.style.filter = 'blur(8px)'; this.pointing.append(this.cursorGlow, triangle);
    for (const [index, weight] of [0.4, 0.7, 1, 0.7, 0.4].entries()) {
      const bar = this.svg('rect'); bar.setAttribute('x', String(index * 5 - 11.5)); bar.setAttribute('y', String(-9 * weight)); bar.setAttribute('width', '3'); bar.setAttribute('height', String(18 * weight)); bar.setAttribute('rx', '1.5'); bar.setAttribute('fill', 'currentColor'); bar.setAttribute('data-gk-wave-weight', String(weight));
      Object.assign(bar.style, { transformBox: 'fill-box', transformOrigin: 'center', animation: `gk-motion-wave 0.8s ${index * -0.09}s ease-in-out infinite alternate` }); this.waveform.append(bar); this.activityAnimations.push(bar);
    }
    const spinner = this.svg('circle'); spinner.setAttribute('cx', '0'); spinner.setAttribute('cy', '0'); spinner.setAttribute('r', '9'); spinner.setAttribute('fill', 'none'); spinner.setAttribute('stroke', 'currentColor'); spinner.setAttribute('stroke-width', '2.5'); spinner.setAttribute('stroke-linecap', 'round'); spinner.setAttribute('stroke-dasharray', '38 19');
    Object.assign(spinner.style, { transformOrigin: '0px 0px', animation: 'gk-motion-spin 0.8s linear infinite' }); this.spinner.append(spinner); this.activityAnimations.push(spinner);
    this.cursor.append(this.pointing, this.waveform, this.spinner);
    this.element.append(definitions, animationStyles, this.cursor); shadow.append(this.element); this.syncActivity();
    this.media?.addEventListener('change', this.onReducedMotion); this.document.addEventListener('visibilitychange', this.onVisibility);
    if (this.document.hidden) this.suspend();
  }
  get ready(): boolean { return this.current?.ready ?? Boolean(this.dockTarget && this.cursorPose && !this.flight); }
  get location(): CursorLocation { return this.cursorLocation; }
  get diagnostics(): Readonly<{ generation: number; ready: boolean; location: CursorLocation; cursor: Readonly<CursorPose> | null; framePending: boolean; annotations: number; paths: number; frames: number; maxFrameDeltaMs: number; penDurationMs: number; flightDurationMs: number; releaseDelayMs: number }> {
    return { generation: this.generation, ready: this.ready, location: this.location, cursor: this.cursorPose ? { ...this.cursorPose } : null, framePending: this.frame !== null, annotations: Number(!!this.current) + Number(!!this.erasing), paths: (this.current?.geometry.paths.length ?? 0) + (this.erasing?.mark.geometry.paths.length ?? 0), frames: this.frames, maxFrameDeltaMs: this.maxFrameDeltaMs, ...this.timings };
  }
  /** The supplied viewport point is the retained cursor group's center/origin. */
  dock(input: MotionPoint, options: DockOptions = {}): void {
    if (this.destroyed) return;
    const destination = point(input), now = this.time(); this.sample(now);
    if (this.dockTarget?.x === destination.x && this.dockTarget.y === destination.y && !this.current && !this.erasing) {
      this.dockReady = options.onReady ?? this.dockReady; this.notifyReady(); return;
    }
    const returning = Boolean(this.flight && this.dockTarget), animate = !this.reduced && Boolean(this.cursorPose) && (options.animate === true || returning);
    this.stopFrame(); ++this.generation; this.current?.group.remove(); this.erasing?.mark.group.remove(); this.current = null; this.erasing = null;
    this.dockTarget = destination; this.dockReady = options.onReady; this.cursorRetained = true;
    const start = this.cursorPose;
    this.flight = animate && start ? { ...createFlight(start, destination, now), fromRotation: start.rotation, fromScale: start.scale } : null;
    if (!this.flight) this.cursorPose = { ...destination, rotation: 0, scale: 1, glowRadius: 8, progress: 1 };
    this.locate(this.flight ? 'flight' : 'docked');
    this.timings = { penDurationMs: 0, flightDurationMs: this.flight?.durationMs ?? 0, releaseDelayMs: 0 };
    this.render(now); this.schedule();
  }
  present(input: AnnotationCommand, options: PresentOptions = {}): void {
    if (this.destroyed) return;
    const command = validateCommand(input), now = this.time(), animate = options.animate !== false && !this.reduced;
    // Validate timing before changing any retained state.
    const geometry = annotationGeometry(command), duration = command.kind === 'frame' ? MOTION.frameMs * Math.max(options.pace ?? 1, 0.35) : penDurationMs(geometry.length, options.pace ?? 1);
    penDurationMs(0, options.pace ?? 1);
    if (this.current?.command.id === command.id && this.current.command.kind === command.kind) {
      this.current.command = { ...command, box: this.current.command.box }; this.current.onReady = options.onReady ?? this.current.onReady; this.patchLabel(this.current, geometry);
      this.updateBounds(command.box, { animate }); this.notifyReady(); return;
    }
    this.sample(now); ++this.generation;
    const fromDock = this.dockTarget !== null;
    this.dockTarget = null; this.dockReady = undefined; this.cursorRetained = true;
    this.current?.group.removeAttribute('data-gk-shape');
    this.erasing?.mark.group.remove(); this.erasing = this.current && animate ? { mark: this.current, startedAt: now } : null;
    if (this.current && !animate) this.current.group.remove();
    const end = anchor(command.box), start = this.cursorPose ?? { x: Math.max(20, end.x - 80), y: Math.max(20, end.y - 60) }, distance = Math.hypot(end.x - start.x, end.y - start.y), first = fromDock || (options.first ?? !this.current);
    this.flight = animate ? { ...createFlight(start, end, now), ...(this.cursorPose ? { fromRotation: this.cursorPose.rotation, fromScale: this.cursorPose.scale } : {}) } : null;
    const delay = animate ? Math.max(releaseDelayMs(distance, first), first ? this.flight?.durationMs ?? 0 : 0) : 0;
    if (!animate) this.cursorPose = { ...end, rotation: 0, scale: 1, glowRadius: 8, progress: 1 };
    this.current = this.createMark(command, geometry, now + delay, animate ? duration : 0, options.onReady);
    this.current.waitForArrival = first; this.locate(this.flight ? 'flight' : 'target');
    this.timings = { penDurationMs: animate ? duration : 0, flightDurationMs: this.flight?.durationMs ?? 0, releaseDelayMs: delay };
    this.lastFrameAt = null; this.frames = 0; this.maxFrameDeltaMs = 0;
    this.render(now); this.schedule();
  }
  updateBounds(input: MotionBox, options: BoundsOptions = {}): void {
    if (this.destroyed) return;
    const box = validateBox(input), mark = this.current; if (!mark || sameBox(mark.command.box, box) && !mark.move) return;
    if (sameBox(mark.command.box, box)) return;
    const now = this.time(); this.sample(now);
    const from = { ...mark.box }, animate = options.animate === true && !this.reduced, flying = Boolean(this.flight) && !this.reduced;
    mark.command = { ...mark.command, box }; mark.geometry = annotationGeometry(mark.command); this.patchPaths(mark); this.patchLabel(mark, mark.geometry);
    mark.move = animate ? { from, to: box, startedAt: now, durationMs: MOTION.moveMs } : null; mark.box = animate ? from : box;
    const end = anchor(box);
    this.flight = animate || flying ? this.flight ? retargetFlight(this.flight, end, now) : { ...createFlight(this.cursorPose ?? anchor(from), end, now), ...(this.cursorPose ? { fromRotation: this.cursorPose.rotation, fromScale: this.cursorPose.scale } : {}) } : null;
    if (this.flight && mark.waitForArrival && mark.revealed === 0) mark.releaseAt = Math.max(mark.releaseAt, now + this.flight.durationMs);
    if (!this.flight) this.cursorPose = { ...end, rotation: this.cursorPose?.rotation ?? 0, scale: 1, glowRadius: 8, progress: 1 };
    this.locate(this.flight ? 'flight' : 'target');
    this.render(now); this.schedule();
  }
  setVisible(value: boolean): void {
    if (this.destroyed || this.visible === value) return;
    this.visible = value; this.element.style.visibility = value ? 'visible' : 'hidden'; this.syncSuspension();
  }
  /** State changes only; actual speech start/end ownership stays with the host. */
  setActivity(value: CursorActivity): void {
    if (this.destroyed) return;
    if (!['pointing', 'speaking', 'waiting'].includes(value)) throw new TypeError('Unknown cursor activity.');
    this.activity = value; this.cursor.setAttribute('data-gk-cursor-mode', value); this.syncActivity();
  }
  setPaused(value: boolean): void { if (this.destroyed || this.paused === value) return; this.paused = value; this.element.style.opacity = value ? '0.5' : '1'; this.syncSuspension(); }
  erase(options: EraseOptions = {}): void {
    if (this.destroyed) return;
    const now = this.time(); this.sample(now); ++this.generation; this.erasing?.mark.group.remove();
    this.current?.group.removeAttribute('data-gk-shape');
    if (this.current && options.animate !== false && !this.reduced) { this.current.onReady = undefined; this.erasing = { mark: this.current, startedAt: now }; }
    else { this.current?.group.remove(); this.erasing = null; }
    this.current = null; this.flight = null; this.dockTarget = null; this.dockReady = undefined; this.cursorRetained = options.preserveCursor === true;
    this.locate('target'); this.render(now); this.stopFrame(); this.schedule();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; ++this.generation; this.stopFrame(); this.current = null; this.erasing = null; this.flight = null; this.cursorPose = null; this.dockTarget = null; this.dockReady = undefined; this.cursorRetained = false;
    this.media?.removeEventListener('change', this.onReducedMotion); this.document.removeEventListener('visibilitychange', this.onVisibility); this.element.remove();
  }
  private svg<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] { const node = this.document.createElementNS(svgNamespace, name); node.setAttribute('pointer-events', 'none'); return node; }
  private createMark(command: AnnotationCommand, geometry: AnnotationGeometry, releaseAt: number, durationMs: number, onReady?: () => void): Mark {
    const group = this.svg('g'), glowing = this.svg('g'), ink = this.svg('g'), text = this.svg('text'); group.setAttribute('data-gk-mark', command.id); group.setAttribute('data-gk-shape', command.kind); group.setAttribute('data-kind', command.kind); glowing.setAttribute('filter', `url(#${this.filterId})`); glowing.setAttribute('opacity', String(MOTION.glowOpacity));
    const mark: Mark = { command, geometry, group, ink: [], glow: [], text, box: { ...command.box }, move: null, releaseAt, durationMs, revealed: 0, ready: false, waitForArrival: false, onReady };
    for (const path of geometry.paths) {
      const stroke = this.svg('path'); stroke.setAttribute('d', path.d); stroke.setAttribute('fill', 'none'); stroke.setAttribute('stroke', 'currentColor'); stroke.setAttribute('stroke-width', String(MOTION.strokeWidth)); stroke.setAttribute('vector-effect', 'non-scaling-stroke'); stroke.setAttribute('stroke-linecap', 'round'); stroke.setAttribute('stroke-linejoin', 'round'); stroke.setAttribute('pathLength', '1'); stroke.setAttribute('stroke-dasharray', '1'); stroke.setAttribute('stroke-dashoffset', '1');
      const glow = stroke.cloneNode(false) as SVGPathElement; mark.ink.push(stroke); mark.glow.push(glow); glowing.append(glow); ink.append(stroke);
    }
    text.setAttribute('fill', 'currentColor'); text.setAttribute('stroke', 'white'); text.setAttribute('stroke-width', '3'); text.setAttribute('paint-order', 'stroke'); text.setAttribute('font-family', 'system-ui, sans-serif'); text.setAttribute('font-size', command.kind === 'number' ? '13' : '12'); text.setAttribute('font-weight', '700');
    group.append(glowing, ink, text); this.element.insertBefore(group, this.cursor); this.patchLabel(mark, geometry); return mark;
  }
  private patchPaths(mark: Mark): void { mark.geometry.paths.forEach((path, index) => { mark.ink[index]?.setAttribute('d', path.d); mark.glow[index]?.setAttribute('d', path.d); }); }
  private patchLabel(mark: Mark, geometry: AnnotationGeometry): void {
    const label = geometry.label; mark.text.textContent = label?.text ?? ''; mark.text.setAttribute('x', String(label?.x ?? 0)); mark.text.setAttribute('y', String(label?.y ?? 0)); mark.text.setAttribute('text-anchor', mark.command.kind === 'number' ? 'middle' : 'start'); mark.text.setAttribute('dominant-baseline', mark.command.kind === 'number' ? 'central' : 'auto');
  }
  private time(): number { const measured = finite(this.clock(), 'clock'); this.lastNow = Math.max(this.lastNow, measured); return this.suspendedAt ?? this.lastNow; }
  private locate(location: CursorLocation): void { this.cursorLocation = location; this.cursor.setAttribute('data-gk-cursor-location', location); }
  private sample(now: number): void {
    if (this.flight) { this.cursorPose = sampleFlight(this.flight, now); if (this.cursorPose.progress >= 1) { this.flight = null; this.locate(this.dockTarget ? 'docked' : 'target'); } }
    if (this.current?.move) { this.current.box = boxAt(this.current.move, now); if (now >= this.current.move.startedAt + this.current.move.durationMs) this.current.move = null; }
  }
  private applyMark(mark: Mark, reveal: number, eraseElapsed?: number): void {
    // Hide zero-length round caps as well as the stroke while the cursor flies.
    mark.group.setAttribute('opacity', reveal > 0 ? '1' : '0');
    const target = mark.command.box; mark.group.setAttribute('transform', `translate(${number(mark.box.left)} ${number(mark.box.top)}) scale(${number(mark.box.width / target.width)} ${number(mark.box.height / target.height)})`);
    let accumulated = 0;
    mark.geometry.paths.forEach((path, index) => {
      let progress = clamp((reveal * mark.geometry.length - accumulated) / path.length, 0, 1); accumulated += path.length;
      if (eraseElapsed !== undefined) { const stagger = (mark.geometry.paths.length - index - 1) * 18; progress *= 1 - cubicBezier((eraseElapsed - stagger) / MOTION.eraseMs, MOTION.editEasing); }
      const offset = number(1 - progress); mark.ink[index]!.setAttribute('stroke-dashoffset', offset); mark.glow[index]!.setAttribute('stroke-dashoffset', offset);
    });
    mark.text.setAttribute('opacity', number(eraseElapsed === undefined ? reveal : 1 - clamp(eraseElapsed / MOTION.eraseMs, 0, 1)));
  }
  private render(now: number): void {
    if (this.destroyed) return;
    this.sample(now);
    if (this.current) {
      const mark = this.current, progress = mark.durationMs ? clamp((now - mark.releaseAt) / mark.durationMs, 0, 1) : 1;
      mark.revealed = cubicBezier(progress); mark.ready = progress >= 1; this.applyMark(mark, mark.revealed);
    }
    if (this.erasing) {
      const elapsed = now - this.erasing.startedAt, mark = this.erasing.mark;
      this.applyMark(mark, mark.revealed, elapsed);
      if (elapsed >= MOTION.eraseMs + (mark.geometry.paths.length - 1) * 18) { mark.group.remove(); this.erasing = null; }
    }
    const pose = this.cursorPose;
    this.cursor.setAttribute('opacity', this.cursorRetained && pose ? '1' : this.erasing ? number(1 - clamp((now - this.erasing.startedAt) / MOTION.eraseMs, 0, 1)) : '0');
    if (pose) { this.cursor.setAttribute('transform', `translate(${number(pose.x)} ${number(pose.y)}) scale(${number(pose.scale)})`); this.pointing.setAttribute('transform', `rotate(${number(pose.rotation)})`); this.cursorGlow.style.filter = `blur(${number(pose.glowRadius)}px)`; }
    this.notifyReady();
  }
  private notifyReady(): void {
    if (this.destroyed || !this.canRun()) return;
    const mark = this.current;
    if (mark?.ready && mark.onReady) { const callback = mark.onReady; mark.onReady = undefined; callback(); }
    else if (this.dockTarget && !this.flight && this.dockReady) { const callback = this.dockReady; this.dockReady = undefined; callback(); }
  }
  private canRun(): boolean { return this.visible && !this.paused && !this.document.hidden; }
  private hasWork(): boolean { return !!(this.flight || this.current?.move || this.current && !this.current.ready || this.erasing); }
  private schedule(): void {
    if (this.destroyed || !this.canRun() || this.frame !== null) return;
    if (!this.hasWork()) { this.stopFrame(); return; }
    const epoch = this.frameEpoch;
    this.frame = this.requestFrame(() => {
      if (epoch !== this.frameEpoch) return;
      this.frame = null; if (this.destroyed || !this.canRun()) return;
      const now = this.time(); if (this.lastFrameAt !== null) this.maxFrameDeltaMs = Math.max(this.maxFrameDeltaMs, Math.min(10_000, now - this.lastFrameAt)); this.lastFrameAt = now; this.frames = Math.min(1_000_000, this.frames + 1);
      this.render(now); this.schedule();
    });
  }
  private stopFrame(): void { ++this.frameEpoch; if (this.frame !== null) this.cancelFrame(this.frame); this.frame = null; }
  private suspend(): void { if (this.suspendedAt !== null) return; const now = this.time(); this.render(now); this.suspendedAt = now; this.stopFrame(); }
  private syncSuspension(): void {
    this.syncActivity();
    if (!this.canRun()) { this.suspend(); return; }
    if (this.suspendedAt !== null) {
      const frozen = this.suspendedAt; this.suspendedAt = null; const elapsed = this.time() - frozen;
      if (this.current) { this.current.releaseAt += elapsed; if (this.current.move) this.current.move.startedAt += elapsed; }
      if (this.erasing) this.erasing.startedAt += elapsed;
      if (this.flight) this.flight.startedAt += elapsed;
      this.lastFrameAt = null;
    }
    this.render(this.time()); this.schedule();
  }
  private syncActivity(): void {
    const running = this.canRun() && !this.reduced;
    for (const [mode, group, duration] of [['pointing', this.pointing, 250], ['speaking', this.waveform, 150], ['waiting', this.spinner, 150]] as const) {
      group.style.transition = running ? `opacity ${duration}ms ease` : 'none'; group.setAttribute('opacity', mode === this.activity ? '1' : '0');
    }
    this.activityAnimations.forEach((shape, index) => {
      const mode = index < 5 ? 'speaking' : 'waiting'; shape.style.animationPlayState = running && this.activity === mode ? 'running' : 'paused';
      // A reduced-motion state keeps a readable, static waveform/spinner.
      shape.style.animationName = this.reduced ? 'none' : index < 5 ? 'gk-motion-wave' : 'gk-motion-spin';
    });
  }
  private onVisibility = (): void => { if (!this.destroyed) this.syncSuspension(); };
  private onReducedMotion = (): void => {
    if (this.destroyed || !this.media) return;
    this.reduced = this.media.matches;
    this.syncActivity();
    if (this.reduced) {
      const now = this.time(); this.flight = null;
      if (this.current) { this.current.move = null; this.current.box = { ...this.current.command.box }; this.current.releaseAt = now; this.current.durationMs = 0; this.cursorPose = { ...anchor(this.current.box), rotation: 0, scale: 1, glowRadius: 8, progress: 1 }; }
      else if (this.dockTarget) this.cursorPose = { ...this.dockTarget, rotation: 0, scale: 1, glowRadius: 8, progress: 1 };
      this.locate(this.dockTarget ? 'docked' : 'target');
      this.erasing?.mark.group.remove(); this.erasing = null; this.stopFrame(); this.render(now);
    } else this.schedule();
  };
}
