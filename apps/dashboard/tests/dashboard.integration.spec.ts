import { test, expect } from '@playwright/test';

test('real dashboard and local API preserve immutable releases, roll back safely, and stop only new sessions on unpublish', async ({ page }) => {
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Your name', { exact: true }).fill('Dashboard Integration Tester');
  await page.getByLabel('Company name', { exact: true }).fill('Synthetic Release Workspace');
  await page.getByLabel('Email address').fill(`dashboard-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password').fill('Synthetic-dashboard-password-42');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Create your first agent', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create your agent', exact: true });
  await create.getByLabel('Agent name', { exact: true }).fill('Release Integration Guide');
  const created = page.waitForResponse(response => response.url().endsWith('/api/agents') && response.request().method() === 'POST');
  await create.getByRole('button', { name: 'Create agent', exact: true }).click();
  const { agent } = await (await created).json() as { agent: { id: string } };
  await page.getByLabel('Allowed website origins').fill('http://127.0.0.1:4511');
  await page.getByRole('tab', { name: /^Knowledge/ }).click();
  await page.getByLabel('Document title', { exact: true }).fill('Release knowledge');
  await page.getByLabel('Document text', { exact: true }).fill('Original published invoice policy: ORIGINAL-RELEASE-MARKER.');
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Release knowledge/ })).toBeVisible();
  await page.getByRole('button', { name: 'Publish agent', exact: true }).click(); await expect(page.getByText('Live v1', { exact: true })).toBeVisible();
  await page.getByLabel('Retrieval test question', { exact: true }).fill('What is the invoice policy?'); await page.getByRole('button', { name: 'Preview retrieved sources', exact: true }).click(); await expect(page.locator('.retrieval-source')).toContainText('ORIGINAL-RELEASE-MARKER');
  await page.getByText('Evaluate a temporary question set', { exact: true }).click(); await page.getByRole('checkbox', { name: 'Release knowledge', exact: true }).check(); await page.getByRole('button', { name: 'Add evaluation case', exact: true }).click(); await page.getByRole('button', { name: 'Evaluate 1 case', exact: true }).click(); await expect(page.getByText('Version 1: mean recall 100% · mean reciprocal rank 1.00', { exact: true })).toBeVisible();
  const bootstrap = await page.request.post(`/api/embed/${agent.id}/session`, { headers: { Origin: 'http://127.0.0.1:4511' }, data: {} });
  expect(bootstrap.status()).toBe(200); const pinned = await bootstrap.json() as { token: string; agent: { version: number } }; expect(pinned.agent.version).toBe(1);

  await page.getByRole('button', { name: 'Edit Release knowledge', exact: true }).click();
  await page.getByLabel('Document text', { exact: true }).fill('Updated published invoice policy: UPDATED-RELEASE-MARKER.');
  await page.getByRole('tab', { name: 'Install', exact: true }).click();
  await expect(page.locator('pre code')).toContainText('data-endpoint="http://127.0.0.1:4510"'); await expect(page.locator('pre code')).toContainText('src="http://127.0.0.1:4510/sdk/');
  const manifestResponse = await page.request.get('/sdk/manifest.json'); expect(manifestResponse.status()).toBe(200); const manifest = await manifestResponse.json() as { version: string; script: { path: string; integrity: string } };
  await expect(page.getByText(`Pinned SDK ${manifest.version}`, { exact: false })).toBeVisible(); await expect(page.locator('pre code')).toContainText(`http://127.0.0.1:4510${manifest.script.path}`); await expect(page.locator('pre code')).toContainText(`integrity="${manifest.script.integrity}"`); await expect(page.locator('pre code')).toContainText('crossorigin="anonymous"');
  await page.getByRole('button', { name: 'Inspect version 1', exact: true }).click();
  const first = page.getByRole('dialog', { name: 'Version 1 snapshot', exact: true }); await first.getByText('Release knowledge', { exact: true }).click();
  await expect(first).toContainText('ORIGINAL-RELEASE-MARKER'); await expect(first).not.toContainText('UPDATED-RELEASE-MARKER'); await first.getByRole('button', { name: 'Close snapshot', exact: true }).click();
  await page.getByRole('tab', { name: /^Knowledge/ }).click(); await expect(page.getByLabel('Document text', { exact: true })).toHaveValue('Updated published invoice policy: UPDATED-RELEASE-MARKER.');
  await page.getByRole('button', { name: 'Save document', exact: true }).click(); await expect(page.getByText('Document updated in the draft.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Publish agent', exact: true }).click(); await expect(page.getByText('Live v2', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await page.getByLabel(/^Instructions/).fill('Unsaved configuration preserved through rollback and unpublish.');
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await page.getByRole('button', { name: 'Activate version 1', exact: true }).click(); await expect(page.getByText('Live v1', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Unsaved configuration preserved through rollback and unpublish.');
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await page.getByRole('button', { name: 'Unpublish agent', exact: true }).click(); await expect(page.getByText('No active publication', { exact: true })).toBeVisible();
  const stopped = await page.request.post(`/api/embed/${agent.id}/session`, { headers: { Origin: 'http://127.0.0.1:4511' }, data: {} }); expect(stopped.status()).toBe(404);
  const answer = await page.request.post('/api/embed/session/ask', { headers: { Origin: 'http://127.0.0.1:4511', Authorization: `Bearer ${pinned.token}` }, data: { requestId: `pinned_${crypto.randomUUID()}`, message: 'What is the invoice policy?', page: { url: 'http://127.0.0.1:4511/', title: 'Synthetic integration host', targets: [], actions: [], context: {} } } });
  expect(answer.status()).toBe(200); const result = await answer.json() as { version: number; answer: string }; expect(result.version).toBe(1); expect(result.answer).toContain('ORIGINAL-RELEASE-MARKER'); expect(result.answer).not.toContain('UPDATED-RELEASE-MARKER');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Unsaved configuration preserved through rollback and unpublish.');
  expect(browserErrors).toEqual([]);
});

test('real account controls update profile, preserve failed password entry, revoke other sessions and manage local invitations', async ({ page, playwright }) => {
  const email = `account-${crypto.randomUUID()}@example.test`, current = 'Synthetic-account-current-42', next = 'Synthetic-account-updated-42';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto('/'); await page.getByLabel('Your name', { exact: true }).fill('Account Browser Tester'); await page.getByLabel('Company name', { exact: true }).fill('Synthetic Account Workspace'); await page.getByLabel('Email address').fill(email); await page.getByLabel('Password').fill(current); await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Account & team', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Account & team', exact: true });
  await dialog.getByLabel('Your name', { exact: true }).fill('Updated Browser Tester'); await dialog.getByRole('button', { name: 'Save profile', exact: true }).click(); await expect(dialog.getByText('Profile updated.', { exact: true })).toBeVisible();
  await dialog.getByLabel('Current password', { exact: true }).fill('wrong-password'); await dialog.getByLabel('New password', { exact: true }).fill(next); await dialog.getByLabel('Confirm new password', { exact: true }).fill(next); await dialog.getByRole('button', { name: 'Change password', exact: true }).click(); await expect(dialog.getByText('Current password is incorrect.', { exact: false })).toBeVisible(); await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue(next);
  await dialog.getByLabel('Current password', { exact: true }).fill(current); await dialog.getByRole('button', { name: 'Change password', exact: true }).click(); await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue('');
  const other = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4510', extraHTTPHeaders: { Origin: 'http://127.0.0.1:4510' } });
  try {
    expect((await other.post('/api/auth/login', { data: { email, password: next } })).status()).toBe(200);
    await dialog.getByRole('button', { name: 'Sign out other sessions', exact: true }).click(); await expect(dialog.getByText('Other dashboard sessions were signed out.', { exact: true })).toBeVisible(); expect((await (await other.get('/api/auth/me')).json()).workspace).toBeNull();
    await dialog.getByRole('button', { name: 'Request verification link', exact: true }).click(); await expect(dialog.getByText('No email was sent.', { exact: false })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Team members', exact: true }).click(); const inviteEmail = `invite-${crypto.randomUUID()}@example.test`; await dialog.getByLabel('Teammate email', { exact: true }).fill(inviteEmail); await dialog.getByLabel('Invitation role', { exact: true }).selectOption('viewer'); await dialog.getByRole('button', { name: 'Send invitation', exact: true }).click(); await expect(dialog.getByText(inviteEmail, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: `Revoke invitation for ${inviteEmail}`, exact: true }).click(); await expect(dialog.getByText(inviteEmail, { exact: true })).toHaveCount(0); await dialog.getByRole('tab', { name: 'Security activity', exact: true }).click(); await expect(dialog.getByText('workspace invited', { exact: true })).toBeVisible(); await expect(dialog.getByText('workspace invitation revoked', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await dialog.getByRole('button', { name: 'Close account', exact: true }).click(); await expect(page.locator('.sidebar-user')).toContainText('Updated Browser Tester'); expect(errors).toEqual([]);
  } finally { await other.dispose(); }
});
