import { spawn } from 'node:child_process';
import { build } from 'esbuild';

await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: 'dist/sdk/guidekit.js', bundle: true, format: 'iife', globalName: 'GuideKitSDK', target: 'es2022' });
const children = [spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })];
const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => { stop(); process.exitCode = code ?? 0; });
