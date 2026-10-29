import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexProvider } from './index.js';

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };

// A local protocol fixture, never a replacement provider in the application.
async function fixture(mode: string, callback: (bin: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-runtime-test-'));
  const bin = join(directory, 'codex-fixture.mjs');
  await writeFile(bin, `#!/usr/bin/env node
import {createInterface} from 'node:readline';
const mode=${JSON.stringify(mode)};
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const reply=(m,result)=>send({id:m.id,result});
const features=Object.fromEntries(process.argv.filter(x=>x.startsWith('features.')).map(x=>[x.slice(9).split('=')[0],false]));
if(mode==='capability')features.shell_tool=true;
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')return reply(m,{});
 if(m.method==='config/read')return reply(m,{config:{features,mcp_servers:{},web_search:'disabled'}});
 if(m.method==='account/read')return reply(m,{account:{type:mode==='apikey'?'apiKey':'chatgpt'}});
 if(m.method==='model/list')return reply(m,{data:[{model:'fixture-default',isDefault:true,hidden:false,supportedReasoningEfforts:[],defaultReasoningEffort:'low'}]});
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
