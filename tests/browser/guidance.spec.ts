import { test as base, expect, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const quietWindow = 1_400;
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const nameField = (page: Page) => page.locator('[data-guidekit-id="contact-name"]');
const companyField = (page: Page) => page.locator('[data-guidekit-id="contact-company"]');
const annotation = (page: Page) => page.locator('[data-guidekit-root] [data-gk-annotation]');
const shape = (page: Page) => page.locator('[data-guidekit-root] [data-gk-shape]');
const cursor = (page: Page) => page.locator('[data-guidekit-root] [data-gk-cursor]');
async function noTargetMark(page: Page) {
  await expect(shape(page)).toHaveCount(0); await expect(page.locator('[data-guidekit-root] [data-gk-step-badge]')).toHaveCount(0); await expect(annotation(page)).toHaveCount(1);
}

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /content security policy|unsafe-eval/i.test(message.text())) errors.push(message.text()); });
    await use(errors); expect(errors, 'No browser exceptions or CSP violations').toEqual([]);
  }, { auto: true }],
});

async function step(page: Page, number: number) {
  await expect(guide(page).getByText(`Step ${number} of 4`, { exact: true })).toBeVisible();
}
async function askForGuide(page: Page) {
  if (await guide(page).isVisible()) await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  if (!await chat(page).isVisible()) await page.getByRole('button', { name: 'Open Observed guide', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Show me how to create a contact');
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const answered = await response; expect(answered.status()).toBe(200);
  await expect(guide(page)).toBeVisible(); await step(page, 1); await expect(chat(page)).toBeHidden();
  return answered;
}
async function openFixture(page: Page, adaptive = true) {
  if (!adaptive) await page.addInitScript(() => {
    document.addEventListener('guidekit:ready', event => {
      const api = (event as CustomEvent).detail.api as Window['GuideKit'], mount = api.mount;
      api.mount = options => mount({ ...options, journey: { enabled: false } });
    }, { once: true });
  });
  // This suite uses the existing explicit synthetic provider, not subscription inference.
  const auth = await page.request.post(`${endpoint}/api/auth/register`, { headers: { Origin: endpoint }, data: { email: `guidance-${crypto.randomUUID()}@example.test`, name: 'Guidance Tester', companyName: 'Observed Workspace', password: 'Synthetic-guidance-password-42' } });
  expect(auth.status()).toBe(201);
  const created = await page.request.post(`${endpoint}/api/agents`, { headers: { Origin: endpoint }, data: { name: 'Observed guide', companyName: 'Observed Workspace', allowedOrigins: [website], allowedActions: ['create_contact'] } });
  expect(created.status()).toBe(201); const { agent } = await created.json() as { agent: { id: string } };
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/documents`, { headers: { Origin: endpoint }, data: { title: 'CRM guide', content: 'Create a contact by entering a full name and company, choosing status, and submitting Create contact. New, Qualified and Customer are the supported statuses.' } })).status()).toBe(201);
  expect((await page.request.post(`${endpoint}/api/agents/${agent.id}/publish`, { headers: { Origin: endpoint }, data: {} })).status()).toBe(201);
  await page.goto(`${website}/?agentId=${encodeURIComponent(agent.id)}`);
  await page.getByRole('button', { name: 'Open Observed guide', exact: true }).click();
  await expect(chat(page)).toBeVisible();
}
async function observeFieldsToSubmit(page: Page) {
  // The guide follows trusted host edits rather than a navigation control or
  // a call into its private session. Each field remains under visitor control.
  await nameField(page).fill('Observed Host Name'); await step(page, 2);
  await companyField(page).fill('Observed Host Company'); await step(page, 3);
  const status = page.locator('[data-guidekit-id="contact-status"]');
  await status.focus(); await status.press('q');
  await expect(status).toHaveValue('Qualified'); await step(page, 4);
}
async function noManualNavigation(page: Page) {
  await expect(guide(page).getByRole('button', { name: /^(Back|Next|Finish guide|Automatic progress)$/ })).toHaveCount(0);
}

test('observed input moves the guide without stealing focus, and only verified host save completes it', async ({ page }) => {
  await openFixture(page);
  const requests: { url: string; body: string }[] = [];
  page.on('request', request => { if (request.url().includes('/api/embed/')) requests.push({ url: request.url(), body: request.postData() ?? '' }); });
  await page.locator('input[name="email"]').fill('private-guidance-marker@example.test');
  await askForGuide(page);
  await noManualNavigation(page);
  await nameField(page).click();
  await nameField(page).fill('Observed Name Private Marker');
  await page.waitForTimeout(900); await step(page, 1);
  await step(page, 2); await expect(nameField(page)).toBeFocused();
  await expect(chat(page)).toBeHidden();
  await companyField(page).click();
  await companyField(page).fill('Observed Company Private Marker');
  await step(page, 3); await expect(companyField(page)).toBeFocused();
  const status = page.locator('[data-guidekit-id="contact-status"]');
  // Native type-ahead emits trusted input/change on macOS and avoids a native
  // popup. selectOption() deliberately emits synthetic events in Playwright.
  await status.focus(); await status.press('q');
  await expect(status).toHaveValue('Qualified'); await step(page, 4); await expect(status).toBeFocused();
  // A real trusted button click is insufficient. This explicit fixture blocks
  // one form submission so no verified host report can complete the guide.
  await page.locator('#contact-form').evaluate(form => form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, once: true }));
  await page.locator('[data-guidekit-id="create-contact"]').click();
  await page.waitForTimeout(quietWindow); await step(page, 4);
  await expect(page.locator('#contacts-list tr')).toHaveCount(0); await expect(chat(page)).toBeHidden();
  await page.locator('[data-guidekit-id="create-contact"]').click();
  await expect(page.locator('#contacts-list tr')).toHaveCount(1);
  await expect(page.locator('#form-result')).toContainText('created and verified');
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.locator('#contacts-list')).toContainText('Observed Name Private Marker');
  expect(requests.filter(request => request.url.endsWith('/api/embed/session/ask'))).toHaveLength(1);
  expect(requests.filter(request => request.url.endsWith('/action-result'))).toHaveLength(0);
  expect(JSON.stringify(requests)).not.toMatch(/Observed Name Private Marker|Observed Company Private Marker|private-guidance-marker/);
});

test('a visitor can keep a native select default by tabbing onward, while focus, guide controls and invalid values do not accept it', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
  await nameField(page).fill('Default Selection Name'); await step(page, 2);
  await companyField(page).fill('Default Selection Company'); await step(page, 3);
  const status = page.locator('[data-guidekit-id="contact-status"]');
  const submit = page.locator('[data-guidekit-id="create-contact"]');
  await expect(status).toHaveValue('New'); await noManualNavigation(page);

  // Focusing the current selection does not mean the visitor accepted it.
  await status.focus(); await page.waitForTimeout(quietWindow); await step(page, 3);
  await guide(page).getByRole('button', { name: 'Pause guide', exact: true }).click();
  await page.waitForTimeout(quietWindow); await step(page, 3);
  await guide(page).getByRole('button', { name: 'Resume guide', exact: true }).click();
  await page.waitForTimeout(quietWindow); await step(page, 3);
  await status.focus();
  await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(chat(page)).toBeVisible(); await expect(guide(page)).toBeHidden();
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
  await page.waitForTimeout(quietWindow); await step(page, 3);

  // Native and host-declared invalidity both block acceptance even when the
  // visitor deliberately tabs to the next real page control.
  await status.evaluate(select => (select as HTMLSelectElement).setCustomValidity('Choose a valid status.'));
  await status.focus(); await status.press('Tab'); await expect(submit).toBeFocused();
  expect(await status.evaluate(select => (select as HTMLSelectElement).validity.valid)).toBe(false);
  await page.waitForTimeout(quietWindow); await step(page, 3);
  await status.evaluate(select => { (select as HTMLSelectElement).setCustomValidity(''); select.setAttribute('aria-invalid', 'true'); });
  await status.focus(); await status.press('Tab'); await expect(submit).toBeFocused();
  await page.waitForTimeout(quietWindow); await step(page, 3);

  await status.evaluate(select => select.removeAttribute('aria-invalid'));
  await status.focus(); await page.waitForTimeout(quietWindow); await step(page, 3);
  await status.press('Tab'); await step(page, 4); await expect(submit).toBeFocused();
  await expect(status).toHaveValue('New'); await noManualNavigation(page);
  await expect(page.locator('#contacts-list tr')).toHaveCount(0);
  await submit.click();
  await expect(page.locator('#contacts-list tr')).toHaveCount(1);
  await expect(page.locator('#contacts-list')).toContainText('Default Selection Name');
  await expect(page.locator('#contacts-list .status-pill')).toHaveText('New');
  await expect(page.locator('#form-result')).toContainText('created and verified');
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
});

test('guidance follows edits automatically while pause, resume and stop stay under visitor control', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
  await noManualNavigation(page);
  await guide(page).getByRole('button', { name: 'Pause guide', exact: true }).click();
  await nameField(page).fill('Paused Name'); await page.waitForTimeout(quietWindow); await step(page, 1);
  await guide(page).getByRole('button', { name: 'Resume guide', exact: true }).click();
  await step(page, 2);
  // The visitor moved focus to Resume. Automatic progression keeps it on that
  // same header button (now Pause), rather than returning to a previous field.
  await expect(guide(page).getByRole('button', { name: 'Pause guide', exact: true })).toBeFocused();
  await companyField(page).fill('Automatic Company'); await step(page, 3);
  const status = page.locator('[data-guidekit-id="contact-status"]');
  await status.focus(); await status.press('q'); await expect(status).toHaveValue('Qualified'); await step(page, 4);
  await noManualNavigation(page);
  // Correcting an earlier field restores attention there, then returns to the
  // unfinished save control without Back or Next and without creating a record.
  await companyField(page).fill('Revised Automatic Company'); await step(page, 2);
  await step(page, 4); await expect(companyField(page)).toBeFocused();
  await guide(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click();
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.locator('#contacts-list tr')).toHaveCount(0);
});

test('empty, native-invalid, aria-invalid and script-generated field changes do not advance', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
  await nameField(page).fill(''); await page.waitForTimeout(quietWindow); await step(page, 1);
  await nameField(page).evaluate(input => input.setAttribute('pattern', '[A-Z]+'));
  await nameField(page).fill('invalid lower case');
  expect(await nameField(page).evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
  await page.waitForTimeout(quietWindow); await step(page, 1);
  await nameField(page).evaluate(input => { input.removeAttribute('pattern'); input.setAttribute('aria-invalid', 'true'); });
  await nameField(page).fill('Aria Invalid Name'); await page.waitForTimeout(quietWindow); await step(page, 1);
  await nameField(page).evaluate(input => { input.removeAttribute('aria-invalid'); (input as HTMLInputElement).value = 'Script Generated Name'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(quietWindow); await step(page, 1);
  await nameField(page).fill('Valid Human Name'); await step(page, 2);
});

test('trusted IME composition stays pending, continued typing defers progress, and earlier edits restore attention', async ({ page, context }) => {
  await openFixture(page); await askForGuide(page);
  await nameField(page).focus();
  const cdp = await context.newCDPSession(page);
  try {
    // Chromium IME protocol produces trusted composition/input events, unlike
    // dispatchEvent(), which the guidance engine intentionally ignores.
    await cdp.send('Input.imeSetComposition', { text: '山田', selectionStart: 2, selectionEnd: 2 });
    await expect(nameField(page)).toHaveValue('山田');
    await page.waitForTimeout(quietWindow); await step(page, 1);
    // CDP's commit emits an untrusted compositionend in Chromium. The real
    // commit branch is unit-tested; this browser check covers trusted composing
    // input and cancellation without pretending to simulate a physical IME.
    await guide(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click();
    await expect(chat(page)).toBeVisible();
  } finally { await cdp.detach(); }
  await askForGuide(page);
  await nameField(page).fill('Continued Name');
  await page.waitForTimeout(700);
  await nameField(page).pressSequentially(' Continued', { delay: 120 });
  await page.waitForTimeout(650); await step(page, 1);
  await step(page, 2); await expect(nameField(page)).toBeFocused();
  await nameField(page).pressSequentially(' Edit', { delay: 25 }); await step(page, 1);
  await step(page, 2); await expect(nameField(page)).toBeFocused();
  await companyField(page).fill('Earlier Edit Company'); await page.waitForTimeout(200);
  await nameField(page).focus(); await nameField(page).fill(''); await step(page, 1);
  await page.waitForTimeout(quietWindow); await step(page, 1);
  await expect(nameField(page)).toBeFocused();
  // The already-valid company remains completed when the earlier name is
  // revised, so automatic guidance resumes at the next unfinished control.
  await nameField(page).fill('Revised Name'); await step(page, 3); await expect(nameField(page)).toBeFocused();
});

test('with adaptive guidance disabled a stable ID recovers, and a lost target returns to chat after grace', async ({ page }) => {
  await openFixture(page, false); await askForGuide(page);
  await nameField(page).evaluate(input => {
    const parent = input.parentElement!, replacement = input.cloneNode(true); input.remove();
    setTimeout(() => parent.append(replacement), 350);
  });
  await expect(nameField(page)).toHaveCount(1); await page.waitForTimeout(500); await step(page, 1);
  await nameField(page).fill('Replacement Target'); await step(page, 2);
  await companyField(page).evaluate(input => input.remove());
  await page.waitForTimeout(500); await expect(guide(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.getByText('That control changed or is no longer visible. Ask again to refresh the guide.', { exact: true })).toBeVisible();
});

test('Open chat preserves a paused guide, while stop, Escape and destroy cancel pending observation', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
  await nameField(page).fill('Pending Open Chat');
  await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(guide(page)).toBeHidden(); await expect(chat(page)).toBeVisible();
  await page.waitForTimeout(quietWindow); await expect(guide(page)).toBeHidden();
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
  await expect(guide(page)).toBeVisible(); await step(page, 1); await expect(chat(page)).toBeHidden();
  await nameField(page).fill('Pending Stop');
  await guide(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click();
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await page.waitForTimeout(quietWindow); await expect(guide(page)).toHaveCount(0);
  await askForGuide(page);
  await nameField(page).fill('Pending Escape'); await page.keyboard.press('Escape');
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await page.waitForTimeout(quietWindow); await expect(guide(page)).toHaveCount(0);
  await askForGuide(page); await nameField(page).fill('Pending Destroy');
  await page.evaluate(() => window.GuideKit.destroy());
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  await page.waitForTimeout(quietWindow); await companyField(page).fill('After Destroy');
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  await expect(page.locator('#contacts-list tr')).toHaveCount(0);
});

test('a verified host result received while chat is open completes safely when the paused guide resumes', async ({ page }) => {
  await openFixture(page);
  await askForGuide(page); await observeFieldsToSubmit(page);
  await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(chat(page)).toBeVisible(); await expect(guide(page)).toBeHidden();
  // The real host validates and saves this fixture contact, then calls
  // reportStepResult while the guide is paused behind chat. No action receipt
  // or inference is involved in this explicit form-submission fixture.
  await page.locator('#contact-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(page.locator('#contacts-list tr')).toHaveCount(1);
  await expect(page.locator('#form-result')).toContainText('created and verified');
  await expect(chat(page)).toBeVisible(); await expect(guide(page)).toBeHidden();
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.getByRole('log')).toContainText('The website confirmed the result.');
  await page.waitForTimeout(quietWindow); await expect(guide(page)).toHaveCount(0);
});

test('a loading submit control can change meaning and disappear while its real host result is pending', async ({ page }) => {
  await openFixture(page);
  await askForGuide(page); await observeFieldsToSubmit(page);
  await page.locator('#contact-form').evaluate(form => form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, once: true }));
  await page.locator('[data-guidekit-id="create-contact"]').click();
  await page.locator('[data-guidekit-id="create-contact"]').evaluate(button => {
    button.textContent = 'Saving…'; button.setAttribute('hidden', '');
    // Model a host's asynchronous save with the actual demo form handler. That
    // handler persists and verifies the contact before reporting completion.
    setTimeout(() => (document.querySelector('#contact-form') as HTMLFormElement).requestSubmit(), 2_300);
  });
  await page.waitForTimeout(1_500); await expect(guide(page)).toBeVisible(); await expect(chat(page)).toBeHidden();
  await expect(page.locator('#contacts-list tr')).toHaveCount(0);
  await expect(page.locator('#contacts-list tr')).toHaveCount(1); await expect(page.locator('#form-result')).toContainText('created and verified');
  await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.getByRole('log')).toContainText('The website confirmed the result.');
});

async function annotationError(page: Page, targetId = 'contact-name'): Promise<number> {
  return page.evaluate(id => {
    const target = document.querySelector(`[data-guidekit-id="${id}"]`), mark = document.querySelector('[data-guidekit-root]')?.shadowRoot?.querySelector('[data-gk-shape]');
    if (!target || !mark || getComputedStyle(mark).visibility === 'hidden') return 999;
    const bounds = target.getBoundingClientRect(), actual = mark.getBoundingClientRect();
    const view = window.visualViewport, x = view?.offsetLeft ?? 0, y = view?.offsetTop ?? 0, width = view?.width ?? document.documentElement.clientWidth, height = view?.height ?? window.innerHeight;
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), value));
    // View supplies a 5px-expanded/clamped target; target corner geometry adds
    // another 5px. Measure coordinate error separately from authored padding.
    const left = clamp(bounds.left - 5, x + 3, x + width - 3), top = clamp(bounds.top - 5, y + 3, y + height - 3);
    const right = clamp(bounds.right + 5, left, x + width - 3), bottom = clamp(bounds.bottom + 5, top, y + height - 3);
    return Math.max(Math.abs(actual.left - (left - 5)), Math.abs(actual.top - (top - 5)), Math.abs(actual.right - (right + 5)), Math.abs(actual.bottom - (bottom + 5)));
  }, targetId);
}
async function frameIntervals(page: Page, durationMs: number): Promise<number[]> {
  return page.evaluate(duration => new Promise<number[]>(resolve => {
    const intervals: number[] = []; let previous: number | undefined, started: number | undefined;
    const frame = (now: number) => {
      started ??= now; if (previous !== undefined) intervals.push(now - previous); previous = now;
      if (now - started >= duration) resolve(intervals); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), durationMs);
}

test('retained SVG follows scroll, resize and an ancestor transform without blocking host clicks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1280, height: 760 });
  await openFixture(page);
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '900px'; document.body.append(spacer); });
  const firstFrames = frameIntervals(page, 1_500), response = await askForGuide(page); await response.finished();
  await expect(shape(page)).toBeVisible(); await expect(page.locator('[data-gk-cursor]')).toHaveCount(1);
  const root = await annotation(page).elementHandle(), retained = await shape(page).elementHandle();
  if (!root || !retained) throw new Error('The retained annotation surface was not mounted.');
  const cursor = page.locator('[data-gk-cursor]'), initialCursor = await cursor.getAttribute('transform');
  await expect.poll(() => cursor.getAttribute('transform')).not.toBe(initialCursor);
  const intervals = await firstFrames, alignment: number[] = [];
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2); alignment.push(await annotationError(page));
  expect(await annotation(page).evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  expect(await annotation(page).evaluate(node => [...node.querySelectorAll('*')].every(child => child.getAttribute('pointer-events') === 'none'))).toBe(true);
  await nameField(page).click(); await expect(nameField(page)).toBeFocused(); await step(page, 1);
  await page.evaluate(() => window.scrollTo(0, 80)); expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2); alignment.push(await annotationError(page));
  await page.locator('#contact-form').evaluate(async form => {
    form.style.transition = 'transform 600ms linear'; await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    form.style.transform = 'translate(-80px, 24px)'; await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  await expect.poll(() => page.locator('#contact-form').evaluate(form => form.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true);
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2); alignment.push(await annotationError(page));
  expect(await shape(page).evaluate((node, original) => node === original, retained)).toBe(true);
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2); alignment.push(await annotationError(page));
  const secondFrames = frameIntervals(page, 1_500);
  await nameField(page).fill('Retained Annotation Name'); await step(page, 2);
  intervals.push(...await secondFrames); await expect.poll(() => annotationError(page, 'contact-company')).toBeLessThan(1.2);
  alignment.push(await annotationError(page, 'contact-company'));
  expect(await annotation(page).evaluate((node, original) => node === original, root)).toBe(true);
  const ordered = [...intervals].sort((a, b) => a - b), percentile = (p: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))]!;
  expect(intervals.length).toBeGreaterThan(20);
  console.log(JSON.stringify({ fixture: 'synthetic-provider / Chromium / normal motion', rafSampleCount: intervals.length, rafP50Ms: Number(percentile(0.5).toFixed(2)), rafP95Ms: Number(percentile(0.95).toFixed(2)), maxSettledAlignmentErrorCssPx: Number(Math.max(...alignment).toFixed(3)), syntheticAskRoundTripMs: Number(response.request().timing().responseEnd.toFixed(2)) }));
  await guide(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click(); await noTargetMark(page);
  await page.waitForTimeout(1_600); await noTargetMark(page); await expect(chat(page)).toBeVisible();
  await root.dispose(); await retained.dispose();
});

test('reduced motion draws settled marks immediately and cancellation leaves no ghost annotation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openFixture(page);
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'docked'); await expect.poll(() => dockError(page)).toBeLessThan(1);
  const retained = await annotation(page).elementHandle(); if (!retained) throw new Error('The docked SVG was not mounted.');
  await askForGuide(page); await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target');
  expect(await annotation(page).evaluate((node, original) => node === original, retained)).toBe(true);
  await expect(shape(page)).toBeVisible(); await expect.poll(() => annotationError(page)).toBeLessThan(1.2);
  const offsets = await shape(page).locator('path[stroke-dashoffset]').evaluateAll(paths => paths.map(path => path.getAttribute('stroke-dashoffset')));
  expect(offsets.length).toBeGreaterThan(0); expect(offsets.every(offset => Number(offset) === 0)).toBe(true);
  const before = await nameField(page).boundingBox();
  // A host WAAPI transform emits no DOM mutation/transitionrun event. Reduced
  // assistant motion must still follow the actual host's moving geometry.
  await page.locator('#contact-form').evaluate(async form => { await form.animate([{ transform: 'none' }, { transform: 'translate(-40px, 16px)' }], { duration: 600, fill: 'forwards' }).finished; });
  const after = await nameField(page).boundingBox(); expect(before).not.toBeNull(); expect(after).not.toBeNull();
  expect(after!.x - before!.x).toBeCloseTo(-40, 1);
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2);
  await nameField(page).click(); await expect(nameField(page)).toBeFocused();
  await page.keyboard.press('Escape'); await noTargetMark(page); await expect(chat(page)).toBeVisible();
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'docked'); await expect.poll(() => dockError(page)).toBeLessThan(1);
  await page.waitForTimeout(2_700); await noTargetMark(page); await expect(guide(page)).toHaveCount(0); await retained.dispose();
});

for (const mutation of ['duplicate ID', 'changed label'] as const) test(`grounding rejects a ${mutation} instead of keeping a stale annotation`, async ({ page }) => {
  await openFixture(page, false); await askForGuide(page); await expect(shape(page)).toBeVisible();
  await nameField(page).evaluate((input, kind) => {
    if (kind === 'duplicate ID') input.parentElement!.append(input.cloneNode(true));
    else input.setAttribute('aria-label', 'Delete an unrelated project');
  }, mutation);
  await expect(shape(page)).toBeHidden(); await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  await expect(page.getByText('That control changed or is no longer visible. Ask again to refresh the guide.', { exact: true })).toBeVisible();
  await noTargetMark(page);
});

test('a delayed answer after path navigation waits for a fresh plan before annotating controls', async ({ page }) => {
  await openFixture(page);
  let release!: () => void, fetched!: () => void, releaseFresh!: () => void, fetchedFresh!: () => void, calls = 0, freshUrl = '';
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { fetched = resolve; });
  const heldFresh = new Promise<void>(resolve => { releaseFresh = resolve; }), readyFresh = new Promise<void>(resolve => { fetchedFresh = resolve; });
  await page.route('**/api/embed/session/ask', async route => { const call = ++calls, response = await route.fetch(); if (call === 1) { fetched(); await held; } else { freshUrl = route.request().postDataJSON().page.url; fetchedFresh(); await heldFresh; } await route.fulfill({ response }); });
  try {
    await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Show me how to create a contact');
    await page.getByRole('button', { name: 'Send question', exact: true }).click(); await ready;
    await page.evaluate(() => history.pushState({}, '', '/changed-scene'));
    release(); await readyFresh; expect(new URL(freshUrl).pathname).toBe('/changed-scene');
    await expect(shape(page)).toHaveCount(0);
    releaseFresh(); await expect(guide(page)).toBeVisible(); await step(page, 1); await expect(shape(page)).toBeVisible();
    expect(calls).toBe(2);
  } finally { release(); releaseFresh(); await page.unrouteAll({ behavior: 'wait' }); }
});

interface BeatDouble { texts: string[]; cancelled: number; fire(index: number, event: 'start' | 'end' | 'error'): void; }
type BeatWindow = Window & { __guidekitBeatDouble: BeatDouble };
async function installBeatDouble(page: Page) {
  // Playback callbacks are explicit test doubles, never a real mic/TTS claim.
  await page.addInitScript(() => {
    const callbacks: Array<{ start: (() => void) | null; end: (() => void) | null; error: (() => void) | null }> = [];
    const state: BeatDouble = { texts: [], cancelled: 0, fire: (index, event) => callbacks[index]?.[event]?.() };
    class Utterance { lang = ''; rate = 1; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(readonly text: string) {} }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (utterance: Utterance) => { state.texts.push(utterance.text); callbacks.push({ start: utterance.onstart, end: utterance.onend, error: utterance.onerror }); }, cancel: () => { state.cancelled++; } } });
    (window as unknown as BeatWindow).__guidekitBeatDouble = state;
  });
}

test('speech beats release drawing on playback start, bound fallback, and ignore cancelled callbacks', async ({ page }) => {
  await installBeatDouble(page); await openFixture(page);
  await page.getByRole('button', { name: 'Read answers aloud using your browser', exact: true }).click();
  await askForGuide(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.texts.length)).toBe(1);
  await page.waitForTimeout(500); await expect(shape(page)).toBeHidden();
  await page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.fire(0, 'start'));
  await expect(shape(page)).toBeVisible(); await expect(shape(page)).toHaveAttribute('data-gk-mark', /contact-name/);
  await nameField(page).fill('Speech Beat Name'); await step(page, 2);
  await expect.poll(() => page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.texts.length)).toBe(2);
  await page.evaluate(() => { const beats = (window as unknown as BeatWindow).__guidekitBeatDouble; beats.fire(0, 'start'); beats.fire(0, 'end'); });
  await page.waitForTimeout(200); await expect(shape(page)).toBeHidden();
  await page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.fire(1, 'start'));
  await expect(shape(page)).toBeVisible(); await expect(shape(page)).toHaveAttribute('data-gk-mark', /contact-company/);
  await companyField(page).fill('Speech Beat Company'); await step(page, 3);
  await expect(shape(page)).toBeHidden();
  await expect(shape(page)).toBeVisible({ timeout: 4_000 });
  await expect(shape(page)).toHaveAttribute('data-gk-mark', /contact-status/);
  const status = page.locator('[data-guidekit-id="contact-status"]');
  await status.focus(); await status.press('q'); await expect(status).toHaveValue('Qualified'); await step(page, 4);
  await expect.poll(() => page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.texts.length)).toBe(4);
  await guide(page).getByRole('button', { name: 'Stop visual guidance', exact: true }).click();
  await page.evaluate(() => { const beats = (window as unknown as BeatWindow).__guidekitBeatDouble; beats.fire(3, 'start'); beats.fire(3, 'end'); beats.fire(2, 'error'); });
  await page.waitForTimeout(2_700); await noTargetMark(page); await expect(guide(page)).toHaveCount(0); await expect(chat(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as BeatWindow).__guidekitBeatDouble.cancelled)).toBeGreaterThan(0);
});

interface CursorFrame { time: number; x: number; y: number; rotation: number; scale: number; location: string; ink: boolean; }
async function dockError(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-guidekit-root]')?.shadowRoot;
    const badge = root?.querySelector('[data-gk-cursor-dock]'), cursor = root?.querySelector<SVGGraphicsElement>('[data-gk-cursor]');
    const matrix = cursor?.getScreenCTM(); if (!badge || !matrix) return 999;
    const center = badge.getBoundingClientRect(), point = new DOMPoint(0, 0).matrixTransform(matrix);
    return Math.hypot(point.x - center.left - center.width / 2, point.y - center.top - center.height / 2);
  });
}
async function visibleDock(page: Page) {
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'docked'); await expect.poll(() => dockError(page)).toBeLessThan(1);
  expect(await annotation(page).evaluate(svg => {
    const cursor = svg.querySelector('[data-gk-cursor]'); if (!cursor) return false;
    return getComputedStyle(svg).visibility === 'visible' && Number(getComputedStyle(svg).opacity) > 0.99 && Number(getComputedStyle(cursor).opacity) > 0.99 && [...cursor.querySelectorAll('[data-gk-cursor-surface]')].some(surface => Number(getComputedStyle(surface).opacity) > 0.5);
  }), 'The dock cursor is painted at full opacity, not merely mounted').toBe(true);
}
async function cursorFrames(page: Page, durationMs: number): Promise<CursorFrame[]> {
  return page.evaluate(duration => new Promise<CursorFrame[]>(resolve => {
    const frames: CursorFrame[] = []; let started: number | undefined;
    const frame = (time: number) => {
      started ??= time;
      const root = document.querySelector('[data-guidekit-root]')?.shadowRoot, cursor = root?.querySelector<SVGGraphicsElement>('[data-gk-cursor]');
      const matrix = cursor?.getScreenCTM(), mark = root?.querySelector('[data-gk-shape]');
      if (cursor && matrix) {
        const point = new DOMPoint(0, 0).matrixTransform(matrix);
        const pointing = cursor.querySelector<SVGGraphicsElement>('[data-gk-cursor-surface="pointing"]')?.getScreenCTM();
        const ink = !!mark && getComputedStyle(mark).visibility !== 'hidden' && Number(getComputedStyle(mark).opacity) > 0 && [...mark.querySelectorAll('path[stroke-dashoffset]')].some(path => Number(path.getAttribute('stroke-dashoffset')) < 0.999);
        frames.push({ time, x: point.x, y: point.y, rotation: pointing ? Math.atan2(pointing.b, pointing.a) * 180 / Math.PI : 0, scale: Math.hypot(matrix.a, matrix.b), location: cursor.getAttribute('data-gk-cursor-location') ?? '', ink });
      }
      if (time - started >= duration) resolve(frames); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), durationMs);
}
async function holdAnswer(page: Page) {
  let release!: () => void, fetched!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { fetched = resolve; });
  const handler = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch(); fetched(); await held;
    // Explicit cancellation may abort the intercepted fetch before its fixture
    // response is released. The stale-response branch must remain harmless.
    await route.fulfill({ response }).catch(() => {});
  };
  await page.route('**/api/embed/session/ask', handler);
  return { ready, release, dispose: async () => { release(); await page.unroute('**/api/embed/session/ask', handler); } };
}
function continuousDeparture(frames: CursorFrame[]) {
  const docked = frames.filter(frame => frame.location === 'docked'), flying = frames.filter(frame => frame.location === 'flight');
  expect(docked.length).toBeGreaterThan(0); expect(flying.length).toBeGreaterThan(3);
  const start = docked.at(-1)!, first = flying[0]!;
  expect(Math.hypot(first.x - start.x, first.y - start.y), 'Flight starts from the rendered dock point').toBeLessThan(5);
  expect(new Set(flying.map(frame => `${Math.round(frame.x)},${Math.round(frame.y)}`)).size, 'Flight has intermediate positions').toBeGreaterThan(3);
  expect(frames.some(frame => frame.location === 'flight' && frame.ink), 'First target stroke waits for cursor arrival').toBe(false);
  expect(frames.some(frame => frame.location === 'target' && frame.ink)).toBe(true);
}
function expressiveFlight(frames: CursorFrame[], startState: 'docked' | 'target', endState: 'target' | 'docked') {
  const start = frames.filter(frame => frame.location === startState).at(-1);
  const flying = frames.filter(frame => frame.location === 'flight');
  const end = frames.find(frame => frame.location === endState);
  expect(start, 'Capture the visible departure point').toBeDefined(); expect(end, 'Capture the settled endpoint').toBeDefined(); expect(flying.length).toBeGreaterThan(8);
  const dx = end!.x - start!.x, dy = end!.y - start!.y, distance = Math.hypot(dx, dy);
  expect(distance).toBeGreaterThan(150);
  const points = flying.map(frame => ({ ...frame, projection: ((frame.x - start!.x) * dx + (frame.y - start!.y) * dy) / distance ** 2, perpendicular: Math.abs(dx * (frame.y - start!.y) - dy * (frame.x - start!.x)) / distance }));
  expect(Math.max(...points.map(frame => frame.perpendicular)), 'The cursor follows a visible arc perpendicular to its chord').toBeGreaterThan(12);
  expect(points.every(frame => frame.projection >= -.005 && frame.projection <= 1.005), 'The flight never overshoots either endpoint along its direction of travel').toBe(true);
  expect(Math.hypot(flying[0]!.x - start!.x, flying[0]!.y - start!.y), 'The arc departs continuously from the rendered position').toBeLessThan(5);
  const middle = points.filter(frame => frame.projection > .15 && frame.projection < .85);
  expect(Math.max(...middle.map(frame => Math.abs(frame.rotation))), 'The cursor banks during the arc').toBeGreaterThan(3);
  expect(Math.max(...middle.map(frame => frame.scale)), 'The cursor has a restrained mid-flight scale pulse').toBeGreaterThan(1.03);
  expect(Math.max(...points.map(frame => frame.scale))).toBeLessThan(1.25);
  expect(Math.abs(end!.rotation), 'The cursor lands at neutral rotation').toBeLessThan(.1); expect(Math.abs(end!.scale - 1)).toBeLessThan(.005);
}
async function cursorInsideName(page: Page) {
  return page.evaluate(() => {
    const target = document.querySelector('[data-guidekit-id="contact-name"]'), cursor = document.querySelector('[data-guidekit-root]')?.shadowRoot?.querySelector<SVGGraphicsElement>('[data-gk-cursor]');
    const matrix = cursor?.getScreenCTM(); if (!target || !matrix) return false;
    const bounds = target.getBoundingClientRect(), point = new DOMPoint(0, 0).matrixTransform(matrix);
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  });
}

test('the same visible cursor departs its chat dock continuously, waits to draw, returns, and resumes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page);
  await visibleDock(page);
  await expect(cursor(page)).toBeVisible(); const retained = await annotation(page).elementHandle();
  if (!retained) throw new Error('The chat cursor surface was not mounted.');
  const held = await holdAnswer(page);
  try {
    const asking = askForGuide(page); await held.ready;
    await expect(chat(page)).toBeVisible(); await expect.poll(() => dockError(page)).toBeLessThan(1);
    expect(await annotation(page).evaluate((node, original) => node === original, retained)).toBe(true);
    const recorded = cursorFrames(page, 2_300); await page.waitForTimeout(60); held.release(); await asking;
    const departure = await recorded; continuousDeparture(departure);
    await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target'); expect(await cursorInsideName(page)).toBe(true);
    expect(await annotation(page).evaluate((node, original) => node === original, retained)).toBe(true);
    await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
    await expect(chat(page)).toBeVisible(); await visibleDock(page); await noTargetMark(page);
    const resumed = cursorFrames(page, 2_300); await page.waitForTimeout(60);
    await page.getByRole('button', { name: 'Resume guide', exact: true }).click(); continuousDeparture(await resumed);
    expect(await cursorInsideName(page)).toBe(true); await expect(chat(page)).toBeHidden();
    expect(await annotation(page).evaluate((node, original) => node === original, retained)).toBe(true);
  } finally { await held.dispose(); await retained.dispose(); }
});

for (const direction of ['diagonal', 'vertical'] as const) test(`the ${direction} cursor flight visibly swoops, banks and returns precisely to its dock`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1280, height: 900 }); await openFixture(page, false); await visibleDock(page);
  await nameField(page).evaluate((input, direction) => {
    const cursor = document.querySelector('[data-guidekit-root]')!.shadowRoot!.querySelector<SVGGraphicsElement>('[data-gk-cursor]')!;
    const start = new DOMPoint(0, 0).matrixTransform(cursor.getScreenCTM()!);
    Object.assign((input as HTMLElement).style, { position: 'fixed', left: `${direction === 'vertical' ? start.x - 3 : Math.max(40, start.x - 500)}px`, top: `${Math.max(60, start.y - (direction === 'vertical' ? 300 : 180))}px`, width: '120px', height: '44px' });
  }, direction);
  const held = await holdAnswer(page);
  try {
    const asking = askForGuide(page); await held.ready;
    const departure = cursorFrames(page, 3_000); await page.waitForTimeout(60); held.release(); await asking;
    const outgoing = await departure; expressiveFlight(outgoing, 'docked', 'target');
    const start = outgoing.filter(frame => frame.location === 'docked').at(-1)!, end = outgoing.find(frame => frame.location === 'target')!;
    if (direction === 'vertical') expect(Math.abs(end.x - start.x), 'The vertical fixture has a vertical start/end chord').toBeLessThan(1);
    else { expect(Math.abs(end.x - start.x)).toBeGreaterThan(300); expect(Math.abs(end.y - start.y)).toBeGreaterThan(80); }
    expect(await cursorInsideName(page)).toBe(true);
    const returning = cursorFrames(page, 1_800); await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click(); await visibleDock(page);
    expressiveFlight(await returning, 'target', 'docked'); await noTargetMark(page);
  } finally { await held.dispose(); }
});

test('paused target mutations cannot interrupt the cursor returning to its chat dock', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await askForGuide(page);
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target');
  await guide(page).getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'flight');
  await nameField(page).evaluate(input => input.setAttribute('hidden', ''));
  await page.waitForTimeout(100);
  await nameField(page).evaluate(input => { const replacement = input.cloneNode(true) as HTMLElement; replacement.removeAttribute('hidden'); input.replaceWith(replacement); });
  await visibleDock(page); await noTargetMark(page); await expect(chat(page)).toBeVisible();
  await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target'); expect(await cursorInsideName(page)).toBe(true);
  await expect.poll(() => annotationError(page)).toBeLessThan(1.2);
});

test('cursor flight retargets through viewport resize and scroll without jumping to stale coordinates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1280, height: 760 }); await openFixture(page);
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '900px'; document.body.append(spacer); });
  const held = await holdAnswer(page);
  try {
    const asking = askForGuide(page); await held.ready;
    const recorded = cursorFrames(page, 2_700); await page.waitForTimeout(60); held.release(); await asking;
    await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'flight');
    await page.setViewportSize({ width: 1180, height: 760 }); await page.evaluate(() => window.scrollBy(0, 60));
    const frames = await recorded;
    const jumps = frames.slice(1).map((frame, index) => Math.hypot(frame.x - frames[index]!.x, frame.y - frames[index]!.y));
    expect(Math.max(...jumps), 'Retargeting starts from the displayed cursor pose').toBeLessThan(50);
    const adjacent = frames.slice(1).flatMap((frame, index) => frame.time - frames[index]!.time <= 40 ? [{ previous: frames[index]!, current: frame }] : []);
    expect(adjacent.every(({ previous, current }) => Math.abs(current.rotation - previous.rotation) < 25), 'Retargeting preserves bank continuity').toBe(true);
    expect(adjacent.every(({ previous, current }) => Math.abs(current.scale - previous.scale) < .08), 'Retargeting preserves scale continuity').toBe(true);
    await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'target'); expect(await cursorInsideName(page)).toBe(true);
    await expect.poll(() => annotationError(page)).toBeLessThan(1.2);
    expect(frames.some(frame => frame.location === 'flight' && frame.ink)).toBe(false);
  } finally { await held.dispose(); }
});

test('cancelling an active cursor flight returns to the dock and destroy prevents late marks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await openFixture(page); await askForGuide(page);
  await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'flight'); await page.keyboard.press('Escape');
  await expect(chat(page)).toBeVisible(); await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'docked');
  await expect.poll(() => dockError(page)).toBeLessThan(1); await noTargetMark(page);
  await page.waitForTimeout(1_600); await noTargetMark(page);
  await askForGuide(page); await expect(cursor(page)).toHaveAttribute('data-gk-cursor-location', 'flight');
  await page.evaluate(() => window.GuideKit.destroy()); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  await page.waitForTimeout(2_700); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
});
