import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist/sdk', { recursive: true });
await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: 'dist/sdk/guidekit.js', bundle: true, format: 'iife', globalName: 'GuideKitSDK', target: 'es2022', minify: true, sourcemap: false });
await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: 'dist/sdk/guidekit.mjs', bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false });
await viteBuild();
await cp('apps/demo', 'dist/demo', { recursive: true });
console.log('Dashboard, reusable SDK (script + ESM), and independent demo sites built.');
