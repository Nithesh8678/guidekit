import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexProvider, type InferenceTiming } from './index.js';

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };

// A local protocol fixture, never a replacement provider in the application.
async function fixture(mode: string, callback: (bin: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-runtime-test-'));
  const bin = join(directory, 'codex-fixture.mjs');
  await writeFile(bin, `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)};
const log=${JSON.stringify(join(directory, 'events.jsonl'))};
const record=event=>appendFileSync(log,JSON.stringify({event,pid:process.pid})+'\\n');
record('spawn');process.on('SIGTERM',()=>{record('stop');process.exit(0)});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(m,result)=>send({id:m.id,result});
const features=Object.fromEntries(process.argv.filter(x=>x.startsWith('features.')).map(x=>[x.slice(9).split('=')[0],false]));
if(mode==='capability')features.shell_tool=true;
let configReads=0,accountReads=0;
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
 const m=JSON.parse(line);
 record(m.method);
 if(m.method==='initialize'){if(mode==='prepare-wait')return;return reply(m,{});}
 if(m.method==='config/read'){configReads++;return reply(m,{config:{features:{...features,...(mode==='claim-capability'&&configReads>1?{shell_tool:true}:{})},mcp_servers:{},web_search:'disabled'}});}
 if(m.method==='account/read'){accountReads++;return reply(m,{account:{type:mode==='apikey'||mode==='claim-apikey'&&accountReads>1?'apiKey':'chatgpt',email:mode==='claim-account'&&accountReads>1?'changed@example.invalid':'fixture@example.invalid'}});}
 if(m.method==='model/list'){reply(m,{data:[{model:'fixture-default',isDefault:true,hidden:false,supportedReasoningEfforts:[],defaultReasoningEffort:'low'}]});setTimeout(()=>record('catalog-settled'),20);return;}
 if(m.method==='thread/start'){
  if(m.params.sandbox!=='read-only'||m.params.approvalPolicy!=='never'||m.params.ephemeral!==true)process.exit(2);
  return reply(m,{thread:{id:'fixture-thread'},model:m.params.model});
 }
 if(m.method==='turn/start'){
  if(!m.params.outputSchema||m.params.input[0].text!=='fixture prompt')process.exit(3);
  reply(m,{turn:{id:'fixture-turn',status:'inProgress'}});
  if(mode==='wait')return;
  if(mode==='tool'){send({method:'item/started',params:{item:{type:'commandExecution'}}});return;}
  if(mode==='server-request'){send({id:500,method:'item/tool/call',params:{}});return;}
  send({method:'item/completed',params:{threadId:'fixture-thread',item:{type:'agentMessage',text:mode==='invalid'?'not json':'{"answer":"verified"}'}}});
  send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{status:'completed'}}});
 }
});
`, { mode: 0o700 });
  try { await callback(bin, directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

interface FixtureEvent { event: string; pid: number; }
async function events(directory: string): Promise<FixtureEvent[]> {
  const text = await readFile(join(directory, 'events.jsonl'), 'utf8').catch(() => '');
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
}
async function waitEvent(directory: string, event: string, count = 1): Promise<FixtureEvent[]> {
  const deadline = performance.now() + 5000;
  do {
    const value = await events(directory);
    if (value.filter(entry => entry.event === event).length >= count) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (performance.now() < deadline);
  throw new Error(`Protocol fixture did not observe ${count} ${event} events.`);
}
async function settledPreparation(directory: string): Promise<FixtureEvent[]> {
  return waitEvent(directory, 'catalog-settled');
}
async function waitEventWithoutTimers(directory: string, event: string, count = 1): Promise<FixtureEvent[]> {
  const deadline = performance.now() + 5000;
  do {
    const value = await events(directory);
    if (value.filter(entry => entry.event === event).length >= count) return value;
    await new Promise<void>(resolve => setImmediate(resolve));
  } while (performance.now() < deadline);
  throw new Error(`Protocol fixture did not observe ${count} ${event} events.`);
}
async function assertNoRuntimeDirectories(directory: string): Promise<void> {
  assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('guidekit-inference-')), []);
}

test('status distinguishes login from completed schema-constrained inference', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try {
      const initial = await provider.status();
      assert.equal(initial.authenticated, true);
      assert.match(initial.message, /not yet been verified/);
      assert.deepEqual(JSON.parse(await provider.infer({ prompt: 'fixture prompt', schema })), { answer: 'verified' });
      assert.match((await provider.status()).message, /Live inference completed with fixture-default/);
    } finally { await provider.close(); }
    await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /closed/);
  });
});

test('API-key authentication is rejected without a model turn', async () => {
  await fixture('apikey', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try { await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /API-key inference is disabled/); }
    finally { await provider.close(); }
  });
});

test('fails closed when a capability remains enabled', async () => {
  await fixture('capability', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try { await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /shell_tool/); }
    finally { await provider.close(); }
  });
});

for (const mode of ['tool', 'server-request']) {
  test(`stops inference on an unexpected ${mode}`, async () => {
    await fixture(mode, async (bin, cwd) => {
      const provider = createCodexProvider({ bin, cwd });
      try { await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /disabled/); }
      finally { await provider.close(); }
    });
  });
}

test('rejects invalid model JSON', async () => {
  await fixture('invalid', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try { await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /invalid JSON/); }
    finally { await provider.close(); }
  });
});

test('cancellation stops the subprocess and leaves live status unverified', async () => {
  await fixture('wait', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema, signal: controller.signal }), { name: 'AbortError' });
      assert.match((await provider.status()).message, /not yet been verified/);
    } finally { clearTimeout(timer); await provider.close(); }
  });
});

test('phase timings contain only numeric durations and preserve completed inference', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd }), events: InferenceTiming[] = [];
    try {
      const result = await provider.infer({ prompt: 'fixture prompt', schema, onTiming: event => events.push(event) });
      assert.deepEqual(JSON.parse(result), { answer: 'verified' });
      assert.deepEqual(events.map(event => event.phase), ['startup', 'restrictions', 'authentication', 'catalog', 'thread', 'inference', 'cleanup']);
      for (const [index, event] of events.entries()) {
        assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'elapsedMs', 'phase']);
        assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0);
        assert.ok(Number.isInteger(event.elapsedMs) && event.elapsedMs >= event.durationMs);
        if (index) assert.ok(event.elapsedMs >= events[index - 1]!.elapsedMs);
      }
      assert.equal(JSON.stringify(events).includes('fixture'), false);
      assert.equal(JSON.stringify(events).includes(cwd), false);
    } finally { await provider.close(); }
  });
});

test('throwing timing observers cannot bypass restrictions or replace successful output', async () => {
  for (const mode of ['success', 'capability']) await fixture(mode, async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try {
      const result = provider.infer({ prompt: 'fixture prompt', schema, onTiming: () => { throw new Error('private diagnostic failure'); } });
      if (mode === 'success') assert.deepEqual(JSON.parse(await result), { answer: 'verified' });
      else await assert.rejects(result, /shell_tool/);
    } finally { await provider.close(); }
  });
});

test('cancelled model work records inference and cleanup phases without output or cancellation details', async () => {
  await fixture('wait', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd }), events: InferenceTiming[] = [], controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema, signal: controller.signal, onTiming: event => {
        events.push(event);
        if (event.phase === 'thread') timer = setTimeout(() => controller.abort('private cancellation details'), 20);
      } }), { name: 'AbortError' });
      assert.deepEqual(events.map(event => event.phase), ['startup', 'restrictions', 'authentication', 'catalog', 'thread', 'inference', 'cleanup']);
      assert.equal(JSON.stringify(events).includes('private'), false);
      assert.match((await provider.status()).message, /not yet been verified/);
    } finally { if (timer) clearTimeout(timer); await provider.close(); }
  });
});

test('a restriction failure records its completed phases and still performs cleanup', async () => {
  await fixture('capability', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd }), events: InferenceTiming[] = [];
    try {
      await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema, onTiming: event => events.push(event) }), /shell_tool/);
      assert.deepEqual(events.map(event => event.phase), ['startup', 'restrictions', 'cleanup']);
    } finally { await provider.close(); }
  });
});

test('prepare is idempotent, performs no model turn, and destroys its private idle process on close', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    provider.prepare(); provider.prepare(); provider.prepare();
    const initial = await settledPreparation(cwd);
    assert.equal(initial.filter(entry => entry.event === 'spawn').length, 1);
    assert.equal(initial.some(entry => entry.event === 'thread/start' || entry.event === 'turn/start'), false);
    await provider.close();
    assert.equal((await events(cwd)).filter(entry => entry.event === 'stop').length, 1);
    await assertNoRuntimeDirectories(cwd);
    provider.prepare(); await provider.close();
    assert.equal((await events(cwd)).filter(entry => entry.event === 'spawn').length, 1);
  });
});

test('each prepared process serves exactly one fresh thread and turn while one spare is replenished', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd }), timings: InferenceTiming[] = [];
    try {
      provider.prepare(); await settledPreparation(cwd);
      assert.deepEqual(JSON.parse(await provider.infer({ prompt: 'fixture prompt', schema, onTiming: event => { timings.push(event); throw new Error('diagnostic failure'); } })), { answer: 'verified' });
      assert.equal(timings[0]!.phase, 'startup'); assert.equal(timings[0]!.durationMs, 0);
      assert.deepEqual(timings.map(event => event.phase), ['startup', 'restrictions', 'authentication', 'catalog', 'thread', 'inference', 'cleanup']);
      await waitEvent(cwd, 'catalog-settled', 2);
      assert.deepEqual(JSON.parse(await provider.infer({ prompt: 'fixture prompt', schema })), { answer: 'verified' });
      await waitEvent(cwd, 'catalog-settled', 3);
      const recorded = await events(cwd), turns = recorded.filter(entry => entry.event === 'turn/start');
      assert.equal(turns.length, 2); assert.equal(new Set(turns.map(entry => entry.pid)).size, 2);
      assert.equal(recorded.filter(entry => entry.event === 'spawn').length, 3);
      for (const { pid } of turns) {
        assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'thread/start').length, 1);
        assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'config/read').length, 2);
        assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'account/read').length, 2);
        assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'model/list').length, 1);
      }
      assert.equal(JSON.stringify(timings).includes('fixture'), false);
    } finally { await provider.close(); }
    await assertNoRuntimeDirectories(cwd);
  });
});

test('concurrent inference claims separate one-shot processes and never shares a thread', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try {
      provider.prepare(); await settledPreparation(cwd);
      const answers = await Promise.all([provider.infer({ prompt: 'fixture prompt', schema }), provider.infer({ prompt: 'fixture prompt', schema })]);
      for (const answer of answers) assert.deepEqual(JSON.parse(answer), { answer: 'verified' });
      const recorded = await events(cwd), turns = recorded.filter(entry => entry.event === 'turn/start');
      assert.equal(turns.length, 2); assert.equal(new Set(turns.map(entry => entry.pid)).size, 2);
      for (const { pid } of turns) assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'thread/start').length, 1);
      assert.ok(recorded.filter(entry => entry.event === 'spawn').length <= 3);
    } finally { await provider.close(); }
    await assertNoRuntimeDirectories(cwd);
  });
});

test('cancellation during preparation destroys only the claimed lease before close destroys its spare', async () => {
  await fixture('prepare-wait', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd }), controller = new AbortController(), timings: InferenceTiming[] = [];
    provider.prepare();
    const pending = provider.infer({ prompt: 'fixture prompt', schema, signal: controller.signal, onTiming: event => timings.push(event) });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await waitEvent(cwd, 'initialize', 2); controller.abort('private cancellation reason'); await rejected;
    const beforeClose = await events(cwd);
    assert.equal(beforeClose.filter(entry => entry.event === 'stop').length, 1);
    assert.equal(beforeClose.some(entry => entry.event === 'turn/start'), false);
    assert.deepEqual(timings.map(event => event.phase), ['startup', 'cleanup']);
    await provider.close();
    assert.equal((await events(cwd)).filter(entry => entry.event === 'stop').length, 2);
    await assertNoRuntimeDirectories(cwd);
  });
});

test('close cancels prepared inference and its idle spare, waits for cleanup, and forbids new work', async () => {
  await fixture('wait', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    provider.prepare(); await settledPreparation(cwd);
    const pending = provider.infer({ prompt: 'fixture prompt', schema }), rejected = assert.rejects(pending, /closed|stopped/i);
    await waitEvent(cwd, 'turn/start');
    await provider.close(); await rejected;
    await assertNoRuntimeDirectories(cwd);
    await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), /closed/);
    assert.equal((await provider.status()).authenticated, false);
  });
});

test('close during filesystem preparation cannot launch a late subprocess or leave state behind', async () => {
  await fixture('success', async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    provider.prepare(); await provider.close();
    assert.equal((await events(cwd)).some(entry => entry.event === 'spawn'), false);
    await assertNoRuntimeDirectories(cwd);
  });
});

for (const mode of ['prepare-wait', 'success']) test(`an unclaimed ${mode === 'success' ? 'ready' : 'preparing'} lease expires after 60 seconds without a replenishment loop`, async context => {
  await fixture(mode, async (bin, cwd) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const provider = createCodexProvider({ bin, cwd });
    provider.prepare();
    await waitEventWithoutTimers(cwd, mode === 'success' ? 'catalog-settled' : 'initialize');
    context.mock.timers.tick(60_001);
    await waitEventWithoutTimers(cwd, 'stop');
    // The expiry abort completes asynchronously; close joins that cleanup.
    await provider.close();
    const recorded = await events(cwd);
    assert.equal(recorded.filter(entry => entry.event === 'spawn').length, 1);
    assert.equal(recorded.some(entry => entry.event === 'thread/start' || entry.event === 'turn/start'), false);
    await assertNoRuntimeDirectories(cwd);
  });
});

test('an expired prepared lease is not consumed and later inference uses a fresh process', async context => {
  await fixture('success', async (bin, cwd) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const provider = createCodexProvider({ bin, cwd });
    try {
      provider.prepare(); const initial = await waitEventWithoutTimers(cwd, 'catalog-settled');
      const expiredPid = initial.find(entry => entry.event === 'spawn')!.pid;
      context.mock.timers.tick(60_001); await waitEventWithoutTimers(cwd, 'stop');
      assert.deepEqual(JSON.parse(await provider.infer({ prompt: 'fixture prompt', schema })), { answer: 'verified' });
      const recorded = await events(cwd), turn = recorded.find(entry => entry.event === 'turn/start');
      assert.ok(turn); assert.notEqual(turn.pid, expiredPid);
      assert.equal(recorded.some(entry => entry.pid === expiredPid && entry.event === 'thread/start'), false);
    } finally { await provider.close(); }
    await assertNoRuntimeDirectories(cwd);
  });
});

test('a late claim receives its own full inference deadline instead of inheriting the idle preparation age', async context => {
  await fixture('wait', async (bin, cwd) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const provider = createCodexProvider({ bin, cwd }), controller = new AbortController();
    try {
      provider.prepare(); await waitEventWithoutTimers(cwd, 'catalog-settled');
      context.mock.timers.tick(59_000);
      let settled = false;
      const pending = provider.infer({ prompt: 'fixture prompt', schema, signal: controller.signal });
      void pending.then(() => { settled = true; }, () => { settled = true; });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await waitEventWithoutTimers(cwd, 'turn/start');
      context.mock.timers.tick(32_000);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      controller.abort(); await rejected;
    } finally { await provider.close(); }
    await assertNoRuntimeDirectories(cwd);
  });
});

for (const [mode, expected] of [['capability', /shell_tool/], ['apikey', /API-key/], ['claim-capability', /shell_tool/], ['claim-apikey', /API-key/], ['claim-account', /account changed/]] as const) test(`preparation and claim fail closed for ${mode} before any model turn`, async () => {
  await fixture(mode, async (bin, cwd) => {
    const provider = createCodexProvider({ bin, cwd });
    try {
      provider.prepare();
      if (mode.startsWith('claim-')) await settledPreparation(cwd);
      await assert.rejects(provider.infer({ prompt: 'fixture prompt', schema }), expected);
      const recorded = await events(cwd);
      assert.equal(recorded.some(entry => entry.event === 'thread/start' || entry.event === 'turn/start'), false);
      if (mode === 'claim-account') {
        const pid = recorded.find(entry => entry.event === 'spawn')!.pid;
        assert.equal(recorded.filter(entry => entry.pid === pid && entry.event === 'model/list').length, 1);
      }
    } finally { await provider.close(); }
    await assertNoRuntimeDirectories(cwd);
  });
});
