import { build } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const SDK_VERSION = '0.5.0-alpha.1';
export async function buildSDK() {
  const output = resolve('dist/sdk'), packageDir = resolve('dist/sdk-package');
  await mkdir(output, { recursive: true });
  // Keep Three.js off the normal guidance startup path. Both core formats load
  // the same same-origin, immutable renderer only for a validated explanation.
  const threeLicense = await readFile(resolve('node_modules/three/LICENSE'), 'utf8');
  const viewer = { name: 'guidekit-lazy-viewer', setup(builder: import('esbuild').PluginBuild) { builder.onResolve({ filter: /^\.\/viewer3d$/ }, () => ({ path: './viewer3d.mjs', external: true })); } };
  await build({ entryPoints: ['packages/sdk/src/viewer3d.ts'], outfile: join(output, 'viewer3d.mjs'), bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false, banner: { js: `/*! Bundled Three.js license:\n${threeLicense.replaceAll('*/', '* /')}\n*/` } });
  const visual = await readFile(join(output, 'viewer3d.mjs'));
  const viewerFilename = `viewer3d-${createHash('sha256').update(visual).digest('hex').slice(0, 24)}.mjs`;
  await cp(join(output, 'viewer3d.mjs'), join(output, viewerFilename));
  const viewerIntegrity = `sha384-${createHash('sha384').update(visual).digest('base64')}`;
  const define = { __GUIDEKIT_VIEWER_INTEGRITY__: JSON.stringify(viewerIntegrity), __GUIDEKIT_VIEWER_FILENAME__: JSON.stringify(viewerFilename) };
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: join(output, 'guidekit.js'), bundle: true, format: 'iife', globalName: 'GuideKitSDK', target: 'es2022', minify: true, sourcemap: false, plugins: [viewer], define: { ...define, __GUIDEKIT_CORE_FORMAT__: JSON.stringify('script'), 'import.meta.url': 'undefined' } });
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: join(output, 'guidekit.mjs'), bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false, plugins: [viewer], define: { ...define, __GUIDEKIT_CORE_FORMAT__: JSON.stringify('module') } });
  const script = await readFile(join(output, 'guidekit.js')), module = await readFile(join(output, 'guidekit.mjs'));
  const release = createHash('sha256').update(script).update(module).update(visual).digest('hex').slice(0, 24), releaseDir = join(output, 'releases', release);
  await mkdir(releaseDir, { recursive: true });
  for (const file of ['guidekit.js', 'guidekit.mjs', viewerFilename]) await cp(join(output, file), join(releaseDir, file));
  const manifest = { version: SDK_VERSION, release, capabilities: { apiVersion: 1, explicitTargets: true, adaptiveJourneys: true, hostWorkflowProgress: true, guideTargetCatalog: true, activeSessions: true, controlHoldVoice: true, scene3d: 1 }, script: { path: `/sdk/releases/${release}/guidekit.js`, integrity: `sha384-${createHash('sha384').update(script).digest('base64')}` }, module: { path: `/sdk/releases/${release}/guidekit.mjs`, integrity: `sha384-${createHash('sha384').update(module).digest('base64')}` }, assets: { viewer3d: { path: `/sdk/releases/${release}/${viewerFilename}`, integrity: viewerIntegrity } } };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(packageDir, { recursive: true, force: true }); await mkdir(join(packageDir, 'dist'), { recursive: true });
  await cp(join(output, 'guidekit.mjs'), join(packageDir, 'dist', 'guidekit.mjs'));
  await cp(join(output, 'guidekit.js'), join(packageDir, 'dist', 'guidekit.js'));
  await cp(join(output, viewerFilename), join(packageDir, 'dist', viewerFilename));
  await writeFile(join(packageDir, 'dist', 'THIRD_PARTY_NOTICES.txt'), `Three.js (bundled in ${viewerFilename})\n\n${threeLicense}`);
  const program = ts.createProgram(['packages/sdk/src/index.ts'], { declaration: true, emitDeclarationOnly: true, outDir: join(packageDir, 'dist/types'), rootDir: resolve('packages'), module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2023, lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], strict: true, skipLibCheck: true, esModuleInterop: true });
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
  const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ name: '@guidekit/sdk', version: SDK_VERSION, description: 'Company-scoped visual and voice guidance SDK', type: 'module', main: './dist/guidekit.mjs', module: './dist/guidekit.mjs', types: './dist/types/sdk/src/index.d.ts', exports: { '.': { types: './dist/types/sdk/src/index.d.ts', import: './dist/guidekit.mjs', default: './dist/guidekit.mjs' }, './script': './dist/guidekit.js' }, files: ['dist', 'README.md', 'LICENSE'], sideEffects: true, license: 'MIT', dependencies: { zod: rootPackage.dependencies.zod }, engines: { node: '>=20' }, repository: { type: 'git', url: 'git+https://github.com/Nithesh8678/guidekit.git', directory: 'packages/sdk' } }, null, 2)}\n`);
  await cp('LICENSE', join(packageDir, 'LICENSE'));
  await writeFile(join(packageDir, 'README.md'), `# GuideKit SDK\n\nBrowser SDK build ${SDK_VERSION}; release ${release}.\n\nImport { mount } from '@guidekit/sdk' and provide your published agentId and trusted GuideKit endpoint. Register typed host actions with validation, authorization, explicit approval, idempotency and verified outcomes. Browser voice requires supported Chrome/Edge, localhost/HTTPS and microphone permission. See https://github.com/Nithesh8678/guidekit/blob/feat/active-guide-explain/docs/sdk-release.md for configuration and privacy boundaries.\n\nThis archive is a locally verified release candidate. It has not been published to the npm registry.\n`);
  return manifest;
}
