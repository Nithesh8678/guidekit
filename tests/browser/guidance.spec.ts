import { test as base, expect, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const quietWindow = 1_400;
const guide = (page: Page) => page.getByRole('region', { name: 'Visual guidance' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Website assistant', includeHidden: true });
const nameField = (page: Page) => page.locator('[data-guidekit-id="contact-name"]');
const companyField = (page: Page) => page.locator('[data-guidekit-id="contact-company"]');

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
  expect((await response).status()).toBe(200);
  await expect(guide(page)).toBeVisible(); await step(page, 1); await expect(chat(page)).toBeHidden();
}
async function openFixture(page: Page) {
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
async function manuallyAdvanceToButton(page: Page) {
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click(); await step(page, 2);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click(); await step(page, 3);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click(); await step(page, 4);
}

test('observed input moves the guide without stealing focus, and only verified host save completes it', async ({ page }) => {
  await openFixture(page);
  const requests: { url: string; body: string }[] = [];
  page.on('request', request => { if (request.url().includes('/api/embed/')) requests.push({ url: request.url(), body: request.postData() ?? '' }); });
  await page.locator('input[name="email"]').fill('private-guidance-marker@example.test');
  await askForGuide(page);
  await expect(guide(page).getByRole('button', { name: 'Automatic progress', exact: true })).toHaveAttribute('aria-pressed', 'true');
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

test('pause, automatic progress toggle, back and manual finish remain under visitor control', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
  await guide(page).getByRole('button', { name: 'Pause guide', exact: true }).click();
  await nameField(page).fill('Paused Name'); await page.waitForTimeout(quietWindow); await step(page, 1);
  await guide(page).getByRole('button', { name: 'Resume guide', exact: true }).click();
  const automatic = guide(page).getByRole('button', { name: 'Automatic progress', exact: true });
  await automatic.click(); await expect(automatic).toHaveAttribute('aria-pressed', 'false');
  await nameField(page).fill('Manual Name'); await page.waitForTimeout(quietWindow); await step(page, 1);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click(); await step(page, 2);
  await guide(page).getByRole('button', { name: 'Back', exact: true }).click(); await step(page, 1);
  await manuallyAdvanceToButton(page);
  await guide(page).getByRole('button', { name: 'Finish guide', exact: true }).click();
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

test('a stable target ID recovers across replacement and a lost target returns to chat after grace', async ({ page }) => {
  await openFixture(page); await askForGuide(page);
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
  await nameField(page).fill('Deferred Verified Name'); await companyField(page).fill('Deferred Verified Company');
  await askForGuide(page); await manuallyAdvanceToButton(page);
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
