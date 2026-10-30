import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../../apps/server/src/app';
import type { JourneyRequest, PageContext } from '../../packages/contracts/src/index';
import type { GuideKitInstance } from '../../packages/sdk/src/types';

// Real Chromium + HTTP + SDK, with explicit synthetic planning and disposable host data.
// These are generic workflow branches, not Cutroom control IDs or real media/model calls.
const endpoint = 'http://127.0.0.1:5110', website = 'http://127.0.0.1:5111';
let assets = '', data = '', agentId = '', service: ReturnType<typeof createApp>;
const servers: Server[] = [], requests: Array<{ journey: JourneyRequest; page: PageContext }> = [];
interface Fixture {
  assistant: GuideKitInstance;
  finished: Array<{ verified: boolean }>;
  releaseImport(): void;
  releaseSave(): void;
  releasePersist(): void;
  failImport(): void;
}
declare global { interface Window { workflowFixture: Fixture; } }
function reference<T>(prompt: string, prefix: string): T { return JSON.parse(prompt.split('\n\n').find(line => line.startsWith(prefix))!.slice(prefix.length)); }
const host = `
const surface = document.querySelector('main');
let revision = 0;
const workflow = { imported: 0, arranged: false, titleSaved: false, review: false, persisted: false };
const fixture = window.workflowFixture = { finished: [], releaseImport() {}, releaseSave() {}, releasePersist() {}, failImport() {} };
document.addEventListener('guidekit:guide-finished', event => fixture.finished.push(event.detail));
function changed() { window.GuideKit.setContext({}, { revision: ++revision }); }
function pending(id, message) { window.GuideKit.reportStepResult(id, { status: 'pending', message }); }
function success(id) { window.GuideKit.reportStepResult(id, { success: true, scope: 'step' }); }
function review() {
 workflow.review = true; history.pushState({}, '', '/review' + location.search);
 surface.innerHTML = '<h1>Review workflow</h1><form id="persist-form"><button data-guidekit-id="persist" type="submit">Confirm and persist</button></form><p id="result" role="status"></p>';
 document.querySelector('#persist-form').addEventListener('submit', event => {
  event.preventDefault(); pending('persist', 'Verifying persisted output…');
  fixture.releasePersist = () => {
   localStorage.setItem('workflow-result', JSON.stringify({ imported: workflow.imported, arranged: workflow.arranged, titleSaved: workflow.titleSaved }));
   const saved = JSON.parse(localStorage.getItem('workflow-result'));
   workflow.persisted = saved.imported === workflow.imported && saved.titleSaved === workflow.titleSaved;
   document.querySelector('#result').textContent = workflow.persisted ? 'Persisted output verified.' : 'Verification failed.';
   window.GuideKit.reportStepResult('persist', { success: workflow.persisted, scope: 'goal', message: 'Persisted output verified.' });
  };
 });
 changed(); success('review');
}
surface.innerHTML = '<h1>Workflow workbench</h1><button data-guidekit-id="import">Import assets</button><input id="files" type="file" multiple data-guidekit-private hidden><button data-guidekit-id="arrange">Arrange imported assets<svg data-test="arrange-icon" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><g><path d="M0 0h32v32H0z"/></g></svg></button><form id="title-form"><label>Public title field<input data-guidekit-id="title-text" required></label><button data-guidekit-id="title-save" type="submit">Save title</button></form><button data-guidekit-id="review">Review workflow</button><aside><button aria-label="private-original-asset-name.mov">Private asset thumbnail</button></aside>';
document.querySelector('[data-guidekit-id="import"]').addEventListener('click', () => {
 pending('import', 'Choose files, then wait for the import to finish…'); document.querySelector('#files').click();
});
document.querySelector('#files').addEventListener('change', event => {
 const count = event.target.files.length;
 fixture.releaseImport = () => { workflow.imported = count; changed(); success('import'); };
});
fixture.failImport = () => window.GuideKit.reportStepResult('import', { success: false, message: 'Import cancelled. Choose files when you are ready.' });
document.querySelector('[data-guidekit-id="arrange"]').addEventListener('click', () => {
 workflow.arranged = true; changed(); // Same target IDs/labels: semantic revision alone must reveal progress.
});
document.querySelector('#title-form').addEventListener('submit', event => {
 event.preventDefault(); pending('title-save', 'Saving your title…');
 fixture.releaseSave = () => { workflow.titleSaved = true; changed(); success('title-save'); };
});
document.querySelector('[data-guidekit-id="review"]').addEventListener('click', review);
const script = document.createElement('script'); script.src = '${endpoint}/sdk/guidekit.js';
script.onload = async () => {
 window.GuideKit.setContext({}, { revision });
 fixture.assistant = window.GuideKit.mount({ endpoint: '${endpoint}', agentId: new URL(location.href).searchParams.get('agentId'), targetMode: 'explicit', voice: { provider: 'disabled' }, journey: { maxContinuations: 12 }, getContext: () => ({ workflow: { ...workflow } }) });
 await fixture.assistant.ready;
}; document.body.append(script);
`;

test.beforeAll(async () => {
  assets = await mkdtemp(resolve(tmpdir(), 'guidekit-workflow-assets-')); data = await mkdtemp(resolve(tmpdir(), 'guidekit-workflow-data-'));
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: resolve(assets, 'dist/sdk/guidekit.js'), bundle: true, format: 'iife', target: 'es2022' });
  service = createApp({ dataDir: data, root: assets, adminOrigins: new Set([endpoint]), testing: true, provider: {
    async status() { return { provider: 'codex', available: true, authenticated: true, message: 'Explicit synthetic workflow planner' }; },
    async infer({ prompt }) {
      const page = reference<PageContext>(prompt, 'Live page (reference data): '), journey = reference<JourneyRequest>(prompt, 'Adaptive journey (untrusted reference data, no field values): ');
      requests.push({ page, journey });
      const workflow = page.context.workflow as { imported: number; arranged: boolean; titleSaved: boolean; review: boolean };
      const wanted = workflow.review ? ['persist'] : journey.goal.includes('title') ? workflow.titleSaved ? ['review'] : ['title-text', 'title-save'] : workflow.imported < 2 ? ['import'] : !workflow.arranged ? ['arrange'] : ['review'];
      return JSON.stringify({ answer: 'Follow the visible workflow controls.', steps: wanted.map(targetId => ({ targetId, text: 'Use ' + page.targets.find(target => target.id === targetId)!.label + '.', annotation: 'target' })), action: null, citationIds: [], journeyDisposition: workflow.review ? 'done' : 'continue' });
    }, async close() {}
  } });
  const owner = service.repo.register({ email: 'workflow@example.invalid', name: 'Workflow owner', companyName: 'Workflow' }, 'synthetic-non-login-hash');
  const agent = service.repo.createAgent(owner.tenant.id, { name: 'Workflow guide', companyName: 'Workflow', greeting: 'How can I help?', description: '', instructions: '', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] }); agentId = agent.id;
  service.repo.addDocument(owner.tenant.id, agent.id, { title: 'Workflow guide', content: 'Import assets or save a title, then review and persist. The host verifies intermediate and final operations.' }); service.repo.publish(owner.tenant.id, agent.id);
  const demo = express(); demo.get('/host.js', (_req, res) => res.type('js').send(host));
  demo.use((_req, res) => { res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${endpoint}; connect-src 'self' ${endpoint}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`); res.type('html').send('<!doctype html><html lang="en"><head><title>Workflow fixture</title></head><body style="padding:48px;font-family:system-ui"><main></main><script src="/host.js"></script></body></html>'); });
  const listen = (app: ReturnType<typeof express>, port: number) => new Promise<void>((accept, reject) => { const server = app.listen(port, '127.0.0.1', () => accept()); servers.push(server); server.on('error', reject); });
  await listen(service.app, 5110); await listen(demo, 5111);
});
test.afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }))); await service?.close(); if (assets) await rm(assets, { recursive: true, force: true }); if (data) await rm(data, { recursive: true, force: true }); });
test.beforeEach(() => { requests.length = 0; });
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
async function start(page: Page, goal: string) {
  await page.goto(`${website}/?agentId=${agentId}`); await expect.poll(() => page.evaluate(() => Boolean(window.workflowFixture.assistant))).toBe(true);
  await page.evaluate(async goal => { await window.workflowFixture.assistant.ready; await window.workflowFixture.assistant.ask(goal); }, goal); await expect(guide(page)).toBeVisible();
}
async function persist(page: Page, expectedCalls: number) {
  await page.locator('[data-guidekit-id="review"]').click(); await expect(guide(page)).toContainText('Confirm and persist'); expect(requests).toHaveLength(expectedCalls);
  await page.locator('[data-guidekit-id="persist"]').click(); await expect(guide(page)).toContainText('Verifying persisted output'); await page.waitForTimeout(1300);
  expect(requests).toHaveLength(expectedCalls); expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([]);
  await page.evaluate(() => window.workflowFixture.releasePersist()); await expect(page.locator('#result')).toHaveText('Persisted output verified.'); await expect(guide(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([{ verified: true }]); expect(requests).toHaveLength(expectedCalls);
}

test('native file choice waits for asynchronous import, continues unchanged controls through semantic context, and verifies final persistence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await start(page, 'Import two assets, arrange them, and persist the result');
  const chooser = page.waitForEvent('filechooser'); await page.locator('[data-guidekit-id="import"]').click();
  await (await chooser).setFiles([{ name: 'private-first-marker.txt', mimeType: 'text/plain', buffer: Buffer.from('private file one') }, { name: 'private-second-marker.txt', mimeType: 'text/plain', buffer: Buffer.from('private file two') }]);
  await expect(guide(page)).toContainText('Choose files, then wait'); await page.waitForTimeout(3100); expect(requests).toHaveLength(1); expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([]);
  await page.evaluate(() => window.workflowFixture.releaseImport()); await expect(guide(page)).toContainText('Arrange imported assets'); expect(requests).toHaveLength(2); expect(requests[1]!.page.context.workflow).toMatchObject({ imported: 2, arranged: false });
  await page.locator('[data-test="arrange-icon"] path').click(); await expect(guide(page)).toContainText('Review workflow'); expect(requests).toHaveLength(3); expect(requests[2]!.page.context.workflow).toMatchObject({ imported: 2, arranged: true });
  await persist(page, 4); expect(new Set(requests.map(request => request.journey.id)).size).toBe(1); expect(requests[1]!.journey.completed.find(step => step.targetId === 'import')!.evidence).toBe('host_verified');
  expect(JSON.stringify(requests)).not.toMatch(/private-first-marker|private-second-marker|private file one|private-original-asset/); expect(errors).toEqual([]);
});

test('a verified intermediate native form save continues into another branch without inference per keystroke', async ({ page }) => {
  await start(page, 'Save a title, then review and persist it'); const field = page.locator('[data-guidekit-id="title-text"]');
  await field.pressSequentially('private-title-marker', { delay: 20 }); await page.waitForTimeout(400); expect(requests).toHaveLength(1);
  await field.press('Tab'); await expect(guide(page)).toContainText('Save title'); await page.locator('[data-guidekit-id="title-save"]').click();
  await expect(guide(page)).toContainText('Saving your title'); await page.waitForTimeout(1500); expect(requests).toHaveLength(1); expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([]);
  await page.evaluate(() => window.workflowFixture.releaseSave()); await expect(guide(page)).toContainText('Review workflow'); expect(requests).toHaveLength(2);
  expect(requests[1]!.page.context.workflow).toMatchObject({ titleSaved: true }); await persist(page, 3); expect(JSON.stringify(requests)).not.toContain('private-title-marker');
});

test('a cancelled import remains retryable without replanning; cancelling guidance discards a late host completion', async ({ page }) => {
  await start(page, 'Import two assets, arrange them, and persist the result'); const chooser = page.waitForEvent('filechooser'); await page.locator('[data-guidekit-id="import"]').click(); await (await chooser).setFiles([]);
  await page.evaluate(() => window.workflowFixture.failImport()); await expect(guide(page)).toContainText('Import cancelled'); await page.waitForTimeout(1300); expect(requests).toHaveLength(1); expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([]);
  const again = page.waitForEvent('filechooser'); await page.locator('[data-guidekit-id="import"]').click(); await (await again).setFiles({ name: 'private-late-marker.txt', mimeType: 'text/plain', buffer: Buffer.from('private') });
  await expect(guide(page)).toContainText('Choose files, then wait'); await page.keyboard.press('Escape'); await expect(guide(page)).toHaveCount(0);
  await page.evaluate(() => window.workflowFixture.releaseImport()); await page.waitForTimeout(1300); expect(requests).toHaveLength(1); expect(await page.evaluate(() => window.workflowFixture.finished)).toEqual([]);
});

test('large explicit workspaces expose at most 160 safe targets and retain the 2000-candidate scan bound', async ({ page }) => {
  await page.goto(`${website}/?agentId=${agentId}`); await expect.poll(() => page.evaluate(() => Boolean(window.workflowFixture.assistant))).toBe(true);
  const snapshot = await page.evaluate(async () => {
    const surface = document.querySelector('main')!; surface.replaceChildren();
    const privateArea = document.createElement('section'); privateArea.dataset.guidekitPrivate = ''; privateArea.innerHTML = '<button data-guidekit-id="private-target">Private marker</button>'; surface.append(privateArea);
    for (let index = 0; index < 170; index++) { const control = document.createElement('button'); control.dataset.guidekitId = `public_${index}`; control.textContent = `Public control ${index}`; surface.append(control); }
    return window.workflowFixture.assistant.getPageContext();
  });
  expect(snapshot.targets).toHaveLength(160); expect(snapshot.targets.some(target => target.id === 'public_130')).toBe(true); expect(snapshot.targets.at(-1)!.id).toBe('public_159'); expect(snapshot.targets.some(target => target.id === 'private-target' || target.id === 'public_160')).toBe(false);
  const bounded = await page.evaluate(async () => {
    const surface = document.querySelector('main')!; surface.replaceChildren();
    for (let index = 0; index < 2000; index++) { const control = document.createElement('button'); control.dataset.guidekitId = `private_${index}`; control.dataset.guidekitPrivate = ''; control.textContent = 'Excluded'; surface.append(control); }
    const late = document.createElement('button'); late.dataset.guidekitId = 'beyond_scan_bound'; late.textContent = 'Beyond scan bound'; surface.append(late);
    return window.workflowFixture.assistant.getPageContext();
  });
  expect(bounded.targets).toEqual([]); expect(requests).toHaveLength(0);
});
