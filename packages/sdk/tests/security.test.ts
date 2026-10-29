import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAction, endpointOrigin, parsePublicAgent, parseRun, safeContext } from '../src/security';

test('SDK endpoint cannot introduce credentials, scripts, paths, or query parameters', () => {
  assert.equal(endpointOrigin('http://127.0.0.1:4410/'), 'http://127.0.0.1:4410');
  for (const url of ['javascript:alert(1)', 'https://user:secret@example.test', 'https://example.test/api', 'https://example.test?token=secret', 'https://example.test/#secret']) assert.throws(() => endpointOrigin(url));
});
test('explicit context drops secrets, cyclic objects, excessive nesting, and prototype keys', () => {
  const context: Record<string, unknown> = { selectedProject: 'project_1', password: 'private', accessToken: 'private', credentials: { key: 'private' }, __proto__: { inherited: true } };
  // Non-plain input fails closed.
  assert.deepEqual(safeContext(context), {});
  const plain: Record<string, unknown> = { selectedProject: 'project_1', apiToken: 'private', clientSecret: 'private', list: [1, true] }; plain.cycle = plain;
  const clean = safeContext(plain);
  assert.equal(clean.selectedProject, 'project_1'); assert.equal(clean.apiToken, undefined); assert.equal(clean.clientSecret, undefined); assert.equal(clean.cycle, undefined);
  assert.equal(JSON.stringify(safeContext({ value: 'a'.repeat(50_000) })).length < 1300, true);
});
test('actions never coerce model arguments or remove extra fields', () => {
  const action = compileAction('create_task', {
    description: 'Create a task', requiresConfirmation: true,
    inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 100 }, priority: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['title', 'priority'], additionalProperties: false },
    execute: async () => ({ success: true, message: 'Verified' })
  });
  assert.equal(action.validate({ title: 'Task', priority: 2 }), true);
  assert.equal(action.validate({ title: 'Task', priority: '2' }), false);
  assert.equal(action.validate({ title: 'Task', priority: 2, injected: 'field' }), false);
  assert.equal(action.validate({ title: 'a'.repeat(101), priority: 2 }), false);
});
test('actions require confirmation and cannot use recursive schema references', () => {
  const base = { description: 'Run', requiresConfirmation: true as const, inputSchema: { type: 'object' }, execute: async () => ({ success: true, message: 'Verified' }) };
  assert.throws(() => compileAction('run', { ...base, requiresConfirmation: false } as unknown as typeof base));
  assert.throws(() => compileAction('run', { ...base, inputSchema: { type: 'object', properties: { recursive: { $ref: '#' } } } }));
  assert.throws(() => compileAction('run', { ...base, timeoutMs: 500_000 }));
  const compiled = compileAction('run', base); base.description = 'Changed'; assert.equal(compiled.definition.description, 'Run');
});
test('malformed runtime output fails closed before any UI or action execution', () => {
  const plan = { runId: 'run_1', answer: '<img src=x onerror=alert(1)>', steps: [], action: null, citations: [], provider: 'codex', version: 1 };
  assert.equal(parseRun(plan).answer, plan.answer); // Valid text remains text; the view never inserts it as HTML.
  assert.throws(() => parseRun({ ...plan, steps: [{ targetId: 'button[onclick]', text: 'Click here' }] }));
  assert.equal(parseRun({ ...plan, steps: [{ targetId: 'export', text: 'Click Export', annotation: 'arrow' }] }).steps[0]?.annotation, 'arrow');
  assert.throws(() => parseRun({ ...plan, steps: [{ targetId: 'export', text: 'Click Export', annotation: 'eval(code)' }] }));
  assert.throws(() => parseRun({ ...plan, action: { name: 'run', receiptId: 'receipt_1', reason: 'Do it', arguments: {}, requiresConfirmation: false } }));
  assert.throws(() => parsePublicAgent({ id: 'agent_1', version: 1, name: 'Agent', companyName: 'Company', greeting: 'Hello', accentColor: 'red;position:fixed', allowedActions: [] }));
});
test('known model providers and strict journey echoes are accepted without coercing malformed metadata', () => {
  const result = { runId: 'run_1', answer: 'Continue', steps: [], action: null, citations: [], provider: 'openai', version: 1, journey: { id: 'journey_1', revision: 2, disposition: 'continue' } };
  assert.equal(parseRun(result).provider, 'openai'); assert.equal(parseRun({ ...result, provider: 'codex' }).journey?.revision, 2);
  for (const journey of [{ ...result.journey, revision: -1 }, { ...result.journey, disposition: ['done'] }, { ...result.journey, fieldValue: 'private' }, { ...result.journey, id: 'bad id' }]) assert.throws(() => parseRun({ ...result, journey }));
  assert.throws(() => parseRun({ ...result, provider: 'unknown' })); assert.throws(() => parseRun({ ...result, provider: ['codex'] }));
});
