import assert from 'node:assert/strict';
import test from 'node:test';
import type { PageContext } from '../../contracts/src/index';
import { SceneObserver } from '../src/scene';

const page: PageContext = { url: 'https://host.test/editor', title: 'Editor', targets: [], actions: [], context: {} };
const settled = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function environment() {
  let mutate: (() => void) | undefined;
  class ElementDouble { parentElement = null; closest() { return null; } }
  class ObserverDouble { constructor(callback: (records: Array<{ target: ElementDouble }>) => void) { mutate = () => callback([{ target: new ElementDouble() }]); } observe() {} disconnect() {} }
  const events = { addEventListener() {}, removeEventListener() {} };
  const doc = { ...events, hidden: false, documentElement: new ElementDouble() };
  const route = { origin: 'https://host.test', pathname: '/editor', search: '', hash: '' };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ document: doc, window: events, location: route, Element: ElementDouble, MutationObserver: ObserverDouble })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  return { doc, route, mutate: () => mutate?.(), restore: () => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

test('fresh async scene reads debounce, abort obsolete snapshots, and discard completion after destroy', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const state = environment();
  const reads: Array<{ signal: AbortSignal; release(page: PageContext): void }> = [], delivered: PageContext[] = [];
  const observer = new SceneObserver(signal => new Promise(resolve => reads.push({ signal, release: resolve })), snapshot => delivered.push(snapshot));
  try {
    observer.refresh(); observer.refresh(); context.mock.timers.tick(179); await settled(); assert.equal(reads.length, 0);
    context.mock.timers.tick(1); await settled(); assert.equal(reads.length, 1);
    observer.refresh(); assert.equal(reads[0]!.signal.aborted, true); context.mock.timers.tick(180); await settled(); assert.equal(reads.length, 2);
    reads[0]!.release({ ...page, context: { stage: 'obsolete' } }); reads[1]!.release({ ...page, context: { stage: 'fresh' } }); await settled();
    assert.deepEqual(delivered.map(snapshot => snapshot.context), [{ stage: 'fresh' }]);
    observer.refresh(); context.mock.timers.tick(180); await settled(); observer.destroy(); assert.equal(reads[2]!.signal.aborted, true);
    reads[2]!.release(page); await settled(); assert.equal(delivered.length, 1);
  } finally { observer.destroy(); state.restore(); context.mock.timers.reset(); }
});

test('route changes during async context collection discard the old snapshot and read the new route; hidden/paused scenes stay silent', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const state = environment(); let enabled = true;
  const releases: Array<(page: PageContext) => void> = [], delivered: string[] = [];
  const observer = new SceneObserver(() => new Promise(resolve => releases.push(resolve)), (_page, route) => delivered.push(route), () => enabled);
  try {
    observer.refresh(); context.mock.timers.tick(180); await settled(); state.route.pathname = '/review'; releases[0]!(page); await settled(); assert.equal(delivered.length, 0);
    context.mock.timers.tick(180); await settled(); releases[1]!(page); await settled(); assert.equal(delivered.length, 1);
    observer.refresh(); context.mock.timers.tick(180); await settled(); enabled = false; releases[2]!(page); await settled(); assert.equal(delivered.length, 1);
    enabled = true; state.doc.hidden = true; observer.refresh(); context.mock.timers.tick(200); await settled(); assert.equal(releases.length, 3);
  } finally { observer.destroy(); state.restore(); context.mock.timers.reset(); }
});

test('continuous render notifications cannot starve a local scene read beyond 500 ms', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const state = environment();
  let reads = 0, deliveries = 0;
  const observer = new SceneObserver(() => { reads++; return page; }, () => { deliveries++; });
  try {
    observer.refresh();
    for (let index = 0; index < 6; index++) { context.mock.timers.tick(80); state.mutate(); await settled(); }
    assert.equal(reads, 0); context.mock.timers.tick(19); await settled(); assert.equal(reads, 0);
    context.mock.timers.tick(1); await settled(); assert.equal(reads, 1); assert.equal(deliveries, 1);
    context.mock.timers.tick(500); await settled(); assert.equal(reads, 1);
    observer.refresh(); observer.destroy(); context.mock.timers.tick(1000); await settled(); assert.equal(reads, 1);
  } finally { observer.destroy(); state.restore(); context.mock.timers.reset(); }
});

test('soft DOM storms let asynchronous context finish with fresh targets and queue one follow-up; explicit refresh remains hard', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const state = environment();
  const reads: Array<{ signal: AbortSignal; release(): void }> = [], snapshots: string[] = []; let label = 'before';
  const observer = new SceneObserver(async signal => {
    await new Promise<void>(release => reads.push({ signal, release }));
    return { ...page, targets: [{ id: 'current', label, role: 'button' }] };
  }, snapshot => snapshots.push(snapshot.targets[0]!.label));
  try {
    observer.refresh(); context.mock.timers.tick(180); await settled(); assert.equal(reads.length, 1);
    for (let index = 0; index < 7; index++) { context.mock.timers.tick(16); label = `render_${index}`; state.mutate(); }
    assert.equal(reads[0]!.signal.aborted, false); reads[0]!.release(); await settled(); assert.deepEqual(snapshots, ['render_6']);
    context.mock.timers.tick(179); await settled(); assert.equal(reads.length, 1);
    context.mock.timers.tick(1); await settled(); assert.equal(reads.length, 2);
    observer.refresh(); assert.equal(reads[1]!.signal.aborted, true); label = 'explicit-new-state'; reads[1]!.release(); await settled(); assert.equal(snapshots.length, 1);
    context.mock.timers.tick(180); await settled(); reads[2]!.release(); await settled(); assert.deepEqual(snapshots, ['render_6', 'explicit-new-state']);
  } finally { observer.destroy(); state.restore(); context.mock.timers.reset(); }
});
