import { test as base, expect, type Page } from '@playwright/test';

// Runtime exceptions and CSP violations are failures even when the visible assertion passes.
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

async function register(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your name', { exact: true }).fill('Browser Tester');
  await page.getByLabel('Company name', { exact: true }).fill('Acceptance Workspace');
  await page.getByLabel('Email address').fill(`browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password').fill('Synthetic-browser-password-42');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create your first agent' })).toBeVisible();
  await expect(page.getByText('Explicit isolated browser-test provider.', { exact: false })).toBeAttached();
}

async function publishAgent(page: Page, kind: 'crm' | 'support') {
  const name = kind === 'crm' ? 'Northstar Guide' : 'Fieldnotes Guide';
  const first = page.getByRole('button', { name: 'Create your first agent' });
  if (await first.isVisible()) await first.click();
  else await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create your agent' });
  await dialog.getByLabel('Agent name', { exact: true }).fill(name);
  await dialog.getByLabel('Starting capabilities').selectOption(kind);
  const created = page.waitForResponse(response => response.url().endsWith('/api/agents') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
  const { agent } = await (await created).json() as { agent: { id: string } };
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Allowed website origins').fill(`http://127.0.0.1:${kind === 'crm' ? 4511 : 4512}`);
  await page.getByRole('tab', { name: /^Knowledge/ }).click();
  await page.getByLabel('Document title', { exact: true }).fill(kind === 'crm' ? 'CRM handbook' : 'Support handbook');
  await page.getByLabel('Document text').fill(kind === 'crm'
    ? 'Northstar CRM handbook. Create a contact with name, company and status. Contact status is New, Qualified or Customer. CRM-only knowledge marker: NORTHSTAR-ONLY.'
    : 'Fieldnotes support handbook. Find invoices under Workspace settings, Billing, Invoices. Support-only knowledge marker: FIELDNOTES-ONLY. Create support requests with subject, description and priority Normal or High.');
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(page.getByRole('button', { name: kind === 'crm' ? /^CRM handbook/ : /^Support handbook/ })).toBeVisible();
  await page.getByRole('button', { name: 'Publish agent', exact: true }).click();
  await expect(page.getByText('Live v1', { exact: true })).toBeVisible();
  return agent.id;
}

async function openHost(page: Page, kind: 'crm' | 'support', id: string) {
  const response = await page.goto(`http://127.0.0.1:${kind === 'crm' ? 4511 : 4512}/?agentId=${encodeURIComponent(id)}`);
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain('http://127.0.0.1:4510');
  expect(csp).not.toContain('unsafe-eval');
  await page.getByRole('button', { name: `Open ${kind === 'crm' ? 'Northstar Guide' : 'Fieldnotes Guide'}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Website assistant' })).toBeVisible();
}

async function ask(page: Page, message: string) {
  const activeGuide = page.getByRole('region', { name: 'Visual guidance' });
  if (await activeGuide.isVisible()) await activeGuide.getByRole('button', { name: 'Open chat', exact: true }).click();
  const request = page.waitForRequest(request => request.url().endsWith('/api/embed/session/ask'));
  const response = page.waitForResponse(response => response.url().endsWith('/api/embed/session/ask'));
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Send question', exact: true, includeHidden: true })).toBeEnabled();
  return (await request).postDataJSON() as { page: { targets: { id: string; label: string }[]; actions: { name: string; inputSchema: unknown }[] } };
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('dashboard publication, private context, strict CSP and visual guidance recover on mobile', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  await noHorizontalOverflow(page);
  const id = await publishAgent(page, 'crm');
  await noHorizontalOverflow(page);
  const host = await context.newPage();
  await host.setViewportSize({ width: 390, height: 844 });
  await openHost(host, 'crm', id);
  await host.locator('input[name="name"]').fill('RAW-INPUT-MUST-NOT-LEAK');
  await host.locator('input[name="email"]').fill('private-marker@example.test');
  await host.evaluate(() => {
    const wrapper = document.createElement('button'); wrapper.dataset.guidekitId = 'editable-wrapper';
    wrapper.append(document.createTextNode('Public wrapper '));
    const editable = document.createElement('span'); editable.contentEditable = 'true'; editable.textContent = 'EDITABLE-SECRET-MUST-NOT-LEAK'; wrapper.append(editable);
    const privateNode = document.createElement('span'); privateNode.dataset.guidekitPrivate = ''; privateNode.textContent = 'PRIVATE-NODE-MUST-NOT-LEAK'; wrapper.append(privateNode);
    document.body.append(wrapper);
  });
  const payload = await ask(host, 'How do I create a contact?');
  expect(JSON.stringify(payload.page)).not.toMatch(/RAW-INPUT-MUST-NOT-LEAK|private-marker|EDITABLE-SECRET|PRIVATE-NODE/);
  expect(payload.page.targets.find(target => target.id === 'editable-wrapper')?.label).toBe('Public wrapper');
  expect(payload.page.actions.map(action => action.name)).toEqual(['create_contact', 'update_contact_status']);
  expect(payload.page.actions[0].inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  const guidance = host.getByRole('region', { name: 'Visual guidance' });
  await expect(guidance).toBeVisible();
  const target = host.locator('[data-guidekit-id="contact-name"]');
  await expect.poll(async () => {
    const a = await target.boundingBox(), b = await host.locator('[data-guidekit-root] .highlight').boundingBox();
    return a && b ? Math.abs(b.y - Math.max(3, a.y - 5)) : 999;
  }).toBeLessThan(2);
  await host.evaluate(() => window.scrollBy(0, -80));
  await expect.poll(async () => {
    const a = await target.boundingBox(), b = await host.locator('[data-guidekit-root] .highlight').boundingBox();
    return a && b ? Math.abs(b.y - Math.max(3, a.y - 5)) : 999;
  }).toBeLessThan(2);
  await host.evaluate(() => document.querySelector('[data-guidekit-id="contact-name"]')?.remove());
  await expect(guidance).toHaveCount(0);
  await expect(host.getByText('That control changed or is no longer visible. Ask again to refresh the guide.', { exact: true })).toBeVisible();
  const fresh = await ask(host, 'Show me how to create a contact again');
  expect(fresh.page.targets.some(target => target.id === 'contact-name')).toBe(false);
  await expect(guidance).toBeVisible();
  await noHorizontalOverflow(host);
  await guidance.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(host.getByRole('dialog', { name: 'Website assistant' })).toBeVisible();
  const panel = await host.getByRole('dialog', { name: 'Website assistant' }).boundingBox();
  expect(panel).not.toBeNull(); expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
});

test('confirmed contact persists exactly once, while decline leaves records unchanged and activity reports both', async ({ page, context }) => {
  await register(page);
  const id = await publishAgent(page, 'crm');
  const host = await context.newPage();
  await openHost(host, 'crm', id);
  await ask(host, 'Create a contact named Jamie Rivera at Acme Studio');
  await expect(host.locator('#contacts-list tr')).toHaveCount(0);
  const recorded = host.waitForResponse(response => response.url().endsWith('/action-result'));
  await host.getByRole('button', { name: 'Approve and run', exact: true }).dblclick();
  expect((await recorded).status()).toBe(200);
  await expect(host.locator('#contacts-list tr')).toHaveCount(1);
  await expect(host.locator('#activity-list')).toContainText('Jamie Rivera added to Contacts');
  await expect(host.getByRole('log').getByText('Jamie Rivera at Acme Studio was created and verified in Contacts.', { exact: true })).toBeVisible();
  await ask(host, 'Create a contact named Declined Person at Acme Studio');
  const declined = host.waitForResponse(response => response.url().endsWith('/action-result'));
  await host.getByRole('button', { name: 'Decline', exact: true }).click();
  expect((await declined).status()).toBe(200);
  await expect(host.locator('#contacts-list tr')).toHaveCount(1);
  await host.reload();
  await expect(host.locator('#contacts-list tr')).toHaveCount(1);
  await expect(host.locator('#contacts-list')).toContainText('Jamie Rivera');
  await expect(host.locator('#contacts-list')).not.toContainText('Declined Person');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  const success = page.locator('.activity-item').filter({ hasText: 'Create a contact named Jamie Rivera' });
  const cancelled = page.locator('.activity-item').filter({ hasText: 'Create a contact named Declined Person' });
  await expect(success).toContainText('action succeeded');
  await expect(cancelled).toContainText('action cancelled');
});

test('a second website uses its own published knowledge, agent and permitted ticket action', async ({ page, context }) => {
  await register(page);
  const crmId = await publishAgent(page, 'crm');
  const supportId = await publishAgent(page, 'support');
  expect(supportId).not.toBe(crmId);
  const host = await context.newPage();
  await openHost(host, 'support', supportId);
  const payload = await ask(host, 'Where can I find invoices in support?');
  expect(payload.page.actions.map(action => action.name)).toEqual(['create_ticket']);
  await expect(host.getByRole('log')).toContainText('FIELDNOTES-ONLY');
  await expect(host.getByRole('log')).not.toContainText('NORTHSTAR-ONLY');
  await host.getByText('1 knowledge source', { exact: true }).click();
  await expect(host.getByRole('log')).toContainText('Support handbook');
  await ask(host, 'Create a support request about a missing invoice');
  await expect(host.locator('#tickets-list li')).toHaveCount(0);
  await expect(host.getByText('Approval required · create_ticket', { exact: true })).toBeVisible();
  const recorded = host.waitForResponse(response => response.url().endsWith('/action-result'));
  await host.getByRole('button', { name: 'Approve and run', exact: true }).click();
  expect((await recorded).status()).toBe(200);
  await expect(host.locator('#tickets-list li')).toHaveText('FN-0001 — Missing invoice (Normal)');
  await host.reload();
  await expect(host.locator('#tickets-list li')).toHaveCount(1);
  const crm = await context.newPage();
  await openHost(crm, 'crm', crmId);
  await expect(crm.locator('#contacts-list tr')).toHaveCount(0);
});
