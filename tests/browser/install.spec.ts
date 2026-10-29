import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:4510';
const website = 'http://127.0.0.1:4511';
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /content security policy|unsafe-eval/i.test(message.text())) errors.push(message.text()); });
    await use(errors);
    expect(errors, 'Installation does not execute pasted code or violate the host CSP').toEqual([]);
  }, { auto: true }],
});

async function publishedAgent(request: APIRequestContext, allowedOrigin = website) {
  const headers = { Origin: endpoint };
  const registration = await request.post('/api/auth/register', { headers, data: { name: 'Install Tester', companyName: 'Installation Workspace', email: `install-${crypto.randomUUID()}@example.test`, password: 'Synthetic-install-password-42' } });
  expect(registration.status()).toBe(201);
  const created = await request.post('/api/agents', { headers, data: { name: 'Installed Northstar Guide', companyName: 'Northstar', allowedOrigins: [allowedOrigin], allowedActions: ['create_contact'] } });
  expect(created.status()).toBe(201);
  const { agent } = await created.json() as { agent: { id: string } };
  const document = await request.post(`/api/agents/${agent.id}/documents`, { headers, data: { title: 'Installation CRM handbook', content: 'Create a contact with a name, company, and a status of New, Qualified, or Customer. Require approval before saving.' } });
  expect(document.status()).toBe(201);
  const publication = await request.post(`/api/agents/${agent.id}/publish`, { headers, data: {} });
  expect(publication.status()).toBe(201);
  return agent.id;
}

function snippet(id: string) {
  return `<script\n  src="${endpoint}/sdk/guidekit.js"\n  data-agent-id="${id}"\n  data-endpoint="${endpoint}"\n  data-voice-provider="browser"\n  defer\n></script>`;
}

async function install(page: Page, value: string) {
  await page.getByLabel('SDK script snippet', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Install SDK', exact: true }).click();
}

test('manual installation loads the real SDK once, preserves host actions, and supports removal and reinstall', async ({ page, request }) => {
  const id = await publishedAgent(request);
  let sdkRequests = 0, sessions = 0;
  page.on('request', request => {
    if (request.url() === `${endpoint}/sdk/guidekit.js`) sdkRequests++;
    if (request.url() === `${endpoint}/api/embed/${id}/session`) sessions++;
  });
  // Even an agentId in the URL must not bypass the manual installation step.
  await page.goto(`${website}/?install=manual&agentId=${id}`);
  await expect(page.getByRole('heading', { name: 'Install your GuideKit SDK' })).toBeVisible();
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'not-loaded');
  expect(await page.evaluate(() => 'GuideKit' in window)).toBe(false);
  expect(sdkRequests).toBe(0); expect(sessions).toBe(0);
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);

  const invalid = [
    snippet(id).replace('defer', 'onload="window.PASTED_CODE_RAN=true" defer'),
    snippet(id).replace(`${endpoint}/sdk/guidekit.js`, 'https://example.invalid/untrusted.js'),
    snippet(id).replace('</script>', 'window.PASTED_CODE_RAN=true</script>'),
    `<img src="https://example.invalid/track">${snippet(id)}`,
    `${snippet(id)}${snippet(id)}`,
  ];
  for (const value of invalid) {
    await install(page, value);
    await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'error');
    expect(sdkRequests).toBe(0); expect(sessions).toBe(0);
    expect(await page.evaluate(() => 'PASTED_CODE_RAN' in window)).toBe(false);
  }

  await install(page, snippet(id));
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#manual-install-status')).toContainText('Connected to Installed Northstar Guide · published version 1. 1 host action is available with approval.');
  expect(sdkRequests).toBe(1); expect(sessions).toBe(1);
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open Installed Northstar Guide', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('Create a contact named Jamie Rivera at Acme Studio');
  const ask = page.waitForRequest(request => request.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const body = (await ask).postDataJSON() as { page: { actions: { name: string }[]; targets: { id: string }[] } };
  expect(body.page.actions.map(action => action.name)).toEqual(['create_contact']);
  expect(body.page.targets.some(target => target.id === 'sdk-snippet')).toBe(false);
  await expect(page.getByRole('button', { name: 'Approve and run', exact: true })).toBeVisible();
  await expect(page.locator('#contacts-list tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve and run', exact: true }).click();
  await expect(page.locator('#contacts-list tr')).toHaveCount(1);
  await expect(page.locator('#contacts-list')).toContainText('Jamie Rivera');

  await page.getByRole('button', { name: 'Remove assistant', exact: true }).click();
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'removed');
  await expect(page.getByRole('button', { name: 'Install SDK', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Install SDK', exact: true }).click();
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'ready');
  expect(sdkRequests).toBe(2); expect(sessions).toBe(2);
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(1);
  await expect(page.locator('#contacts-list tr')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a pinned SDK release loads with its reviewed integrity and rejects altered bytes', async ({ page, request }) => {
  const id = await publishedAgent(request), manifestResponse = await request.get(`${endpoint}/sdk/manifest.json`);
  expect(manifestResponse.status()).toBe(200); const manifest = await manifestResponse.json();
  const value = `<script src="${endpoint}${manifest.script.path}" integrity="${manifest.script.integrity}" crossorigin="anonymous" data-agent-id="${id}" data-endpoint="${endpoint}" defer></script>`;
  await page.goto(`${website}/?install=manual`); await install(page, value);
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(1);
  const response = await request.get(`${endpoint}${manifest.script.path}`); expect(response.headers()['cache-control']).toContain('immutable');
  await page.getByRole('button', { name: 'Remove assistant', exact: true }).click();
  await install(page, value.replace(manifest.script.integrity, `sha384-${'A'.repeat(64)}`));
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'error'); await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
});

test('an origin rejected by the published agent never reports a successful installation', async ({ page, request }) => {
  const id = await publishedAgent(request, 'http://127.0.0.1:4512');
  await page.goto(`${website}/?install=manual`);
  const bootstrap = page.waitForResponse(response => response.url().endsWith(`/api/embed/${id}/session`));
  await install(page, snippet(id));
  expect((await bootstrap).status()).toBe(403);
  await expect(page.locator('#manual-install-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#manual-install-status')).toContainText('Connection failed: This website is not in the published agent’s allowed origins.');
  await expect(page.locator('[data-guidekit-root]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install SDK', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove assistant', exact: true })).toBeDisabled();
});
