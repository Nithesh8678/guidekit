import assert from 'node:assert/strict';
import test from 'node:test';
import { continuationLimit, JourneyCoordinator, parseJourneyMemory, semanticRevision, type JourneyPlan, type JourneyRequest } from '../src/journey';
import type { PageContext, RunResult } from '../../contracts/src/index';

const page = (ids = ['open'], url = 'https://host.test/app'): PageContext => ({ url, title: 'Product', targets: ids.map(id => ({ id, label: id, role: 'button' })), actions: [], context: {} });
function plan(context: PageContext, request?: JourneyRequest): JourneyPlan {
  const run: RunResult = { runId: 'run_1', answer: 'Continue here', steps: context.targets.map(target => ({ targetId: target.id, text: `Use ${target.label}` })), action: null, citations: [], provider: 'codex', version: 1, ...(request ? { journey: { id: request.id, revision: request.revision, disposition: 'continue' as const } } : {}) };
  return { run, page: context, routeKey: context.url, resolve: () => null };
}
function fixture() {
  const requests: JourneyRequest[] = [], errors: string[] = [], plans: JourneyPlan[] = []; let pending = 0; let current = page();
  const journey = new JourneyCoordinator('Show me how to create a contact', { replan: async request => { requests.push(request); return plan(current, request); }, onPending: () => { pending++; }, onPlan: value => plans.push(value), onError: message => errors.push(message) }, { id: 'journey_1' });
  journey.adopt(plan(current, journey.initial()));
  return { journey, requests, errors, plans, pending: () => pending, scene: (next: PageContext) => { current = next; journey.observe(next, next.url); } };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };

test('a settled relevant scene triggers one bounded continuation, without geometry/value-driven requests', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    for (let index = 0; index < 10; index++) state.scene(page()); context.mock.timers.tick(5000); assert.equal(state.requests.length, 0);
    state.journey.record(0, { targetId: 'open', label: 'Open form', role: 'button', evidence: 'observed' });
    state.scene(page(['open', 'name'])); state.scene(page(['open', 'name'])); context.mock.timers.tick(749); assert.equal(state.requests.length, 0);
    context.mock.timers.tick(1); await settled(); assert.equal(state.requests.length, 1); assert.equal(state.requests[0]!.reason, 'scene_changed'); assert.equal(state.requests[0]!.revision, 1); assert.equal(state.plans.length, 1);
    state.scene(page(['open', 'name'])); context.mock.timers.tick(5000); await settled(); assert.equal(state.requests.length, 1);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('route changes replan even when no existing control is lost; unrelated added controls need relevant interaction', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.scene(page(['open', 'unrelated'])); context.mock.timers.tick(1000); await settled(); assert.equal(state.requests.length, 0);
    state.scene(page(['open', 'unrelated'], 'https://host.test/settings')); context.mock.timers.tick(750); await settled(); assert.equal(state.requests.length, 1);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('pause and pending host confirmation prevent speculative replanning or duplicate business operations', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.setAwaitingHost(true); state.scene(page(['loading'])); context.mock.timers.tick(5000); await settled(); assert.equal(state.requests.length, 0);
    state.journey.setAwaitingHost(false); state.journey.setPaused(true); state.scene(page(['next'])); context.mock.timers.tick(5000); await settled(); assert.equal(state.requests.length, 0);
    state.journey.setPaused(false); state.scene(page(['next'])); context.mock.timers.tick(750); await settled(); assert.equal(state.requests.length, 1);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('host confirmation suspends an already queued continuation and rejects an obsolete in-flight response', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let request!: JourneyRequest, signal!: AbortSignal, release!: (plan: JourneyPlan) => void; let rendered = 0;
  const journey = new JourneyCoordinator('Save the record', { replan: (input, abort) => { request = input; signal = abort; return new Promise(resolve => { release = resolve; }); }, onPending() {}, onPlan: () => { rendered++; }, onError: assert.fail }, { id: 'journey_submit' });
  try {
    journey.adopt(plan(page(), journey.initial())); journey.observe(page(['loading']), '/save'); journey.setAwaitingHost(true);
    context.mock.timers.tick(5000); assert.equal(request, undefined);
    journey.setAwaitingHost(false); context.mock.timers.tick(750); assert.equal(signal.aborted, false);
    journey.setAwaitingHost(true); assert.equal(signal.aborted, true); release(plan(page(['loading']), request)); await settled(); assert.equal(rendered, 0);
    assert.equal(journey.segmentFinished({ reason: 'completed', verified: true }, true), false); assert.equal(journey.active, false);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});
test('cancel and superseding generations discard delayed inference responses', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let release!: (plan: JourneyPlan) => void; let request!: JourneyRequest; let signal!: AbortSignal; let applied = 0;
  const journey = new JourneyCoordinator('Open settings', { replan: (input, abort) => { request = input; signal = abort; return new Promise(resolve => { release = resolve; }); }, onPending() {}, onPlan: () => { applied++; }, onError: assert.fail }, { id: 'journey_cancel' });
  try {
    journey.adopt(plan(page(), journey.initial())); journey.observe(page(['settings']), '/settings'); context.mock.timers.tick(750); assert.equal(signal.aborted, false);
    journey.cancel(); assert.equal(signal.aborted, true); release(plan(page(['settings']), request)); await settled(); assert.equal(applied, 0);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});
test('automatic continuations stop at six and surface an explicit recoverable limit', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    for (let index = 0; index < 7; index++) { state.scene(page([`control_${index}`], `https://host.test/step/${index}`)); context.mock.timers.tick(750); await settled(); }
    assert.equal(state.requests.length, 6); assert.match(state.errors[0]!, /automatic guidance limit/); assert.equal(state.journey.active, false);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('step memory is bounded and excludes field values, labels, URLs, session tokens and arbitrary extra keys', () => {
  const state = fixture();
  try {
    for (let index = 0; index < 40; index++) state.journey.record(index, { targetId: `field_${index}`, label: 'Public field', role: 'textbox', evidence: 'observed' });
    const memory = state.journey.memory(); assert.equal(memory.completed.length, 24); assert.deepEqual(Object.keys(memory.completed[0]!).sort(), ['evidence', 'targetId']);
    assert.deepEqual(parseJourneyMemory(memory, memory.savedAt), memory); assert.equal(parseJourneyMemory({ ...memory, token: 'credential' }, memory.savedAt), null); assert.equal(parseJourneyMemory(memory, memory.savedAt + 1_800_001), null);
  } finally { state.journey.cancel(); }
});
test('verified completion and explicit Finish/unknown save outcomes never trigger automatic retries', () => {
  for (const result of [{ reason: 'completed' as const, verified: true, scope: 'goal' as const }, { reason: 'completed' as const, verified: false, message: 'Guide ended without a confirmed website result.' }, { reason: 'completed' as const, verified: false, message: 'The website has not confirmed the result. Check the website before trying again.' }]) {
    const state = fixture(); assert.equal(state.journey.segmentFinished(result), false); assert.equal(state.journey.active, false); assert.equal(state.requests.length, 0);
  }
});

test('verified intermediate segments continue with the same goal; done and legacy native-submit boundaries remain terminal', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.setAwaitingHost(true);
    assert.equal(state.journey.segmentFinished({ reason: 'completed', verified: true, scope: 'step' }), true);
    context.mock.timers.tick(750); await settled(); assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0]!.reason, 'segment_completed'); assert.equal(state.requests[0]!.goal, state.journey.goal);
    const final = plan(page(['save']), state.journey.initial()); final.run.journey!.disposition = 'done'; state.journey.adopt(final);
    assert.equal(state.journey.segmentFinished({ reason: 'completed', verified: true, scope: 'step' }), false); assert.equal(state.journey.active, false);
    const legacy = fixture(); assert.equal(legacy.journey.segmentFinished({ reason: 'completed', verified: true }, true), false); assert.equal(legacy.journey.active, false);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});

test('semantic revisions replan unchanged controls only after an expected continuing transition; input/context changes alone do not', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.seed(page(), page().url, 'number:0');
    for (let index = 1; index < 10; index++) state.journey.observe({ ...page(), context: { count: index } }, page().url, `number:${index}`);
    context.mock.timers.tick(1000); await settled(); assert.equal(state.requests.length, 0);
    state.journey.record(0, { targetId: 'open', label: 'Open', role: 'button', evidence: 'observed' });
    state.journey.observe(page(), page().url, 'number:10'); context.mock.timers.tick(1000); await settled(); assert.equal(state.requests.length, 0);
    state.journey.expectTransition(); state.journey.observe(page(), page().url, 'number:11'); context.mock.timers.tick(750); await settled(); assert.equal(state.requests.length, 1);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});

test('host failure drops queued progress without an automatic retry', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.expectTransition(); state.scene(page(['next'])); state.journey.reportHostResult('open', false);
    context.mock.timers.tick(5000); await settled(); assert.equal(state.requests.length, 0); assert.equal(state.journey.active, true);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});

test('longer host workflows explicitly opt into a bounded continuation budget', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0;
  const journey = new JourneyCoordinator('Longer workflow', { replan: async request => { calls++; return plan(page([`next_${calls}`]), request); }, onPending() {}, onPlan() {}, onError: assert.fail }, { maxContinuations: 12 });
  try {
    journey.adopt(plan(page(), journey.initial()));
    for (let index = 0; index < 10; index++) { journey.observe(page([`next_${index}`]), `/step/${index}`); context.mock.timers.tick(750); await settled(); }
    assert.equal(calls, 10); assert.equal(journey.active, true);
    assert.equal(continuationLimit(undefined), 6); for (const invalid of [0, 25, -1, 2.5, '12', null]) assert.throws(() => continuationLimit(invalid), /between 1 and 24/);
    assert.equal(semanticRevision('1'), 'string:1'); assert.equal(semanticRevision(1), 'number:1');
    for (const invalid of ['', 'x'.repeat(161), 'a\nb', NaN, {}, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => semanticRevision(invalid), /context revision/);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});

test('disappearing completed controls do not replan when the remaining segment is still grounded', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.adopt(plan(page(['open', 'name']), state.journey.initial()));
    state.journey.record(0, { targetId: 'open', label: 'Open', role: 'button', evidence: 'observed' });
    state.scene(page(['name'])); context.mock.timers.tick(1000); await settled(); assert.equal(state.requests.length, 0);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('an explicitly expected asynchronous modal transition can continue after the short input interaction window', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const state = fixture();
  try {
    state.journey.record(0, { targetId: 'open', label: 'Open', role: 'button', evidence: 'observed' }); state.journey.expectTransition(); context.mock.timers.tick(5000);
    state.scene(page(['name'])); context.mock.timers.tick(750); await settled(); assert.equal(state.requests.length, 1);
  } finally { state.journey.cancel(); context.mock.timers.reset(); }
});
test('pausing an in-flight continuation keeps its intent for Resume and rejects the obsolete response', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const requests: JourneyRequest[] = [], releases: Array<(plan: JourneyPlan) => void> = []; let applied = 0;
  const journey = new JourneyCoordinator('Continue the task', { replan: request => { requests.push(request); return new Promise(resolve => releases.push(resolve)); }, onPending() {}, onPlan: () => { applied++; }, onError: assert.fail }, { id: 'journey_pause' });
  try {
    journey.adopt(plan(page(), journey.initial())); journey.observe(page(['next']), '/next'); context.mock.timers.tick(750); assert.equal(requests.length, 1);
    journey.setPaused(true); context.mock.timers.tick(5000); journey.setPaused(false); context.mock.timers.tick(750); assert.equal(requests.length, 2);
    releases[0]!(plan(page(['next']), requests[0])); await settled(); assert.equal(applied, 0);
    releases[1]!(plan(page(['next']), requests[1])); await settled(); assert.equal(applied, 1);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});
test('late host verification upgrades earlier segment evidence without claiming the whole goal succeeded', () => {
  const state = fixture();
  try {
    state.journey.record(0, { targetId: 'open', label: 'Open', role: 'button', evidence: 'observed' }); state.journey.reportHostResult('open', true);
    assert.equal(state.journey.initial().completed[0]!.evidence, 'host_verified'); assert.equal(state.journey.active, true);
    state.journey.reportHostResult('unknown', true); assert.equal(state.journey.initial().completed.length, 1);
  } finally { state.journey.cancel(); }
});
test('mismatched or absent journey echoes fail closed before rendering a continuation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); const errors: string[] = []; let rendered = 0;
  const journey = new JourneyCoordinator('Continue', { replan: async () => plan(page(['next'])), onPending() {}, onPlan: () => { rendered++; }, onError: error => errors.push(error) }, { id: 'journey_echo' });
  try {
    journey.adopt(plan(page(), journey.initial())); journey.observe(page(['next']), '/next'); context.mock.timers.tick(750); await settled(); assert.equal(rendered, 0); assert.match(errors[0]!, /did not match/); assert.equal(journey.active, false);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});
