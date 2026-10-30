import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Public entry pages must not produce uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

async function publicFixture(page: Page, signedIn = false) {
  const requests: { path: string; method: string }[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    const value = path === '/api/auth/me'
      ? { workspace: signedIn ? { user: { id: 'usr_landing', name: 'Preview Owner', email: 'preview@example.test' }, tenant: { id: 'org_landing', name: 'Preview Workspace' }, role: 'owner' } : null }
      : path === '/api/agents' ? { agents: [] }
        : path === '/api/runtime/status' ? { provider: 'codex', available: false, authenticated: false, message: 'Explicit public-page fixture; no model request.' }
          : { error: `Unexpected public-page request: ${path}` };
    await route.fulfill({ status: path === '/api/auth/me' || path === '/api/agents' || path === '/api/runtime/status' ? 200 : 500, contentType: 'application/json', body: JSON.stringify(value) });
  });
  return requests;
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page, 'The page must fit the viewport without horizontal scrolling').toBeLessThanOrEqual(dimensions.viewport);
}

async function prepareFullPageScreenshot(page: Page) {
  // Native lazy images load as their real sections enter the viewport.
  const images = page.locator('.gk-landing main img');
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.landing-header')).toBeInViewport();
}

test('anonymous visitors see the public product page and explicit signup and login destinations', async ({ page }) => {
  const requests = await publicFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your product.');
  await expect(page.getByText('Interactive preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started', exact: true })).toHaveAttribute('href', '#signup');
  await page.getByRole('link', { name: 'Build your guide', exact: true }).first().click();
  await expect(page).toHaveURL(/#signup$/);
  await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible();
  await expect(page.getByLabel('Company name', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'GuideKit home', exact: true }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await expect(page).toHaveURL(/#login$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(requests).toEqual([{ path: '/api/auth/me', method: 'GET' }]);
});

test('signed-in visitors can inspect the public page before opening their actual dashboard', async ({ page }) => {
  const requests = await publicFixture(page, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your product.');
  const open = page.getByRole('link', { name: 'Open dashboard', exact: true }).first();
  await expect(open).toHaveAttribute('href', '#dashboard');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ path: '/api/auth/me', method: 'GET' }]);
  await open.click();
  await expect(page).toHaveURL(/#dashboard$/);
  await expect(page.getByText('Your first agent starts here.', { exact: true })).toBeVisible();
  expect(requests.some(request => request.path === '/api/agents')).toBe(true);
});

for (const width of [360, 390, 768]) {
  test(`the product page fits ${width}px with functional navigation and FAQ`, async ({ page }, testInfo) => {
    await publicFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noOverflow(page);
    if (width < 700) {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
      await menu.click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Questions & answers', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toHaveCount(0);
    } else await page.getByRole('link', { name: 'FAQ', exact: true }).click();
    const question = page.getByText('Where is my workspace stored?', { exact: true });
    await question.click();
    await expect(page.getByText('This edition runs on your local GuideKit instance.', { exact: false })).toBeVisible();
    await question.press('Enter');
    await expect(page.getByText('This edition runs on your local GuideKit instance.', { exact: false })).not.toBeVisible();
    await noOverflow(page);
    await prepareFullPageScreenshot(page);
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
  });
}

test('the interactive preview follows real clicks, saves only local fictional state, and can replay or cancel', async ({ page }, testInfo) => {
  const requests = await publicFixture(page);
  await page.goto('/');
  const demo = page.getByLabel('Interactive GuideKit product preview', { exact: true });
  await demo.getByRole('button', { name: 'Try the guide', exact: true }).click();
  await expect(demo.getByRole('status')).toHaveText('Guide step 1 of 4. Open Contacts in the sidebar.');
  await expect(demo.locator('.ld-chat')).toHaveAttribute('aria-hidden', 'true');
  await demo.getByRole('button', { name: /^Contacts/ }).click();
  await demo.getByRole('button', { name: 'New contact', exact: true }).click();
  await demo.getByLabel('Full name', { exact: true }).fill('Taylor Preview');
  await expect(demo.getByRole('status')).toHaveText('Guide step 4 of 4. Save your contact to finish.');
  await demo.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(demo.getByRole('table', { name: 'Fictional contacts', exact: true }).getByText('Taylor Preview', { exact: true })).toBeVisible();
  await expect(demo.getByRole('status')).toHaveText('Preview complete. Taylor Preview was added to the fictional contact list.');
  await expect(demo.getByRole('button', { name: 'Replay the guide', exact: true })).toBeFocused();
  await expect(demo.locator('.ld-chat')).toHaveCSS('opacity', '1');
  await prepareFullPageScreenshot(page);
  await page.screenshot({ path: testInfo.outputPath('landing-desktop-preview-complete.png'), fullPage: true });
  await demo.getByRole('button', { name: 'Replay the guide', exact: true }).click();
  await expect(demo.getByRole('table').getByText('Taylor Preview', { exact: true })).toHaveCount(0);
  await demo.getByRole('button', { name: 'End guide', exact: true }).click();
  await expect(demo.getByRole('button', { name: 'Try the guide', exact: true })).toBeVisible();
  await demo.getByRole('button', { name: 'Close preview assistant', exact: true }).click();
  await demo.getByRole('button', { name: 'Open preview assistant', exact: true }).click();
  await expect(demo.getByRole('button', { name: 'Try the guide', exact: true })).toBeVisible();
  expect(requests).toEqual([{ path: '/api/auth/me', method: 'GET' }]);
});

test('the preview is keyboard operable and reduced motion removes cursor flights', async ({ page }) => {
  const requests = await publicFixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const demo = page.getByLabel('Interactive GuideKit product preview', { exact: true });
  const tryGuide = demo.getByRole('button', { name: 'Try the guide', exact: true });
  await tryGuide.focus();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('button', { name: /^Contacts/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('button', { name: 'New contact', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByLabel('Full name', { exact: true })).toBeFocused();
  await page.keyboard.type('Keyboard Preview');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(demo.getByRole('button', { name: 'Save contact', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status')).toContainText('Preview complete.');
  const animation = await demo.locator('.ld-floating-cursor').evaluate(element => ({ transition: getComputedStyle(element).transitionDuration, animation: getComputedStyle(element).animationDuration }));
  expect(animation.transition.split(',').every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
  expect(animation.animation.split(',').every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(tryGuide).toBeFocused();
  await expect(demo.getByRole('status')).toHaveText('Interactive preview ready.');
  expect(requests).toEqual([{ path: '/api/auth/me', method: 'GET' }]);
});

for (const route of ['/', '/#signup']) {
  test(`public ${route === '/' ? 'landing' : 'signup'} passes axe WCAG A and AA checks`, async ({ page }, testInfo) => {
    await publicFixture(page);
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    await testInfo.attach('axe-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    expect(results.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  });
}

for (const width of [360, 1280]) {
  test(`the active preview form remains usable and accessible at ${width}px`, async ({ page }, testInfo) => {
    const requests = await publicFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const demo = page.getByLabel('Interactive GuideKit product preview', { exact: true });
    await demo.getByRole('button', { name: 'Try the guide', exact: true }).click();
    await demo.getByRole('button', { name: /^Contacts/ }).click();
    await demo.getByRole('button', { name: 'New contact', exact: true }).click();
    await expect(demo.getByLabel('Full name', { exact: true })).toBeFocused();
    await expect(demo.locator('.ld-instruction')).toHaveCSS('opacity', '1');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    await testInfo.attach('axe-active-preview-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    await demo.getByLabel('Full name', { exact: true }).fill('Responsive Preview');
    await expect(demo.getByRole('status')).toContainText('Guide step 4 of 4.');
    await demo.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(demo.getByRole('status')).toContainText('Preview complete.');
    await noOverflow(page);
    expect(requests).toEqual([{ path: '/api/auth/me', method: 'GET' }]);
    expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  });
}
