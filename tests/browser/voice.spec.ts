import { test as base, expect, type Page } from '@playwright/test';

/** Explicit browser speech doubles. No microphone, real speech service or audio playback is used. */
interface VoiceDouble {
  started: number; stopped: number; aborted: number; finalText: string;
  spoken: string[]; speechCancelled: number; late(text: string): void;
}
type VoiceWindow = Window & { __guidekitVoiceDouble: VoiceDouble };
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ context }, use) => {
    const errors: string[] = [];
    const observe = (page: Page) => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && /content security policy|unsafe-eval/i.test(message.text())) errors.push(message.text()); });
    };
    context.pages().forEach(observe); context.on('page', observe);
    await use(errors);
    expect(errors, 'No browser exceptions or CSP violations').toEqual([]);
  }, { auto: true }],
});

async function installSpeechDouble(page: Page, supported = true) {
  await page.addInitScript(({ supported }) => {
    type ResultEvent = { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } };
    let lateStart: (() => void) | null = null, lateResult: ((event: ResultEvent) => void) | null = null, lateEnd: (() => void) | null = null;
    const result = (text: string): ResultEvent => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
    const state: VoiceDouble = { started: 0, stopped: 0, aborted: 0, finalText: 'What is our voice support policy?', spoken: [], speechCancelled: 0, late: text => { lateStart?.(); lateResult?.(result(text)); lateEnd?.(); } };
    class MockRecognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onresult: ((event: ResultEvent) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null; onend: (() => void) | null = null;
      start() {
        state.started++; lateStart = this.onstart; lateResult = this.onresult; lateEnd = this.onend;
        queueMicrotask(() => this.onstart?.());
      }
      stop() { state.stopped++; queueMicrotask(() => { this.onresult?.(result(state.finalText)); this.onend?.(); }); }
      abort() { state.aborted++; }
    }
    class MockUtterance { lang = ''; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(readonly text: string) {} }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: supported ? MockRecognition : undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: supported ? MockRecognition : undefined });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (utterance: MockUtterance) => state.spoken.push(utterance.text), cancel: () => { state.speechCancelled++; } } });
    (window as unknown as VoiceWindow).__guidekitVoiceDouble = state;
  }, { supported });
}

async function publishedHost(page: Page, reviewVoice = false) {
  const endpoint = 'http://127.0.0.1:4510';
  const post = async (path: string, data: unknown, expected = 201) => {
    const response = await page.request.post(`${endpoint}${path}`, { headers: { Origin: endpoint }, data });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(expected);
    return response.json();
  };
  await post('/api/auth/register', { email: `voice-${crypto.randomUUID()}@example.test`, name: 'Synthetic Voice Tester', companyName: 'Voice Regression Workspace', password: 'Synthetic-voice-test-password-42' });
  const { agent } = await post('/api/agents', { name: 'Voice Regression Guide', companyName: 'Voice Regression Workspace', greeting: 'Ask about our support policy.', instructions: 'Answer using the published voice handbook.', allowedOrigins: ['http://127.0.0.1:4511'], allowedActions: ['create_contact'] }) as { agent: { id: string } };
  await post(`/api/agents/${agent.id}/documents`, { title: 'Voice handbook', content: 'Our voice support policy is to answer within 42 hours. Voice regression marker: BROWSER-VOICE-ONLY.' });
  await post(`/api/agents/${agent.id}/publish`, {});
  const response = await page.goto(`http://127.0.0.1:4511/?agentId=${encodeURIComponent(agent.id)}`);
  expect(response?.headers()['content-security-policy']).not.toContain('unsafe-eval');
  await expect(page.getByRole('button', { name: 'Open Voice Regression Guide', exact: true })).toBeVisible();
  // URL-installed demos deliberately enable auto-submit. Exercise the public
  // SDK's review configuration without changing the production host fixture.
  if (reviewVoice) {
    await page.evaluate(async ({ agentId, endpoint }) => {
      await window.GuideKit.mount({ agentId, endpoint, voice: { provider: 'browser', autoSubmit: false } }).ready;
    }, { agentId: agent.id, endpoint });
    await expect(page.getByRole('button', { name: 'Open Voice Regression Guide', exact: true })).toBeVisible();
  }
  return agent.id;
}

const shortcut = process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K';
const question = (page: Page) => page.getByRole('textbox', { name: 'Your question', exact: true });

for (const modifier of ['Meta', 'Control']) test(`${modifier}+Shift+K starts browser voice, finishes once, submits final text and enables spoken output`, async ({ page }) => {
  const shortcut = `${modifier}+Shift+K`;
  await installSpeechDouble(page); await publishedHost(page);
  const asks: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push((request.postDataJSON() as { message: string }).message); });
  await page.keyboard.press(shortcut);
  await expect(page.getByRole('dialog', { name: 'Website assistant' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.started)).toBe(1);
  await expect(page.getByRole('button', { name: 'Finish voice input and send question', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Cancel voice', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off browser spoken answers', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(question(page)).toHaveAttribute('readonly', ''); expect(asks).toEqual([]);
  const reply = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.keyboard.press(shortcut); expect((await reply).status()).toBe(200);
  expect(asks).toEqual(['What is our voice support policy?']);
  await expect.poll(() => page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.stopped)).toBe(1);
  await expect(page.getByRole('log')).toContainText('BROWSER-VOICE-ONLY');
  await expect.poll(() => page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.spoken.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.spoken[0])).toContain('42 hours');
  await expect(question(page)).not.toHaveAttribute('readonly', ''); await expect(page.getByRole('button', { name: 'Send question', exact: true })).toBeEnabled();
});

test('Escape discards browser voice and delayed speech callbacks cannot submit a question', async ({ page }) => {
  await installSpeechDouble(page); await publishedHost(page);
  const asks: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push(request.url()); });
  await page.keyboard.press(shortcut); await expect(page.getByRole('button', { name: 'Cancel voice', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Website assistant' })).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.aborted)).toBe(1);
  await page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.late('Do not send this delayed transcript'));
  await page.getByRole('button', { name: 'Open Voice Regression Guide', exact: true }).click();
  await expect(question(page)).toHaveValue(''); await expect(page.getByRole('log')).not.toContainText('Do not send this delayed transcript');
  expect(asks).toEqual([]);
});

test('autoSubmit:false microphone dictation keeps its transcript for review and sends only after an explicit click', async ({ page }) => {
  await installSpeechDouble(page); await publishedHost(page, true);
  const asks: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push((request.postDataJSON() as { message: string }).message); });
  await page.getByRole('button', { name: 'Open Voice Regression Guide', exact: true }).click();
  await question(page).fill('Please explain');
  await page.evaluate(() => { (window as unknown as VoiceWindow).__guidekitVoiceDouble.finalText = 'our voice support policy'; });
  await page.getByRole('button', { name: 'Dictate with your browser, then review your question. Your browser may process audio online.', exact: true }).click();
  const finish = page.getByRole('button', { name: 'Finish dictation and review transcript', exact: true }); await expect(finish).toBeVisible(); await finish.click();
  await expect(question(page)).toHaveValue('Please explain our voice support policy'); await expect(question(page)).not.toHaveAttribute('readonly', '');
  await expect(page.getByRole('dialog', { name: 'Website assistant' }).getByRole('status')).toContainText('Transcript ready'); expect(asks).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.spoken)).toEqual([]);
  const reply = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click(); expect((await reply).status()).toBe(200);
  expect(asks).toEqual(['Please explain our voice support policy']);
});

test('unsupported browser exposes a disabled microphone with recovery guidance and keeps text chat available', async ({ page }) => {
  await installSpeechDouble(page, false); await publishedHost(page); await page.keyboard.press(shortcut);
  const mic = page.getByRole('button', { name: 'Speech recognition is unavailable in this browser. Try Chrome or Edge with microphone access, or type your question.', exact: true });
  await expect(mic).toBeDisabled(); await expect(page.getByRole('dialog', { name: 'Website assistant' }).getByRole('status')).toContainText('Try Chrome or Edge');
  expect(await page.evaluate(() => (window as unknown as VoiceWindow).__guidekitVoiceDouble.started)).toBe(0);
  await expect(question(page)).toBeEditable(); await question(page).fill('What is our voice support policy?');
  const reply = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click(); expect((await reply).status()).toBe(200);
  await expect(page.getByRole('log')).toContainText('BROWSER-VOICE-ONLY');
});
