import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../../apps/server/src/app';
import type { GuideKitInstance } from '../../packages/sdk/src/types';

// Accelerated lifecycle simulation: real Chromium/HTTP, synthetic accounts/inference,
// and controlled token expiry. This is not an elapsed ten-minute or physical voice test.
const endpoint = 'http://127.0.0.1:4710', website = 'http://127.0.0.1:4711', sdkUrl = `${endpoint}/sdk/guidekit.js`;
let assets = '', data = '', agentId = '', service: ReturnType<typeof createApp>, inferCalls = 0, askRequests = 0, sessionRequests = 0;
const servers: Server[] = [];
type Resources = { listeners: number; mutations: number; resizes: number; timeouts: number; intervals: number; frames: number };
declare global { interface Window { lifecycleAssistant: GuideKitInstance; lifecycleResources: () => Resources; } }

test.beforeAll(async () => {
  assets = await mkdtemp(resolve(tmpdir(), 'guidekit-lifecycle-assets-')); data = await mkdtemp(resolve(tmpdir(), 'guidekit-lifecycle-data-'));
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: resolve(assets, 'dist/sdk/guidekit.js'), bundle: true, format: 'iife', target: 'es2022' });
  service = createApp({ dataDir: data, root: assets, adminOrigins: new Set([endpoint]), testing: true, provider: {
    async status() { return { provider: 'codex', available: true, authenticated: true, message: 'Explicit synthetic lifecycle provider' }; },
    async infer({ prompt }) { inferCalls++; const message = JSON.parse(prompt.split('\n\n').find(line => line.startsWith('User request (reference data): '))!.slice('User request (reference data): '.length)) as string;
      return JSON.stringify({ answer: message.includes('Guide this form') ? 'Enter the public fields, then save.' : 'Export is available in the directory.', steps: message.includes('Guide this form') ? ['full-name', 'company', 'save'].map(targetId => ({ targetId, text: `Use ${targetId}.`, annotation: 'target' })) : [], action: null, citationIds: [], journeyDisposition: 'done' });
    }, async close() {}
  } });
  const owner = service.repo.register({ email: 'lifecycle@example.invalid', name: 'Lifecycle owner', companyName: 'Lifecycle' }, 'synthetic-non-login-hash');
  const agent = service.repo.createAgent(owner.tenant.id, { name: 'Lifecycle guide', companyName: 'Lifecycle', greeting: 'How can I help?', description: '', instructions: '', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] }); agentId = agent.id;
  service.repo.addDocument(owner.tenant.id, agent.id, { title: 'Directory guide', content: 'Contacts can be exported from the directory.' }); service.repo.publish(owner.tenant.id, agent.id);
  const api = express(); api.use((req, _res, next) => { if (req.method === 'POST') { if (req.path === '/api/embed/session/ask') askRequests++; else if (req.path === `/api/embed/${agentId}/session`) sessionRequests++; } next(); }); api.use(service.app);
  const host = express(); host.use((_req, res) => { res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${endpoint}; connect-src 'self' ${endpoint}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`); res.type('html').send(`<!doctype html><html lang="en"><head><title>Lifecycle fixture</title></head><body style="padding:48px;font-family:system-ui"><main><h1>Directory</h1><form><label>Full name<input data-guidekit-id="full-name" required></label><label>Company<input data-guidekit-id="company" required></label><button data-guidekit-id="save" type="button">Save contact</button></form></main><script src="${sdkUrl}"></script></body></html>`); });
  const listen = (app: ReturnType<typeof express>, port: number) => new Promise<void>((accept, reject) => { const server = app.listen(port, '127.0.0.1', () => accept()); servers.push(server); server.on('error', reject); });
  await listen(api, 4710); await listen(host, 4711);
});
test.afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }))); await service?.close(); if (assets) await rm(assets, { recursive: true, force: true }); if (data) await rm(data, { recursive: true, force: true }); });
test.beforeEach(() => { inferCalls = 0; askRequests = 0; sessionRequests = 0; });

async function install(page: Page) { await page.goto(website); await expect.poll(() => page.evaluate(() => Boolean(window.GuideKit))).toBe(true); await mount(page); }
async function mount(page: Page) { await page.evaluate(async ({ endpoint, agentId }) => { window.lifecycleAssistant = window.GuideKit.mount({ endpoint, agentId, voice: { provider: 'disabled' }, targetMode: 'explicit' }); await window.lifecycleAssistant.ready; }, { endpoint, agentId }); }
const ask = (page: Page, message: string) => page.evaluate(message => window.lifecycleAssistant.ask(message), message);

test('accelerated server-side expiry fails safely at 401, then a new visitor request reconnects without automatic retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await install(page);
  expect((await ask(page, 'Explain directory export'))?.answer).toBe('Export is available in the directory.'); expect(inferCalls).toBe(1); expect(sessionRequests).toBe(1);
  // Force the disposable server credential to expire while the browser still believes it valid.
  service.repo.db.prepare('UPDATE embed_sessions SET expires=0').run();
  expect(await ask(page, 'Explain directory export again')).toBeNull(); await expect(page.getByRole('dialog', { name: 'Website assistant' })).toContainText('session expired');
  expect(inferCalls).toBe(1); expect(sessionRequests).toBe(1); const stoppedRequests = askRequests; await page.waitForTimeout(400); expect(askRequests).toBe(stoppedRequests);
  expect((await ask(page, 'Explain directory export after reconnect'))?.answer).toBe('Export is available in the directory.'); expect(sessionRequests).toBe(2); expect(inferCalls).toBe(2);
  const networkFailure = `${endpoint}/api/embed/session/ask`; await page.route(networkFailure, route => route.abort('failed'));
  expect(await ask(page, 'Explain export during an outage')).toBeNull(); await expect(page.getByRole('dialog', { name: 'Website assistant' })).toContainText('Cannot connect to the assistant'); expect(inferCalls).toBe(2);
  await page.unroute(networkFailure); expect((await ask(page, 'Explain export after network recovery'))?.answer).toBe('Export is available in the directory.'); expect(inferCalls).toBe(3); expect(sessionRequests).toBe(2); expect(errors).toEqual([]);
});

test('accelerated client near-expiry refresh obtains a fresh session before asking', async ({ page }) => {
  await page.clock.install(); let intercepted = false;
  await page.route(`${endpoint}/api/embed/${agentId}/session`, async route => { const response = await route.fetch(); const body = await response.json(); if (!intercepted) { intercepted = true; body.expiresAt = Date.now() + 35_000; } await route.fulfill({ response, json: body }); });
  await install(page); expect(sessionRequests).toBe(1); await page.clock.fastForward(6000);
  expect((await ask(page, 'Explain export after the simulated near-expiry window'))?.answer).toBe('Export is available in the directory.'); expect(sessionRequests).toBe(2); expect(inferCalls).toBe(1);
});

test('repeated mount and destroy remove active SDK listeners, observers, timers, frames and delayed guidance', async ({ page }) => {
  await page.addInitScript(({ sdkUrl }) => {
    // Instrument only calls originating in the actual SDK bundle. Detached button
    // listeners are collectible with their shadow root; persistent global resources are measured.
    const owned = () => new Error().stack?.includes(sdkUrl) === true;
    const listeners: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; capture: boolean }> = [];
    const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
      if (listener && owned() && [window, document, window.visualViewport].includes(this as Window & Document & VisualViewport) && !listeners.some(entry => entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture)) listeners.push({ target: this, type, listener, capture });
      nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { const capture = typeof options === 'boolean' ? options : options?.capture ?? false; const index = listeners.findIndex(entry => entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture); if (index >= 0) listeners.splice(index, 1); nativeRemove.call(this, type, listener, options); };
    const mutations = new Set<MutationObserver>(), resizes = new Set<ResizeObserver>(), NativeMutation = window.MutationObserver, NativeResize = window.ResizeObserver;
    window.MutationObserver = class extends NativeMutation { override observe(target: Node, options?: MutationObserverInit) { super.observe(target, options); if (owned()) mutations.add(this); } override disconnect() { mutations.delete(this); super.disconnect(); } };
    window.ResizeObserver = class extends NativeResize { override observe(target: Element, options?: ResizeObserverOptions) { super.observe(target, options); if (owned()) resizes.add(this); } override disconnect() { resizes.delete(this); super.disconnect(); } };
    const timeouts = new Set<number>(), intervals = new Set<number>(), frames = new Set<number>();
    const timeout = window.setTimeout.bind(window) as (handler: TimerHandler, ms?: number, ...args: unknown[]) => number, clearTimeout = window.clearTimeout.bind(window), interval = window.setInterval.bind(window) as (handler: TimerHandler, ms?: number, ...args: unknown[]) => number, clearInterval = window.clearInterval.bind(window), frame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => { if (!owned() || typeof handler !== 'function') return timeout(handler, ms, ...args); const id = timeout(() => { timeouts.delete(id); handler(...args); }, ms); timeouts.add(id); return id; }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number) => { timeouts.delete(id); clearTimeout(id); }) as typeof window.clearTimeout;
    window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => { const id = interval(handler, ms, ...args); if (owned()) intervals.add(id); return id; }) as typeof window.setInterval;
    window.clearInterval = ((id: number) => { intervals.delete(id); clearInterval(id); }) as typeof window.clearInterval;
    window.requestAnimationFrame = callback => { const track = owned(); const id = frame(time => { frames.delete(id); callback(time); }); if (track) frames.add(id); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); cancelFrame(id); };
    window.lifecycleResources = () => ({ listeners: listeners.length, mutations: mutations.size, resizes: resizes.size, timeouts: timeouts.size, intervals: intervals.size, frames: frames.size });
  }, { sdkUrl });
  await install(page); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (let cycle = 0; cycle < 4; cycle++) {
    if (cycle) await mount(page); await expect(page.locator('[data-guidekit-root]')).toHaveCount(1);
    expect(await ask(page, 'Guide this form')).not.toBeNull(); await expect(page.getByRole('region', { name: 'Visual guidance' })).toBeVisible();
    await page.locator('[data-guidekit-id="full-name"]').fill(`Synthetic cycle ${cycle}`);
    const active = await page.evaluate(() => window.lifecycleResources()); expect(active.listeners).toBeGreaterThan(0); expect(active.mutations).toBeGreaterThan(0); expect(active.resizes).toBeGreaterThan(0); expect(active.intervals).toBeGreaterThan(0); expect(active.timeouts).toBeGreaterThan(0);
    await page.evaluate(() => window.GuideKit.destroy());
    await expect(page.locator('[data-guidekit-root]')).toHaveCount(0); await expect.poll(() => page.evaluate(() => window.lifecycleResources())).toEqual({ listeners: 0, mutations: 0, resizes: 0, timeouts: 0, intervals: 0, frames: 0 });
  }
  const stopped = askRequests; await page.locator('[data-guidekit-id="company"]').fill('After teardown'); await page.keyboard.press('Control+Shift+K'); await page.waitForTimeout(1400);
  expect(askRequests).toBe(stopped); await expect(page.getByRole('region', { name: 'Visual guidance' })).toHaveCount(0); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0); expect(errors).toEqual([]);
});
