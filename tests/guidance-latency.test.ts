import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { JourneyEvidenceCache, type EvidenceScope } from '../apps/server/src/evidence-cache.js';
import { pageContextSchema } from '../packages/contracts/src/index.js';

const website = 'http://127.0.0.1:4411';
const open = { id: 'open_details', label: 'Open details', role: 'button' };
const future = { id: 'save_details', label: 'Save details', role: 'button', description: 'Appears after opening Details and entering the required fields.' };
const page = { url: `${website}/`, title: 'Synthetic workflow', targets: [open], guideTargets: [future], actions: [], context: {} };

test('public target catalogs are bounded, unique, and cannot conflict with observed control identities', () => {
  assert.equal(pageContextSchema.safeParse(page).success, true);
  assert.equal(pageContextSchema.safeParse({ ...page, targets: [open, open] }).success, false);
  assert.equal(pageContextSchema.safeParse({ ...page, guideTargets: [future, future] }).success, false);
  assert.equal(pageContextSchema.safeParse({ ...page, guideTargets: [{ ...open, label: 'Delete data' }] }).success, false);
  assert.equal(pageContextSchema.safeParse({ ...page, guideTargets: Array.from({ length: 65 }, (_, i) => ({ ...future, id: `future_${i}` })) }).success, false);
  assert.equal(pageContextSchema.safeParse({ ...page, guideTargets: Array.from({ length: 64 }, (_, i) => ({ ...future, id: `future_${i}`, description: 'x'.repeat(250) })) }).success, false);
});

test('task evidence cache clones validated results, isolates every scope, expires, evicts and never falls back after refresh failure', async () => {
  let now = 100, calls = 0;
  const cache = new JourneyEvidenceCache(() => now, 200, 2);
  const scope: EvidenceScope = { tenantId: 'tenant', agentId: 'agent', version: 1, sessionId: 'session', journeyId: 'journey', question: 'synthetic question' };
  const load = async () => { calls++; return { citations: [{ documentId: 'doc', title: 'Guide', excerpt: 'Verified publication.' }], knowledge: { source: 'tigergraph' as const, paths: [] } }; };
  const first = await cache.read(scope, false, load); first.evidence.citations[0]!.excerpt = 'modified caller copy';
  const next = await cache.read(scope, true, load); assert.equal(calls, 1); assert.equal(next.cached, true); assert.equal(next.evidence.citations[0]!.excerpt, 'Verified publication.');
  next.evidence.citations.length = 0; assert.equal((await cache.read(scope, true, load)).evidence.citations.length, 1);
  for (const [key, value] of Object.entries({ tenantId: 'other', agentId: 'other', version: 2, sessionId: 'other', journeyId: 'other', question: 'other' })) {
    assert.equal((await cache.read({ ...scope, [key]: value }, true, load)).cached, false);
  }
  assert.equal((await cache.read(scope, true, load)).cached, false); // Capacity eviction.
  now += 201; assert.equal((await cache.read(scope, true, load)).cached, false);
  await assert.rejects(cache.read(scope, false, async () => { throw new Error('graph unavailable'); }), /graph unavailable/);
  assert.equal((await cache.read(scope, true, load)).cached, false);
  cache.clear(); assert.equal((await cache.read(scope, true, load)).cached, false);
});

test('HTTP planner accepts declared later controls, requires a visible first step, and exposes duration-only diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-catalog-http-'));
  let nextSteps = [open.id, future.id];
  let lastPrompt = '', prepareCalls = 0;
  const core = (await createApp({ dataDir: directory, testing: true, adminOrigins: new Set(), provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit fixture.' }), close: async () => {}, prepare() { prepareCalls++; },
    infer: async input => {
      lastPrompt = input.prompt;
      input.onTiming?.({ phase: 'inference', durationMs: 12, elapsedMs: 12 });
      // Invalid runtime diagnostics cannot inject header text or expose context.
      input.onTiming?.({ phase: 'prompt-secret' as 'inference', durationMs: 1, elapsedMs: 13 });
      input.onTiming?.({ phase: 'cleanup', durationMs: Number.NaN, elapsedMs: 13 });
      return JSON.stringify({ answer: 'Open Details, then save when ready.', steps: nextSteps.map(targetId => ({ targetId, text: 'Use the highlighted control.' })), action: null, citationIds: [] });
    }
  } }));
  const server = createServer(core.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const owner = (await core.repo.register({ email: 'synthetic@example.invalid', name: 'Synthetic tester', companyName: 'Synthetic workspace' }, 'fixture-no-login'));
    const agent = (await core.repo.createAgent(owner.tenant.id, { name: 'Synthetic Guide', companyName: 'Synthetic', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] }));
    (await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Details', content: 'Open Details to reveal Save details.' })); (await core.repo.publish(owner.tenant.id, agent.id));
    const started = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}' });
    const { token } = await started.json() as { token: string };
    assert.equal(prepareCalls, 1);
    const prepare = (origin: string, auth: string, body: unknown = {}) => fetch(`${base}/api/embed/session/prepare`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(body) });
    assert.equal((await prepare(website, 'invalid')).status, 401); assert.equal(prepareCalls, 1);
    assert.equal((await prepare('https://foreign.test', token)).status, 403); assert.equal(prepareCalls, 1);
    assert.equal((await prepare(website, token, { prompt: 'must not be accepted' })).status, 400); assert.equal(prepareCalls, 1);
    assert.equal((await prepare(website, token)).status, 200); assert.equal(prepareCalls, 2);
    const ask = (id: string, overrides = {}) => fetch(`${base}/api/embed/session/ask`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ page, message: 'Show how to edit details', requestId: id, ...overrides }) });
    const response = await ask('catalog_batch'); assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { steps: { targetId: string }[] }).steps.map(step => step.targetId), [open.id, future.id]);
    assert.match(lastPrompt, /first step must reference a currently visible/);
    const timing = response.headers.get('Server-Timing')!;
    assert.match(timing, /knowledge;dur=\d/); assert.match(timing, /model_inference;dur=12\.0/); assert.match(timing, /planning;dur=\d/);
    assert.doesNotMatch(timing, /secret|NaN|synthetic|details|prompt/); assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Server-Timing');
    nextSteps = [future.id]; assert.equal((await ask('not_visible_first')).status, 502);
    nextSteps = [open.id, 'invented']; assert.equal((await ask('not_declared')).status, 502);
    nextSteps = [open.id, future.id]; assert.equal((await ask('no_catalog', { page: { ...page, guideTargets: undefined } })).status, 502);
    assert.equal((await ask('conflicting_identity', { page: { ...page, guideTargets: [{ ...open, role: 'link' }] } })).status, 400);
    const journey = { id: 'task_1', revision: 0, goal: 'Show how to edit details', reason: 'initial', completed: [] };
    assert.equal((await ask('task_initial', { journey })).status, 200);
    const continued = await ask('task_continue', { journey: { ...journey, revision: 1, reason: 'scene_changed' } });
    assert.equal(continued.status, 200); assert.match(continued.headers.get('Server-Timing')!, /task-cache/);
    const different = await ask('task_different', { journey: { ...journey, id: 'task_2', revision: 1, reason: 'scene_changed' } });
    assert.equal(different.status, 200); assert.doesNotMatch(different.headers.get('Server-Timing')!, /task-cache/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await core.close(); await rm(directory, { recursive: true, force: true }); }
});
