import { test as base, expect, type Page } from '@playwright/test';
import type { Agent, Workspace, WorkspaceRole } from '@guidekit/contracts';

const token = 'A'.repeat(43), password = 'Synthetic-account-password-42';
const test = base.extend<{ browserErrors: string[] }>({ browserErrors: [async ({ page }, use) => { const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await use(errors); expect(errors).toEqual([]); }, { auto: true }] });
async function setup(page: Page, options: { anonymous?: boolean; role?: WorkspaceRole } = {}) {
  let workspace: Workspace | null = options.anonymous ? null : { user: { id: 'usr_owner', name: 'Synthetic Owner', email: 'owner@example.test', emailVerified: false }, tenant: { id: 'org_first', name: 'First Workspace' }, role: options.role ?? 'owner' };
  const calls: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
  const members = [{ id: 'usr_owner', name: 'Synthetic Owner', email: 'owner@example.test', role: 'owner' }, { id: 'usr_editor', name: 'Synthetic Editor', email: 'editor@example.test', role: 'editor' }];
  let invitations: { id: string; email: string; role: string; expiresAt: string }[] = [];
  const agent = (): Agent => ({ id: workspace?.tenant.id === 'org_second' ? 'agt_second' : 'agt_first', tenantId: workspace?.tenant.id ?? 'org_first', name: workspace?.tenant.id === 'org_second' ? 'Second Workspace Guide' : 'First Workspace Guide', companyName: workspace?.tenant.name ?? 'First Workspace', description: '', instructions: 'Saved instructions', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4641'], allowedActions: [], publishedVersion: 1, createdAt: '2026-10-29T10:00:00Z', updatedAt: '2026-10-29T10:00:00Z' });
  await page.route('**/sdk/manifest.json', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(), body = route.request().postData() ? route.request().postDataJSON() as Record<string, unknown> : null; calls.push({ path, method, body }); let value: unknown, status = 200;
    if (path === '/api/auth/me') value = { workspace };
    else if (path === '/api/auth/login') { workspace = { user: { id: 'usr_invited', name: 'Existing Invitee', email: String(body?.email), emailVerified: true }, tenant: { id: 'org_first', name: 'First Workspace' }, role: 'owner' }; value = { workspace }; }
    else if (path === '/api/runtime/status') value = { provider: 'codex', available: false, authenticated: false, message: 'Explicit account UI fixture.' };
    else if (path === '/api/agents') value = { agents: [agent()] };
    else if (/^\/api\/agents\/agt_\w+$/.test(path)) value = { agent: agent(), documents: [{ id: 'doc_a', title: 'Saved guide', content: 'Saved public knowledge', createdAt: agent().createdAt }], versions: [{ number: 1, createdAt: agent().createdAt, documentCount: 1, status: 'ready', graphSource: 'local' }], sessions: [] };
    else if (path.endsWith('/diagnostics')) value = { endpointOrigin: 'http://127.0.0.1:4640', ready: false, checks: [{ id: 'runtime', status: 'warning', message: 'Explicit account UI fixture.' }] };
    else if (/\/versions\/1$/.test(path)) value = { version: { number: 1, createdAt: agent().createdAt, documentCount: 1, status: 'ready', graphSource: 'local' }, config: agent(), documents: [] };
    else if (path === '/api/account') value = { workspace, workspaces: [{ id: 'org_first', name: 'First Workspace', role: workspace?.role ?? 'owner' }, { id: 'org_second', name: 'Second Workspace', role: 'viewer' }], delivery: 'local' };
    else if (path === '/api/account/profile') { workspace!.user.name = String(body?.name); value = { workspace }; }
    else if (path === '/api/account/password') { if (body?.currentPassword !== password) { status = 401; value = { error: 'Current password is incorrect.' }; } else value = { ok: true }; }
    else if (path === '/api/account/switch') { workspace = { ...workspace!, tenant: { id: 'org_second', name: 'Second Workspace' }, role: 'viewer' }; value = { workspace }; }
    else if (path === '/api/account/verification') value = { ok: true, delivery: 'local' };
    else if (path === '/api/account/revoke-sessions') value = { ok: true };
    else if (path === '/api/workspace/members') value = { members, invitations };
    else if (path === '/api/workspace/invitations') { invitations.push({ id: 'inv_a', email: String(body?.email), role: String(body?.role), expiresAt: '2026-10-30T10:00:00Z' }); status = 201; value = { id: 'inv_a', delivery: 'local' }; }
    else if (path === '/api/workspace/invitations/inv_a') { invitations = []; value = { ok: true }; }
    else if (path === '/api/workspace/members/usr_editor') { if (method === 'PATCH') members[1]!.role = String(body?.role); else members.pop(); value = { ok: true }; }
    else if (path === '/api/workspace/audit') value = { events: [{ id: 'evt_a', actorId: 'usr_owner', event: 'workspace.invited', resourceId: 'inv_a', details: { role: 'viewer' }, createdAt: '2026-10-29T10:00:00Z' }] };
    else if (path === '/api/auth/forgot-password') value = { ok: true, delivery: 'local', message: 'If an account exists, recovery instructions are queued when the configured delivery adapter is available.' };
    else if (path === '/api/auth/reset-password') { workspace = null; value = { ok: true }; }
    else if (path === '/api/auth/verify') { if (workspace) workspace.user.emailVerified = true; value = { ok: true }; }
    else if (path === '/api/auth/invitations/preview') value = { email: 'invited@example.test', companyName: 'Inviting Workspace', role: 'viewer' };
    else if (path === '/api/auth/invitations/accept') { workspace = { user: { id: 'usr_invited', name: String(body?.name ?? 'Existing Invitee'), email: 'invited@example.test', emailVerified: true }, tenant: { id: 'org_inviting', name: 'Inviting Workspace' }, role: 'viewer' }; value = { workspace }; }
    else { status = 404; value = { error: `Unhandled explicit account fixture ${method} ${path}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  });
  return calls;
}

test('viewer access disables mutations while allowing source, version and account inspection', async ({ page }) => {
  const calls = await setup(page, { role: 'viewer' }); await page.goto('/#dashboard'); await expect(page.getByText('You have viewer access.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Publish agent', exact: true })).toBeDisabled(); await expect(page.getByLabel(/^Instructions/)).toBeDisabled();
  await page.getByRole('tab', { name: /^Knowledge/ }).click(); await expect(page.getByRole('button', { name: 'Edit Saved guide', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Saved guide/ }).click(); await expect(page.locator('.document-preview')).toHaveText('Saved public knowledge');
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unpublish agent', exact: true })).toBeDisabled(); await page.getByRole('button', { name: 'Inspect version 1', exact: true }).click(); await page.getByRole('button', { name: 'Close snapshot', exact: true }).click();
  await page.getByRole('button', { name: 'Account & team', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Account & team', exact: true }); await dialog.getByRole('tab', { name: 'Team members', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Send invitation', exact: true })).toHaveCount(0);
  expect(calls.filter(call => call.path.startsWith('/api/agents/') && call.method !== 'GET')).toHaveLength(0);
});

test('account security errors preserve fields, team delivery is explicit, and workspace switching clears old editor state', async ({ page }) => {
  const calls = await setup(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/#dashboard'); await page.getByLabel(/^Instructions/).fill('Unsaved first workspace draft');
  await page.getByRole('button', { name: 'Account & team', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Account & team', exact: true });
  await expect(dialog.getByText('No email was sent.', { exact: false })).toHaveCount(0); await dialog.getByLabel('Your name', { exact: true }).fill('Updated Owner'); await dialog.getByRole('button', { name: 'Save profile', exact: true }).click(); await expect(dialog.getByText('Profile updated.', { exact: true })).toBeVisible();
  await dialog.getByLabel('Current password', { exact: true }).fill('wrong'); await dialog.getByLabel('New password', { exact: true }).fill(password); await dialog.getByLabel('Confirm new password', { exact: true }).fill(password); await dialog.getByRole('button', { name: 'Change password', exact: true }).click(); await expect(dialog.getByText('Current password is incorrect.', { exact: false })).toBeVisible(); await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue(password);
  await dialog.getByLabel('Current password', { exact: true }).fill(password); await dialog.getByRole('button', { name: 'Change password', exact: true }).click(); await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Request verification link', exact: true }).click(); await expect(dialog.getByText('No email was sent.', { exact: false })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Team members', exact: true }).click(); await expect(dialog.getByLabel('Role for owner@example.test', { exact: true })).toHaveCount(0); await dialog.getByLabel('Role for editor@example.test', { exact: true }).selectOption('viewer');
  await dialog.getByLabel('Teammate email', { exact: true }).fill('new@example.test'); await dialog.getByLabel('Invitation role', { exact: true }).selectOption('viewer'); await dialog.getByRole('button', { name: 'Send invitation', exact: true }).click(); await expect(dialog.getByText('new@example.test', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke invitation for new@example.test', exact: true }).click(); await expect(dialog.getByText('new@example.test', { exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Security activity', exact: true }).click(); await expect(dialog.getByText('workspace invited', { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'My account', exact: true }).click(); await dialog.getByRole('button', { name: 'Sign out other sessions', exact: true }).click(); await dialog.getByLabel('Switch workspace', { exact: true }).selectOption('org_second'); await dialog.getByRole('button', { name: 'Switch workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second Workspace Guide', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'First Workspace Guide', exact: true })).toHaveCount(0); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Saved instructions'); await expect(page.getByText('You have viewer access.', { exact: false })).toBeVisible();
  expect(calls.some(call => call.path === '/api/account/switch' && call.body?.tenantId === 'org_second')).toBe(true);
});

test('recovery links stay out of storage and request URLs, and successful reset removes the fragment', async ({ page }) => {
  const calls = await setup(page, { anonymous: true }); await page.goto('/#login'); await page.getByRole('button', { name: 'Forgot password?', exact: true }).click(); await page.getByLabel('Email address', { exact: true }).fill('unknown@example.test'); await page.getByRole('button', { name: 'Request recovery link', exact: true }).click(); await expect(page.getByText('If the account exists, its link uses', { exact: false })).toBeVisible();
  await page.evaluate(value => { location.hash = `account/reset?token=${value}`; }, token); const dialog = page.getByRole('dialog', { name: 'Reset your password', exact: true });
  await dialog.getByLabel('New password', { exact: true }).fill(password); await dialog.getByLabel('Confirm new password', { exact: true }).fill(password); await dialog.getByRole('button', { name: 'Reset password', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByText('Password reset. Sign in with your new password.', { exact: true })).toBeVisible(); expect(new URL(page.url()).hash).toBe('#login');
  expect(calls.find(call => call.path === '/api/auth/reset-password')?.body).toEqual({ token, password }); expect(calls.every(call => !call.path.includes(token))).toBe(true); expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain(token);
});

test('existing invitee signs in without losing the invitation and verification preserves viewer permissions', async ({ page }) => {
  const calls = await setup(page, { anonymous: true }); await page.goto(`/#account/invite?token=${token}`); const invite = page.getByRole('dialog', { name: 'Workspace invitation', exact: true }); await invite.getByRole('button', { name: 'Sign in to invited account', exact: true }).click(); await expect(invite.getByLabel('Email address', { exact: true })).toHaveValue('invited@example.test'); await expect(invite.getByLabel('Email address', { exact: true })).toHaveAttribute('readonly', '');
  await invite.getByLabel('Password', { exact: true }).fill(password); await invite.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(invite.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible(); expect(new URL(page.url()).hash).toContain(token); await invite.getByRole('button', { name: 'Accept invitation', exact: true }).click(); await expect(invite).toHaveCount(0); expect(new URL(page.url()).hash).toBe('#dashboard');
  expect(calls.find(call => call.path === '/api/auth/login')?.body).toEqual({ email: 'invited@example.test', password }); expect(calls.find(call => call.path === '/api/auth/invitations/accept')?.body).toEqual({ token });
  await page.reload();
  // The next fixture remains viewer-scoped; verification must not grant editing access.
  await page.evaluate(value => { location.hash = `account/verify?token=${value}`; }, token); const verify = page.getByRole('dialog', { name: 'Verify your email', exact: true }); await verify.getByRole('button', { name: 'Verify email address', exact: true }).click(); await expect(verify).toHaveCount(0); await expect(page.getByText('You have viewer access.', { exact: false })).toBeVisible(); expect(new URL(page.url()).hash).toBe('#dashboard');
});

test('verification and canceled malformed links preserve the editor draft and remove consumed or canceled fragments', async ({ page }) => {
  await setup(page); await page.goto('/#dashboard'); await page.getByLabel(/^Instructions/).fill('Unsaved draft stays through email verification');
  await page.evaluate(value => { location.hash = `account/verify?token=${value}`; }, token); const verify = page.getByRole('dialog', { name: 'Verify your email', exact: true }); await verify.getByRole('button', { name: 'Verify email address', exact: true }).click(); await expect(verify).toHaveCount(0); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Unsaved draft stays through email verification');
  await page.evaluate(() => { location.hash = 'account/reset?token=invalid'; }); const malformed = page.getByRole('dialog', { name: 'Invalid account link', exact: true }); await expect(malformed).toBeVisible(); await malformed.getByRole('button', { name: 'Cancel account link', exact: true }).click(); expect(new URL(page.url()).hash).toBe('#dashboard'); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Unsaved draft stays through email verification');
});

test('a new invited account joins with the requested role using only an explicit form submission', async ({ page }) => {
  const calls = await setup(page, { anonymous: true }); await page.goto(`/#account/invite?token=${token}`); const invite = page.getByRole('dialog', { name: 'Workspace invitation', exact: true }); await invite.getByLabel('Your name', { exact: true }).fill('New Invitee'); await invite.getByLabel('New account password', { exact: true }).fill(password); expect(calls.some(call => call.path.endsWith('/accept'))).toBe(false); await invite.getByRole('button', { name: 'Create account and join', exact: true }).click(); await expect(invite).toHaveCount(0); expect(calls.find(call => call.path.endsWith('/accept'))?.body).toEqual({ token, name: 'New Invitee', password }); await expect(page.getByText('You have viewer access.', { exact: false })).toBeVisible(); expect(new URL(page.url()).hash).toBe('#dashboard');
});

test('public website navigation asks before discarding an unsaved dashboard draft', async ({ page }) => {
  await setup(page); await page.goto('/#dashboard');
  await page.getByLabel(/^Instructions/).fill('Keep this unsaved draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.evaluate(() => { location.hash = 'product'; });
  await expect(page).toHaveURL(/#dashboard$/);
  await expect(page.getByLabel(/^Instructions/)).toHaveValue('Keep this unsaved draft');
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => { location.hash = 'product'; });
  await expect(page).toHaveURL(/#product$/);
  await expect(page.getByRole('link', { name: 'Open dashboard', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/^Instructions/)).toHaveCount(0);
});
