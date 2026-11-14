import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { assistantContextSchema, visualSceneSchema, type ModelPlan } from '../packages/contracts/src/index.js';
import { rocketScene } from './fixtures/explanation.js';

test('procedural scenes accept bounded geometry and reject executable, ambiguous and oversized data', () => {
  const valid = rocketScene(); assert.equal(visualSceneSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, script: 'alert(1)' }, { ...valid, focusId: 'missing' },
    { ...valid, objects: [...valid.objects, valid.objects[0]] },
    { ...valid, objects: [{ ...valid.objects[0], assetUrl: 'https://untrusted.invalid/model.glb' }] },
    { ...valid, objects: [{ ...valid.objects[0], shape: 'javascript' }] },
    { ...valid, objects: [{ ...valid.objects[0], position: [0, Infinity, 0] }] },
    { ...valid, objects: [{ ...valid.objects[0], size: [-1, 1, 1] }] },
    { ...valid, objects: [{ ...valid.objects[0], color: 'url(https://untrusted.invalid)' }] },
    { ...valid, objects: Array.from({ length: 37 }, (_, index) => ({ ...valid.objects[0], id: `o_${index}` })) }
  ]) assert.equal(visualSceneSchema.safeParse(invalid).success, false);
  assert.equal(assistantContextSchema.safeParse({ mode: 'explain', capabilities: { scene3d: 1 } }).success, true);
  assert.equal(assistantContextSchema.safeParse({ mode: 'explain', capabilities: { scene3d: 2 } }).success, false);
});

test('HTTP Explain supplies real viewer capabilities, retains scoped scenes and cannot execute host actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-explanation-'));
  let prompt = '', schema: Record<string, any> = {}, calls = 0;
  let output: Record<string, unknown> = { answer: 'A rocket produces thrust by expelling gas.', steps: [], action: null, citationIds: [], visual: null };
  const core = await createApp({ dataDir: directory, testing: true, adminOrigins: new Set(), provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit synthetic provider.' }), close: async () => {},
    infer: async input => { calls++; prompt = input.prompt; schema = input.schema; return JSON.stringify(output); }
  } });
  const server = createServer(core.app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, origin = 'http://127.0.0.1:4412';
  try {
    const owner = await core.repo.register({ email: 'scene@example.invalid', name: 'Scene tester', companyName: 'Scene workspace' }, 'no-login-fixture');
    const agent = await core.repo.createAgent(owner.tenant.id, { name: 'Explain Guide', companyName: 'Scene workspace', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [origin], allowedActions: ['save'] });
    await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Company support', content: 'The support page can create a support request after visitor approval.' }); await core.repo.publish(owner.tenant.id, agent.id);
    const session = async () => { const response = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 200); return (await response.json() as { token: string }).token; };
    const token = await session(); let sequence = 0;
    const page = { url: `${origin}/`, title: 'Synthetic support page', targets: [{ id: 'save', label: 'Save', role: 'button' }], actions: [{ name: 'save', description: 'Save after approval', requiresConfirmation: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], context: {} };
    const assistant = { mode: 'explain', capabilities: { scene3d: 1 } };
    const ask = (message: string, overrides: Record<string, unknown> = {}, auth = token) => fetch(`${base}/api/embed/session/ask`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify({ message, page, requestId: `explain_${++sequence}`, assistant, ...overrides }) });
    const words = await ask('Explain how a rocket works in words.'); assert.equal(words.status, 200); assert.equal((await words.json() as { visual?: unknown }).visual, undefined);
    assert.ok(schema.properties.visual); assert.match(prompt, /installed interactive procedural 3D viewer/); assert.match(prompt, /Return steps=\[\] and action=null/);
    output = { ...output, visual: rocketScene() };
    const generated = await ask('Now show that as a 3D model.'); assert.equal(generated.status, 200); const first = await generated.json() as { runId: string; visual: ModelPlan['visual'] };
    assert.equal(first.visual!.id, 'rocket'); assert.match(prompt, /Explain how a rocket works in words/);
    assert.match(prompt, /"actions":\[\]/, 'Explain removes business-action descriptors before inference');
    output = { ...output, visual: rocketScene('engine') };
    const followup = await ask('Show me the engine.', { assistant: { ...assistant, sceneRunId: first.runId, selectedObjectId: 'engine' } }); assert.equal(followup.status, 200);
    const updated = await followup.json() as { visual: { id: string; focusId: string } }; assert.equal(updated.visual.id, 'rocket'); assert.equal(updated.visual.focusId, 'engine'); assert.match(prompt, /Current validated explanation:.*"id":"rocket"/);
    output = { ...output, visual: { kind: 'scene3d-focus', sceneId: 'rocket', focusId: 'payload' } };
    const focused = await ask('Explain and highlight the payload.', { assistant: { ...assistant, sceneRunId: first.runId } });
    assert.equal(focused.status, 200);
    const reused = await focused.json() as { visual: ModelPlan['visual'] };
    assert.deepEqual(reused.visual, { ...rocketScene(), focusId: 'payload' }, 'A compact focus reuses exact validated geometry');
    assert.match(prompt, /FOLLOW-UP FAST PATH/); assert.doesNotMatch(prompt, /For a form workflow/);
    assert.ok(schema.properties.visual.anyOf.some((choice: any) => choice.properties?.kind?.enum?.includes('scene3d-focus')));
    for (const visual of [{ kind: 'scene3d-focus', sceneId: 'other', focusId: 'engine' }, { kind: 'scene3d-focus', sceneId: 'rocket', focusId: 'missing' }, { kind: 'scene3d-focus', sceneId: 'rocket', focusId: 'engine', script: 'alert(1)' }]) {
      output = { ...output, visual };
      assert.equal((await ask('Invalid focus patch', { assistant: { ...assistant, sceneRunId: first.runId } })).status, 502);
    }
    output = { ...output, visual: { kind: 'scene3d-focus', sceneId: 'rocket', focusId: 'engine' } };
    assert.equal((await ask('No source scene for patch')).status, 502);
    const beforeInvalid = calls;
    assert.equal((await ask('Other session scene', { assistant: { ...assistant, sceneRunId: first.runId } }, await session())).status, 400);
    assert.equal((await ask('Missing selected part', { assistant: { ...assistant, sceneRunId: first.runId, selectedObjectId: 'missing' } })).status, 400);
    assert.equal((await ask('Undeclared renderer', { assistant: { mode: 'explain', capabilities: {}, sceneRunId: first.runId } })).status, 400);
    assert.equal((await ask('No journey in Explain', { journey: { id: 'j', revision: 0, goal: 'save', reason: 'initial', completed: [] } })).status, 400);
    assert.equal(calls, beforeInvalid, 'Rejected scene references and capability claims never reach inference');
    output = { ...output, visual: { ...rocketScene(), focusId: 'unavailable' } }; assert.equal((await ask('Invalid model focus')).status, 502);
    output = { ...output, visual: rocketScene(), action: { name: 'save', argumentsJson: '{}', reason: 'Forbidden Explain action' } }; assert.equal((await ask('Save from Explain')).status, 502);
    assert.equal(Number((await core.repo.row('SELECT COUNT(*) AS count FROM receipts'))!.count), 0);
    output = { ...output, action: null, steps: [{ targetId: 'save', text: 'Click Save' }] }; assert.equal((await ask('Guide from Explain')).status, 502);
    output = { ...output, steps: [] };
    assert.equal((await ask('Legacy request cannot invent a renderer', { assistant: undefined })).status, 502);
    assert.equal(schema.properties.visual, undefined, 'Legacy requests retain their prior provider schema');
    assert.equal((await ask('Guide mode cannot generate a scene', { assistant: { mode: 'guide', capabilities: { scene3d: 1 } } })).status, 502);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await core.close(); await rm(directory, { recursive: true, force: true });
  }
});
