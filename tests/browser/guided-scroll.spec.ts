import { test as base, expect, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const target = (page: Page, id = 'contact-name') => page.locator(`[data-guidekit-id="${id}"]`);
const shape = (page: Page) => page.locator('[data-guidekit-root] [data-gk-shape]');
const cursor = (page: Page) => page.locator('[data-guidekit-root] [data-gk-cursor]');

interface Frame { time: number; y: number; panel: number; state: string; ink: boolean; cursor: string; speech: number; }
interface ScrollProbe { frames: Frame[]; running: boolean; texts: string[]; }
type ProbeWindow = Window & { __guidekitScrollProbe: ScrollProbe };

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors); expect(errors, 'No browser exceptions during scrolling or cancellation').toEqual([]);
  }, { auto: true }],
});

async function openFixture(page: Page, speech = false) {
  await page.addInitScript(({ speech }) => {
    const probe: ScrollProbe = { frames: [], running: false, texts: [] };
    (window as unknown as ProbeWindow).__guidekitScrollProbe = probe;
    if (speech) {
      // Explicit playback callbacks only: no real speaker or microphone claim.
      class Utterance {
        lang = ''; rate = 1; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null;
        constructor(readonly text: string) {}
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (utterance: Utterance) => { probe.texts.push(utterance.text); utterance.onstart?.(); utterance.onend?.(); }, cancel() {} } });
    }
    // Adaptive replanning is tested elsewhere. These cases exercise the local
    // reveal lifecycle without allowing a second synthetic answer to mask it.
    document.addEventListener('guidekit:ready', event => {
      const api = (event as CustomEvent).detail.api as Window['GuideKit'], mount = api.mount;
      api.mount = options => mount({ ...options, journey: { enabled: false } });
    }, { once: true });
  }, { speech });
  const auth = await page.request.post(`${endpoint}/api/auth/register`, { headers: { Origin: endpoint }, data: { email: `scroll-${crypto.randomUUID()}@example.test`, name: 'Scroll Tester', companyName: 'Scroll Workspace', password: 'Synthetic-scroll-password-42' } });
  expect(auth.status()).toBe(201);
  const created = await page.request.post(`${endpoint}/api/agents`, { headers: { Origin: endpoint }, data: { name: 'Scroll guide', companyName: 'Scroll Workspace', allowedOrigins: [website], allowedActions: ['create_contact'] } });
  expect(created.status()).toBe(201); const { agent } = await created.json() as { agent: { id: string } };
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/documents`, { headers: { Origin: endpoint }, data: { title: 'Contact workflow', content: 'Create a contact by entering a full name and company, choosing status, and submitting Create contact.' } })).status()).toBe(201);
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/publish`, { headers: { Origin: endpoint }, data: {} })).status()).toBe(201);
  await page.goto(`${website}/?agentId=${encodeURIComponent(agent.id)}`);
  await page.getByRole('button', { name: 'Open Scroll guide', exact: true }).click();
  await expect(chat(page)).toBeVisible();
}

async function arrange(page: Page, layout: 'window' | 'nested' | 'outer-clip' | 'second-step' | 'visible') {
  await page.evaluate(kind => {
    const form = document.querySelector<HTMLElement>('#contact-form')!;
    // Preserve the real fixture's host listeners, stable IDs and accessible
    // labels. Only its disposable layout changes in this isolated browser.
    document.querySelectorAll('body > :not([data-guidekit-root])').forEach(node => { if (node !== form && !node.contains(form)) (node as HTMLElement).style.display = 'none'; });
    document.body.append(form);
    Object.assign(document.documentElement.style, { scrollBehavior: 'auto', overflowAnchor: 'none' });
    Object.assign(document.body.style, { margin: '0', minHeight: kind === 'window' ? '6500px' : '900px', background: '#f4f6fa', overflowAnchor: 'none' });
    Object.assign(form.style, { position: 'absolute', left: '80px', top: '80px', margin: '0', width: '440px', height: kind === 'window' ? '5800px' : '700px', display: 'block', overflowAnchor: 'none' });
    const ids = ['contact-name', 'contact-company', 'contact-status', 'create-contact'];
    ids.forEach((id, index) => {
      const input = document.querySelector<HTMLElement>(`[data-guidekit-id="${id}"]`)!;
      const control = id === 'create-contact' ? input : input.closest('label')! as HTMLElement;
      Object.assign(control.style, { position: 'absolute', left: '24px', top: `${90 + index * 100}px`, width: '360px', margin: '0' });
      if (id !== 'create-contact') Object.assign(input.style, { display: 'block', width: '100%', height: '44px' });
    });
    // Private email is not involved in these public-control fixtures.
    document.querySelector<HTMLElement>('input[name="email"]')!.closest('label')!.setAttribute('hidden', '');
    if (kind === 'window') document.querySelector<HTMLElement>('[data-guidekit-id="contact-name"]')!.closest('label')!.style.top = '5000px';
    if (kind === 'nested' || kind === 'outer-clip' || kind === 'second-step') {
      const panel = document.createElement('div'); panel.id = 'scroll-panel';
      Object.assign(panel.style, { position: 'absolute', left: '40px', top: '100px', width: '540px', height: '300px', overflow: 'auto', border: '2px solid #999', scrollBehavior: 'auto', overflowAnchor: 'none' });
      document.body.append(panel); panel.append(form);
      Object.assign(form.style, { left: '10px', top: '0', width: '440px', height: '1600px' });
      const id = kind === 'second-step' ? 'contact-company' : 'contact-name';
      document.querySelector<HTMLElement>(`[data-guidekit-id="${id}"]`)!.closest('label')!.style.top = '540px';
      if (kind === 'outer-clip') {
        // The target fits the inner scroller's own port. Its non-scrollable
        // ancestor clips that port, so the inner scroller must compensate.
        const clip = document.createElement('div'); clip.id = 'outer-clip';
        Object.assign(clip.style, { position: 'absolute', left: '40px', top: '100px', width: '550px', height: '250px', overflow: 'clip' });
        document.body.append(clip); clip.append(panel);
        Object.assign(panel.style, { top: '0', left: '0', height: '500px' });
        document.querySelector<HTMLElement>('[data-guidekit-id="contact-name"]')!.closest('label')!.style.top = '400px';
        document.querySelector<HTMLElement>('main')!.style.display = 'none';
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, layout);
}

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__guidekitScrollProbe;
    probe.frames = []; probe.running = true;
    const painted = (node: Element | null): boolean => {
      if (!node) return false;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const frame = (time: number) => {
      const root = document.querySelector('[data-guidekit-root]')?.shadowRoot;
      const card = root?.querySelector<HTMLElement>('[aria-label="Visual guidance"]');
      const mark = root?.querySelector('[data-gk-shape]') ?? null;
      const cursor = root?.querySelector('[data-gk-cursor]');
      probe.frames.push({ time, y: window.scrollY, panel: document.querySelector('#scroll-panel')?.scrollTop ?? 0, state: card?.dataset.gkScrollState ?? '', ink: painted(mark) && [...mark!.querySelectorAll('path[stroke-dashoffset]')].some(path => Number(path.getAttribute('stroke-dashoffset')) < 0.999), cursor: cursor && painted(cursor) ? cursor.getAttribute('data-gk-cursor-location') ?? '' : '', speech: probe.texts.length });
      if (probe.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function stopProbe(page: Page): Promise<Frame[]> {
  return page.evaluate(() => { const probe = (window as unknown as ProbeWindow).__guidekitScrollProbe; probe.running = false; return probe.frames; });
}

async function ask(page: Page) {
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Show me how to create a contact');
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(guide(page)).toBeVisible();
}

async function settled(page: Page, id = 'contact-name') {
  await expect(guide(page)).toHaveAttribute('data-gk-scroll-state', 'ready');
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target');
  await expect(shape(page)).toBeVisible();
  await expect.poll(() => target(page, id).evaluate(node => {
    const bounds = node.getBoundingClientRect(), panel = document.querySelector('#scroll-panel')?.getBoundingClientRect();
    return bounds.top >= Math.max(0, panel?.top ?? 0) && bounds.bottom <= Math.min(innerHeight, panel?.bottom ?? innerHeight) && bounds.left >= 0 && bounds.right <= innerWidth;
  })).toBe(true);
}

async function revealStarted(page: Page) {
  await expect(guide(page)).toHaveAttribute('data-gk-scroll-state', 'revealing');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

async function subsequentFrames(page: Page, count = 50): Promise<Frame[]> {
  await startProbe(page);
  await page.evaluate(count => new Promise<void>(resolve => {
    let remaining = count; const frame = () => { if (--remaining <= 0) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  }), count);
  return stopProbe(page);
}

function noLateScroll(frames: Frame[]) {
  expect(frames.length).toBeGreaterThan(20);
  expect(Math.max(...frames.map(frame => frame.y)) - Math.min(...frames.map(frame => frame.y)), 'A cancelled reveal does not resume later').toBeLessThan(1);
  expect(frames.some(frame => frame.ink), 'A cancelled reveal leaves no target ink').toBe(false);
}

test('a below-page target scrolls through intermediate positions before cursor arrival, ink and narration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, true); await arrange(page, 'window');
  await page.getByRole('button', { name: 'Read answers aloud using your browser', exact: true }).click();
  await startProbe(page);
  try {
    await ask(page); await settled(page);
    const frames = await stopProbe(page), moving = frames.filter(frame => frame.state === 'revealing');
    expect(moving.length).toBeGreaterThan(3);
    expect(new Set(moving.map(frame => Math.round(frame.y))).size, 'Scroll contains real intermediate positions').toBeGreaterThan(3);
    expect(moving.some(frame => frame.ink), 'Offscreen target is not painted during reveal').toBe(false);
    expect(moving.some(frame => frame.cursor === 'target'), 'Cursor waits for settled target geometry').toBe(false);
    expect(moving.some(frame => frame.speech > 0), 'Step narration waits for the target to settle').toBe(false);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__guidekitScrollProbe.texts.length)).toBe(1);
    const final = await target(page).boundingBox(); expect(final!.y).toBeGreaterThan(20);
    expect(final!.y + final!.height).toBeLessThan(900 - 20);
  } finally { await stopProbe(page); }
});

test('a target clipped by a nested overflow panel is revealed even when its page rectangle is in the viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'nested');
  const before = await target(page).boundingBox(); expect(before!.y).toBeGreaterThan(400); expect(before!.y + before!.height).toBeLessThan(900);
  await startProbe(page);
  try {
    await ask(page); await settled(page);
    const frames = await stopProbe(page), moving = frames.filter(frame => frame.state === 'revealing');
    expect(new Set(moving.map(frame => Math.round(frame.panel))).size).toBeGreaterThan(3);
    expect(moving.some(frame => frame.ink)).toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.locator('#scroll-panel').evaluate(node => node.scrollTop)).toBeGreaterThan(200);
  } finally { await stopProbe(page); }
});

test('the inner scroller compensates when a non-scrollable outer clipping ancestor hides its otherwise visible target', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'outer-clip');
  const before = await target(page).boundingBox(), inner = await page.locator('#scroll-panel').boundingBox(), outer = await page.locator('#outer-clip').boundingBox();
  expect(before!.y).toBeGreaterThan(outer!.y + outer!.height);
  expect(before!.y + before!.height).toBeLessThan(inner!.y + inner!.height);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
  await startProbe(page);
  try {
    await ask(page); await settled(page);
    const frames = await stopProbe(page), moving = frames.filter(frame => frame.state === 'revealing');
    expect(new Set(moving.map(frame => Math.round(frame.panel))).size).toBeGreaterThan(3);
    expect(moving.some(frame => frame.ink)).toBe(false);
    const after = await target(page).boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(outer!.y); expect(after!.y + after!.height).toBeLessThanOrEqual(outer!.y + outer!.height);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  } finally { await stopProbe(page); }
});

test('observed completion reveals the next field inside a panel locally without another inference or focus theft', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'second-step');
  const asks: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push(request.url()); });
  await ask(page); await settled(page); await target(page).fill('Scroll Test Name');
  await startProbe(page);
  try {
    await expect(guide(page).getByText('Step 2 of 4', { exact: true })).toBeVisible(); await settled(page, 'contact-company');
    const frames = await stopProbe(page);
    expect(new Set(frames.filter(frame => frame.state === 'revealing').map(frame => Math.round(frame.panel))).size).toBeGreaterThan(3);
    await expect(target(page)).toBeFocused(); expect(asks).toHaveLength(1); await expect(chat(page)).toBeHidden();
  } finally { await stopProbe(page); }
});

test('an already visible target keeps both host viewport and scroll panel still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'visible');
  await startProbe(page);
  try {
    await ask(page); await settled(page);
    const frames = await stopProbe(page);
    expect(frames.every(frame => frame.y === 0 && frame.panel === 0)).toBe(true);
    expect(frames.some(frame => frame.state === 'revealing')).toBe(false);
  } finally { await stopProbe(page); }
});

test('reduced motion reveals the target instantly without intermediate scrolling frames', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openFixture(page); await arrange(page, 'window');
  await startProbe(page);
  try {
    await ask(page); await settled(page);
    const frames = await stopProbe(page), positions = new Set(frames.map(frame => Math.round(frame.y)));
    expect(positions.size).toBeLessThanOrEqual(2); expect(await page.evaluate(() => scrollY)).toBeGreaterThan(4000);
    expect(frames.some(frame => frame.state === 'revealing')).toBe(false);
  } finally { await stopProbe(page); }
});

test('a trusted wheel gesture cancels reveal without fighting the visitor or painting the offscreen target', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'window');
  await ask(page); await revealStarted(page);
  await page.mouse.move(700, 420); await page.mouse.wheel(0, -180);
  await expect(guide(page)).toHaveAttribute('data-gk-scroll-state', 'interrupted');
  await page.evaluate(() => window.scrollBy({ top: -120, behavior: 'instant' }));
  noLateScroll(await subsequentFrames(page)); await expect(chat(page)).toBeHidden();
  await expect(guide(page).getByText('Step 1 of 4', { exact: true })).toBeVisible();
});

for (const cancellation of ['pause', 'chat', 'stop', 'Escape', 'destroy'] as const) test(`${cancellation} cancels active scrolling and leaves no late annotation`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'window');
  await ask(page); await revealStarted(page);
  if (cancellation === 'Escape') await page.keyboard.press('Escape');
  else if (cancellation === 'destroy') await page.evaluate(() => window.GuideKit.destroy());
  else {
    const name = { pause: 'Pause guide', chat: 'Open chat', stop: 'Stop visual guidance' }[cancellation];
    // Invoke the real UI control immediately; an actionability wait for a
    // moving card could otherwise let the reveal finish before cancellation.
    await guide(page).getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  }
  noLateScroll(await subsequentFrames(page));
  if (cancellation === 'destroy') await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  else if (cancellation === 'pause') await expect(guide(page).getByRole('button', { name: 'Resume guide', exact: true })).toBeVisible();
  else await expect(chat(page)).toBeVisible();
});

for (const interruption of ['pause', 'chat'] as const) test(`explicit Resume after ${interruption} restarts the cancelled reveal for the current step`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'window');
  const asks: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push(request.url()); });
  await ask(page); await revealStarted(page);
  await guide(page).getByRole('button', { name: interruption === 'pause' ? 'Pause guide' : 'Open chat', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  noLateScroll(await subsequentFrames(page, 30));
  const resume = interruption === 'pause' ? guide(page).getByRole('button', { name: 'Resume guide', exact: true }) : page.getByRole('button', { name: 'Resume guide', exact: true });
  await resume.click(); await settled(page);
  await expect(guide(page).getByText('Step 1 of 4', { exact: true })).toBeVisible(); expect(asks).toHaveLength(1); await expect(chat(page)).toBeHidden();
});

for (const mutation of ['private', 'changed label'] as const) test(`a ${mutation} target invalidated during reveal cancels scroll instead of using stale geometry`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'window');
  await ask(page); await revealStarted(page);
  await target(page).evaluate((node, kind) => node.setAttribute(kind === 'private' ? 'data-guidekit-private' : 'aria-label', kind === 'private' ? '' : 'Delete unrelated information'), mutation);
  noLateScroll(await subsequentFrames(page));
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
});

test('changing the step during a reveal cancels the old destination and presents the newly grounded control', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await arrange(page, 'window');
  const asks: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) asks.push(request.url()); });
  await ask(page); await revealStarted(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(guide(page).getByText('Step 2 of 4', { exact: true })).toBeVisible(); await settled(page, 'contact-company');
  await expect(shape(page)).toHaveAttribute('data-gk-mark', /contact-company/);
  const frames = await subsequentFrames(page, 30);
  expect(Math.max(...frames.map(frame => frame.y)) - Math.min(...frames.map(frame => frame.y))).toBeLessThan(1);
  expect(await page.evaluate(() => scrollY)).toBeLessThan(400); expect(asks).toHaveLength(1);
});
