import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { JourneyRequest, PageContext, RunResult } from '../../packages/contracts/src/index';
import type { GuideKitInstance } from '../../packages/sdk/src/types';
import type { ContextCollector } from '../../packages/sdk/src/context';

// Explicit synthetic HTTP planner, real Chromium and the real built SDK. No
// inference account, personal pages or media, database, microphone or actions.
const endpoint = 'http://127.0.0.1:5210', website = 'http://127.0.0.1:5211';
const catalog = [{ id: 'name', label: 'Public name field', role: 'textbox' }, { id: 'save', label: 'Save item', role: 'button' }];
const requests: Array<{ page: PageContext; journey: JourneyRequest }> = [], servers: Server[] = [];
let assets = '';
interface LatencyFixture { assistant: GuideKitInstance; reads: number; clickAt: number; nextAt: number; releaseSave(): void; stopChurn(): void; }
declare global { interface Window { guideKitLatency: LatencyFixture; LatencyContextCollector: typeof ContextCollector; } }
const host = `
const surface = document.querySelector('main'), options = new URL(location.href).searchParams;
const catalog = ${JSON.stringify(catalog)};
const fixture = window.guideKitLatency = { reads: 0, clickAt: 0, nextAt: 0, releaseSave() {}, stopChurn() {} };
surface.innerHTML = '<h1>Public workflow fixture</h1><button data-guidekit-id="open">Open form</button><section id="details"></section>';
document.querySelector('[data-guidekit-id="open"]').addEventListener('click', () => {
 fixture.clickAt = performance.now();
 document.querySelector('#details').innerHTML = '<form id="save-form"><label>Public name field<input data-guidekit-id="name" required></label><button data-guidekit-id="save" type="submit">Save item</button></form>';
 document.querySelector('#save-form').addEventListener('submit', event => {
  event.preventDefault();
  fixture.assistant.reportStepResult('save', { status: 'pending', message: 'Verifying saved output…' });
  fixture.releaseSave = () => fixture.assistant.reportStepResult('save', { success: true, ...(options.has('legacy') ? {} : { scope: 'goal' }), message: 'Saved output verified.' });
 });
});
const script = document.createElement('script'); script.src = '${endpoint}/sdk.js';
script.onload = async () => {
 fixture.assistant = window.GuideKit.mount({ agentId: 'latency_fixture', endpoint: '${endpoint}', targetMode: 'explicit', ...(options.has('noCatalog') ? {} : { guideTargets: catalog }), voice: { provider: 'disabled' }, getContext: async () => { fixture.reads++; if (options.has('churn')) await new Promise(resolve => setTimeout(resolve, 50)); return { publicWorkflow: 'create-item' }; } });
 fixture.assistant.setContext({}, { revision: 0 }); await fixture.assistant.ready;
 const root = document.querySelector('[data-guidekit-root]').shadowRoot;
 new MutationObserver(() => { const guide = root.querySelector('[aria-label="Visual guidance"]'); if (fixture.clickAt && !fixture.nextAt && guide && guide.textContent.includes('Enter the public name.')) fixture.nextAt = performance.now(); }).observe(root, { subtree: true, childList: true, characterData: true });
 if (options.has('churn')) { const timer = setInterval(() => fixture.assistant.setContext({}, { revision: 0 }), 16); fixture.stopChurn = () => clearInterval(timer); }
}; document.body.append(script);
`;

test.beforeAll(async () => {
  assets = await mkdtemp(resolve(tmpdir(), 'guidekit-latency-'));
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: resolve(assets, 'sdk.js'), bundle: true, format: 'iife', target: 'es2022' });
  const probe = await build({ stdin: { contents: "import { ContextCollector } from './packages/sdk/src/context'; window.LatencyContextCollector = ContextCollector;", resolveDir: process.cwd() }, bundle: true, format: 'iife', target: 'es2022', write: false });
  const service = express(); service.use(express.json());
  service.use((_req, res, next) => { res.set({ 'Access-Control-Allow-Origin': website, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }); next(); });
  service.options('/{*path}', (_req, res) => res.sendStatus(204));
  service.get('/sdk.js', (_req, res) => res.sendFile(resolve(assets, 'sdk.js')));
  service.get('/probe.js', (_req, res) => res.type('js').send(probe.outputFiles[0]!.text));
  service.post('/api/embed/latency_fixture/session', (_req, res) => res.json({ token: 'synthetic-latency-session', expiresAt: Date.now() + 3600_000, agent: { id: 'latency_fixture', version: 1, name: 'Latency guide', companyName: 'Fixture', greeting: 'How can I help?', accentColor: '#365cf5', allowedActions: [] } }));
  service.post('/api/embed/session/ask', async (req, res) => {
    const page = req.body.page as PageContext, journey = req.body.journey as JourneyRequest; requests.push({ page, journey });
    await new Promise(resolve => setTimeout(resolve, 180));
    const visible = new Set(page.targets.map(target => target.id));
    const ids = journey.goal.includes('Invalid first') ? ['name', 'save'] : page.guideTargets?.length ? ['open', 'name', 'save'] : visible.has('name') ? ['name', 'save'] : ['open'];
    const result: RunResult = { runId: `run_${requests.length}`, answer: 'Follow the public controls.', steps: ids.map(targetId => ({ targetId, text: targetId === 'name' ? 'Enter the public name.' : targetId === 'save' ? 'Save this item.' : 'Open the public form.' })), action: null, citations: [], provider: 'codex', version: 1, journey: { id: journey.id, revision: journey.revision, disposition: ids.includes('save') && !journey.goal.includes('then continue') ? 'done' : 'continue' } };
    res.json(result);
  });
  const demo = express(); demo.get('/host.js', (_req, res) => res.type('js').send(host));
  demo.use((_req, res) => res.type('html').send('<!doctype html><html lang="en"><head><title>Latency fixture</title></head><body style="padding:48px;font-family:system-ui"><main></main><script src="/host.js"></script></body></html>'));
  for (const [app, port] of [[service, 5210], [demo, 5211]] as const) await new Promise<void>((accept, reject) => { const server = app.listen(port, '127.0.0.1', () => accept()); server.on('error', reject); servers.push(server); });
});
test.afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }))); if (assets) await rm(assets, { recursive: true, force: true }); });
test.beforeEach(() => { requests.length = 0; });
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
async function start(page: Page, query = '', goal = 'Create and save an item') {
  await page.goto(`${website}/?${query}`); await expect.poll(() => page.evaluate(() => Boolean(window.guideKitLatency.assistant))).toBe(true);
  await page.evaluate(async goal => { await window.guideKitLatency.assistant.ready; await window.guideKitLatency.assistant.ask(goal); }, goal); await expect(guide(page)).toBeVisible();
}

test('catalog batches future controls into one request and advances locally without compromising host confirmation', async ({ page }, testInfo) => {
  const timings: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    await start(page); const before = requests.length;
    await page.locator('[data-guidekit-id="open"]').click(); await expect(guide(page)).toContainText('Enter the public name.');
    timings.push(await page.evaluate(() => window.guideKitLatency.nextAt - window.guideKitLatency.clickAt));
    await page.locator('[data-guidekit-id="name"]').fill('private-value-marker'); await page.locator('[data-guidekit-id="name"]').press('Tab');
    await expect(guide(page)).toContainText('Save this item.'); await page.locator('[data-guidekit-id="save"]').click();
    await expect(guide(page)).toContainText('Verifying saved output'); await page.waitForTimeout(350); expect(requests).toHaveLength(before);
    await page.evaluate(() => window.guideKitLatency.releaseSave()); await expect(guide(page)).toHaveCount(0);
  }
  expect(timings.every(value => value >= 0 && value < 500)).toBe(true); expect(requests).toHaveLength(5);
  expect(requests.every(request => request.page.targets.every(target => target.id === 'open') && request.page.guideTargets?.length === 2)).toBe(true);
  expect(JSON.stringify(requests)).not.toContain('private-value-marker');
  const sorted = [...timings].sort((a, b) => a - b); await testInfo.attach('local-guidance-latency.json', { contentType: 'application/json', body: JSON.stringify({ samples: timings, medianMs: sorted[2], maximumMs: sorted.at(-1), modelCallsPerWorkflow: 1, plannerFixtureDelayMs: 180 }) });
  console.log('Local guidance latency:', JSON.stringify({ samples: timings, medianMs: sorted[2], maximumMs: sorted.at(-1), modelCallsPerWorkflow: 1 }));
});

test('identical revision-aware host renders do not starve asynchronous scene collection or continuation', async ({ page }, testInfo) => {
  await start(page, 'noCatalog=1&churn=1'); await page.locator('[data-guidekit-id="open"]').click();
  await expect(guide(page)).toContainText('Enter the public name.');
  const result = await page.evaluate(() => ({ elapsedMs: window.guideKitLatency.nextAt - window.guideKitLatency.clickAt, contextReads: window.guideKitLatency.reads }));
  await page.evaluate(() => window.guideKitLatency.stopChurn());
  expect(requests).toHaveLength(2); expect(result.elapsedMs).toBeLessThan(1500); expect(result.contextReads).toBeLessThan(12);
  await testInfo.attach('render-churn-latency.json', { contentType: 'application/json', body: JSON.stringify(result) });
  console.log('Render-churn continuation:', JSON.stringify(result));
});

test('catalog resolution refuses private, duplicate, mismatched and changed-route controls', async ({ page }) => {
  await start(page);
  const failures = await page.evaluate(async () => {
    const fixture = window.guideKitLatency, errors: string[] = [];
    for (const [name, options] of Object.entries({ automatic: { guideTargets: [{ id: 'later', label: 'Later', role: 'button' }] }, duplicate: { targetMode: 'explicit' as const, guideTargets: [{ id: 'later', label: 'Later', role: 'button' }, { id: 'later', label: 'Later', role: 'button' }] } })) {
      try { window.GuideKit.mount({ agentId: 'latency_fixture', endpoint: 'http://127.0.0.1:5210', ...options }); } catch { errors.push(name); }
    }
    return { errors, oldStillWorks: Boolean(await fixture.assistant.getPageContext()) };
  });
  expect(failures).toEqual({ errors: ['automatic', 'duplicate'], oldStillWorks: true });
  await page.evaluate(() => window.guideKitLatency.assistant.close()); await page.addScriptTag({ url: `${endpoint}/probe.js` });
  const grounding = await page.evaluate(() => {
    const collector = new window.LatencyContextCollector('explicit', [{ id: 'later', label: 'Later control', role: 'button' }]);
    collector.collect(new Map(), [], {}); const missing = collector.resolve('later') === null;
    const control = document.createElement('button'); control.dataset.guidekitId = 'later'; control.textContent = 'Later control'; document.querySelector('main')!.append(control);
    const appeared = collector.resolve('later') === control;
    control.dataset.guidekitPrivate = ''; const privateRefused = collector.resolve('later') === null; delete control.dataset.guidekitPrivate;
    const duplicate = control.cloneNode(true) as HTMLButtonElement; control.after(duplicate); const duplicateRefused = collector.resolve('later') === null; duplicate.remove();
    control.textContent = 'Different meaning'; const labelRefused = collector.resolve('later') === null; control.textContent = 'Later control';
    control.setAttribute('role', 'menuitem'); const roleRefused = collector.resolve('later') === null; control.removeAttribute('role');
    history.pushState({}, '', '/another-route'); const routeRefused = collector.resolve('later') === null;
    return { missing, appeared, privateRefused, duplicateRefused, labelRefused, roleRefused, routeRefused };
  });
  expect(grounding).toEqual({ missing: true, appeared: true, privateRefused: true, duplicateRefused: true, labelRefused: true, roleRefused: true, routeRefused: true });
});

test('a future native submit keeps its terminal boundary through paused legacy host verification', async ({ page }) => {
  await start(page, 'legacy=1', 'Create and save an item, then continue');
  await page.locator('[data-guidekit-id="open"]').click(); await expect(guide(page)).toContainText('Enter the public name.');
  await page.locator('[data-guidekit-id="name"]').fill('private-legacy-marker'); await page.locator('[data-guidekit-id="name"]').press('Tab');
  await expect(guide(page)).toContainText('Save this item.'); await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.locator('#save-form').evaluate(form => (form as HTMLFormElement).requestSubmit()); await page.evaluate(() => window.guideKitLatency.releaseSave());
  await page.waitForTimeout(350); expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click(); await expect(guide(page)).toHaveCount(0);
  await page.waitForTimeout(500); expect(requests).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Website assistant' })).toBeVisible();
  expect(JSON.stringify(requests)).not.toContain('private-legacy-marker');
});

test('a catalog cannot start guidance at a control that has not appeared', async ({ page }) => {
  await start(page); await page.evaluate(() => window.guideKitLatency.assistant.close());
  const result = await page.evaluate(() => window.guideKitLatency.assistant.ask('Invalid first target'));
  expect(result).toBeNull(); await expect(guide(page)).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('is not ready');
});
