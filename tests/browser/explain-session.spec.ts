import { test as base, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { AssistantContext, PageContext, RunResult } from '../../packages/contracts/src/index.js';
import type { GuideKitInstance } from '../../packages/sdk/src/types.js';

// Real browser + persisted HTTP runs + generated primitives. Only speech and
// inference are explicit fixtures; no microphone, live model or paid API is used.
const endpoint = 'http://127.0.0.1:4510', website = 'http://127.0.0.1:4511';
const root = (page: Page) => page.locator('[data-guidekit-root]');
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const viewer = (page: Page) => page.getByRole('region', { name: 'Interactive 3D explanation', includeHidden: true });
const stage = (page: Page) => viewer(page).getByRole('group', { name: '3D model. Arrow keys rotate, plus and minus zoom, Home resets.', exact: true });
const viewerChunk = /\/viewer3d(?:-[a-f0-9]{24})?\.mjs(?:\?|$)/;
interface Ask { message: string; page: PageContext; assistant?: AssistantContext; }
interface SessionInstance extends GuideKitInstance { startSession(mode?: 'guide' | 'explain'): void; setMode(mode: 'guide' | 'explain'): void; stopSession(): void; }
interface SpeechProbe { started: number; stopped: number; aborted: number; autoStart: boolean; autoFinalize: boolean; denied: boolean; finalText: string; result(text: string): void; end(): void; late(text: string): void; }
interface ExplainProbe { instance: SessionInstance; collects: number; revision: number; speech: SpeechProbe; timings: { responseTextToGeometryMs: number[]; localFocusToSelectionMs: number[] }; measureFocus: boolean; wheelPrevented: boolean[]; }
type ProbeWindow = Window & { __guidekitExplainProbe: ExplainProbe };
interface Camera { position: number[]; target: number[]; }

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /content security policy|unsafe-eval|uncaught/i.test(message.text())) errors.push(message.text()); });
    await use(errors); expect(errors, 'No browser exceptions or CSP violations').toEqual([]);
  }, { auto: true }],
});

async function installProbe(page: Page, fallback = false) {
  await page.addInitScript(({ fallback }) => {
    type ResultEvent = { resultIndex: number; results: { length: number; [key: number]: { isFinal: boolean; [key: number]: { transcript: string } } } };
    const result = (text: string): ResultEvent => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
    let current: Recognition | null = null, lateStart: (() => void) | null = null, lateEnd: (() => void) | null = null, lateResult: ((event: ResultEvent) => void) | null = null;
    const speech: SpeechProbe = { started: 0, stopped: 0, aborted: 0, autoStart: true, autoFinalize: true, denied: false, finalText: 'Show a rocket in 3D', result: text => current?.onresult?.(result(text)), end: () => current?.onend?.(), late: text => { lateStart?.(); lateResult?.(result(text)); lateEnd?.(); } };
    // The public instance is assigned by the intercepted mount below.
    const probe = { collects: 0, revision: 0, speech, timings: { responseTextToGeometryMs: [], localFocusToSelectionMs: [] }, measureFocus: false, wheelPrevented: [] } as unknown as ExplainProbe;
    (window as unknown as ProbeWindow).__guidekitExplainProbe = probe;
    let presentation: { at: number; runId: string } | null = null, focusAt: number | null = null;
    const text = Response.prototype.text;
    Response.prototype.text = async function () {
      const value = await Reflect.apply(text, this, []);
      if (this.url.endsWith('/api/embed/session/ask') && this.ok) {
        const at = performance.now();
        try {
          const parsed = JSON.parse(value) as RunResult;
          if (parsed.visual?.kind === 'scene3d' && typeof parsed.runId === 'string') presentation = { at, runId: parsed.runId };
        } catch { /* Preserve the SDK's own malformed-response handling. */ }
      }
      return value;
    };
    document.addEventListener('click', event => {
      if (probe.measureFocus && event.composedPath().some(node => node instanceof HTMLButtonElement && node.getAttribute('aria-label') === 'Send question')) { focusAt = performance.now(); probe.measureFocus = false; }
    }, true);
    document.addEventListener('wheel', event => queueMicrotask(() => probe.wheelPrevented.push(event.defaultPrevented)), { passive: true });
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onresult: ((event: ResultEvent) => void) | null = null; onerror: ((event: { error: string }) => void) | null = null;
      start() { current = this; speech.started++; lateStart = this.onstart; lateEnd = this.onend; lateResult = this.onresult; queueMicrotask(() => { if (speech.denied) this.onerror?.({ error: 'not-allowed' }); else if (speech.autoStart) this.onstart?.(); }); }
      stop() { speech.stopped++; if (speech.autoFinalize) queueMicrotask(() => { this.onresult?.(result(speech.finalText)); this.onend?.(); }); }
      abort() { speech.aborted++; }
    }
    class Utterance { lang = ''; rate = 1; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(readonly text: string) {} }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (utterance: Utterance) => queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); }), cancel() {} } });
    if (fallback) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) { return /^webgl/.test(type) ? null : Reflect.apply(getContext, this, [type, options]); } as typeof getContext;
    }
    document.addEventListener('guidekit:ready', event => {
      const api = (event as CustomEvent).detail.api as Window['GuideKit'], mount = api.mount;
      api.mount = options => {
        const instance = mount({ ...options, journey: { enabled: false }, getContext: () => { probe.collects++; return { publicRevision: probe.revision }; } });
        probe.instance = instance as SessionInstance;
        const shadow = document.querySelector('[data-guidekit-root]')?.shadowRoot;
        if (shadow) {
          const timing = new MutationObserver(() => {
            const model = shadow.querySelector<HTMLElement>('[data-gk-viewer]');
            if (presentation && model?.dataset.gkSceneRun === presentation.runId && Number(model.dataset.gkRenderedFrames) > 0) { probe.timings.responseTextToGeometryMs.push(performance.now() - presentation.at); presentation = null; }
            if (focusAt !== null && model?.querySelector('[data-gk-object-id="body"][aria-pressed="true"]')) { probe.timings.localFocusToSelectionMs.push(performance.now() - focusAt); focusAt = null; }
          });
          timing.observe(shadow, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-gk-scene-run', 'data-gk-rendered-frames', 'aria-pressed'] });
          window.addEventListener('pagehide', () => timing.disconnect(), { once: true });
        }
        return instance;
      };
    }, { once: true });
  }, { fallback });
}

async function openFixture(page: Page, fallback = false) {
  await installProbe(page, fallback);
  const asks: Ask[] = [], chunks: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push(request.postDataJSON() as Ask); if (viewerChunk.test(request.url())) chunks.push(request.url()); });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`${endpoint}${path}`, { headers: { Origin: endpoint }, data });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(201); return response.json();
  };
  await post('/api/auth/register', { email: `explain-${crypto.randomUUID()}@example.test`, name: 'Explanation Tester', companyName: 'Explanation Workspace', password: 'Synthetic-explanation-password-42' });
  const { agent } = await post('/api/agents', { name: 'Explanation guide', companyName: 'Explanation Workspace', allowedOrigins: [website], allowedActions: ['create_contact'] }) as { agent: { id: string } };
  await post(`/api/agents/${agent.id}/documents`, { title: 'CRM guide', content: 'Create a contact by entering a name, company, choosing status and submitting Create contact.' });
  await post(`/api/agents/${agent.id}/publish`, {});
  await page.goto(`${website}/?agentId=${encodeURIComponent(agent.id)}`);
  await page.getByRole('button', { name: 'Open Explanation guide', exact: true }).click();
  await expect(chat(page)).toBeVisible();
  return { asks, chunks, agentId: agent.id };
}

async function explain(page: Page) {
  await chat(page).getByRole('group', { name: 'Assistant mode', exact: true }).getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-gk-assistant-mode', 'explain');
  await expect(root(page)).toHaveAttribute('data-gk-session-active', 'true');
}
async function composer(page: Page) {
  if (!await chat(page).isVisible()) await viewer(page).getByRole('button', { name: 'Hide 3D explanation', exact: true }).click();
  await expect(chat(page)).toBeVisible();
  return chat(page).getByRole('textbox', { name: 'Your question', exact: true });
}
async function ask(page: Page, message: string) {
  await (await composer(page)).fill(message);
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await chat(page).getByRole('button', { name: 'Send question', exact: true }).click();
  const answered = await response; expect(answered.status()).toBe(200); return answered.json() as Promise<RunResult>;
}
async function shown(page: Page) {
  await expect(viewer(page)).toBeVisible(); await expect(viewer(page)).toHaveAttribute('data-gk-scene-id', 'rocket');
  await expect(viewer(page)).toHaveAttribute('data-gk-renderer', /^(webgl|svg)$/);
  await expect.poll(async () => Number(await viewer(page).getAttribute('data-gk-rendered-frames'))).toBeGreaterThan(0);
}
async function camera(page: Page): Promise<Camera> { return JSON.parse((await viewer(page).getAttribute('data-gk-camera'))!); }
function cameraDifference(a: Camera, b: Camera) { return Math.max(...a.position.map((value, index) => Math.abs(value - b.position[index]!)), ...a.target.map((value, index) => Math.abs(value - b.target[index]!))); }
async function timingEvidence(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.json`);
  const evidence = { renderer: await viewer(page).getAttribute('data-gk-renderer'), samples: await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.timings), methodology: {
    responseTextToGeometryMs: 'Completed response.text, immediately before SDK JSON parsing and validation, to a committed matching scene-run and rendered-frame DOM update. Includes parsing, validation, rendering and mutation-observer delivery; no model or network time.',
    localFocusToSelectionMs: 'Trusted Send click capture to the requested existing object selection DOM update. No model request or camera-paint latency is included.',
  } };
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
async function stop(page: Page) {
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await expect(root(page)).toHaveAttribute('data-gk-session-active', 'false'); await expect(root(page)).toHaveAttribute('data-gk-observing', 'false');
}
async function holdResponse(page: Page) {
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { ready = resolve; });
  const handler = async (route: Route) => { const response = await route.fetch(); ready(); await gate; await route.fulfill({ response }).catch(() => {}); };
  await page.route('**/api/embed/session/ask', handler);
  return { ready: arrived, release, dispose: async () => { release(); await page.unroute('**/api/embed/session/ask', handler); } };
}

test('Explain preloads its pure verified module without a microphone, inference or geometry, then renders a generated scene', async ({ page }, testInfo) => {
  const state = await openFixture(page); expect(state.chunks).toHaveLength(0); await explain(page);
  expect(state.asks).toHaveLength(0); await expect(viewer(page)).toHaveCount(0);
  await expect.poll(() => state.chunks.length).toBe(1);
  await expect(page.locator('script[type="module"][src*="viewer3d"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.started)).toBe(0);
  await expect(root(page)).toHaveAttribute('data-gk-observing', 'true');
  await ask(page, 'Explain how a rocket works in words'); await expect(viewer(page)).toHaveCount(0); expect(state.chunks).toHaveLength(1);
  const run = await ask(page, 'Show that rocket in 3D'); await shown(page);
  expect(run.visual?.objects.map(object => object.id)).toEqual(['body', 'payload', 'engine']);
  await expect(viewer(page).getByRole('button', { name: 'Select Fuel tanks', exact: true })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: 'Select Payload fairing', exact: true })).toBeVisible();
  await expect(viewer(page).getByRole('button', { name: 'Select Rocket engine', exact: true })).toBeVisible();
  expect(state.chunks, 'Preloading and rendering reuse one verified module fetch').toHaveLength(1);
  expect(state.asks.every(request => request.assistant?.mode === 'explain' && request.assistant.capabilities.scene3d === 1)).toBe(true);
  await testInfo.attach('generated-rocket-viewer', { body: await viewer(page).screenshot(), contentType: 'image/png' });
  await timingEvidence(page, testInfo, 'loaded-module-presentation-timing');
});

for (const format of ['esm', 'iife'] as const) test(`an npm consumer rebundled as ${format} loads its verified renderer from the configured endpoint`, async ({ page }, testInfo) => {
  const state = await openFixture(page);
  const assetRoot = process.env.GUIDEKIT_TEST_ASSET_ROOT ?? process.cwd();
  const packagedModule = resolve(assetRoot, 'dist/sdk-package/dist/guidekit.mjs');
  const output = await build({
    stdin: { contents: `import { GuideKit } from ${JSON.stringify(packagedModule)}; const instance = GuideKit.mount({ agentId: ${JSON.stringify(state.agentId)}, endpoint: ${JSON.stringify(endpoint)}, journey: { enabled: false } }); instance.ready.then(() => instance.open());`, resolveDir: assetRoot, sourcefile: 'package-consumer.js' },
    bundle: true, write: false, format, platform: 'browser', target: 'es2022',
  });
  // Deliberately retain the SDK-looking basename: build metadata, rather than
  // guessing from a filename, must survive a customer's second bundling pass.
  const hostChunk = `${website}/assets/guidekit.${format === 'esm' ? 'mjs' : 'js'}`;
  await page.route(hostChunk, route => route.fulfill({ contentType: 'text/javascript', body: output.outputFiles[0]!.text }));
  // Keep an actual loopback HTTP document so Chromium's local-network address
  // space policy is exercised normally; only the consumer chunk is routed.
  await page.goto(`${website}/?install=manual`);
  await page.addScriptTag({ ...(format === 'esm' ? { type: 'module' } : {}), url: hostChunk });
  await expect(chat(page)).toBeVisible(); await explain(page);
  const run = await ask(page, 'Show a rocket in 3D');
  await testInfo.attach('packaged-renderer-module-requests', { body: JSON.stringify(state.chunks, null, 2), contentType: 'application/json' });
  await shown(page);
  expect(run.visual?.objects.map(object => object.id)).toEqual(['body', 'payload', 'engine']);
  await expect(viewer(page)).toHaveAttribute('data-gk-mesh-count', /^[1-9]\d*$/);
  expect(state.chunks.length).toBeGreaterThan(0);
  expect(state.chunks.every(url => new URL(url).origin === endpoint), 'Bundling does not relocate the verified renderer into the host application assets').toBe(true);
});

test('a follow-up preserves the same interactive viewer, camera and selected object reference, while explicit focus changes it', async ({ page }, testInfo) => {
  const state = await openFixture(page); await explain(page); const first = await ask(page, 'Show a rocket in 3D'); await shown(page);
  const original = await viewer(page).elementHandle(); if (!original) throw new Error('Expected an actual rendered viewer.');
  const before = await camera(page); await stage(page).focus(); await stage(page).press('ArrowRight');
  await expect.poll(async () => cameraDifference(await camera(page), before)).toBeGreaterThan(.01);
  await viewer(page).getByRole('button', { name: 'Zoom in', exact: true }).click();
  await viewer(page).getByRole('button', { name: 'Select Payload fairing', exact: true }).click();
  await expect(viewer(page).getByRole('button', { name: 'Select Payload fairing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const orbited = await camera(page); await ask(page, 'Tell me more about this selected part'); await shown(page);
  expect(state.asks[1]!.assistant).toMatchObject({ mode: 'explain', capabilities: { scene3d: 1 }, sceneRunId: first.runId, selectedObjectId: 'payload' });
  expect(await viewer(page).evaluate((node, retained) => node === retained, original)).toBe(true);
  expect(cameraDifference(await camera(page), orbited)).toBeLessThan(.00001);
  await ask(page, 'Explain how the engine produces thrust and highlight it'); await shown(page);
  await expect.poll(async () => cameraDifference(await camera(page), orbited)).toBeGreaterThan(.01);
  const focused = await camera(page);
  await (await composer(page)).fill('Focus the Fuel tanks'); await page.evaluate(() => { (window as unknown as ProbeWindow).__guidekitExplainProbe.measureFocus = true; });
  await chat(page).getByRole('button', { name: 'Send question', exact: true }).click();
  await shown(page); await expect(viewer(page).getByRole('button', { name: 'Select Fuel tanks', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => cameraDifference(await camera(page), focused)).toBeGreaterThan(.01);
  expect(await viewer(page).evaluate((node, retained) => node === retained, original)).toBe(true);
  await original.dispose(); expect(state.asks, 'A unique existing-object focus uses the actual current scene without another inference').toHaveLength(3);
  await timingEvidence(page, testInfo, 'scene-update-and-local-focus-timing');
});

test('small screens retain keyboard orbit, zoom, reset and accessible object selection without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 }); await openFixture(page); await explain(page); await ask(page, 'Show a rocket in 3D'); await shown(page);
  const initial = await camera(page); await stage(page).focus(); await stage(page).press('ArrowUp');
  await expect.poll(async () => cameraDifference(await camera(page), initial)).toBeGreaterThan(.01);
  const rotated = await camera(page); await stage(page).press('+'); await expect.poll(async () => cameraDifference(await camera(page), rotated)).toBeGreaterThan(.01);
  await stage(page).press('Home'); await expect.poll(async () => cameraDifference(await camera(page), initial)).toBeLessThan(.001);
  await viewer(page).getByRole('button', { name: 'Select Rocket engine', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(viewer(page).getByRole('button', { name: 'Select Rocket engine', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await viewer(page).evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('without WebGL the same generated geometry has an orbitable SVG fallback', async ({ page }) => {
  await openFixture(page, true); await explain(page); await ask(page, 'Show a rocket in 3D'); await shown(page);
  await expect(viewer(page)).toHaveAttribute('data-gk-renderer', 'svg');
  const svg = viewer(page).locator('svg[data-gk-renderer]'); await expect(svg).toBeVisible();
  await expect.poll(() => svg.locator('path').count()).toBeGreaterThan(2);
  const before = await camera(page); await viewer(page).getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect.poll(async () => cameraDifference(await camera(page), before)).toBeGreaterThan(.01);
  const paths = await svg.locator('path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
  await viewer(page).getByRole('button', { name: 'Rotate up', exact: true }).click();
  await expect.poll(() => svg.locator('path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))).not.toEqual(paths);
  const detached = await viewer(page).elementHandle(), oldStage = await stage(page).elementHandle();
  if (!detached || !oldStage) throw new Error('Expected the rendered viewer and its actual stage.');
  await stop(page); await expect(viewer(page)).toHaveCount(0);
  expect(await detached.getAttribute('data-gk-frame-pending')).toBe('false');
  const count = await detached.getAttribute('data-gk-rendered-frames');
  // Dispatch only to the detached test-owned stage. A disposed viewer must no
  // longer own this listener or schedule work in response to old interactions.
  await oldStage.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await page.waitForTimeout(80); expect(await detached.getAttribute('data-gk-rendered-frames')).toBe(count);
  await detached.dispose(); await oldStage.dispose();
});

test('a malicious scene is rejected while the last validated scene and its session reference survive', async ({ page }) => {
  const state = await openFixture(page); await explain(page); const first = await ask(page, 'Show a rocket in 3D'); await shown(page);
  const original = await viewer(page).elementHandle(); if (!original) throw new Error('Expected the last valid viewer.');
  await page.route('**/api/embed/session/ask', async route => {
    const response = await route.fetch(), run = await response.json() as RunResult;
    await route.fulfill({ response, json: { ...run, visual: { ...run.visual, assetUrl: 'https://untrusted.invalid/execute.js' } } });
  }, { times: 1 });
  await ask(page, 'Add more detail to the rocket');
  await expect(chat(page).getByRole('log')).toContainText(/invalid|could not|did not|response/i);
  await expect(viewer(page)).toHaveAttribute('data-gk-scene-id', 'rocket');
  expect(await viewer(page).evaluate((node, retained) => node === retained, original)).toBe(true);
  await ask(page, 'Explain the selected part again'); await shown(page);
  expect(state.asks[2]!.assistant?.sceneRunId).toBe(first.runId); await original.dispose();
});

for (const terminal of ['stop', 'destroy'] as const) test(`${terminal} rejects a delayed explanation response and stops public observation`, async ({ page }) => {
  const state = await openFixture(page); await explain(page); const held = await holdResponse(page);
  try {
    await (await composer(page)).fill('Show a rocket in 3D'); await chat(page).getByRole('button', { name: 'Send question', exact: true }).click(); await held.ready;
    await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'thinking');
    if (terminal === 'stop') await stop(page); else await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.instance.destroy());
    held.release(); await page.waitForTimeout(300); await expect(viewer(page)).toHaveCount(0);
    const collects = await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects);
    await page.locator('[data-guidekit-id="contact-name"]').evaluate(node => node.setAttribute('aria-label', 'Changed after stop'));
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects)).toBe(collects); expect(state.asks).toHaveLength(1);
    if (terminal === 'destroy') await expect(root(page)).toHaveCount(0);
  } finally { await held.dispose(); }
});

test('a viewer chunk completing after Stop cannot mount a scene or restart a frame loop', async ({ page }) => {
  const state = await openFixture(page);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(viewerChunk, async route => { const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response }).catch(() => {}); });
  try {
    await explain(page); await ready;
    await (await composer(page)).fill('Show a rocket in 3D');
    const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
    await chat(page).getByRole('button', { name: 'Send question', exact: true }).click(); expect((await response).status()).toBe(200);
    await stop(page); release(); await page.waitForTimeout(400); await expect(viewer(page)).toHaveCount(0);
    expect(state.asks).toHaveLength(1); await expect(root(page)).toHaveAttribute('data-gk-session-active', 'false');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('holding Control sends one final transcript only on release and uses fresh public context through listening and thinking', async ({ page }) => {
  const state = await openFixture(page); await explain(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects)).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects);
  await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
  await page.locator('input[name="email"]').fill('private-active-session-marker@example.invalid');
  await page.locator('[data-guidekit-id="contact-name"]').evaluate(node => node.setAttribute('aria-label', 'Public name changed while listening'));
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects)).toBeGreaterThan(before);
  await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.result('Show a rocket in 3D'));
  expect(state.asks).toHaveLength(0);
  const held = await holdResponse(page);
  try {
    await page.keyboard.up('Control'); await held.ready; await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'thinking');
    expect(state.asks).toHaveLength(1); expect(state.asks[0]!.message).toBe('Show a rocket in 3D');
    expect(state.asks[0]!.page.targets.find(target => target.id === 'contact-name')?.label).toBe('Public name changed while listening');
    const thinking = await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects);
    await page.locator('[data-guidekit-id="contact-company"]').evaluate(node => node.setAttribute('aria-label', 'Public company changed while thinking'));
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.collects)).toBeGreaterThan(thinking);
    held.release(); await shown(page); await ask(page, 'Tell me more about the rocket'); await shown(page);
    expect(state.asks).toHaveLength(2); expect(state.asks[1]!.page.targets.find(target => target.id === 'contact-company')?.label).toBe('Public company changed while thinking');
    expect(JSON.stringify(state.asks)).not.toContain('private-active-session-marker');
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.stopped)).toBe(1);
  } finally { await page.keyboard.up('Control'); await held.dispose(); }
});

test('Control shortcuts and an IME composition never arm a voice request', async ({ page, context }) => {
  const state = await openFixture(page); await explain(page);
  await page.keyboard.press('Control'); await page.waitForTimeout(180);
  await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control'); await page.waitForTimeout(180);
  await (await composer(page)).focus(); const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: '山田', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.down('Control'); await page.waitForTimeout(180); await page.keyboard.up('Control');
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.started)).toBe(0); expect(state.asks).toHaveLength(0);
  } finally { await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }); await cdp.detach(); await page.keyboard.up('Control'); }
});

test('permission-pending release, denial, blur and an early recognition end discard late speech instead of submitting', async ({ page }) => {
  const state = await openFixture(page); await explain(page);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.autoStart = false; });
  await page.keyboard.down('Control'); await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.started)).toBe(1); await page.keyboard.up('Control');
  await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.late('Do not submit a late permission result'));
  await page.evaluate(() => { const speech = (window as unknown as ProbeWindow).__guidekitExplainProbe.speech; speech.autoStart = true; speech.denied = true; });
  await page.keyboard.down('Control'); await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.started)).toBe(2); await page.keyboard.up('Control');
  await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.late('Do not submit after denial'));
  await page.evaluate(() => { (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.denied = false; });
  await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('Control');
  await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.late('Do not submit after simulated blur'));
  await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
  await page.evaluate(() => { const speech = (window as unknown as ProbeWindow).__guidekitExplainProbe.speech; speech.result('Do not submit before release'); speech.end(); });
  await page.keyboard.up('Control'); await page.waitForTimeout(200);
  expect(state.asks).toHaveLength(0); await expect(viewer(page)).toHaveCount(0);
});

test('Control-click, Escape and simulated page hiding cancel a held recording without late submission', async ({ page }) => {
  const state = await openFixture(page); await explain(page);
  for (const interruption of ['control-click', 'Escape', 'hidden'] as const) {
    await page.evaluate(() => { const instance = (window as unknown as ProbeWindow).__guidekitExplainProbe.instance; instance.startSession('explain'); instance.open(); });
    await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
    if (interruption === 'control-click') { await page.locator('#contact-search').click(); await page.keyboard.press('Escape'); }
    else if (interruption === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.keyboard.up('Control');
    if (interruption === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.late('Do not send this interrupted transcript'));
    await page.waitForTimeout(180); expect(state.asks, interruption).toHaveLength(0);
  }
  await expect(viewer(page)).toHaveCount(0);
});

test('Control-wheel preserves native wheel behavior and discards a hold, while a released transcript can still finalize', async ({ page }) => {
  const state = await openFixture(page); await explain(page); await page.mouse.move(140, 200);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.wheelPrevented.length)).toBe(1);
  await page.keyboard.up('Control'); await page.waitForTimeout(180);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.started)).toBe(0); expect(state.asks).toHaveLength(0);
  await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.aborted)).toBeGreaterThan(0);
  await page.keyboard.up('Control'); expect(state.asks).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__guidekitExplainProbe.speech.autoFinalize = false; });
  await page.keyboard.down('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'listening');
  await page.keyboard.up('Control'); await expect(root(page)).toHaveAttribute('data-gk-session-phase', 'finalizing');
  await page.mouse.wheel(0, 120);
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.evaluate(() => { const speech = (window as unknown as ProbeWindow).__guidekitExplainProbe.speech; speech.result('Show a rocket in 3D'); speech.end(); });
  expect((await response).status()).toBe(200); await shown(page); expect(state.asks).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__guidekitExplainProbe.wheelPrevented)).toEqual([false, false, false]);
});
