import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createOpenAIProvider, type OpenAIProviderOptions } from './openai.js';

const model = 'fixture-model', apiKey = 'fixture-credential-only';
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const input = { prompt: 'fixture prompt', schema };
const json = (value: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
const message = (text = '{"answer":"fixture answer"}') => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const completed = (output: unknown[] = [message()]) => ({ object: 'response', status: 'completed', error: null, incomplete_details: null, output });
function provider(fetch: typeof globalThis.fetch, overrides: Omit<OpenAIProviderOptions, 'fetch'> = {}) { return createOpenAIProvider({ enabled: true, apiKey, model, ...overrides, fetch }); }

test('disabled, missing and malformed configuration never invokes a transport', async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error('Unexpected network'); };
  for (const options of [{ enabled: false }, { enabled: undefined }, { apiKey: undefined }, { model: undefined }, { model: '../../untrusted?key=value' }, { apiKey: 'invalid\ncredential' }]) {
    const value = provider(fetch, options);
    assert.equal(value.id, 'openai'); assert.equal((await value.status()).authenticated, false);
    await assert.rejects(value.infer(input), /disabled|requires/); await value.close();
  }
  assert.equal(calls, 0);
});

test('status performs only a fixed model GET and distinguishes access from live inference', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const value = provider(async (url, init) => { requests.push({ url: String(url), init }); return json({ object: 'model', id: model }); });
  try {
    const status = await value.status(); assert.equal(status.available, true); assert.equal(status.authenticated, true); assert.match(status.message, /not yet been verified/);
    await value.status(); assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, `https://api.openai.com/v1/models/${model}`); assert.equal(requests[0]!.init?.method, 'GET'); assert.equal(requests[0]!.init?.body, undefined); assert.equal(requests[0]!.init?.redirect, 'error');
  } finally { await value.close(); }
  assert.equal((await value.status()).available, false); assert.equal(requests.length, 1);
});

test('completed inference sends an explicit nonstored strict request without tools or credential-bearing input', async () => {
  let posts = 0;
  const value = provider(async (url, init) => {
    if (init?.method === 'GET') return json({ object: 'model', id: model });
    posts++; assert.equal(String(url), 'https://api.openai.com/v1/responses'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${apiKey}`);
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, model); assert.equal(body.store, false); assert.equal(body.stream, false); assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none'); assert.equal(body.max_output_tokens, 8192);
    assert.deepEqual(body.text.format, { type: 'json_schema', name: 'guidekit_plan', strict: true, schema }); assert.deepEqual(body.input, [{ role: 'user', content: input.prompt }]); assert.equal(String(init?.body).includes(apiKey), false); assert.equal(body.previous_response_id, undefined);
    return json(completed([{ type: 'reasoning', summary: [] }, { ...message(), phase: 'final_answer' }]));
  });
  try { assert.deepEqual(JSON.parse(await value.infer(input)), { answer: 'fixture answer' }); assert.equal(posts, 1); assert.match((await value.status()).message, /inference completed/); }
  finally { await value.close(); }
});

test('refusals, incomplete answers, tool calls, duplicate messages and malformed model JSON are rejected', async () => {
  const cases: unknown[] = [
    { ...completed(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { ...completed(), error: { message: 'private fixture error' } },
    { ...completed(), incomplete_details: { reason: 'content_filter' } },
    completed([{ ...message(), content: [{ type: 'refusal', refusal: 'private refusal fixture' }] }]),
    completed([message(), { type: 'function_call', name: 'forbidden', arguments: '{}' }]),
    completed([{ ...message(), status: 'in_progress' }]), completed([{ ...message(), role: 'user' }]), completed([{ ...message(), phase: 'commentary' }]), completed([message(), message()]),
    completed([message('{"answer":')]), completed([message('[]')]), completed([message('"a JSON scalar"')]),
    completed([{ type: 'reasoning', status: 'incomplete' }]), completed([]), { ...completed(), output: 'invalid' },
  ];
  for (const body of cases) {
    const value = provider(async () => json(body));
    try { await assert.rejects(value.infer(input), /OpenAI/); } finally { await value.close(); }
  }
});

test('transport errors and provider bodies never leak credentials, prompts or raw errors', async () => {
  const sensitive = `${apiKey} Bearer fixture-private-token fixture prompt`;
  for (const fetch of [
    (async () => { throw new Error(sensitive); }) as typeof globalThis.fetch,
    (async () => json({ error: { message: sensitive } }, { status: 401 })) as typeof globalThis.fetch,
    (async () => new Response(sensitive, { status: 503 })) as typeof globalThis.fetch,
  ]) {
    const value = provider(fetch);
    try {
      await assert.rejects(value.infer(input), error => { assert.ok(error instanceof Error); assert.equal(error.message.includes(apiKey), false); assert.equal(error.message.includes('fixture'), false); return true; });
      const status = await value.status(); assert.equal(status.authenticated, false); assert.equal(status.message.includes('fixture'), false);
    } finally { await value.close(); }
  }
});

test('redirects and unexpected final URLs are rejected without a second request', async () => {
  for (const changed of [{ redirected: true }, { url: 'https://untrusted.invalid/collect' }]) {
    let calls = 0;
    const value = provider(async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); const response = json(completed()); for (const [key, property] of Object.entries(changed)) Object.defineProperty(response, key, { value: property }); return response; });
    try { await assert.rejects(value.infer(input), /OpenAI request failed/); assert.equal(calls, 1); } finally { await value.close(); }
  }
});

test('response and final-text limits reject declared and streamed oversized bodies and cancel their readers', async () => {
  let streamCancelled = false;
  const cases = [
    () => json(completed(), { headers: { 'Content-Length': '524289' } }),
    () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(524289)); }, cancel() { streamCancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }),
    () => json(completed([message(JSON.stringify({ answer: 'x'.repeat(64_001) }))])),
    () => new Response('{"unterminated"', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('<html>upstream error</html>', { headers: { 'Content-Type': 'text/html' } }),
  ];
  for (const make of cases) { const value = provider(async () => make()); try { await assert.rejects(value.infer(input), /limit|JSON|request failed/); } finally { await value.close(); } }
  assert.equal(streamCancelled, true);
});

test('model status rejects mismatched models and malformed metadata without claiming authentication', async () => {
  for (const metadata of [{ object: 'model', id: 'different-model' }, { object: 'response', id: model }, { id: model }]) { const value = provider(async () => json(metadata)); try { const status = await value.status(); assert.equal(status.authenticated, false); assert.equal(status.available, false); } finally { await value.close(); } }
});

test('invalid inputs are rejected before network access', async () => {
  let calls = 0; const value = provider(async () => { calls++; return json(completed()); });
  const cycle: Record<string, unknown> = { type: 'object' }; cycle.self = cycle;
  try {
    for (const bad of [{ ...input, prompt: ' ' }, { ...input, prompt: 'x'.repeat(180_001) }, { ...input, schema: cycle }, { ...input, schema: { type: 'array' } }, { ...input, schema: { ...schema, description: 'x'.repeat(33_000) } }]) await assert.rejects(value.infer(bad), /prompt|schema/);
    const controller = new AbortController(); controller.abort('private cancellation reason'); await assert.rejects(value.infer({ ...input, signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
  } finally { await value.close(); }
});

test('caller cancellation rejects even a transport that ignores AbortSignal and removes listeners', async () => {
  let signal: AbortSignal | undefined;
  const value = provider(async (_url, init) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}); });
  const controller = new AbortController(), pending = value.infer({ ...input, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); controller.abort('private cancellation reason'); await rejected;
  assert.equal(signal?.aborted, true); assert.equal(getEventListeners(controller.signal, 'abort').length, 0); await value.close();
});

test('cancellation stops an in-progress streamed response', async () => {
  let streamCancelled = false;
  const value = provider(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { streamCancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }));
  const controller = new AbortController(), pending = value.infer({ ...input, signal: controller.signal }), rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await rejected; assert.equal(streamCancelled, true); await value.close();
});

test('inference and status have finite deadlines even when a transport ignores cancellation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const value = provider(async () => new Promise<Response>(() => {}));
  const pending = value.infer(input), rejected = assert.rejects(pending, /timed out/); context.mock.timers.tick(90_001); await rejected;
  const status = value.status(); context.mock.timers.tick(10_001); assert.equal((await status).authenticated, false); await value.close();
});

test('close cancels inference and status and prevents later network calls', async () => {
  let calls = 0;
  const value = provider(async () => { calls++; return new Promise<Response>(() => {}); });
  const inference = value.infer(input), rejected = assert.rejects(inference, /closed/), status = value.status();
  await value.close(); await rejected; assert.equal((await status).available, false); assert.equal((await value.status()).authenticated, false);
  await assert.rejects(value.infer(input), /closed/); await value.close(); assert.equal(calls, 2);
});
