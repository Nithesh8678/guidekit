import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantContext, PublicAgent, RunResult, VisualScene } from '../../contracts/src/index';
import { Assistant } from '../src/controller';

const agent: PublicAgent = { id: 'agent_1', version: 1, name: 'Guide', companyName: 'Company', greeting: 'Hello', accentColor: '#112233', allowedActions: [] };
const scene: VisualScene = { kind: 'scene3d', id: 'rocket', title: 'Rocket', summary: 'A conceptual rocket.', focusId: 'engine', objects: [{ id: 'engine', label: 'Engine', description: 'An engine.', shape: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#eeb455' }] };
type Session = { token: string; expiresAt: number; agent: PublicAgent };
type Acknowledged = { scene: VisualScene; runId: string; token: string };
type Harness = {
  session: Session | null; lastVisual: Acknowledged | null; active: AbortController | null;
  ensureSession(): Promise<Session>; assistantContext(session: Session, mode: 'explain'): AssistantContext;
  ask(message: string): Promise<RunResult | null>;
  json(path: string, payload: unknown, token?: string): Promise<unknown>;
};
function harness() {
  const messages: string[] = [], statuses: string[] = [], phases: string[] = [], events: string[] = []; let clears = 0, requests = 0;
  const assistant: Harness = Object.assign(Object.create(Assistant.prototype) as Harness, {
    options: { agentId: agent.id }, endpoint: 'https://assistant.test', configuredVersion: 1,
    destroyed: false, sessionActive: true, sessionEpoch: 1, mode: 'explain', phase: 'presenting', intent: 0, generation: 0,
    lifetime: new AbortController(), connecting: null, active: null,
    session: { token: 'previous_session_token', expiresAt: Date.now() + 1000, agent },
    lastVisual: { scene, runId: 'run_rocket', token: 'previous_session_token' },
    view: { input: { value: '' }, open() {}, clearVisual() { clears++; }, visualSelection: () => ({ sceneId: scene.id, selectedObjectId: 'engine' }), message(_role: string, text: string) { messages.push(text); }, status(text: string) { statuses.push(text); } },
    voice: { active: false },
    setPhase(phase: string) { phases.push(phase); }, emit(name: string) { events.push(name); },
    startSession() {}, async cancel() {},
    async readSnapshot() { assert.fail('A follow-up with an expired visual must not collect/send replacement context silently.'); },
    async json() { requests++; return { token: 'replacement_session_token', expiresAt: Date.now() + 3600000, agent }; }
  });
  return { assistant, messages, statuses, phases, events, clears: () => clears, requests: () => requests };
}

test('renewal clears the acknowledged scene and explicitly explains the lost continuity, including after a prior 401 removed the session', async () => {
  for (const missingSession of [false, true]) {
    const state = harness(); if (missingSession) state.assistant.session = null;
    const replacement = await state.assistant.ensureSession();
    assert.equal(state.assistant.lastVisual, null); assert.equal(state.clears(), 1);
    assert.match(state.messages[0]!, /earlier assistant session.*cleared/); assert.match(state.statuses[0]!, /new explanation/);
    assert.deepEqual(state.assistant.assistantContext(replacement, 'explain'), { mode: 'explain', capabilities: { scene3d: 1 } });
    assert.deepEqual(state.events, ['visual-session-expired']);
    await state.assistant.ensureSession(); assert.equal(state.clears(), 1); assert.equal(state.messages.length, 1); assert.equal(state.requests(), 1);
  }
});

test('an Explain follow-up interrupted by renewal is stopped instead of silently submitting without its old scene', async () => {
  const state = harness();
  assert.equal(await state.assistant.ask('Explain how the engine produces thrust'), null);
  assert.equal(state.requests(), 1); assert.equal(state.assistant.lastVisual, null); assert.equal(state.assistant.active, null);
  assert.equal(state.phases.at(-1), 'error'); assert.match(state.statuses.at(-1)!, /assistant session changed/);
});

test('an unexpired exact session preserves the acknowledged scene and reference without a renewal notice', async () => {
  const state = harness(); state.assistant.session!.expiresAt = Date.now() + 3600000;
  const session = await state.assistant.ensureSession();
  assert.equal(state.clears(), 0); assert.equal(state.messages.length, 0); assert.equal(state.requests(), 0);
  assert.deepEqual(state.assistant.assistantContext(session, 'explain'), { mode: 'explain', capabilities: { scene3d: 1 }, sceneRunId: 'run_rocket', selectedObjectId: 'engine' });
});

test('a real 401 clears only the expired session scene immediately', async () => {
  const state = harness(), originalFetch = globalThis.fetch;
  const json = Assistant.prototype as unknown as { json(path: string, payload: unknown, token?: string): Promise<unknown> };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'The assistant session expired.' }), { status: 401, headers: { 'content-type': 'application/json' } });
    await assert.rejects(json.json.call(state.assistant, '/api/embed/session/ask', {}, 'previous_session_token'), /session expired/);
    assert.equal(state.assistant.session, null); assert.equal(state.assistant.lastVisual, null); assert.equal(state.clears(), 1); assert.equal(state.messages.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
