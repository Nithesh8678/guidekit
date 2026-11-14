import test from 'node:test';
import assert from 'node:assert/strict';
import type { VisualScene } from '../../contracts/src/visual';
import { prepareVisual, visualCameraIntent, visualFitDistance } from '../src/viewer3d-model';
import { verifiedViewerURL, VisualViewerLoader, type VisualViewer, type VisualViewerModule } from '../src/viewer3d-loader';
import type { VisualPresentation } from '../src/session-types';

const scene = (id = 'example'): VisualScene => ({ kind: 'scene3d', id, title: 'A procedural explanation', summary: 'Two real objects described by the scene.', focusId: null, objects: [
  { id: 'body', shape: 'box', label: 'Body', description: 'A rectangular body.', color: '#3670b5', position: [4, 2, 1], rotation: [0, 0, 0], size: [2, 4, 6] },
  { id: 'joint', shape: 'sphere', label: 'Joint', description: 'A spherical joint.', color: '#e9ae36', position: [-2, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] }
] });
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('verified viewer URLs use adjacent content-addressed modules across alias and immutable SDK installs', () => {
  const filename = `viewer3d-${'a'.repeat(24)}.mjs`, next = `viewer3d-${'b'.repeat(24)}.mjs`, integrity = `sha384-${Buffer.alloc(48).toString('base64')}`;
  for (const base of ['http://127.0.0.1:4410/sdk/guidekit.js', 'https://example.test/sdk/releases/current/guidekit.mjs']) {
    const url = verifiedViewerURL(base, filename, integrity), newer = verifiedViewerURL(base, next, integrity);
    assert.equal(url.origin, new URL(base).origin); assert.equal(url.pathname, new URL(`./${filename}`, base).pathname); assert.notEqual(url.href, newer.href);
  }
  for (const filename of ['viewer3d.mjs', '../viewer3d-aaaaaaaaaaaaaaaaaaaaaaaa.mjs', 'https://elsewhere.test/viewer3d-aaaaaaaaaaaaaaaaaaaaaaaa.mjs', 'viewer3d-not-a-hash.mjs']) assert.throws(() => verifiedViewerURL('https://example.test/sdk/guidekit.js', filename, integrity));
  assert.throws(() => verifiedViewerURL('file:///sdk/guidekit.mjs', filename, integrity)); assert.throws(() => verifiedViewerURL('https://example.test/sdk/guidekit.js', filename, ''));
});

test('bundled application modules load the verified renderer from their configured GuideKit endpoint', () => {
  const filename = `viewer3d-${'a'.repeat(24)}.mjs`, integrity = `sha384-${Buffer.alloc(48).toString('base64')}`, endpoint = 'http://127.0.0.1:4510';
  for (const base of ['http://127.0.0.1:4511/assets/index-123.js', 'http://127.0.0.1:4511/node_modules/.vite/deps/@guidekit_sdk.js?v=123', 'http://127.0.0.1:4511/assets/guidekit.js', 'http://127.0.0.1:4511/assets/guidekit.mjs', 'file:///app/assets/index.js', '']) {
    const url = verifiedViewerURL(base, filename, integrity, endpoint); assert.equal(url.origin, endpoint); assert.equal(url.pathname, `/sdk/${filename}`); assert.equal(url.search, ''); assert.equal(url.hash, '');
  }
  for (const base of ['https://cdn.example.test/sdk/releases/version/guidekit.js', 'https://cdn.example.test/package/dist/guidekit.mjs']) {
    assert.equal(verifiedViewerURL(base, filename, integrity, endpoint, true).href, new URL(filename, base).href, 'Direct script/CDN installations keep their adjacent hashed renderer.');
    assert.equal(verifiedViewerURL(base, filename, integrity, endpoint).origin, endpoint, 'Module format consistently uses its trusted endpoint before or after rebundling.');
  }
  for (const endpoint of ['', '/api', 'file:///api', 'javascript:alert(1)', 'https://user:password@example.test', 'https://example.test/api', 'https://example.test/?query=1', 'https://example.test/#fragment']) {
    for (const adjacent of [false, true]) assert.throws(() => verifiedViewerURL('https://cdn.example.test/guidekit.js', filename, integrity, endpoint, adjacent), 'Invalid endpoints fail even when an adjacent SDK module exists.');
  }
  assert.throws(() => verifiedViewerURL('https://app.example.test/assets/app.js', '../viewer3d-aaaaaaaaaaaaaaaaaaaaaaaa.mjs', integrity, endpoint));
  assert.throws(() => verifiedViewerURL('https://app.example.test/assets/app.js', filename, '', endpoint));
});

test('viewer preparation renders provided primitive types and exact authored transforms', () => {
  const spec = scene(); spec.objects = [spec.objects[0]!];
  const visual = prepareVisual(spec);
  assert.equal(visual.meshes.length, 1); assert.equal(visual.objects.get('body')!.children[0], visual.meshes[0]);
  assert.deepEqual(visual.bounds.min.toArray(), [3, 0, -2]); assert.deepEqual(visual.bounds.max.toArray(), [5, 4, 4]);
  assert.equal(visual.meshes[0]!.material instanceof Array, false);
  visual.dispose();
  const shapes = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'arrow'] as const;
  spec.objects = shapes.map((shape, index) => ({ ...scene().objects[0]!, id: `part_${index}`, shape, position: [index * 2, 0, 0] }));
  const every = prepareVisual(spec); assert.equal(every.objects.size, 6); assert.equal(every.meshes.length, 7);
  assert.ok(every.meshes.every(mesh => mesh.geometry.attributes.position!.count < 600)); every.dispose();
});

test('every generated geometry and material is disposed exactly once', () => {
  const visual = prepareVisual(scene()); let geometries = 0, materials = 0;
  for (const mesh of visual.meshes) { mesh.geometry.addEventListener('dispose', () => geometries++); const material = mesh.material; if (Array.isArray(material)) assert.fail('Bounded primitive meshes use one material'); material.addEventListener('dispose', () => materials++); }
  visual.dispose(); visual.dispose(); assert.equal(geometries, 2); assert.equal(materials, 2); assert.equal(visual.objects.size, 0); assert.equal(visual.scene.children.length, 0);
});

test('viewer preparation rejects URL/code fields, duplicates, invalid transforms and unknown focus', () => {
  const original = scene();
  for (const bad of [
    { ...original, texture: 'https://example.invalid/asset.png' },
    { ...original, objects: [{ ...original.objects[0], shader: 'run()' }] },
    { ...original, objects: [original.objects[0], original.objects[0]] },
    { ...original, objects: [{ ...original.objects[0], position: [Infinity, 0, 0] }] },
    { ...original, focusId: 'missing' },
    { ...original, objects: Array.from({ length: 37 }, (_, index) => ({ ...original.objects[0], id: `part_${index}` })) }
  ]) assert.throws(() => prepareVisual(bad));
  assert.equal(original.objects.length, 2);
});

test('same-scene updates retain camera until a different explicit focus or new topic', () => {
  const original = scene(), focused = { ...original, focusId: 'joint' };
  assert.equal(visualCameraIntent(null, original), 'reset'); assert.equal(visualCameraIntent(original, scene('new_topic')), 'reset');
  assert.equal(visualCameraIntent(original, { ...original, summary: 'Updated explanation.' }), 'preserve');
  assert.equal(visualCameraIntent(original, focused), 'focus'); assert.equal(visualCameraIntent(focused, { ...focused }), 'preserve');
  assert.equal(visualCameraIntent(focused, { ...focused, focusId: null }), 'preserve');
  assert.ok(visualFitDistance(4, 1) > visualFitDistance(2, 1)); assert.ok(visualFitDistance(4, .5) > visualFitDistance(4, 1));
  for (const input of [[-1, 1], [1, 0], [NaN, 1], [1, Infinity]]) assert.throws(() => visualFitDistance(input[0]!, input[1]!));
});

function fakeViewer(): VisualViewer & { presents: number; disposes: number; hides: number } {
  let current: VisualScene | null = null;
  return { presents: 0, disposes: 0, hides: 0, async present(spec) { current = spec; this.presents++; return { sceneId: spec.id, renderer: 'svg' }; }, selection() { return current ? { sceneId: current.id, selectedObjectId: current.objects[0]!.id } : null; }, focusObject(id) { return !!current?.objects.some(object => object.id === id); }, cancelPresentation() {}, hide() { this.hides++; }, show() {}, dispose() { this.disposes++; current = null; } };
}

test('preloading is lazy and creates no renderer; completed presentations reuse one handle', async () => {
  let loads = 0, factories = 0; const viewer = fakeViewer();
  const loader = new VisualViewerLoader({} as HTMLElement, async () => { loads++; return { createViewer3D() { factories++; return viewer; } }; }, () => {});
  assert.equal(loads, 0); loader.preload(); await Promise.resolve(); assert.equal(loads, 1); assert.equal(factories, 0);
  assert.deepEqual(await loader.present(scene(), 'run_first'), { sceneId: 'example', renderer: 'svg' });
  await loader.present(scene(), 'run_second'); assert.equal(loads, 1); assert.equal(factories, 1); assert.equal(viewer.presents, 2);
  assert.equal(loader.focusObject('joint'), true); assert.equal(loader.focusObject('unknown'), false); assert.equal(loader.focusObject('bad;script'), false);
  loader.hide(); assert.equal(viewer.hides, 1); assert.equal(loader.selection()?.sceneId, 'example'); loader.clear(); assert.equal(viewer.disposes, 1); assert.equal(loader.selection(), null);
});

test('stopping a deferred import aborts it and prevents a late viewer factory', async () => {
  const module = deferred<VisualViewerModule>(); let factories = 0, signal: AbortSignal | undefined;
  const loader = new VisualViewerLoader({} as HTMLElement, input => { signal = input; return module.promise; }, () => {});
  const presenting = loader.present(scene(), 'run_first'); const rejected = assert.rejects(presenting, { name: 'AbortError' });
  loader.clear(); assert.equal(signal?.aborted, true); module.resolve({ createViewer3D() { factories++; return fakeViewer(); } });
  await rejected; assert.equal(factories, 0); assert.equal(loader.selection(), null);
});

test('superseding a deferred import presents only the latest requested topic', async () => {
  const module = deferred<VisualViewerModule>(), viewer = fakeViewer();
  const loader = new VisualViewerLoader({} as HTMLElement, () => module.promise, () => {});
  const first = loader.present(scene('old_topic'), 'run_first'), rejected = assert.rejects(first, { name: 'AbortError' });
  const second = loader.present(scene('new_topic'), 'run_second'); module.resolve({ createViewer3D: () => viewer });
  await rejected; assert.equal((await second).sceneId, 'new_topic'); assert.equal(viewer.presents, 1); loader.dispose();
});

test('hide and destroy reject a deliberately late first-frame acknowledgement', async () => {
  const ack = deferred<VisualPresentation>(), entered = deferred<void>(), viewer = fakeViewer(); viewer.present = () => { entered.resolve(); return ack.promise; };
  const loader = new VisualViewerLoader({} as HTMLElement, async () => ({ createViewer3D: () => viewer }), () => {});
  const presenting = loader.present(scene(), 'run_first'), rejected = assert.rejects(presenting, { name: 'AbortError' });
  await entered.promise; loader.hide(); loader.dispose(); ack.resolve({ sceneId: 'example', renderer: 'svg' });
  await rejected; assert.equal(viewer.disposes, 1); await assert.rejects(loader.present(scene(), 'run_late'), { name: 'AbortError' });
});

test('a failed update preserves the existing viewer and can retry without reloading', async () => {
  const viewer = fakeViewer(); let loads = 0;
  const loader = new VisualViewerLoader({} as HTMLElement, async () => { loads++; return { createViewer3D: () => viewer }; }, () => {});
  await loader.present(scene(), 'run_first'); viewer.present = async () => { throw new Error('Invalid update'); };
  await assert.rejects(loader.present(scene('bad_update'), 'run_second'), /Invalid update/);
  assert.equal(loader.selection()?.sceneId, 'example'); assert.equal(viewer.disposes, 0); assert.equal(loads, 1); loader.dispose();
});

test('cancelling an unpainted update retains the current acknowledged scene and renderer', async () => {
  const viewer = fakeViewer(), ack = deferred<VisualPresentation>(), entered = deferred<void>(); let cancellations = 0;
  const loader = new VisualViewerLoader({} as HTMLElement, async () => ({ createViewer3D: () => viewer }), () => {});
  await loader.present(scene(), 'run_first'); viewer.present = () => { entered.resolve(); return ack.promise; }; viewer.cancelPresentation = () => { cancellations++; };
  const updating = loader.present(scene('new_topic'), 'run_next'), rejected = assert.rejects(updating, { name: 'AbortError' });
  await entered.promise; loader.cancelPresentation(); ack.resolve({ sceneId: 'new_topic', renderer: 'svg' }); await rejected;
  assert.equal(loader.selection()?.sceneId, 'example'); assert.equal(viewer.disposes, 0); assert.equal(viewer.hides, 0); assert.equal(cancellations, 1); loader.dispose();
});

test('a new turn cancels its presentation immediately while preserving an authorized Explain preload', async () => {
  const module = deferred<VisualViewerModule>(); let loads = 0, signal: AbortSignal | undefined;
  const loader = new VisualViewerLoader({} as HTMLElement, input => { loads++; signal = input; return module.promise; }, () => {});
  loader.preload(); const first = loader.present(scene(), 'run_first'), rejected = assert.rejects(first, { name: 'AbortError' });
  loader.cancelPresentation(); await rejected; assert.equal(signal?.aborted, false);
  const next = loader.present(scene('new_topic'), 'run_next'); module.resolve({ createViewer3D: () => fakeViewer() });
  assert.equal((await next).sceneId, 'new_topic'); assert.equal(loads, 1); loader.dispose();
});
