import { test as base, expect, type Page } from '@playwright/test';
import type { RunResult } from '../../packages/contracts/src/index.js';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const toolbar = (page: Page) => guide(page).locator('.guide-toolbar');
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const instruction = (page: Page) => guide(page).locator('.guide-instruction');
const accessible = (page: Page) => guide(page).locator('.guide-instruction-accessible');
const longInstruction = 'Enter the full name you want to save for this contact. Take your time and check the spelling before continuing. The guide stays beside the field while you work, and it will move to the company field after you finish. You can pause, open chat, or show the complete instruction at any point. Nothing is submitted by this explanation; you stay in control of the contact details and the final save.';

interface CardFrame { text: string; accessible: string; typing: boolean; width: number; height: number; scroll: string; arrival: string; cursor: string; inkReady: boolean; step: string; stepOpacity: number; stepTransform: string; stepState: string; chrome?: { textHeight: number; lineHeight: number; outside: string[] }; }
interface CardProbe { frames: CardFrame[]; running: boolean; }
type ProbeWindow = Window & { __guidekitCardProbe: CardProbe };

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors); expect(errors, 'The instruction lifecycle raises no browser exception').toEqual([]);
  }, { auto: true }],
});

async function openFixture(page: Page, texts: string[], belowPage = false, singleStep = false) {
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
    run.steps = (singleStep ? run.steps.slice(0, 1) : run.steps).map((step, index) => ({ ...step, annotation: 'ring', text: texts[index] ?? 'Continue to this control.' }));
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

async function startProbe(page: Page, inspectChrome = false) {
  await page.evaluate(inspectChrome => {
    const probe = (window as unknown as ProbeWindow).__guidekitCardProbe;
    probe.frames = []; probe.running = true;
    const frame = () => {
      const root = document.querySelector('[data-guidekit-root]')?.shadowRoot;
      const card = root?.querySelector<HTMLElement>('[aria-label="Visual guidance"]');
      if (card && !card.hidden) {
        const bounds = card.getBoundingClientRect();
        let chrome: CardFrame['chrome'];
        if (inspectChrome) {
          const controls = card.querySelector<HTMLElement>('.guide-toolbar')!, controlBounds = controls.getBoundingClientRect();
          const pause = controls.querySelector<HTMLElement>('[aria-label="Pause guide"]')!;
          const range = document.createRange(); range.selectNodeContents(pause);
          const outside = [...controls.querySelectorAll<HTMLElement>('button')].filter(button => !button.hidden).flatMap(button => {
            const control = button.getBoundingClientRect();
            return control.left < controlBounds.left - 1 || control.right > controlBounds.right + 1 || control.top < controlBounds.top - 1 || control.bottom > controlBounds.bottom + 1 ? [button.getAttribute('aria-label') ?? button.textContent ?? ''] : [];
          });
          chrome = { textHeight: range.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(pause).lineHeight), outside };
        }
        const label = card.querySelector<HTMLElement>('.guide-label')!;
        const paths = [...root!.querySelectorAll('[data-gk-shape] path[stroke-dashoffset]')];
        probe.frames.push({ text: card.querySelector('.guide-instruction')?.textContent ?? '', accessible: card.querySelector('.guide-instruction-accessible')?.textContent ?? '', typing: card.dataset.gkTyping === 'true', width: bounds.width, height: bounds.height, scroll: card.dataset.gkScrollState ?? '', arrival: card.dataset.gkArrival ?? '', cursor: root?.querySelector('[data-gk-cursor]')?.getAttribute('data-gk-cursor-location') ?? '', inkReady: paths.length > 0 && paths.every(path => Number(path.getAttribute('stroke-dashoffset')) <= .001), step: label.textContent ?? '', stepOpacity: Number(getComputedStyle(label).opacity), stepTransform: getComputedStyle(label).transform, stepState: card.dataset.gkStepState ?? '', ...(chrome ? { chrome } : {}) });
      }
      if (probe.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, inspectChrome);
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
  await expect(guide(page).getByRole('button', { name: /^(Back|Next|Finish guide|Automatic progress|Auto)$/ })).toHaveCount(0);
}

async function finished(page: Page, text: string) {
  await expect(instruction(page)).toHaveText(text, { timeout: 20_000 });
  await expect(guide(page)).toHaveAttribute('data-gk-typing', 'false');
}

interface LetterWrite { text: string; at: number; }
interface LetterProbe { writes: LetterWrite[]; measurements: number[]; stalledFor: number; dispose: () => void; }
type LetterWindow = Window & { __gkLetterProbe?: LetterProbe };

async function observeLetters(page: Page, stall: boolean) {
  await page.evaluate(stall => {
    const probe: LetterProbe = { writes: [], measurements: [], stalledFor: 0, dispose() {} };
    (window as LetterWindow).__gkLetterProbe = probe;
    const native = HTMLElement.prototype.getBoundingClientRect, descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    HTMLElement.prototype.getBoundingClientRect = function() {
      if (this.classList.contains('guide-measure')) probe.measurements.push(performance.now());
      return native.call(this);
    };
    let previous = '';
    const root = document.querySelector('[data-guidekit-root]')!.shadowRoot!;
    const observer = new MutationObserver(() => {
      const text = root.querySelector('.guide-instruction')?.textContent ?? '';
      if (text === previous) return;
      previous = text; probe.writes.push({ text, at: performance.now() });
      if (stall && probe.writes.length === 10 && !probe.stalledFor) {
        // Deliberate bounded main-thread stall models a dropped animation
        // frame. The next RAF receives real elapsed time, not a mocked clock.
        const started = performance.now(); while (performance.now() - started < 240) { /* fixture-only stall */ }
        probe.stalledFor = performance.now() - started;
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    probe.dispose = () => { observer.disconnect(); if (descriptor) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', descriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect'); };
  }, stall);
}

for (const stall of [false, true]) test(`each actual text write adds one complete grapheme${stall ? ' after a dropped-frame gap' : ' at normal cadence'}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const text = 'Name 👩🏽‍💻 e\u0301 🇮🇳 — type every letter smoothly, then continue. Keep the contact spelling clear.';
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  await openFixture(page, [text]); await observeLetters(page, stall); await startProbe(page);
  try {
    await ask(page); await finished(page, text); await frames(page, 12);
    const measured = await page.evaluate(() => { const probe = (window as LetterWindow).__gkLetterProbe!; return { writes: probe.writes, measurements: probe.measurements, stalledFor: probe.stalledFor }; });
    let expected = '';
    expect(measured.writes).toHaveLength(graphemes.length);
    for (const [index, write] of measured.writes.entries()) { expected += graphemes[index]!; expect(write.text, 'Each committed prefix adds exactly one whole grapheme').toBe(expected); }
    if (stall) {
      expect(measured.stalledFor).toBeGreaterThanOrEqual(240);
      expect(measured.writes.some((write, index) => index > 0 && write.at - measured.writes[index - 1]!.at >= 230), 'The actual write trace includes the injected frame gap').toBe(true);
    }
    const during = measured.measurements.filter(at => at > measured.writes[3]!.at && at < measured.writes.at(-3)!.at);
    expect(during.length).toBeGreaterThan(5);
    expect(during.length, 'Geometry is measured less often than individual letter writes').toBeLessThan(measured.writes.length * .85);
    expect(during.slice(1).every((at, index) => at - during[index]! >= 35), 'Active typing coalesces layout independently from letter cadence').toBe(true);
    const samples = await stopProbe(page);
    expect(new Set(samples.map(sample => Math.round(sample.width))).size).toBeGreaterThan(5);
    expect(samples.every(sample => sample.width <= 320 && sample.height <= 876), 'The animated label remains bounded during individual-letter growth').toBe(true);
  } finally {
    await stopProbe(page); await page.evaluate(() => { const state = window as LetterWindow; state.__gkLetterProbe?.dispose(); delete state.__gkLetterProbe; });
  }
});

test('real intermediate instruction prefixes grow a compact amber label after cursor and mark arrival', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openFixture(page, [longInstruction]); await startProbe(page);
  try {
    await ask(page); await finished(page, longInstruction); await frames(page, 12);
    const captured = await stopProbe(page), samples = captured.filter(sample => sample.text.length > 0);
    const prefixes = samples.filter(sample => sample.typing && sample.text.length < longInstruction.length);
    expect(new Set(prefixes.map(sample => sample.text)).size, 'Text is revealed through real intermediate prefixes').toBeGreaterThan(5);
    expect(prefixes.every(sample => longInstruction.startsWith(sample.text))).toBe(true);
    const pending = captured.filter(sample => sample.arrival === 'pending');
    expect(pending.length, 'Observe the real flight and mark-drawing phase').toBeGreaterThan(3);
    expect(pending.every(sample => !sample.text && !sample.typing), 'No prefix starts before actual cursor and mark arrival').toBe(true);
    expect(prefixes.every(sample => sample.arrival === 'ready' && sample.cursor === 'target' && sample.inkReady), 'The cursor has landed and target strokes are complete before any typed prefix').toBe(true);
    expect(Math.max(...samples.map(sample => sample.width)) - Math.min(...samples.map(sample => sample.width)), 'Revealed content grows the compact card width').toBeGreaterThan(15);
    expect(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height)), 'Wrapped content grows the card height').toBeGreaterThan(30);
    expect(new Set(samples.map(sample => Math.round(sample.width))).size, 'The card travels through intermediate widths').toBeGreaterThan(4);
    const style = await guide(page).locator('.guide-surface').evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, background: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, text: getComputedStyle(node.querySelector('.guide-instruction')!).color }));
    const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const solid = rgb(style.background), gradient = [...style.image.matchAll(/rgba?\(([^)]+)\)/g)].map(match => rgb(match[0]));
    const paint = (solid[3] ?? 1) > 0 ? [solid] : gradient;
    expect(style.shadow).not.toBe('none'); expect(paint.length, 'The label has an actual painted surface, including gradient backgrounds').toBeGreaterThan(0);
    expect(paint.every(([r, g, b, alpha = 1]) => alpha >= .95 && r! > g! && g! > b! && r! >= 240), 'Every painted stop is opaque warm amber, rather than a transparent or white card').toBe(true);
    const luminance = (channels: number[]) => channels.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [ .2126, .7152, .0722 ][index]!, 0);
    const ink = luminance(rgb(style.text));
    expect(paint.every(color => { const surface = luminance(color); return (Math.max(ink, surface) + .05) / (Math.min(ink, surface) + .05) >= 4.5; }), 'Instruction text remains readable against every actual gradient stop').toBe(true);
    const textStyle = await instruction(page).evaluate(node => ({ font: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight), transform: getComputedStyle(node).transform }));
    expect(textStyle.font).toBeGreaterThanOrEqual(12); expect(textStyle.line).toBeGreaterThanOrEqual(textStyle.font * 1.4); expect(textStyle.transform).toBe('none');
    expect(Math.max(...samples.map(sample => sample.width))).toBeLessThanOrEqual(320);
    await expect(guide(page).locator('.guide-progress')).toHaveCount(0);
    const screenshot = test.info().outputPath('adaptive-guide-card-desktop.png');
    await page.screenshot({ path: screenshot });
    await test.info().attach('Adaptive guide card', { path: screenshot, contentType: 'image/png' });
  } finally { await stopProbe(page); }
});

test('compact instructions stay smaller and a 320px viewport contains long unbroken text and every control', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const unbroken = 'A'.repeat(440);
  await openFixture(page, ['Enter your name.', unbroken]);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) requests.push(request.url()); });
  await ask(page); await finished(page, 'Enter your name.');
  const compact = await guide(page).boundingBox();
  await startProbe(page);
  await page.locator('[data-guidekit-id="contact-name"]').fill('Observed Card Name');
  await expect(guide(page).getByText('Step 2 of 4', { exact: true })).toBeVisible(); await finished(page, unbroken); await frames(page, 12);
  await expect(guide(page).locator('.guide-step-number')).toHaveText('2');
  const stepFrames = (await stopProbe(page)).filter(sample => sample.step === 'Step 2 of 4');
  expect(stepFrames.some(sample => sample.stepOpacity > 0 && sample.stepOpacity < 1), 'The actual step label has intermediate opacity after observed progress').toBe(true);
  expect(new Set(stepFrames.filter(sample => sample.stepTransform !== 'none').map(sample => sample.stepTransform)).size, 'The actual step label moves through intermediate transforms').toBeGreaterThan(2);
  expect(stepFrames.some(sample => sample.stepState === 'presented')).toBe(true);
  expect(requests, 'Advancing to the next field stays local after the single initial model request').toHaveLength(1);
  const long = await guide(page).boundingBox();
  expect(long!.height).toBeGreaterThan(compact!.height + 25);
  expect(long!.x).toBeGreaterThanOrEqual(0); expect(long!.x + long!.width).toBeLessThanOrEqual(320);
  expect(long!.y).toBeGreaterThanOrEqual(0); expect(long!.y + long!.height).toBeLessThanOrEqual(740);
  const overflow = await guide(page).evaluate(node => ({ card: node.querySelector('.guide-surface')!.scrollWidth - node.querySelector('.guide-surface')!.clientWidth, text: node.querySelector('.guide-instruction')!.scrollWidth - node.querySelector('.guide-instruction')!.clientWidth }));
  expect(overflow.card).toBeLessThanOrEqual(1); expect(overflow.text).toBeLessThanOrEqual(1);
  const strip = await toolbar(page).boundingBox();
  for (const label of ['Pause guide', 'Open chat', 'Stop visual guidance']) {
    const control = guide(page).getByRole('button', { name: label, exact: true }); await expect(control).toBeInViewport({ ratio: 1 });
    const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(strip!.x); expect(box!.x + box!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
  }
});

test('a one-step guide separates its compact label from its keyboard controls without wizard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const text = 'Enter your name.';
  await openFixture(page, [text], false, true); await startProbe(page, true);
  try {
    await ask(page); await finished(page, text);
    await expect(guide(page).getByRole('button', { name: 'Pause guide', exact: true })).toBeVisible();
    const samples = (await stopProbe(page)).filter(sample => sample.typing && sample.text.length > 0);
    expect(samples.some(sample => sample.text.length < 7), 'Observe the short initial prefix, before full text can widen the card').toBe(true);
    expect(samples.every(sample => sample.chrome && Number.isFinite(sample.chrome.lineHeight) && sample.chrome.textHeight <= sample.chrome.lineHeight + 1), 'The actual Pause text range occupies at most one line during typing').toBe(true);
    expect(samples.flatMap(sample => sample.chrome?.outside ?? []), 'The real controls stay within their independent strip throughout typing').toEqual([]);
    const label = await guide(page).boundingBox(), strip = await toolbar(page).boundingBox();
    expect(Math.min(label!.x + label!.width, strip!.x + strip!.width) - Math.max(label!.x, strip!.x) <= 0 || Math.min(label!.y + label!.height, strip!.y + strip!.height) - Math.max(label!.y, strip!.y) <= 0, 'The controls do not occupy or obscure the instruction label').toBe(true);
  } finally { await stopProbe(page); }
});

test('a 180px visual viewport keeps real Pause, Resume, chat and stop controls reachable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openFixture(page, Array(4).fill(longInstruction) as string[]);
  await page.locator('[data-guidekit-id="contact-name"]').evaluate(node => { (node.closest('label') as HTMLElement).style.top = '-20px'; });
  await ask(page); await finished(page, longInstruction);
  // A short visual viewport models the space remaining above an on-screen
  // keyboard; it deliberately does not claim physical mobile-keyboard testing.
  await page.setViewportSize({ width: 320, height: 180 });
  await expect.poll(async () => {
    const boxes = await Promise.all([guide(page).boundingBox(), toolbar(page).boundingBox()]);
    return boxes.every(bounds => !!bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 180);
  }).toBe(true);
  const traversal: { key: string; focused: string }[] = [];
  const tabTo = async (name: string, key: 'Tab' | 'Shift+Tab' = 'Tab') => {
    const control = guide(page).getByRole('button', { name, exact: true });
    // Native overflow containers can be keyboard stops in their own right.
    // Follow actual focus instead of guessing a fixed number of Tab presses.
    for (let index = 0; index < 16 && !await control.evaluate(node => node.getRootNode() instanceof ShadowRoot && (node.getRootNode() as ShadowRoot).activeElement === node); index++) {
      await page.keyboard.press(key);
      traversal.push({ key, focused: await page.evaluate(() => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active?.getAttribute('aria-label') ?? (active instanceof HTMLButtonElement ? active.textContent ?? '' : active?.className || active?.tagName || 'none');
      }) });
    }
    await expect(control, `Keyboard traversal: ${JSON.stringify(traversal)}`).toBeFocused();
  };
  const visibleFocusedControl = async (name: string) => {
    const control = guide(page).getByRole('button', { name, exact: true }); await expect(control).toBeFocused();
    await expect.poll(() => control.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight, nativeScroll = false, scrolled = false;
      for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, box.left + ancestor.clientLeft); right = Math.min(right, box.left + ancestor.clientLeft + ancestor.clientWidth); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, box.top + ancestor.clientTop); bottom = Math.min(bottom, box.top + ancestor.clientTop + ancestor.clientHeight); }
        if (/auto|scroll/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 1) { nativeScroll = true; scrolled ||= ancestor.scrollTop > 0; }
      }
      return { visible: bounds.left >= left - 1 && bounds.right <= right + 1 && bounds.top >= top - 1 && bounds.bottom <= bottom + 1, nativeScroll, scrolled };
    }), 'The focused control is visibly inside every clipping ancestor, whether the card fits or scrolls').toMatchObject({ visible: true });
  };
  await guide(page).getByRole('button', { name: 'Open chat', exact: true }).focus();
  await tabTo('Pause guide', 'Shift+Tab'); await visibleFocusedControl('Pause guide');
  await page.keyboard.press('Enter'); await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  await visibleFocusedControl('Resume guide');
  await page.keyboard.press('Enter'); await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  await tabTo('Open chat'); await visibleFocusedControl('Open chat');
  await tabTo('Stop visual guidance'); await visibleFocusedControl('Stop visual guidance');
  await page.keyboard.press('Enter'); await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await test.info().attach('Short-viewport keyboard traversal', { body: JSON.stringify(traversal, null, 2), contentType: 'application/json' });
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
    await expect(accessible(page)).toContainText(longInstruction); await expect(accessible(page)).toContainText('Step 1 of 4'); await expect(accessible(page)).toHaveAttribute('aria-live', 'polite');
    const announcement = await accessible(page).textContent();
    await expect(accessible(page)).toHaveAttribute('aria-atomic', 'true'); await expect(instruction(page)).toHaveAttribute('aria-hidden', 'true');
    expect(await instruction(page).getAttribute('aria-live')).toBeNull();
    await guide(page).getByRole('button', { name: 'Show full instruction', exact: true }).click();
    await finished(page, longInstruction); await frames(page);
    const samples = await stopProbe(page);
    expect(samples.filter(sample => sample.typing).length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.accessible === announcement), 'The live region never streams individual prefixes').toBe(true);
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
    await page.locator('[data-guidekit-id="contact-name"]').fill('Reduced Motion Name');
    await expect(guide(page).getByText('Step 2 of 4', { exact: true })).toBeVisible(); await finished(page, 'Continue to this control.');
    expect(await guide(page).locator('.guide-label').evaluate(node => ({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform }))).toEqual({ opacity: '1', transform: 'none' });
    expect(await guide(page).evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  } finally { await stopProbe(page); }
});

test('host geometry and same-step observation refreshes do not restart an instruction or create another request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, [longInstruction]);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) requests.push(request.url()); });
  await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true'); await startProbe(page);
  try {
    await page.locator('[data-guidekit-id="contact-name"]').evaluate(node => { (node as HTMLElement).style.transform = 'translateX(15px)'; window.dispatchEvent(new Event('resize')); });
    await finished(page, longInstruction); await frames(page, 15);
    const samples = await stopProbe(page), lengths = samples.map(sample => sample.text.length);
    expect(lengths.every((length, index) => index === 0 || length >= lengths[index - 1]!), 'A same-step refresh never clears or retypes its prefix').toBe(true);
    expect(samples.every(sample => longInstruction.startsWith(sample.text))).toBe(true); expect(requests).toHaveLength(1);
    const settled = await guide(page).evaluate(async node => {
      let mutations = 0; const before = node.getBoundingClientRect();
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(node, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-gk-typing'] });
      await new Promise<void>(resolve => { let remaining = 40; const frame = () => { if (--remaining <= 0) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
      observer.disconnect(); const after = node.getBoundingClientRect();
      return { mutations, movement: Math.max(Math.abs(before.left - after.left), Math.abs(before.top - after.top), Math.abs(before.width - after.width), Math.abs(before.height - after.height)) };
    });
    expect(settled.mutations, 'A stationary label neither retypes nor rewrites its DOM in a render loop').toBe(0);
    expect(settled.movement).toBeLessThan(1);
  } finally { await stopProbe(page); }
});

test('rapid steps replace the old typewriter, and pause, chat, resume and destroy leave no hidden typing work', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const second = `Company instruction. ${longInstruction}`, third = `Status instruction. ${longInstruction}`;
  await openFixture(page, [longInstruction, second, third]); await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-typing', 'true');
  // Public host result reports model two real asynchronous host completions;
  // this explicit fixture never calls or mutates the internal guidance session.
  await page.evaluate(() => {
    window.GuideKit.reportStepResult('contact-name', { success: true, message: 'The synthetic host verified the name.' });
    window.GuideKit.reportStepResult('contact-company', { success: true, message: 'The synthetic host verified the company.' });
  });
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
    expect(scrolling.every(sample => sample.stepState === 'pending' && sample.stepOpacity === 0), 'The step label reveal also waits until scrolling finishes').toBe(true);
    expect(samples.some(sample => sample.scroll === 'ready' && sample.typing && sample.text.length > 0)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(4000);
  } finally { await stopProbe(page); }
});

test('hiding during the first cursor flight restores the arrived label without replay or another model request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, [longInstruction]);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) requests.push(request.url()); });
  try {
    await ask(page); await expect(guide(page)).toHaveAttribute('data-gk-arrival', 'pending');
    await expect(page.locator('[data-guidekit-root] [data-gk-cursor]')).toHaveAttribute('data-gk-cursor-location', 'flight');
    // This deterministic visibility fixture is not a claim that Chromium was
    // physically backgrounded by an operating-system window manager.
    await page.evaluate(() => {
      const hidden = Object.getOwnPropertyDescriptor(document, 'hidden'), state = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      (window as Window & { __gkRestoreVisibility?: () => void }).__gkRestoreVisibility = () => {
        if (hidden) Object.defineProperty(document, 'hidden', hidden); else Reflect.deleteProperty(document, 'hidden');
        if (state) Object.defineProperty(document, 'visibilityState', state); else Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
      };
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await frames(page, 20); await expect(guide(page)).toHaveAttribute('data-gk-arrival', 'pending');
    expect(await guide(page).locator('.guide-surface').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
    await startProbe(page);
    await page.evaluate(() => (window as Window & { __gkRestoreVisibility?: () => void }).__gkRestoreVisibility?.());
    await expect(guide(page)).toHaveAttribute('data-gk-arrival', 'ready', { timeout: 10_000 });
    await finished(page, longInstruction); await frames(page, 12);
    const recovered = (await stopProbe(page)).filter(sample => sample.arrival === 'ready');
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.every(sample => sample.text === longInstruction && !sample.typing), 'The suspended instruction recovers in full without a typewriter replay').toBe(true);
    expect(requests).toHaveLength(1);
    await toolbar(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click();
    await expect(guide(page)).toHaveCount(0); await expect(page.locator('[data-guidekit-root] [data-gk-step-badge]')).toHaveCount(0);
  } finally {
    await stopProbe(page);
    await page.evaluate(() => { const state = window as Window & { __gkRestoreVisibility?: () => void }; state.__gkRestoreVisibility?.(); delete state.__gkRestoreVisibility; });
  }
});

test('independent rings and step badges stay beside unobscured controls on desktop and mobile edges', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page, ['Enter the contact name here.'], false, true);
  const layouts = [{ width: 1280, height: 900, mobile: false }, { width: 320, height: 600, mobile: true }];
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.evaluate(mobile => {
      const name = document.querySelector<HTMLElement>('[data-guidekit-id="contact-name"]')!.closest('label')! as HTMLElement;
      const company = document.querySelector<HTMLElement>('[data-guidekit-id="contact-company"]')!.closest('label')! as HTMLElement;
      Object.assign(name.style, { left: mobile ? '70px' : '0', top: '100px' });
      // On desktop, this known field occupies the preferred right-hand label
      // slot. On mobile, keep it below the active field near the right edge.
      Object.assign(company.style, { left: mobile ? '0' : '260px', top: mobile ? '340px' : '100px' });
      document.querySelector<HTMLElement>('[data-guidekit-id="contact-status"]')!.closest('label')!.style.top = mobile ? '440px' : '300px';
      document.querySelector<HTMLElement>('[data-guidekit-id="create-contact"]')!.style.top = mobile ? '540px' : '400px';
    }, layout.mobile);
    await ask(page); await finished(page, 'Enter the contact name here.'); await frames(page, 12);
    const ring = page.locator('[data-guidekit-root] [data-gk-shape="ring"]'), badge = page.locator('[data-guidekit-root] [data-gk-step-badge][data-gk-step-number="1"]');
    await expect(ring).toBeVisible(); await expect(badge).toBeVisible(); await expect(badge).toContainText('1'); await expect(badge).toBeInViewport({ ratio: 1 });
    expect(await badge.evaluate(node => getComputedStyle(node).pointerEvents), 'The badge cannot consume the visitor’s clicks').toBe('none');
    expect(await ring.evaluate(node => !!node.querySelector('[data-gk-step-badge]')), 'The requested ring remains independent of its numbered badge').toBe(false);
    const geometry = await guide(page).evaluate(node => {
      const label = node.getBoundingClientRect(), toolbar = node.querySelector('.guide-toolbar')!.getBoundingClientRect();
      const overlap = (first: DOMRect, second: DOMRect) => Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left)) * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      const obstacles = [...document.querySelectorAll<HTMLElement>('[data-guidekit-id]')].filter(control => control.getClientRects().length && !control.closest('[data-guidekit-private]')).filter(control => { const box = control.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth; });
      const target = document.querySelector('[data-guidekit-id="contact-name"]')!.getBoundingClientRect();
      return { overlaps: obstacles.filter(control => overlap(label, control.getBoundingClientRect()) > 1 || overlap(toolbar, control.getBoundingClientRect()) > 1).map(control => control.dataset.guidekitId), gap: Math.hypot(Math.max(0, target.left - label.right, label.left - target.right), Math.max(0, target.top - label.bottom, label.top - target.bottom)), labelInside: label.left >= 0 && label.right <= innerWidth && label.top >= 0 && label.bottom <= innerHeight };
    });
    expect(geometry.overlaps, 'Instruction and controls leave active and nearby known controls usable').toEqual([]);
    expect(geometry.gap, 'The instruction remains adjacent to its grounded target').toBeLessThan(90); expect(geometry.labelInside).toBe(true);
    await toolbar(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click(); await expect(chat(page)).toBeVisible();
  }
});

test('mobile essential feedback moves its full panel and controls away from the active retry target', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openFixture(page, ['Retry the import.'], false, true);
  const failure = 'Import failed. Please retry the import.';
  await page.evaluate(message => {
    const previous = document.querySelector('[data-guidekit-id="contact-name"]')!;
    const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.guidekitId = 'contact-name'; retry.textContent = 'Retry import'; retry.setAttribute('aria-label', 'Retry import');
    Object.assign(retry.style, { position: 'fixed', left: '170px', top: '625px', width: '130px', height: '30px' });
    retry.addEventListener('click', () => window.GuideKit.reportStepResult('contact-name', { success: false, message }));
    previous.replaceWith(retry);
  }, failure);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/embed/session/ask')) requests.push(request.url()); });
  await ask(page); await finished(page, 'Retry the import.');
  await page.getByRole('button', { name: 'Retry import', exact: true }).click();
  const assist = toolbar(page).locator('.guide-assist');
  await expect(assist).toBeVisible(); await expect(assist.getByRole('status')).toHaveText(failure);
  await expect(toolbar(page).getByRole('button', { name: 'Show guidance help', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => toolbar(page).evaluate(strip => {
    const panel = strip.querySelector('.guide-assist')!.getBoundingClientRect(), controls = strip.getBoundingClientRect(), target = document.querySelector('[data-guidekit-id="contact-name"]')!.getBoundingClientRect();
    const overlap = (box: DOMRect) => Math.max(0, Math.min(box.right, target.right) - Math.max(box.left, target.left)) * Math.max(0, Math.min(box.bottom, target.bottom) - Math.max(box.top, target.top));
    return { contained: [panel, controls].every(box => box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight), overlap: overlap(panel) + overlap(controls), topCorner: controls.top < innerHeight / 2 && panel.bottom < innerHeight / 2, targetUnmoved: target.top === 625 && target.bottom === 655 };
  }), 'Essential feedback reserves its entire visible footprint and leaves the retry control usable').toMatchObject({ contained: true, overlap: 0, topCorner: true, targetUnmoved: true });
  expect(requests, 'Local host attention does not trigger another model request').toHaveLength(1);
});
