import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationGeometry, createFlight, cubicBezier, cursorFlightDurationMs, MotionDirector, MOTION, penDurationMs, releaseDelayMs, retargetFlight, sampleFlight, smoothstep, validateBox, type AnnotationCommand, type AnnotationKind } from '../src/motion';

const box = { left: 120, top: 80, width: 160, height: 36 };
const command = (kind: AnnotationKind = 'target', id = 'name'): AnnotationCommand => ({ id, kind, box: { ...box } });
const close = (actual: number, expected: number, tolerance = 0.00001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('CSS pixel bounds preserve negative viewport origins and reject nonfinite, zero and excessive dimensions', () => {
  assert.deepEqual(validateBox({ left: -30, top: -10, width: 100, height: 20 }), { left: -30, top: -10, width: 100, height: 20 });
  assert.notEqual(validateBox(box), box);
  for (const key of ['left', 'top', 'width', 'height']) for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => validateBox({ ...box, [key]: value }));
  for (const value of [0, -1, 0.1, 100_001]) assert.throws(() => validateBox({ ...box, width: value }));
  assert.throws(() => validateBox({ ...box, left: 999_999 }));
});

test('pen, pacing, frame and flight timing follow the supplied source formulas', () => {
  close(penDurationMs(0), 300); close(penDurationMs(1400), 1250); close(penDurationMs(100000), 1400);
  close(penDurationMs(1400, 0.1), 437.5); close(penDurationMs(1400, 2), 2500);
  assert.equal(MOTION.frameMs, 550); assert.equal(MOTION.moveMs, 500); assert.equal(MOTION.eraseMs, 400);
  close(cursorFlightDurationMs(0), 600); close(cursorFlightDurationMs(800), 1000); close(cursorFlightDurationMs(10000), 1400);
  assert.equal(releaseDelayMs(0, true), 450); assert.equal(releaseDelayMs(109), 0); close(releaseDelayMs(110), 200 + 110 / 2.4); assert.equal(releaseDelayMs(10000), 550);
  for (const value of [-1, NaN, Infinity]) { assert.throws(() => penDurationMs(value)); assert.throws(() => cursorFlightDurationMs(value)); assert.throws(() => releaseDelayMs(value)); }
  for (const pace of [0, -1, NaN, Infinity, 5]) assert.throws(() => penDurationMs(100, pace));
});

test('seeded semantic paths remain stable through renders and local translation', () => {
  for (const kind of ['target', 'ring', 'frame', 'arrow', 'underline', 'number'] as const) {
    const first = annotationGeometry(command(kind)), second = annotationGeometry(command(kind));
    assert.deepEqual(first, second); assert.ok(first.paths.length >= 1 && first.paths.length <= 16); assert.ok(Number.isFinite(first.length) && first.length > 0);
    assert.ok(first.paths.every(path => path.length > 0 && !/NaN|Infinity|undefined/.test(path.d)));
    assert.deepEqual(first, annotationGeometry({ ...command(kind), box: { ...box, left: -120, top: 400 } }));
  }
  assert.notDeepEqual(annotationGeometry(command('ring', 'first')), annotationGeometry(command('ring', 'second')));
  assert.equal(annotationGeometry({ ...command('number'), index: 8 }).label?.text, '8');
  assert.throws(() => annotationGeometry({ ...command(), kind: 'script' as AnnotationKind }));
  assert.throws(() => annotationGeometry({ ...command(), id: '<script>' }));
  assert.throws(() => annotationGeometry({ ...command(), label: 'x'.repeat(121) }));
  assert.throws(() => annotationGeometry({ ...command(), index: 0 }));
});

test('smoothstep and local pen easing have exact endpoints and monotonic progress', () => {
  assert.equal(smoothstep(-10), 0); assert.equal(smoothstep(10), 1); close(smoothstep(0.5), 0.5);
  assert.equal(cubicBezier(0), 0); assert.equal(cubicBezier(1), 1);
  let previous = 0;
  for (let index = 0; index <= 100; index++) { const current = cubicBezier(index / 100); assert.ok(current >= previous && current >= 0 && current <= 1); previous = current; }
  assert.throws(() => smoothstep(NaN)); assert.throws(() => cubicBezier(Infinity));
});

test('cursor uses quadratic flight, capped upward arc, tangent rotation and a midflight scale', () => {
  const flight = createFlight({ x: 0, y: 0 }, { x: 800, y: 0 }, 100);
  assert.deepEqual(flight.control, { x: 400, y: -80 }); close(flight.durationMs, 1000);
  const start = sampleFlight(flight, 100), middle = sampleFlight(flight, 600), end = sampleFlight(flight, 1100);
  close(start.x, 0); close(start.y, 0); close(start.scale, 1); close(middle.x, 400); close(middle.y, -40); close(middle.rotation, 90); close(middle.scale, 1.3); close(middle.glowRadius, 14); close(end.x, 800); close(end.y, 0); close(end.scale, 1);
  assert.deepEqual(sampleFlight(flight, 10000), end);
  const stationary = sampleFlight(createFlight({ x: 5, y: 7 }, { x: 5, y: 7 }, 0), 300); assert.ok(Object.values(stationary).every(Number.isFinite));
});

test('interruption retargets from the current presentation pose rather than either stale endpoint', () => {
  const original = createFlight({ x: 20, y: 40 }, { x: 900, y: 500 }, 100), displayed = sampleFlight(original, 650), next = retargetFlight(original, { x: -10, y: 800 }, 650), resumed = sampleFlight(next, 650);
  close(resumed.x, displayed.x); close(resumed.y, displayed.y); close(resumed.scale, displayed.scale); close(resumed.rotation, displayed.rotation);
  assert.notDeepEqual(next.start, original.start); assert.notDeepEqual(next.start, original.end);
  const final = sampleFlight(next, 650 + next.durationMs); close(final.x, -10); close(final.y, 800); close(final.scale, 1);
});

// Lightweight SVG doubles verify the retained renderer's lifecycle and frame
// ownership. Actual CSS layout/click-through behavior is browser-QA territory.
class SVGDouble {
  readonly attributes = new Map<string, string>(); readonly style: Record<string, string> = {}; children: SVGDouble[] = []; parent: SVGDouble | null = null; textContent = '';
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  append(...nodes: SVGDouble[]) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  insertBefore(node: SVGDouble, before: SVGDouble) { node.remove(); node.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  remove() { if (this.parent) { const index = this.parent.children.indexOf(this); if (index >= 0) this.parent.children.splice(index, 1); this.parent = null; } }
  cloneNode() { const clone = new SVGDouble(this.tagName); for (const [key, value] of this.attributes) clone.attributes.set(key, value); Object.assign(clone.style, this.style); return clone; }
  all(): SVGDouble[] { return [this, ...this.children.flatMap(child => child.all())]; }
}
function renderer(reducedMotion = false) {
  let now = 0, sequence = 0; const frames = new Map<number, FrameRequestCallback>(), cancelled: FrameRequestCallback[] = [], listeners = new Map<string, () => void>();
  const doc = { hidden: false, createElementNS: (_: string, tag: string) => new SVGDouble(tag), addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
  const shadow = new SVGDouble('shadow') as SVGDouble & { ownerDocument: typeof doc }; shadow.ownerDocument = doc;
  const director = new MotionDirector(shadow as unknown as ShadowRoot, { reducedMotion, now: () => now, requestFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; }, cancelFrame: id => { const callback = frames.get(id); if (callback) cancelled.push(callback); frames.delete(id); } });
  const tick = (value: number) => { now = value; const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(value); };
  return { director, shadow, doc, listeners, frames, cancelled, tick, time: (value: number) => { now = value; }, all: () => shadow.all(), active: () => shadow.all().filter(node => node.attributes.has('data-gk-shape')) };
}

test('retained SVG is click-through, bounded, stable on repeated bounds and signals readiness once', () => {
  const state = renderer(); let ready = 0;
  try {
    state.director.present(command(), { first: true, onReady: () => { ready++; } }); assert.equal(state.frames.size, 1); assert.equal(state.director.ready, false);
    assert.equal(state.director.element.getAttribute('data-gk-annotation'), ''); assert.equal(state.director.element.getAttribute('focusable'), 'false');
    assert.ok(state.all().filter(node => node.tagName !== 'shadow').every(node => node.getAttribute('pointer-events') === 'none'));
    const original = state.active()[0]; state.director.updateBounds(box); assert.equal(state.active()[0], original);
    state.tick(450); assert.equal(ready, 0); state.tick(2000); assert.equal(ready, 1); assert.equal(state.director.ready, true); assert.equal(state.frames.size, 0);
    state.director.updateBounds({ ...box, left: 300 }); assert.equal(state.active()[0], original); assert.match(original!.getAttribute('transform')!, /translate\(300 80\)/); assert.equal(ready, 1);
    state.director.present({ ...command(), box: { ...box, left: 500 } }, { animate: false }); assert.equal(state.active()[0], original); assert.match(original!.getAttribute('transform')!, /translate\(500 80\)/); assert.equal(state.frames.size, 0);
    for (let index = 0; index < 50; index++) state.director.present(command('ring', `step-${index}`));
    assert.equal(state.active().length, 1); assert.equal(state.director.diagnostics.annotations, 2); assert.ok(state.director.diagnostics.paths <= 32); assert.equal(state.frames.size, 1);
  } finally { state.director.destroy(); }
});

test('bounds updates preserve reveal progress and same-ID geometry without reentering', () => {
  const state = renderer(); let ready = 0;
  try {
    state.director.present(command('frame'), { first: true, onReady: () => ready++ }); state.tick(700);
    const shape = state.active()[0]!, ink = shape.all().filter(node => node.tagName === 'path')[0]!, progress = ink.getAttribute('stroke-dashoffset');
    state.director.updateBounds({ ...box, width: 260 }); assert.equal(state.active()[0], shape); assert.equal(state.director.ready, false); assert.equal(ink.getAttribute('stroke-dashoffset'), progress);
    state.tick(1000); assert.equal(state.director.ready, true); assert.equal(ready, 1); assert.equal(state.director.diagnostics.penDurationMs, 550);
  } finally { state.director.destroy(); }
});

test('pause and hide cancel every frame, freeze elapsed time and resume from the displayed pose', () => {
  const state = renderer(); let ready = 0;
  try {
    state.director.present(command('ring'), { first: true, onReady: () => ready++ }); state.tick(200);
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, transform = cursor.getAttribute('transform');
    state.director.setPaused(true); assert.equal(state.frames.size, 0); state.tick(10000); assert.equal(cursor.getAttribute('transform'), transform); assert.equal(ready, 0);
    for (const callback of state.cancelled) callback(10000); assert.equal(state.frames.size, 0); assert.equal(cursor.getAttribute('transform'), transform);
    state.director.setVisible(false); state.director.setPaused(false); assert.equal(state.frames.size, 0);
    state.director.setVisible(true); assert.equal(state.frames.size, 1); assert.equal(cursor.getAttribute('transform'), transform);
    state.tick(10300); assert.equal(ready, 0); state.tick(12000); assert.equal(ready, 1); assert.equal(state.frames.size, 0);
    state.director.setVisible(true); assert.equal(state.frames.size, 0);
  } finally { state.director.destroy(); }
});

test('hidden presentation initializes safely, callbacks cannot outlive replacement or destroy', () => {
  const state = renderer(); let obsolete = 0, current = 0;
  state.director.setVisible(false); state.director.present(command(), { first: true, onReady: () => obsolete++ }); state.tick(10000); assert.equal(state.frames.size, 0);
  state.director.present(command('ring', 'replacement'), { onReady: () => current++ }); state.director.setVisible(true); state.tick(12000);
  assert.equal(obsolete, 0); assert.equal(current, 1);
  state.director.present(command('frame', 'later'), { onReady: () => obsolete++ }); const queued = [...state.frames.values()]; state.director.destroy();
  assert.equal(state.frames.size, 0); assert.equal(state.shadow.children.length, 0); assert.equal(state.listeners.size, 0);
  for (const callback of queued) callback(20000); state.director.present(command()); state.director.setVisible(true); state.director.setPaused(false); state.director.erase();
  assert.equal(obsolete, 0); assert.equal(state.frames.size, 0); assert.equal(state.shadow.children.length, 0);
});

test('reduced motion is immediately static, while erase invalidates a pending beat and finishes locally', () => {
  const reduced = renderer(true); let ready = 0;
  try { reduced.director.present(command('ring'), { first: true, onReady: () => ready++ }); assert.equal(ready, 1); assert.equal(reduced.frames.size, 0); assert.equal(reduced.director.diagnostics.penDurationMs, 0); reduced.director.erase(); assert.equal(reduced.active().length, 0); }
  finally { reduced.director.destroy(); }
  const state = renderer();
  try { state.director.present(command('frame'), { onReady: () => ready++ }); state.tick(100); state.director.erase(); assert.equal(state.active().length, 0); state.tick(1000); assert.equal(state.director.diagnostics.annotations, 0); assert.equal(state.frames.size, 0); assert.equal(ready, 1); }
  finally { state.director.destroy(); }
});

test('monotonic frame time ignores a regressing clock and document visibility suspends work', () => {
  const state = renderer();
  try {
    state.director.present(command()); state.tick(300); const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, previous = cursor.getAttribute('transform');
    state.tick(100); assert.equal(cursor.getAttribute('transform'), previous);
    state.doc.hidden = true; state.listeners.get('visibilitychange')?.(); assert.equal(state.frames.size, 0); state.tick(5000);
    state.doc.hidden = false; state.listeners.get('visibilitychange')?.(); assert.equal(cursor.getAttribute('transform'), previous); assert.equal(state.frames.size, 1);
  } finally { state.director.destroy(); }
});

test('cursor activity retains triangle, five weighted bars and spinner and pauses hidden CSS animation', () => {
  const state = renderer();
  try {
    state.director.present(command(), { animate: false });
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, surfaces = state.all().filter(node => node.attributes.has('data-gk-cursor-surface')), bars = state.all().filter(node => node.attributes.has('data-gk-wave-weight'));
    assert.equal(surfaces.length, 3); assert.deepEqual(bars.map(node => node.getAttribute('data-gk-wave-weight')), ['0.4', '0.7', '1', '0.7', '0.4']);
    state.director.setActivity('speaking'); assert.equal(cursor.getAttribute('data-gk-cursor-mode'), 'speaking'); assert.ok(bars.every(bar => bar.style.animationPlayState === 'running'));
    state.director.setVisible(false); assert.ok(bars.every(bar => bar.style.animationPlayState === 'paused')); state.director.setVisible(true); assert.ok(bars.every(bar => bar.style.animationPlayState === 'running'));
    state.director.setPaused(true); assert.ok(bars.every(bar => bar.style.animationPlayState === 'paused')); state.director.setPaused(false);
    state.director.setActivity('waiting'); assert.ok(bars.every(bar => bar.style.animationPlayState === 'paused')); assert.equal(cursor.getAttribute('data-gk-cursor-mode'), 'waiting');
    const spinner = state.all().find(node => node.tagName === 'circle')!; assert.equal(spinner.style.animationPlayState, 'running'); assert.match(spinner.style.animation!, /0.8s/);
    state.director.setActivity('pointing'); assert.deepEqual(state.all().filter(node => node.attributes.has('data-gk-cursor-surface')), surfaces); assert.equal(spinner.style.animationPlayState, 'paused');
    assert.throws(() => state.director.setActivity('recording' as 'pointing'));
  } finally { state.director.destroy(); }
  const reduced = renderer(true);
  try { reduced.director.setActivity('speaking'); assert.ok(reduced.all().filter(node => node.attributes.has('data-gk-wave-weight')).every(bar => bar.style.animationPlayState === 'paused' && bar.style.animationName === 'none')); }
  finally { reduced.director.destroy(); }
});
