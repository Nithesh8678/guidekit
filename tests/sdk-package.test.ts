import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { buildSDK } from '../scripts/build-sdk.js';
const exec = promisify(execFile);
test('packed SDK installs as a standalone ESM/types consumer and immutable manifest hashes match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-sdk-package-'));
  try {
    const manifest = await buildSDK();
    for (const asset of [manifest.script, manifest.module]) { const file = await readFile(resolve('dist', asset.path.slice(1))); assert.equal(asset.integrity, `sha384-${createHash('sha384').update(file).digest('base64')}`); }
    const packed = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', dir, '--cache', join(dir, 'cache')], { cwd: resolve('dist/sdk-package'), maxBuffer: 1024 * 1024 });
    const [{ filename, files }] = JSON.parse(packed.stdout); assert.ok(files.some((file: any) => file.path === 'dist/types/sdk/src/index.d.ts')); assert.ok(!files.some((file: any) => /\.env|\.data|\.sqlite|auth\.json/.test(file.path)));
    const modules = join(dir, 'node_modules'); await mkdir(join(modules, '@guidekit'), { recursive: true });
    await exec('tar', ['-xzf', join(dir, filename), '-C', dir]); await symlink(join(dir, 'package'), join(modules, '@guidekit/sdk'), 'dir'); await symlink(resolve('node_modules/zod'), join(modules, 'zod'), 'dir');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    const consumer = join(dir, 'consumer.ts'); await writeFile(consumer, `import { mount, type MountOptions, type RegisteredAction } from '@guidekit/sdk';\nconst action: RegisteredAction = {description:'Rename',inputSchema:{type:'object'},requiresConfirmation:true,async execute(_args,{signal,idempotencyKey}) { if(signal.aborted) throw new Error('aborted'); return {success:!!idempotencyKey,message:'verified'}; }};\nconst options: MountOptions={agentId:'agt_example',endpoint:'http://127.0.0.1:4410',actions:{rename:action},journey:{resume:'disabled'}};\n// @ts-expect-error invalid provider must fail the public declaration contract\nconst invalid: MountOptions={agentId:'a',endpoint:'b',voice:{provider:'unsupported'}};\nconst start=()=>mount(options); void start; void invalid;\n`);
    const program = ts.createProgram([consumer], { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: false, esModuleInterop: true, types: [], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] });
    const errors = ts.getPreEmitDiagnostics(program); assert.equal(errors.length, 0, ts.formatDiagnostics(errors, { getCanonicalFileName: value => value, getCurrentDirectory: () => dir, getNewLine: () => '\n' }));
    const loaded = await import(pathToFileURL(join(dir, 'package/dist/guidekit.mjs')).href); assert.equal(typeof loaded.mount, 'function'); assert.equal(typeof loaded.GuideKit.destroy, 'function');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
