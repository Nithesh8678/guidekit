import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { GuideKitInstance } from '../../packages/sdk/src/types';

// Actual bundled SDK and browser UI; speech, voices and HTTP planning below are
// explicit synthetic fixtures. These tests never play real audio or open a microphone.
const endpoint = 'http://127.0.0.1:4910', website = 'http://127.0.0.1:4911', agentId = 'agt_voice_settings';
let assets = '', asks = 0; const servers: Server[] = [];
interface VoiceRecord { text: string; uri: string | null; rate: number; language: string; }
interface VoiceFixture { spoken: VoiceRecord[]; started: number; cancelled: number; listeners: number; change(empty: boolean, removeChosen?: boolean): void; start(): void; end(): void; }
declare global { interface Window { voiceSettingsFixture: VoiceFixture; voiceSettingsAssistant: GuideKitInstance; } }
test.beforeAll(async () => {
  assets = await mkdtemp(resolve(tmpdir(), 'guidekit-voice-settings-'));
  await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: resolve(assets, 'guidekit.js'), bundle: true, format: 'iife', target: 'es2022' });
  const api = express(); api.use((_req, res, next) => { res.set('Access-Control-Allow-Origin', website); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); next(); }); api.use(express.json());
  api.use((req, res, next) => { if (req.method === 'OPTIONS') res.sendStatus(204); else next(); });
  api.get('/sdk/guidekit.js', (_req, res) => res.sendFile(resolve(assets, 'guidekit.js')));
  api.post(`/api/embed/${agentId}/session`, (_req, res) => res.json({ token: 'synthetic-voice-settings-token', expiresAt: Date.now() + 900_000, agent: { id: agentId, version: 1, name: 'Voice settings guide', companyName: 'Synthetic fixture', greeting: 'Try the browser voices before choosing one.', accentColor: '#365cf5', allowedActions: [] } }));
  api.post('/api/embed/session/ask', (req, res) => { asks++; res.json({ runId: `run_settings_${asks}`, answer: 'Follow the highlighted field.', steps: req.body.message.includes('guide') ? [{ targetId: 'control-one', text: 'Enter your name.', annotation: 'target' }] : [], citations: [], action: null, provider: 'codex', version: 1, ...(req.body.journey ? { journey: { id: req.body.journey.id, revision: req.body.journey.revision, disposition: 'done' } } : {}) }); });
  const host = express(); host.use((_req, res) => { res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${endpoint}; connect-src 'self' ${endpoint}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`); res.type('html').send(`<!doctype html><html lang="en-IN"><head><title>Browser voice fixture</title></head><body style="padding:48px;font-family:system-ui"><label>Full name<input data-guidekit-id="control-one" required></label><script src="${endpoint}/sdk/guidekit.js"></script></body></html>`); });
  const listen = (app: ReturnType<typeof express>, port: number) => new Promise<void>((accept, reject) => { const server = app.listen(port, '127.0.0.1', () => accept()); server.on('error', reject); servers.push(server); });
  await listen(api, 4910); await listen(host, 4911);
});
test.afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(accept => { server.closeAllConnections(); server.close(() => accept()); }))); if (assets) await rm(assets, { recursive: true, force: true }); });
test.beforeEach(() => { asks = 0; });
async function doubles(page: Page, empty = false) {
  await page.addInitScript(({ empty }) => {
    const voice = (voiceURI: string, name: string, lang: string, isDefault = false) => ({ voiceURI, name, lang, default: isDefault, localService: true }) as SpeechSynthesisVoice;
    const all = [voice('novelty', 'Zarvox', 'en-IN', true), voice('natural', 'Samantha (Enhanced)', 'en-IN'), voice('chosen', 'Daniel (Enhanced)', 'en-GB')];
    let voices = empty ? [] : all, pending: MockUtterance | null = null; const listeners = new Set<EventListenerOrEventListenerObject>();
    const state: VoiceFixture = { spoken: [], started: 0, cancelled: 0, listeners: 0, change(none, removeChosen) { voices = none ? [] : removeChosen ? all.filter(voice => voice.voiceURI !== 'chosen') : all; synth.dispatchEvent(new Event('voiceschanged')); }, start() { pending?.onstart?.(); }, end() { pending?.onend?.(); } };
    class MockUtterance { voice: SpeechSynthesisVoice | null = null; lang = ''; rate = 1; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(readonly text: string) {} }
    class MockRecognition { lang = ''; continuous = false; interimResults = false; onstart: (() => void) | null = null; onend: (() => void) | null = null; onresult = null; onerror = null; start() { state.started++; queueMicrotask(() => this.onstart?.()); } stop() { this.onend?.(); } abort() {} }
    const synth = Object.assign(new EventTarget(), { getVoices: () => voices, speak(utterance: MockUtterance) { pending = utterance; state.spoken.push({ text: utterance.text, uri: utterance.voice?.voiceURI ?? null, rate: utterance.rate, language: utterance.lang }); }, cancel() { state.cancelled++; pending = null; } });
    const add = synth.addEventListener.bind(synth), remove = synth.removeEventListener.bind(synth);
    synth.addEventListener = (type, listener, options) => { if (type === 'voiceschanged' && listener) listeners.add(listener); state.listeners = listeners.size; add(type, listener, options); };
    synth.removeEventListener = (type, listener, options) => { if (type === 'voiceschanged' && listener) listeners.delete(listener); state.listeners = listeners.size; remove(type, listener, options); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth }); Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance }); Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: MockRecognition });
    window.voiceSettingsFixture = state;
  }, { empty });
}
async function open(page: Page, navigate = true) {
  if (navigate) await page.goto(website); await expect.poll(() => page.evaluate(() => Boolean(window.GuideKit))).toBe(true);
  await page.evaluate(async ({ endpoint, agentId }) => { window.voiceSettingsAssistant = window.GuideKit.mount({ endpoint, agentId, targetMode: 'explicit' }); await window.voiceSettingsAssistant.ready; }, { endpoint, agentId });
  await page.getByRole('button', { name: 'Open Voice settings guide', exact: true }).click(); await page.getByText('Voice settings', { exact: true }).click();
}
test('preview uses a standard recommended voice, explicit voice/speed persist, and preview leaves dictation and future output off', async ({ page }) => {
  await doubles(page); await open(page); await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  expect(await page.evaluate(() => window.voiceSettingsFixture.spoken[0])).toMatchObject({ uri: 'natural', rate: 0.98, language: 'en-IN' });
  await expect(page.getByRole('button', { name: 'Read answers aloud using your browser', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('combobox', { name: 'Spoken voice', exact: true }).selectOption('chosen'); await page.getByRole('combobox', { name: 'Voice speed', exact: true }).selectOption('0.95'); await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  expect(await page.evaluate(() => window.voiceSettingsFixture.spoken.at(-1))).toMatchObject({ uri: 'chosen', rate: 0.95, language: 'en-GB' }); await page.getByRole('button', { name: 'Stop voice preview', exact: true }).click();
  expect(await page.evaluate(() => window.voiceSettingsFixture.started)).toBe(0); expect(asks).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('guidekit:voice:v1')!))).toEqual({ voiceURI: 'chosen', language: 'en-GB', rate: 0.95 });
  await page.reload(); await open(page, false); await expect(page.getByRole('combobox', { name: 'Spoken voice', exact: true })).toHaveValue('chosen'); await expect(page.getByRole('combobox', { name: 'Voice speed', exact: true })).toHaveValue('0.95');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click(); expect(await page.evaluate(() => window.voiceSettingsFixture.spoken.at(-1))).toMatchObject({ uri: 'chosen', rate: 0.95 });
  await page.evaluate(() => window.GuideKit.destroy()); expect(await page.evaluate(() => window.voiceSettingsFixture.listeners)).toBe(0); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
});
test('late voice lists update the picker, removed choices fall back, and an active preview remains stoppable after removal', async ({ page }) => {
  await doubles(page, true); await open(page); await expect(page.getByRole('button', { name: 'Preview voice', exact: true })).toBeDisabled(); await expect(page.getByRole('combobox', { name: 'Spoken voice', exact: true })).toBeDisabled();
  await page.evaluate(() => window.voiceSettingsFixture.change(false)); await expect(page.getByRole('combobox', { name: 'Spoken voice', exact: true })).toBeEnabled(); expect(await page.evaluate(() => window.voiceSettingsFixture.spoken.length)).toBe(0);
  await page.getByRole('combobox', { name: 'Spoken voice', exact: true }).selectOption('chosen'); await page.evaluate(() => window.voiceSettingsFixture.change(false, true)); await expect(page.getByText(/saved voice is unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click(); expect(await page.evaluate(() => window.voiceSettingsFixture.spoken.at(-1)?.uri)).toBe('natural');
  await page.evaluate(() => window.voiceSettingsFixture.change(true)); await expect(page.getByRole('button', { name: 'Stop voice preview', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Stop voice preview', exact: true }).click(); await expect(page.getByRole('button', { name: 'Preview voice', exact: true })).toBeDisabled();
  await page.evaluate(() => window.voiceSettingsFixture.change(false)); await expect(page.getByRole('combobox', { name: 'Spoken voice', exact: true })).toHaveValue('chosen');
});
test('selected voice drives narration and drawing still waits for actual speech start; settings never open a microphone', async ({ page }) => {
  await doubles(page); await open(page); await page.getByRole('combobox', { name: 'Spoken voice', exact: true }).selectOption('chosen');
  await page.getByRole('button', { name: 'Read answers aloud using your browser', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Please guide me'); await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Visual guidance' })).toBeVisible(); await expect.poll(() => page.evaluate(() => window.voiceSettingsFixture.spoken.length)).toBe(1);
  expect(await page.evaluate(() => window.voiceSettingsFixture.spoken[0]!.uri)).toBe('chosen'); await expect(page.locator('[data-gk-shape]')).toHaveCount(0);
  await page.evaluate(() => window.voiceSettingsFixture.start()); await expect(page.locator('[data-gk-shape]')).toHaveCount(1); expect(await page.evaluate(() => window.voiceSettingsFixture.started)).toBe(0);
  await page.getByRole('region', { name: 'Visual guidance' }).getByRole('button', { name: 'Open chat', exact: true }).click(); expect(await page.evaluate(() => window.voiceSettingsFixture.cancelled)).toBeGreaterThan(0);
  await page.evaluate(() => window.voiceSettingsFixture.end()); await expect(page.getByRole('dialog', { name: 'Website assistant' })).toBeVisible();
});
