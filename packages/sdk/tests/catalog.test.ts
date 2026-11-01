import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGuideTargets } from '../src/context';
import { JourneyCoordinator, type JourneyPlan } from '../src/journey';
import type { PageContext } from '../../contracts/src/index';

const catalog = [{ id: 'name', label: 'Public name field', role: 'textbox' }, { id: 'save', label: 'Save item', role: 'button' }];
test('future-control metadata is explicit, bounded, unique and snapshotted without granting access', () => {
  assert.deepEqual(parseGuideTargets(undefined, 'auto'), []);
  assert.throws(() => parseGuideTargets(catalog, 'auto'), /explicit target mode/);
  for (const invalid of [null, {}, [...catalog, catalog[0]], [{ ...catalog[0], selector: '#anything' }], [{ ...catalog[0], label: '' }], [{ ...catalog[0], role: 'button\nscript' }], Array.from({ length: 65 }, (_, index) => ({ id: `id_${index}`, label: 'Control', role: 'button' }))]) assert.throws(() => parseGuideTargets(invalid, 'explicit'), /guideTargets/);
  assert.throws(() => parseGuideTargets(Array.from({ length: 64 }, (_, index) => ({ id: `id_${index}`, label: 'A'.repeat(160), role: 'button', description: 'D'.repeat(250) })), 'explicit'), /16 KB/);
  const source = [{ id: 'public', label: 'Contact owner@example.test', role: 'button' }];
  const parsed = parseGuideTargets(source, 'explicit'); source[0]!.label = 'Changed later';
  assert.equal(parsed[0]!.label, 'Contact [redacted email]');
});

test('unrevealed catalog steps wait locally, matching appearances stay local, and a seen changed step invalidates', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const page: PageContext = { url: 'https://host.test/app', title: 'Product', targets: [{ id: 'open', label: 'Open form', role: 'button' }], guideTargets: catalog, actions: [], context: {} };
  let requests = 0;
  const journey = new JourneyCoordinator('Create an item', { replan: async () => { requests++; return new Promise<JourneyPlan>(() => {}); }, onPending() {}, onPlan() {}, onError: assert.fail }, { id: 'journey_catalog' });
  const plan: JourneyPlan = { page, routeKey: '/app', resolve: () => null, run: { runId: 'run_catalog', answer: 'Create it.', steps: ['open', 'name', 'save'].map(targetId => ({ targetId, text: 'Use this control.' })), action: null, citations: [], provider: 'codex', version: 1, journey: { id: journey.id, revision: 0, disposition: 'done' } } };
  try {
    journey.adopt(plan); journey.record(0, { targetId: 'open', label: 'Open form', role: 'button', evidence: 'observed' });
    journey.observe({ ...page, targets: [] }, '/app'); context.mock.timers.tick(500); assert.equal(requests, 0);
    journey.observe({ ...page, targets: catalog }, '/app'); context.mock.timers.tick(500); assert.equal(requests, 0);
    journey.observe({ ...page, targets: [{ ...catalog[0]!, label: 'A different field' }, catalog[1]!] }, '/app');
    context.mock.timers.tick(119); assert.equal(requests, 0); context.mock.timers.tick(1); assert.equal(requests, 1);
  } finally { journey.cancel(); context.mock.timers.reset(); }
});
