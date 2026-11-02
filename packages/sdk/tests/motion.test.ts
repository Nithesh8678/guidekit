import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationGeometry, createFlight, cubicBezier, cursorFlightDurationMs, cursorTravelProgress, MotionDirector, MOTION, penDurationMs, releaseDelayMs, retargetFlight, sampleFlight, smoothstep, stepBadgePlacement, STEP_BADGE_SIZE, validateBox, type AnnotationCommand, type AnnotationKind } from '../src/motion';

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
  assert.deepEqual(annotationGeometry({ ...command('number'), index: 8 }), annotationGeometry(command('target')));
  assert.throws(() => annotationGeometry({ ...command(), kind: 'script' as AnnotationKind }));
  assert.throws(() => annotationGeometry({ ...command(), id: '<script>' }));
  assert.throws(() => annotationGeometry({ ...command(), label: 'x'.repeat(121) }));
  assert.throws(() => annotationGeometry({ ...command(), index: 0 }));
});

test('step badges choose an outside edge, respect visual viewport offsets and stay bounded when space is tight', () => {
  assert.equal(STEP_BADGE_SIZE, 22);
  assert.deepEqual(stepBadgePlacement(box), { x: 101, y: 98 });
  const area = { left: 40, top: 20, width: 320, height: 240 }, radius = STEP_BADGE_SIZE / 2;
  const targets = [
    { left: 40, top: 20, width: 100, height: 30 }, { left: 260, top: 20, width: 100, height: 30 },
    { left: 40, top: 230, width: 100, height: 30 }, { left: 260, top: 230, width: 100, height: 30 },
    { left: 100, top: 70, width: 160, height: 36 },
  ];
  for (const target of targets) {
    const center = stepBadgePlacement(target, area);
    assert.ok(center.x - radius >= area.left && center.x + radius <= area.left + area.width);
    assert.ok(center.y - radius >= area.top && center.y + radius <= area.top + area.height);
    const overlap = Math.max(0, Math.min(center.x + radius, target.left + target.width) - Math.max(center.x - radius, target.left)) * Math.max(0, Math.min(center.y + radius, target.top + target.height) - Math.max(center.y - radius, target.top));
    assert.equal(overlap, 0, 'An available outside edge is preferred over covering the target.');
  }
  assert.deepEqual(stepBadgePlacement(box, { left: -20, top: -10, width: 10, height: 8 }), { x: -15, y: -6 });
  assert.throws(() => stepBadgePlacement(box, { ...area, width: NaN }));
});

test('smoothstep and local pen easing have exact endpoints and monotonic progress', () => {
  assert.equal(smoothstep(-10), 0); assert.equal(smoothstep(10), 1); close(smoothstep(0.5), 0.5);
  assert.equal(cubicBezier(0), 0); assert.equal(cubicBezier(1), 1);
  let previous = 0;
  for (let index = 0; index <= 100; index++) { const current = cubicBezier(index / 100); assert.ok(current >= previous && current >= 0 && current <= 1); previous = current; }
  assert.throws(() => smoothstep(NaN)); assert.throws(() => cubicBezier(Infinity));
});

test('cursor travel accelerates, cruises and brakes with continuous bounded progress', () => {
  assert.equal(cursorTravelProgress(-10), 0); assert.equal(cursorTravelProgress(10), 1); assert.throws(() => cursorTravelProgress(NaN));
  let previous = 0;
  for (let index = 0; index <= 200; index++) {
    const progress = cursorTravelProgress(index / 200); assert.ok(progress >= previous && progress >= 0 && progress <= 1); previous = progress;
  }
  const speed = (time: number) => (cursorTravelProgress(time + .0001) - cursorTravelProgress(time - .0001)) / .0002;
  close(speed(.3), speed(.45), .00001);
  assert.ok(speed(.02) < speed(.3) * .1); assert.ok(speed(.98) < speed(.3) * .02);
  for (const boundary of [.22, .52]) close(speed(boundary - .0001), speed(boundary + .0001), .0001);
});

test('perpendicular cubic flights visibly swoop in every direction and land without overshoot or spinning', () => {
  for (const [dx, dy] of [[400, 0], [-400, 0], [0, 400], [0, -400], [300, 400], [-300, 400], [300, -400], [-300, -400]]) {
    const start = { x: 100, y: 150 }, end = { x: start.x + dx!, y: start.y + dy! }, distance = Math.hypot(dx!, dy!);
    const flight = createFlight(start, end, 100), poses = Array.from({ length: 201 }, (_, index) => sampleFlight(flight, 100 + flight.durationMs * index / 200));
    assert.ok(flight.control2); assert.ok(flight.durationMs >= 600 && flight.durationMs <= 1400);
    assert.deepEqual(poses[0], { ...start, rotation: 0, scale: 1, glowRadius: 8, progress: 0 });
    assert.deepEqual(poses.at(-1), { ...end, rotation: 0, scale: 1, glowRadius: 8, progress: 1 });
    assert.deepEqual(sampleFlight(flight, 10000), poses.at(-1));
    let previous = 0, deviation = 0;
    for (const pose of poses) {
      const x = pose.x - start.x, y = pose.y - start.y, projection = (x * dx! + y * dy!) / distance ** 2;
      assert.ok(projection >= previous - 1e-9 && projection >= -1e-9 && projection <= 1 + 1e-9); previous = projection;
      deviation = Math.max(deviation, Math.abs(x * dy! - y * dx!) / distance);
      assert.ok(Math.abs(pose.rotation) <= 24.00001 && pose.scale >= 1 && pose.scale <= 1.16001);
    }
    assert.ok(deviation > distance * .12, `Travel direction ${dx},${dy} needs a visible sideways bow.`);
    assert.ok(Math.max(...poses.map(pose => Math.abs(pose.rotation))) > 3);
    assert.ok(Math.max(...poses.map(pose => pose.scale)) > 1.15);
    assert.ok(Math.hypot(poses[1]!.x - start.x, poses[1]!.y - start.y) < .1);
    assert.ok(Math.hypot(poses.at(-2)!.x - end.x, poses.at(-2)!.y - end.y) < .1);
  }
});

test('viewport-aware swoops choose available room for edge-to-edge and diagonal travel', () => {
  const viewport = { left: 40, top: 20, width: 640, height: 480 };
  for (const [start, end] of [
    [{ x: 48, y: 40 }, { x: 48, y: 480 }], [{ x: 660, y: 480 }, { x: 660, y: 40 }],
    [{ x: 60, y: 28 }, { x: 660, y: 28 }], [{ x: 660, y: 490 }, { x: 60, y: 490 }],
    [{ x: 48, y: 28 }, { x: 660, y: 490 }], [{ x: 660, y: 28 }, { x: 48, y: 490 }],
  ]) {
    const flight = createFlight(start!, end!, 0, { viewport }), dx = end!.x - start!.x, dy = end!.y - start!.y, distance = Math.hypot(dx, dy);
    let deviation = 0, previous = 0;
    for (let index = 0; index <= 200; index++) {
      const pose = sampleFlight(flight, flight.durationMs * index / 200), projection = ((pose.x - start!.x) * dx + (pose.y - start!.y) * dy) / distance ** 2;
      assert.ok(pose.x >= viewport.left - 1e-9 && pose.x <= viewport.left + viewport.width + 1e-9);
      assert.ok(pose.y >= viewport.top - 1e-9 && pose.y <= viewport.top + viewport.height + 1e-9);
      assert.ok(projection >= previous - 1e-9 && projection <= 1 + 1e-9); previous = projection;
      deviation = Math.max(deviation, Math.abs((pose.x - start!.x) * dy - (pose.y - start!.y) * dx) / distance);
    }
    assert.ok(deviation > 20, 'Viewport fitting preserves a visible arc instead of flattening into a straight route.');
  }
});

test('stationary flights do not pulse, while an interrupted pose can settle in place without a jump', () => {
  const at = { x: 5, y: 7 }, stationary = createFlight(at, at, 0);
  assert.equal(stationary.durationMs, 0); assert.deepEqual(sampleFlight(stationary, 0), { ...at, rotation: 0, scale: 1, glowRadius: 8, progress: 1 });
  const settling = createFlight(at, at, 0, { fromRotation: 18, fromScale: 1.12 }); assert.equal(settling.durationMs, 200);
  close(sampleFlight(settling, 0).rotation, 18); close(sampleFlight(settling, 0).scale, 1.12);
  for (let index = 0; index <= 200; index += 10) {
    const pose = sampleFlight(settling, index); close(pose.x, at.x); close(pose.y, at.y); assert.ok(Number.isFinite(pose.rotation) && Number.isFinite(pose.scale));
  }
  assert.deepEqual(sampleFlight(settling, 200), { ...at, rotation: 0, scale: 1, glowRadius: 8, progress: 1 });
  assert.throws(() => createFlight(at, at, 0, { fromScale: 0 })); assert.throws(() => createFlight(at, at, 0, { fromRotation: NaN }));
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

test('all requested mark kinds compose a separate fixed-size numbered disc without replacing or scaling their paths', () => {
  const state = renderer(true);
  try {
    assert.equal(state.director.element.style.color, 'var(--gk-guide-ink, #f2b544)');
    for (const kind of ['target', 'ring', 'frame', 'arrow', 'underline', 'number'] as const) {
      state.director.present({ ...command(kind, `composed-${kind}`), index: 7 });
      const mark = state.active()[0]!, badge = state.all().find(node => node.attributes.has('data-gk-step-badge'))!;
      assert.equal(mark.getAttribute('data-gk-shape'), kind === 'number' ? 'target' : kind);
      assert.notEqual(badge.parent, mark, 'The badge is independent of target-space scaling and shape bounds.');
      assert.equal(badge.getAttribute('data-gk-step-number'), '7'); assert.equal(badge.getAttribute('opacity'), '1');
      assert.equal(badge.getAttribute('transform'), 'translate(101 98)');
      assert.equal(badge.children.find(node => node.tagName === 'circle')!.getAttribute('r'), '11');
      assert.equal(badge.children.find(node => node.tagName === 'text')!.textContent, '7');
      assert.equal(badge.children.find(node => node.tagName === 'circle')!.getAttribute('fill'), 'var(--gk-guide-badge, #f2b544)');
      assert.equal(badge.children.find(node => node.tagName === 'text')!.getAttribute('fill'), 'var(--gk-guide-text, #352707)');
      const paths = mark.all().filter(node => node.tagName === 'path'), geometry = annotationGeometry({ ...command(kind, `composed-${kind}`), index: 7 });
      assert.equal(paths.length, geometry.paths.length * 2);
      assert.deepEqual(paths.slice(0, geometry.paths.length).map(path => path.getAttribute('d')), geometry.paths.map(path => path.d));
      assert.ok(badge.all().every(node => node.getAttribute('pointer-events') === 'none'));
      assert.equal(state.frames.size, 0);
    }
    state.director.present(command('number', 'implicit-number')); assert.equal(state.all().find(node => node.attributes.has('data-gk-step-badge'))!.getAttribute('data-gk-step-number'), '1');
  } finally { state.director.destroy(); }
});

test('badge identity and size survive bounds/index updates and settled viewport changes without scheduling frames', () => {
  const state = renderer(true), visual = { offsetLeft: 40, offsetTop: 20, width: 320, height: 240 };
  Object.assign(state.doc, { defaultView: { visualViewport: visual } });
  try {
    state.director.present({ ...command('ring'), index: 1 });
    const badge = state.all().find(node => node.attributes.has('data-gk-step-badge'))!;
    state.director.present({ ...command('ring'), index: 12 });
    assert.equal(state.all().find(node => node.attributes.has('data-gk-step-badge')), badge); assert.equal(badge.getAttribute('data-gk-step-number'), '12');
    const next = { left: 40, top: 20, width: 280, height: 190 };
    state.director.updateBounds(next); const center = stepBadgePlacement(next, { left: 40, top: 20, width: 320, height: 240 });
    assert.equal(badge.getAttribute('transform'), `translate(${center.x} ${center.y})`); assert.equal(badge.children.find(node => node.tagName === 'circle')!.getAttribute('r'), '11');
    visual.width = 400; visual.height = 300; state.director.updateBounds(next);
    const moved = stepBadgePlacement(next, { left: 40, top: 20, width: 400, height: 300 });
    assert.equal(badge.getAttribute('transform'), `translate(${moved.x} ${moved.y})`); assert.equal(state.frames.size, 0);
    state.director.present({ ...command('ring'), box: next }); assert.equal(state.all().filter(node => node.attributes.has('data-gk-step-badge')).length, 0);
  } finally { state.director.destroy(); }
});

test('badge and readiness cannot precede cursor arrival, and stale badges/callbacks leave with their step', () => {
  const state = renderer(); let ready = 0, stale = 0;
  try {
    state.director.present({ ...command('underline'), index: 3 }, { first: false, onReady: () => ready++ });
    const badge = state.all().find(node => node.attributes.has('data-gk-step-badge'))!;
    state.tick(400); assert.equal(state.director.location, 'flight'); assert.equal(state.director.ready, false); assert.equal(ready, 0); assert.equal(badge.getAttribute('opacity'), '0');
    state.director.updateBounds(box); assert.equal(badge.getAttribute('opacity'), '0', 'A settled-layout refresh cannot reveal a badge during flight.');
    state.tick(600); assert.equal(state.director.location, 'target'); assert.equal(ready, 1); assert.equal(badge.getAttribute('opacity'), '1'); assert.equal(state.frames.size, 0);
    state.director.present({ ...command('frame', 'replacement'), index: 4 }, { onReady: () => stale++ });
    assert.equal(state.all().filter(node => node.attributes.has('data-gk-step-badge')).length, 1);
    state.director.erase({ animate: false, preserveCursor: true }); assert.equal(state.all().filter(node => node.attributes.has('data-gk-step-badge')).length, 0);
    state.tick(5000); assert.equal(stale, 0); assert.equal(ready, 1); assert.equal(state.frames.size, 0);
  } finally { state.director.destroy(); }
});

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
    const shape = state.active()[0]!;
    const revealedFraction = (input: AnnotationCommand) => { const geometry = annotationGeometry(input), paths = shape.all().filter(node => node.tagName === 'path').slice(0, geometry.paths.length); return paths.reduce((sum, path, index) => sum + (1 - Number(path.getAttribute('stroke-dashoffset'))) * geometry.paths[index]!.length, 0) / geometry.length; };
    const progress = revealedFraction(command('frame'));
    state.director.updateBounds({ ...box, width: 260 }); assert.equal(state.active()[0], shape); assert.equal(state.director.ready, false); close(revealedFraction({ ...command('frame'), box: { ...box, width: 260 } }), progress, 0.001);
    state.tick(1200); assert.equal(state.director.ready, true); assert.equal(ready, 1); assert.equal(state.director.diagnostics.penDurationMs, 550);
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

test('cursor docks visibly without annotations and its exact displayed origin starts the first target flight', () => {
  const state = renderer(); let docked = 0, ready = 0;
  try {
    const dock = { x: 720, y: 580 }; state.director.dock(dock, { onReady: () => docked++ });
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, identity = cursor;
    assert.equal(cursor.getAttribute('opacity'), '1'); assert.equal(cursor.getAttribute('data-gk-cursor-location'), 'docked'); assert.equal(state.director.location, 'docked'); assert.equal(docked, 1); assert.equal(state.director.ready, true); assert.equal(state.active().length, 0); assert.equal(state.frames.size, 0);
    const original = cursor.getAttribute('transform'); state.director.present(command('ring'), { first: true, onReady: () => ready++ });
    assert.equal(cursor.getAttribute('transform'), original); assert.equal(state.director.location, 'flight'); assert.equal(state.all().find(node => node.attributes.has('data-gk-cursor')), identity);
    close(state.director.diagnostics.cursor!.x, dock.x); close(state.director.diagnostics.cursor!.y, dock.y);
    const arrival = state.director.diagnostics.flightDurationMs; assert.ok(state.director.diagnostics.releaseDelayMs >= arrival && state.director.diagnostics.releaseDelayMs >= 450);
    state.tick(arrival - 1); assert.ok(state.active()[0]!.all().filter(node => node.tagName === 'path').every(path => path.getAttribute('stroke-dashoffset') === '1')); assert.equal(state.active()[0]!.getAttribute('opacity'), '0'); assert.equal(ready, 0);
    state.tick(arrival); assert.equal(state.director.location, 'target'); close(state.director.diagnostics.cursor!.x, box.left + 8); close(state.director.diagnostics.cursor!.y, box.top + 12);
    state.tick(arrival + 10); assert.ok(state.active()[0]!.all().some(path => path.tagName === 'path' && path.getAttribute('stroke-dashoffset') !== '1')); assert.equal(state.active()[0]!.getAttribute('opacity'), '1');
    state.tick(arrival + 1500); assert.equal(ready, 1);
  } finally { state.director.destroy(); }
});

test('same bounds preserve a flight, while moving bounds retarget from the sampled presentation without teleporting', () => {
  const state = renderer();
  try {
    state.director.dock({ x: 900, y: 600 }); state.director.present(command(), { first: true }); state.tick(250);
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, before = cursor.getAttribute('transform'), pose = state.director.diagnostics.cursor!, flightDuration = state.director.diagnostics.flightDurationMs;
    state.director.updateBounds(box); assert.equal(cursor.getAttribute('transform'), before); assert.equal(state.director.diagnostics.flightDurationMs, flightDuration);
    const next = { ...box, left: 440, top: 230 }; state.director.updateBounds(next);
    assert.equal(cursor.getAttribute('transform'), before); close(state.director.diagnostics.cursor!.x, pose.x); close(state.director.diagnostics.cursor!.y, pose.y); assert.equal(state.director.location, 'flight');
    state.tick(251); assert.notEqual(cursor.getAttribute('transform'), before); assert.notEqual(state.director.diagnostics.cursor!.x, next.left + 8);
    state.tick(3000); close(state.director.diagnostics.cursor!.x, next.left + 8); close(state.director.diagnostics.cursor!.y, next.top + 12); assert.equal(state.director.location, 'target');
  } finally { state.director.destroy(); }
});

test('return flight docks from its current pose, removes marks and invalidates obsolete readiness', () => {
  const state = renderer(); let stale = 0, docked = 0;
  try {
    state.director.dock({ x: 800, y: 500 }); state.director.present(command('frame'), { onReady: () => stale++ }); state.tick(300);
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, before = cursor.getAttribute('transform'), previousCallbacks = [...state.frames.values()];
    state.director.dock({ x: 780, y: 560 }, { animate: true, onReady: () => docked++ }); assert.equal(cursor.getAttribute('transform'), before); assert.equal(state.active().length, 0); assert.equal(state.director.diagnostics.annotations, 0); assert.equal(state.director.location, 'flight');
    for (const callback of previousCallbacks) callback(5000); assert.equal(cursor.getAttribute('transform'), before); assert.equal(docked, 0); assert.equal(state.frames.size, 1);
    state.director.dock({ x: 780, y: 560 }); assert.equal(cursor.getAttribute('transform'), before); state.tick(2000);
    assert.equal(state.director.location, 'docked'); assert.equal(docked, 1); assert.equal(stale, 0); close(state.director.diagnostics.cursor!.x, 780); close(state.director.diagnostics.cursor!.y, 560); assert.equal(state.frames.size, 0);
    state.director.dock({ x: 780, y: 560 }); assert.equal(docked, 1); assert.equal(state.frames.size, 0);
  } finally { state.director.destroy(); }
});

test('clearing annotations can preserve the sampled cursor for the next flight while erase and destroy cancel callbacks', () => {
  const state = renderer(); let stale = 0;
  state.director.dock({ x: 800, y: 550 }); state.director.present(command(), { onReady: () => stale++ }); state.tick(200);
  const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, before = cursor.getAttribute('transform');
  state.director.erase({ animate: false, preserveCursor: true }); assert.equal(state.active().length, 0); assert.equal(cursor.getAttribute('opacity'), '1'); assert.equal(cursor.getAttribute('transform'), before); assert.equal(state.frames.size, 0);
  state.director.present(command('ring', 'second')); assert.equal(cursor.getAttribute('transform'), before); assert.equal(state.director.location, 'flight');
  state.director.dock({ x: 700, y: 500 }, { animate: true, onReady: () => stale++ }); state.director.erase({ animate: false }); state.tick(10000); assert.equal(stale, 0); assert.equal(cursor.getAttribute('opacity'), '0');
  state.director.dock({ x: 20, y: 30 }); state.director.dock({ x: 900, y: 700 }, { animate: true, onReady: () => stale++ }); const pending = [...state.frames.values()]; state.director.destroy(); for (const callback of pending) callback(20000);
  assert.equal(stale, 0); assert.equal(state.frames.size, 0); assert.equal(state.shadow.children.length, 0);
});

test('docked and outbound poses freeze hidden/paused, and reduced motion stays static without a flight', () => {
  const state = renderer(); let docked = 0;
  try {
    state.director.dock({ x: 40, y: 50 }); state.director.dock({ x: 800, y: 600 }, { animate: true, onReady: () => docked++ }); state.tick(200);
    const cursor = state.all().find(node => node.attributes.has('data-gk-cursor'))!, before = cursor.getAttribute('transform');
    state.director.setPaused(true); state.tick(5000); assert.equal(cursor.getAttribute('transform'), before); assert.equal(state.frames.size, 0); assert.equal(docked, 0);
    state.director.setVisible(false); state.director.setPaused(false); state.tick(10000); assert.equal(docked, 0); state.director.setVisible(true); assert.equal(cursor.getAttribute('transform'), before); state.tick(12000); assert.equal(docked, 1); assert.equal(state.director.location, 'docked');
    assert.throws(() => state.director.dock({ x: NaN, y: 0 }));
  } finally { state.director.destroy(); }
  const reduced = renderer(true);
  try {
    reduced.director.dock({ x: 10, y: 20 }, { animate: true }); assert.equal(reduced.director.location, 'docked'); reduced.director.present(command(), { first: true }); assert.equal(reduced.director.location, 'target'); assert.equal(reduced.director.ready, true); assert.equal(reduced.frames.size, 0);
    reduced.director.dock({ x: 30, y: 40 }, { animate: true }); close(reduced.director.diagnostics.cursor!.x, 30); close(reduced.director.diagnostics.cursor!.y, 40); assert.equal(reduced.frames.size, 0);
  } finally { reduced.director.destroy(); }
});

test('a neutral cursor already at its dock needs no stationary animation frames', () => {
  const state = renderer(); let ready = 0;
  try {
    state.director.present(command(), { animate: false }); const pose = state.director.diagnostics.cursor!;
    state.director.dock({ x: pose.x, y: pose.y }, { animate: true, onReady: () => ready++ });
    assert.equal(state.director.location, 'docked'); assert.equal(ready, 1); assert.equal(state.frames.size, 0);
    assert.equal(state.director.diagnostics.flightDurationMs, 0); assert.equal(state.active().length, 0);
  } finally { state.director.destroy(); }
});
