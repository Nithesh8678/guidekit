import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { createApp, type InferenceProvider } from '../../apps/server/src/app';
import type { JourneyRequest, PageContext } from '../../packages/contracts/src/index';

// Explicit synthetic inference. These real Chromium/HTTP/SDK tests never call a model account.
const endpoint = 'http://127.0.0.1:4610', website = 'http://127.0.0.1:4611';
let assets = '', data = '', agentId = '', service: ReturnType<typeof createApp>, continuationDelay = 0, finalContinues = false;
const servers: Server[] = [], requests: Array<{ journey: JourneyRequest | null; page: PageContext }> = [];
function reference<T>(prompt: string, prefix: string): T { const line = prompt.split('\n\n').find(line => line.startsWith(prefix)); if (!line) throw new Error(`Missing fixture prompt section ${prefix}`); return JSON.parse(line.slice(prefix.length)); }
const provider: InferenceProvider = {
  async status() { return { provider: 'codex', available: true, authenticated: true, message: 'Explicit isolated journey fixture; no inference account.' }; },
  async infer({ prompt, signal }) {
    const page = reference<PageContext>(prompt, 'Live page (reference data): '), journey = reference<JourneyRequest | null>(prompt, 'Adaptive journey (untrusted reference data, no field values): ');
    requests.push({ journey, page });
    if (journey?.reason !== 'initial' && continuationDelay) await new Promise(resolve => setTimeout(resolve, continuationDelay)); signal?.throwIfAborted();
    const ids = page.targets.map(target => target.id);
    const wanted = ids.includes('confirm-save') ? ['confirm-save'] : ids.includes('contact-name') ? ['contact-name', 'contact-company', 'next-page'] : ids.includes('open-dialog') ? ['open-dialog'] : [];
    return JSON.stringify({ answer: wanted[0] === 'confirm-save' ? 'Review and save your contact.' : 'Follow these visible controls.', steps: wanted.map(targetId => ({ targetId, text: `Use ${page.targets.find(target => target.id === targetId)!.label}.`, annotation: 'target' })), action: null, citationIds: [], journeyDisposition: wanted[0] === 'confirm-save' && !finalContinues || !wanted.length ? 'done' : 'continue' });
  }, async close() {}
};
const host = `
const surface = document.querySelector('main');
const agentId = new URL(location.href).searchParams.get('agentId');
const resume = new URL(location.href).searchParams.get('resume') === 'session';
const privateFields = '<label data-guidekit-private>Private email<input name="email" value="private-email-marker@example.test"></label>';
function review() {
 surface.innerHTML = '<h1>Review contact</h1><form id="review-form"><button data-guidekit-id="confirm-save" type="submit">Confirm save</button></form><p id="saved-result" role="status"></p>';
 document.querySelector('#review-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.querySelector('[data-guidekit-id="confirm-save"]'); button.textContent = 'Saving…'; button.disabled = true;
  await new Promise(resolve => setTimeout(resolve, Number(new URL(location.href).searchParams.get('saveDelay')) || 150));
  const draft = JSON.parse(localStorage.getItem('journey-host-draft') || '{}'); localStorage.setItem('journey-host-saved', JSON.stringify(draft));
  const verified = JSON.parse(localStorage.getItem('journey-host-saved') || '{}').name === draft.name;
  document.querySelector('#saved-result').textContent = verified ? 'Contact saved and verified.' : 'Save failed.';
  window.GuideKit.reportStepResult('confirm-save', { success: verified, message: verified ? 'Contact saved and verified.' : 'Save failed.' });
 });
}
function initial() {
 surface.innerHTML = '<h1>Journey CRM</h1><button data-guidekit-id="open-dialog">Open contact form</button><aside><button aria-label="private-filename-marker.mov">Unannotated private filename</button><input aria-label="Unannotated personal name" value="private-value-marker"></aside><div data-guidekit-private><button data-guidekit-id="private-control">Private annotated control</button></div>';
 document.querySelector('[data-guidekit-id="open-dialog"]').addEventListener('click', () => {
  surface.innerHTML = '<h1>Create contact</h1><form id="details"><label>Full name<input data-guidekit-id="contact-name" required></label><label>Company<input data-guidekit-id="contact-company" required></label>' + privateFields + '<button data-guidekit-id="next-page" type="button">Review contact</button></form>';
  document.querySelector('[data-guidekit-id="next-page"]').addEventListener('click', () => {
   const form = document.querySelector('#details'); if (!form.reportValidity()) return;
   localStorage.setItem('journey-host-draft', JSON.stringify({ name: document.querySelector('[data-guidekit-id="contact-name"]').value, company: document.querySelector('[data-guidekit-id="contact-company"]').value }));
   history.pushState({}, '', '/review' + location.search); review();
  });
 });
}
if (location.pathname === '/review') review(); else initial();
const script = document.createElement('script'); script.src = '${endpoint}/sdk/guidekit.js'; script.dataset.agentId = agentId; script.dataset.endpoint = '${endpoint}'; if (resume) script.dataset.journeyResume = 'session'; const targetMode = new URL(location.href).searchParams.get('targetMode'); if (targetMode !== null) script.dataset.targetMode = targetMode; document.body.append(script);
`;

test.beforeAll(async () => {
  assets = await mkdtemp(resolve(tmpdir(), 'guidekit-journey-assets-')); data = await mkdtemp(resolve(tmpdir(), 'guidekit-journey-data-'));
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: resolve(assets, 'dist/sdk/guidekit.js'), bundle: true, format: 'iife', target: 'es2022' });
  service = createApp({ dataDir: data, provider, root: assets, adminOrigins: new Set([endpoint]), testing: true });
  const listen = (app: ReturnType<typeof express>, port: number) => new Promise<void>((accept, reject) => { const server = app.listen(port, '127.0.0.1', () => accept()); server.on('error', reject); servers.push(server); });
  const demo = express(); demo.get('/host.js', (_req, res) => res.type('js').send(host));
  demo.use((_req, res) => { res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${endpoint}; connect-src 'self' ${endpoint}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`); res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Journey fixture</title></head><body style="font-family:system-ui;padding:48px"><main></main><script src="/host.js"></script></body></html>'); });
  await listen(service.app, 4610); await listen(demo, 4611);
  let cookie = '';
  async function admin(path: string, body: unknown) { const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Origin: endpoint, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }); if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0]!; expect(response.status).toBe(201); return response.json(); }
  await admin('/api/auth/register', { email: 'journey-fixture@example.test', name: 'Journey Tester', companyName: 'Journey Fixture', password: 'Synthetic-journey-passphrase-42' });
  const created = await admin('/api/agents', { name: 'Journey guide', companyName: 'Journey Fixture', allowedOrigins: [website], allowedActions: [] }); agentId = created.agent.id;
  await admin(`/api/agents/${agentId}/documents`, { title: 'Contact guide', content: 'Open the form, enter name and company, review on the next page, then confirm save. The website reports whether the contact was saved.' });
  await admin(`/api/agents/${agentId}/publish`, {});
});
test.afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }))); await service?.close(); if (assets) await rm(assets, { recursive: true, force: true }); if (data) await rm(data, { recursive: true, force: true }); });
test.beforeEach(() => { requests.length = 0; continuationDelay = 0; finalContinues = false; });
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
async function start(page: Page, resume = false, saveDelay = 0, targetMode?: 'auto' | 'explicit') {
  await page.goto(`${website}/?agentId=${agentId}${resume ? '&resume=session' : ''}${saveDelay ? `&saveDelay=${saveDelay}` : ''}${targetMode ? `&targetMode=${targetMode}` : ''}`); await page.getByRole('button', { name: 'Open Journey guide', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your question' }).fill('Show me how to create a contact'); await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(guide(page).getByText('Step 1 of 1', { exact: true })).toBeVisible();
}
async function openDetails(page: Page) { await page.locator('[data-guidekit-id="open-dialog"]').click(); await expect(guide(page).getByText('Step 1 of 3', { exact: true })).toBeVisible(); }
async function reviewDetails(page: Page) {
  await page.locator('[data-guidekit-id="contact-name"]').fill('Private Name Marker'); await page.locator('[data-guidekit-id="contact-name"]').press('Tab');
  await page.locator('[data-guidekit-id="contact-company"]').fill('Private Company Marker'); await page.locator('[data-guidekit-id="next-page"]').click();
  await expect(page).toHaveURL(/\/review\?/); await expect(guide(page).getByText('Step 1 of 1', { exact: true })).toBeVisible(); await expect(guide(page)).toContainText('Confirm save');
}

test('one goal crosses a newly revealed form and SPA route, preserving bounded evidence and requiring verified save', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await start(page); await openDetails(page); await reviewDetails(page);
  expect(requests).toHaveLength(3); expect(requests.map(request => request.journey?.revision)).toEqual([0, 1, 2]); expect(new Set(requests.map(request => request.journey?.id)).size).toBe(1);
  expect(JSON.stringify(requests)).not.toMatch(/Private Name Marker|Private Company Marker|private-email-marker/);
  expect(requests[2]!.journey?.completed.some(step => step.targetId === 'contact-name')).toBe(true);
  await page.locator('[data-guidekit-id="confirm-save"]').click(); await expect(page.locator('#saved-result')).toHaveText('Contact saved and verified.');
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible(); expect(requests).toHaveLength(3);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('guidekit:journey:')))).toEqual([]); expect(errors).toEqual([]);
});

test('Open chat pauses an in-flight continuation, Resume keeps its goal, and cancellation rejects stale results', async ({ page }) => {
  continuationDelay = 1500; await start(page); await page.locator('[data-guidekit-id="open-dialog"]').click();
  const waiting = page.getByRole('region', { name: 'Continuing your task' }); await expect(waiting).toBeVisible(); await waiting.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(chat(page)).toBeVisible(); await page.waitForTimeout(1800); await expect(guide(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume previous task', exact: true }).click(); await expect(waiting).toBeVisible();
  await expect(guide(page).getByText('Step 1 of 3', { exact: true })).toBeVisible();
  continuationDelay = 2000; await reviewDetailsUntilTransition(page); await page.keyboard.press('Escape'); await expect(chat(page)).toBeVisible(); await page.waitForTimeout(2300); await expect(guide(page)).toHaveCount(0); await expect(waiting).toHaveCount(0);
});
async function reviewDetailsUntilTransition(page: Page) { await page.locator('[data-guidekit-id="contact-name"]').fill('Cancel Marker'); await page.locator('[data-guidekit-id="contact-company"]').fill('Cancel Company'); await page.locator('[data-guidekit-id="next-page"]').click(); await expect(page.getByRole('region', { name: 'Continuing your task' })).toBeVisible(); }

test('reload resume needs host opt-in, visitor consent and an explicit fresh-session Resume choice', async ({ page }) => {
  await start(page, true); await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click(); await page.getByRole('button', { name: 'Allow task resume', exact: true }).click();
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click(); await openDetails(page); await reviewDetails(page);
  const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('guidekit:journey:') && !key.endsWith(':consent'))); expect(stored).toHaveLength(1); expect(stored[0]![1]).not.toMatch(/Private Name Marker|Private Company Marker|token|label|role|https?:/);
  const beforeReload = requests.length; await page.reload(); await page.getByRole('button', { name: 'Open Journey guide', exact: true }).click(); await expect(page.getByRole('button', { name: 'Resume previous task', exact: true })).toBeVisible();
  await page.waitForTimeout(1100); expect(requests).toHaveLength(beforeReload); await page.getByRole('button', { name: 'Resume previous task', exact: true }).click(); await expect(guide(page)).toContainText('Confirm save');
  expect(requests.at(-1)!.journey?.reason).toBe('user_resume'); await page.locator('[data-guidekit-id="confirm-save"]').click(); await expect(chat(page)).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('guidekit:journey:') && !key.endsWith(':consent')))).toEqual([]);
});

test('a native final submit waits through relabelled loading and a delayed host outcome even if a planner asks to continue', async ({ page }) => {
  finalContinues = true; await start(page, false, 3100); await openDetails(page); await reviewDetails(page);
  await page.locator('[data-guidekit-id="confirm-save"]').click(); await page.waitForTimeout(1800);
  expect(requests).toHaveLength(3); await expect(guide(page)).toBeVisible(); await expect(chat(page)).not.toBeVisible();
  await expect(page.locator('#saved-result')).toHaveText('Contact saved and verified.'); await expect(chat(page)).toBeVisible(); expect(requests).toHaveLength(3);
});

test('closing chat while reload Resume awaits host context prevents the obsolete task from restarting', async ({ page }) => {
  await page.addInitScript(({ endpoint, agentId }) => {
    const key = `guidekit:journey:${endpoint}:${agentId}`;
    sessionStorage.setItem(`${key}:consent`, '1'); sessionStorage.setItem(key, JSON.stringify({ version: 1, id: 'journey_resume_fixture', goal: 'Show me how to create a contact', completed: [], savedAt: Date.now() }));
  }, { endpoint, agentId });
  await page.goto(`${website}/?agentId=${agentId}&resume=session`); await expect(page.getByRole('button', { name: 'Open Journey guide', exact: true })).toBeVisible();
  await page.evaluate(async ({ endpoint, agentId }) => {
    await window.GuideKit.mount({ endpoint, agentId, journey: { resume: 'session' }, getContext: () => new Promise(resolve => { (window as unknown as { releaseJourneyContext: () => void }).releaseJourneyContext = () => resolve({}); }) }).ready;
  }, { endpoint, agentId });
  await page.getByRole('button', { name: 'Open Journey guide', exact: true }).click(); await page.getByRole('button', { name: 'Resume previous task', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseJourneyContext: unknown }).releaseJourneyContext)).toBe('function');
  await page.keyboard.press('Escape'); await page.evaluate(() => (window as unknown as { releaseJourneyContext: () => void }).releaseJourneyContext());
  await page.waitForTimeout(1300); expect(requests).toHaveLength(0); await expect(guide(page)).toHaveCount(0); await expect(page.getByRole('region', { name: 'Continuing your task' })).toHaveCount(0);
});

test('explicit target mode excludes unannotated personal controls and bounds both adaptive snapshots and live resolution', async ({ page }) => {
  await start(page, false, 0, 'explicit'); expect(requests[0]!.page.targets.map(target => target.id)).toEqual(['open-dialog']);
  expect(await page.evaluate(() => window.GuideKit.capabilities)).toEqual({ apiVersion: 1, explicitTargets: true, adaptiveJourneys: true, hostWorkflowProgress: true });
  expect(await page.evaluate(() => Object.isFrozen(window.GuideKit.capabilities))).toBe(true);
  expect(await page.evaluate(({ agentId, endpoint }) => { try { window.GuideKit.mount({ agentId, endpoint, targetMode: 'everything' as 'explicit' }); return ''; } catch (error) { return error instanceof Error ? error.message : ''; } }, { agentId, endpoint })).toMatch(/targetMode must be auto or explicit/);
  await expect(guide(page)).toBeVisible();
  await page.locator('[data-guidekit-id="open-dialog"]').evaluate(element => element.removeAttribute('data-guidekit-id'));
  await expect(chat(page)).toBeVisible(); await expect(guide(page)).toHaveCount(0); expect(requests).toHaveLength(2); expect(requests[1]!.page.targets).toEqual([]);
  expect(JSON.stringify(requests)).not.toMatch(/private-filename-marker|private-value-marker|Unannotated personal name|Private annotated control/);
});

test('explicit mode remains active through modal and route continuations; malformed script mode fails closed', async ({ page }) => {
  await start(page, false, 0, 'explicit'); await openDetails(page); await reviewDetails(page); expect(requests).toHaveLength(3);
  expect(requests.flatMap(request => request.page.targets).every(target => ['open-dialog', 'contact-name', 'contact-company', 'next-page', 'confirm-save'].includes(target.id))).toBe(true);
  await page.addInitScript(() => document.addEventListener('guidekit:error', event => { (window as unknown as { targetModeError: string }).targetModeError = (event as CustomEvent<{ message: string }>).detail.message; }));
  await page.goto(`${website}/?agentId=${agentId}&targetMode=everything`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { targetModeError: string }).targetModeError)).toMatch(/data-target-mode must be auto or explicit/);
  await expect(page.getByRole('button', { name: 'Open Journey guide', exact: true })).toHaveCount(0);
});

test('host public labels hide personal accessible filenames and consistently ground semantic replacements', async ({ page }) => {
  await page.goto(`${website}/?agentId=${agentId}&targetMode=explicit`);
  const control = page.locator('[data-guidekit-id="open-dialog"]'); await control.evaluate(element => { element.setAttribute('aria-label', 'private-original-filename.mov'); element.setAttribute('data-guidekit-label', 'Selected timeline clip'); });
  await page.getByRole('button', { name: 'Open Journey guide', exact: true }).click(); await page.getByRole('textbox', { name: 'Your question' }).fill('Explain this selected control'); await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(guide(page)).toContainText('Selected timeline clip'); expect(requests[0]!.page.targets[0]!.label).toBe('Selected timeline clip');
  await control.evaluate(element => element.setAttribute('aria-label', 'private-replacement-filename.mov')); await page.waitForTimeout(1100); expect(requests).toHaveLength(1);
  await control.evaluate(element => element.setAttribute('data-guidekit-label', 'Selected media item')); await expect(guide(page)).toContainText('Selected media item'); expect(requests).toHaveLength(2);
  expect(requests[1]!.page.targets[0]!.label).toBe('Selected media item'); expect(JSON.stringify(requests)).not.toMatch(/private-original-filename|private-replacement-filename|private-filename-marker/);
});
