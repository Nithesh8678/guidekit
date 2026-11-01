import { test as base, expect, type Page } from '@playwright/test';
import type { RunResult } from '../../packages/contracts/src/index.js';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const instruction = (page: Page) => guide(page).locator('.guide-instruction');
const accessible = (page: Page) => guide(page).locator('.guide-instruction-accessible');
const longInstruction = 'Enter the full name you want to save for this contact. Take your time and check the spelling before continuing. The guide stays beside the field while you work, and it will move to the company field after you finish. You can pause, open chat, or show the complete instruction at any point. Nothing is submitted by this explanation; you stay in control of the contact details and the final save.';

interface CardFrame { text: string; accessible: string; typing: boolean; width: number; height: number; scroll: string; step: string; }
interface CardProbe { frames: CardFrame[]; running: boolean; }
type ProbeWindow = Window & { __guidekitCardProbe: CardProbe };

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors); expect(errors, 'The instruction lifecycle raises no browser exception').toEqual([]);
  }, { auto: true }],
});

async function openFixture(page: Page, texts: string[], belowPage = false) {
  await page.addInitScript(() => {
    (window as unknown as ProbeWindow).__guidekitCardProbe = { frames: [], running: false };
    // This suite exercises local presentation using the explicit test provider.
    // Adaptive planning and the real subscription runtime are tested elsewhere.
    document.addEventListener('guidekit:ready', event => {
      const api = (event as CustomEvent).detail.api as Window['GuideKit'], mount = api.mount;
      api.mount = options => mount({ ...options, journey: { enabled: false } });
    }, { once: true });
  });
  await page.route('**/api/embed/session/ask', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const run = await response.json() as RunResult;
    run.steps = run.steps.map((step, index) => ({ ...step, text: texts[index] ?? 'Continue to this control.' }));
    await route.fulfill({ response, json: run });
  });
  const auth = await page.request.post(`${endpoint}/api/auth/register`, { headers: { Origin: endpoint }, data: { email: `card-${crypto.randomUUID()}@example.test`, name: 'Card Tester', companyName: 'Card Workspace', password: 'Synthetic-card-password-42' } });
  expect(auth.status()).toBe(201);
  const created = await page.request.post(`${endpoint}/api/agents`, { headers: { Origin: endpoint }, data: { name: 'Card guide', companyName: 'Card Workspace', allowedOrigins: [website], allowedActions: ['create_contact'] } });
  expect(created.status()).toBe(201); const { agent } = await created.json() as { agent: { id: string } };
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/documents`, { headers: { Origin: endpoint }, data: { title: 'Contact workflow', content: 'Create a contact by entering a full name and company, choosing status, and submitting Create contact.' } })).status()).toBe(201);
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/publish`, { headers: { Origin: endpoint }, data: {} })).status()).toBe(201);
  await page.goto(`${website}/?agentId=${encodeURIComponent(agent.id)}`);
  await page.getByRole('button', { name: 'Open Card guide', exact: true }).click();
  await expect(chat(page)).toBeVisible();
  await page.evaluate(below => {
    const form = document.querySelector<HTMLElement>('#contact-form')!;
    document.body.append(form);
    document.querySelectorAll('body > :not([data-guidekit-root])').forEach(node => { if (node !== form) (node as HTMLElement).style.display = 'none'; });
    Object.assign(document.documentElement.style, { scrollBehavior: 'auto', overflowAnchor: 'none' });
    Object.assign(document.body.style, { margin: '0', minHeight: below ? '6500px' : '900px', background: '#f4f6fa', overflowAnchor: 'none' });
    Object.assign(form.style, { position: 'absolute', left: '24px', top: '60px', margin: '0', width: '220px', height: below ? '5800px' : '650px', display: 'block', overflowAnchor: 'none' });
    ['contact-name', 'contact-company', 'contact-status', 'create-contact'].forEach((id, index) => {
      const input = document.querySelector<HTMLElement>(`[data-guidekit-id="${id}"]`)!;
      const control = id === 'create-contact' ? input : input.closest('label')! as HTMLElement;
      Object.assign(control.style, { position: 'absolute', left: '0', top: `${below && index === 0 ? 5000 : 100 + index * 100}px`, width: '200px', margin: '0' });
      if (id !== 'create-contact') Object.assign(input.style, { display: 'block', width: '100%', height: '44px' });
    });
    document.querySelector<HTMLElement>('input[name="email"]')!.closest('label')!.setAttribute('hidden', '');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, belowPage);
}

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__guidekitCardProbe;
    probe.frames = []; probe.running = true;
    const frame = () => {
      const root = document.querySelector('[data-guidekit-root]')?.shadowRoot;
      const card = root?.querySelector<HTMLElement>('[aria-label="Visual guidance"]');
      if (card && !card.hidden) {
        const bounds = card.getBoundingClientRect();
        probe.frames.push({ text: card.querySelector('.guide-instruction')?.textContent ?? '', accessible: card.querySelector('.guide-instruction-accessible')?.textContent ?? '', typing: card.dataset.gkTyping === 'true', width: bounds.width, height: bounds.height, scroll: card.dataset.gkScrollState ?? '', step: card.querySelector('.guide-label')?.textContent ?? '' });
      }
      if (probe.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function stopProbe(page: Page): Promise<CardFrame[]> {
  return page.evaluate(() => { const probe = (window as unknown as ProbeWindow).__guidekitCardProbe; probe.running = false; return probe.frames; });
}

async function frames(page: Page, count = 25) {
  await page.evaluate(count => new Promise<void>(resolve => {
    let left = count; const frame = () => { if (--left <= 0) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  }), count);
}

async function ask(page: Page) {
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Show me how to create a contact');
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(guide(page)).toBeVisible(); await expect(chat(page)).toBeHidden();
}

async function finished(page: Page, text: string) {
  await expect(instruction(page)).toHaveText(text, { timeout: 10_000 });
  await expect(guide(page)).toHaveAttribute('data-gk-typing', 'false');
}

test('real intermediate instruction prefixes expand the card smoothly in width and height', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openFixture(page, [longInstruction]); await startProbe(page);
  try {
    await ask(page); await finished(page, longInstruction); await frames(page, 12);
    const samples = (await stopProbe(page)).filter(sample => sample.text.length > 0);
    const prefixes = samples.filter(sample => sample.typing && sample.text.length < longInstruction.length);
    expect(new Set(prefixes.map(sample => sample.text)).size, 'Text is revealed through real intermediate prefixes').toBeGreaterThan(5);
    expect(prefixes.every(sample => longInstruction.startsWith(sample.text))).toBe(true);
    expect(Math.max(...samples.map(sample => sample.width)) - Math.min(...samples.map(sample => sample.width)), 'Revealed content grows the compact card width').toBeGreaterThan(15);
    expect(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height)), 'Wrapped content grows the card height').toBeGreaterThan(30);
    expect(new Set(samples.map(sample => Math.round(sample.width))).size, 'The card travels through intermediate widths').toBeGreaterThan(4);
    const style = await guide(page).evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, background: getComputedStyle(node).backgroundImage }));
    expect(style.shadow).not.toBe('none'); expect(style.background).toContain('linear-gradient');
    await expect(guide(page).locator('.guide-rim')).toHaveAttribute('aria-hidden', 'true');
    expect(await guide(page).locator('.guide-rim').evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
    const screenshot = test.info().outputPath('adaptive-guide-card-desktop.png');
    await page.screenshot({ path: screenshot });
    await test.info().attach('Adaptive guide card', { path: screenshot, contentType: 'image/png' });
  } finally { await stopProbe(page); }
});

test('compact instructions stay smaller and a 320px viewport contains long unbroken text and every control', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const unbroken = 'A'.repeat(440);
  await openFixture(page, ['Enter your name.', unbroken]); await ask(page); await finished(page, 'Enter your name.');
  const compact = await guide(page).boundingBox();
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click(); await finished(page, unbroken); await frames(page, 12);
  const long = await guide(page).boundingBox();
  expect(long!.height).toBeGreaterThan(compact!.height + 25);
  expect(long!.x).toBeGreaterThanOrEqual(0); expect(long!.x + long!.width).toBeLessThanOrEqual(320);
  expect(long!.y).toBeGreaterThanOrEqual(0); expect(long!.y + long!.height).toBeLessThanOrEqual(740);
  const overflow = await guide(page).evaluate(node => ({ card: node.scrollWidth - node.clientWidth, text: node.querySelector('.guide-instruction')!.scrollWidth - node.querySelector('.guide-instruction')!.clientWidth }));
  expect(overflow.card).toBeLessThanOrEqual(1); expect(overflow.text).toBeLessThanOrEqual(1);
  for (const label of ['Back', 'Next', 'Automatic progress', 'Pause guide', 'Open chat', 'Stop visual guidance']) {
    const control = guide(page).getByRole('button', { name: label, exact: true }); await expect(control).toBeInViewport({ ratio: 1 });
    const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(long!.x); expect(box!.x + box!.width).toBeLessThanOrEqual(long!.x + long!.width + 1);
  }
});

test('typed Unicode prefixes end only at complete graphemes including combining accents, flags and joined emoji', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const text = 'Name 👨‍👩‍👧‍👦 Café e\u0301 🇮🇳 👍🏽 தமிழ் 👩🏽‍💻 — enter it exactly as you would like the contact to appear. '.repeat(2);
  const valid = new Set(['']); let prefix = '';
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) { prefix += segment; valid.add(prefix); }
  await openFixture(page, [text]); await startProbe(page);
  try {
    await ask(page); await finished(page, text);
    const samples = (await stopProbe(page)).filter(sample => sample.typing);
    expect(new Set(samples.map(sample => sample.text)).size).toBeGreaterThan(4);
    expect(samples.every(sample => valid.has(sample.text)), 'No frame splits a displayed grapheme').toBe(true);
    expect(samples.some(sample => sample.text.includes('👨‍👩‍👧‍👦'))).toBe(true);
  } finally { await stopProbe(page); }
});

test('assistive technology receives the full instruction once while Show full instruction skips only the visual effect', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, [longInstruction]); await startProbe(page);
  try {
    await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true');
    await expect(accessible(page)).toHaveText(longInstruction); await expect(accessible(page)).toHaveAttribute('aria-live', 'polite');
    await expect(accessible(page)).toHaveAttribute('aria-atomic', 'true'); await expect(instruction(page)).toHaveAttribute('aria-hidden', 'true');
    expect(await instruction(page).getAttribute('aria-live')).toBeNull();
    await guide(page).getByRole('button', { name: 'Show full instruction', exact: true }).click();
    await finished(page, longInstruction); await frames(page);
    const samples = await stopProbe(page);
    expect(samples.filter(sample => sample.typing).length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.accessible === longInstruction), 'The live region never streams individual prefixes').toBe(true);
    await expect(guide(page).getByText('Step 1 of 4', { exact: true })).toBeVisible();
    await expect(chat(page)).toBeHidden();
  } finally { await stopProbe(page); }
});

test('Reduced Motion immediately displays the full instruction without type, glow or resize animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openFixture(page, [longInstruction]); await startProbe(page);
  try {
    await ask(page); await finished(page, longInstruction); await frames(page, 4);
    const samples = await stopProbe(page);
    expect(samples.length).toBeGreaterThan(0); expect(samples.every(sample => !sample.typing && (!sample.text || sample.text === longInstruction))).toBe(true);
    await expect(guide(page).getByRole('button', { name: 'Show full instruction', exact: true })).toBeHidden();
    expect(await guide(page).evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  } finally { await stopProbe(page); }
});

test('host geometry and same-step observation refreshes do not restart an instruction or create another request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, [longInstruction]);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) requests.push(request.url()); });
  await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true'); await startProbe(page);
  try {
    await guide(page).getByRole('button', { name: 'Automatic progress', exact: true }).click();
    await page.locator('[data-guidekit-id="contact-name"]').evaluate(node => { (node as HTMLElement).style.transform = 'translateX(15px)'; window.dispatchEvent(new Event('resize')); });
    await finished(page, longInstruction); await frames(page, 15);
    const samples = await stopProbe(page), lengths = samples.map(sample => sample.text.length);
    expect(lengths.every((length, index) => index === 0 || length >= lengths[index - 1]!), 'A same-step refresh never clears or retypes its prefix').toBe(true);
    expect(samples.every(sample => longInstruction.startsWith(sample.text))).toBe(true); expect(requests).toHaveLength(1);
  } finally { await stopProbe(page); }
});

test('rapid steps replace the old typewriter, and pause, chat, resume and destroy leave no hidden typing work', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const second = `Company instruction. ${longInstruction}`, third = `Status instruction. ${longInstruction}`;
  await openFixture(page, [longInstruction, second, third]); await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true');
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(guide(page).getByText('Step 3 of 4', { exact: true })).toBeVisible(); await startProbe(page);
  try {
    await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true');
    await guide(page).getByRole('button', { name: 'Pause guide', exact: true }).click(); await finished(page, third);
    await guide(page).getByRole('button', { name: 'Resume guide', exact: true }).click(); await frames(page, 8); await finished(page, third);
    await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click(); await expect(chat(page)).toBeVisible();
    await page.getByRole('button', { name: 'Resume guide', exact: true }).click(); await finished(page, third);
    const samples = await stopProbe(page);
    expect(samples.every(sample => third.startsWith(sample.text)), 'Cancelled writers cannot put the preceding step back').toBe(true);
    await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click(); await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true');
    const detachedText = await instruction(page).elementHandle(); expect(detachedText).not.toBeNull();
    await page.evaluate(() => window.GuideKit.destroy()); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
    const before = await detachedText!.textContent(); await frames(page, 35);
    expect(await detachedText!.textContent(), 'Destroy stops updates even on the detached instruction node').toBe(before);
  } finally { await stopProbe(page); }
});

test('smoothly revealing an offscreen control finishes before instruction typing begins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, [longInstruction], true); await startProbe(page);
  try {
    await ask(page); await finished(page, longInstruction);
    const samples = await stopProbe(page), scrolling = samples.filter(sample => sample.scroll === 'revealing');
    expect(scrolling.length).toBeGreaterThan(3);
    expect(scrolling.every(sample => sample.text === '' && !sample.typing), 'The visitor first sees a settled target, then the explanation').toBe(true);
    expect(samples.some(sample => sample.scroll === 'ready' && sample.typing && sample.text.length > 0)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(4000);
  } finally { await stopProbe(page); }
});
