import { test as base, expect, type Page } from '@playwright/test';
import type { Agent, AgentConfig, KnowledgeDocument } from '@guidekit/contracts';
import type { PublicationVersion } from '../src/shared';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await use(errors); expect(errors, 'The dashboard must not produce uncaught browser errors').toEqual([]);
  }, { auto: true }]
});

async function fixture(page: Page, options: { pending?: boolean; legacy?: boolean; history?: boolean; viewer?: boolean; manifest?: 'pinned' | 'invalid' } = {}) {
  const config: AgentConfig = { name: 'QA Product Guide', companyName: 'Synthetic QA', description: '', instructions: 'Original instructions', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4641'], allowedActions: ['create_contact'] };
  const agent: Agent = { ...config, id: 'agt_dashboard', tenantId: 'org_qa', createdAt: '2026-10-29T10:00:00Z', updatedAt: '2026-10-29T10:00:00Z', publishedVersion: 1 };
  let documents: KnowledgeDocument[] = [{ id: 'doc_guide', title: 'Product guide', content: 'Original saved knowledge <script>safe text</script>', createdAt: '2026-10-29T10:00:00Z' }];
  const snapshots = new Map([[1, { config: structuredClone(config), documents: structuredClone(documents) }]]);
  const versions: PublicationVersion[] = [{ number: 1, createdAt: '2026-10-29T10:00:00Z', documentCount: 1, status: 'ready', graphSource: 'local' }];
  if (options.history) { versions.push({ number: 2, createdAt: '2026-10-29T10:05:00Z', documentCount: 1, status: 'ready', graphSource: 'local' }); snapshots.set(2, { config: structuredClone(config), documents: [{ ...documents[0]!, title: 'Updated product guide' }] }); }
  if (options.legacy) delete (versions[0] as Partial<PublicationVersion>).status;
  if (options.pending) versions.push({ number: 2, createdAt: '2026-10-29T10:05:00Z', documentCount: 1, status: 'syncing', graphSource: 'tigergraph' });
  let documentFails = true, diagnosticsFail = false, retrievalFails = false;
  const requests: { path: string; method: string; body?: unknown }[] = [];
  await page.route('**/sdk/manifest.json', route => route.fulfill({ status: options.manifest ? 200 : 404, contentType: 'application/json', body: JSON.stringify(options.manifest ? { version: '0.2.0-alpha.1', release: 'a'.repeat(24), capabilities: { apiVersion: 1 }, script: { path: options.manifest === 'invalid' ? 'https://example.invalid/untrusted.js' : `/sdk/releases/${'a'.repeat(24)}/guidekit.js`, integrity: `sha384-${'A'.repeat(64)}` } } : { error: 'Explicit development-alias fixture.' }) }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(); requests.push({ path, method, ...(route.request().postData() ? { body: route.request().postDataJSON() } : {}) });
    let body: unknown, status = 200;
    if (path === '/api/auth/me') body = { workspace: { user: { id: 'usr_qa', name: 'Synthetic Tester', email: 'synthetic@example.test' }, tenant: { id: 'org_qa', name: 'Synthetic QA' }, ...(options.viewer ? { role: 'viewer' } : {}) } };
    else if (path === '/api/runtime/status') body = { provider: 'openai', available: false, authenticated: false, message: 'Prepared API provider; no test credential configured.' };
    else if (path === '/api/agents' && method === 'GET') body = { agents: [agent] };
    else if (path === '/api/agents/agt_dashboard' && method === 'GET') body = { agent, documents, versions: [...versions].reverse(), sessions: [{ id: 'run_ok', question: 'Completed synthetic action', answer: 'Saved', status: 'action_succeeded', createdAt: agent.createdAt, actionName: 'create_contact' }, { id: 'run_fail', question: 'Failed synthetic action', answer: 'Could not save', status: 'action_failed', createdAt: agent.createdAt, actionName: 'create_contact' }] };
    else if (path === '/api/agents/agt_dashboard' && method === 'PUT') { Object.assign(agent, route.request().postDataJSON()); body = { agent }; }
    else if (path.endsWith('/metrics')) body = { periodStart: '2026-10-29T00:00:00Z', statuses: [{ status: 'action_succeeded', count: 2, averageDurationMs: 1240 }, { status: 'failed', count: 1, averageDurationMs: null }], workspaceUsage: { runs: 3, dailyLimit: 100, remaining: 97 } };
    else if (path.endsWith('/knowledge-preview')) { const input = route.request().postDataJSON(); if (retrievalFails) { status = 502; body = { error: 'Synthetic graph retrieval unavailable. No fallback answer generated.' }; } else body = { version: input.version, citations: [{ documentId: 'doc_guide', title: 'Product guide', excerpt: 'Original saved knowledge <script>safe text</script>' }], knowledge: { source: 'tigergraph', paths: [{ nodes: ['doc_guide', 'billing', 'doc_guide'], relation: 'Shared billing concept' }] }, sufficient: true, message: 'Source matches found. Review them for factual support before relying on an answer.' }; }
    else if (path.endsWith('/knowledge-evaluate')) { const input = route.request().postDataJSON(); body = { version: input.version, cases: input.cases.map((item: { question: string; expectedDocumentIds: string[] }) => ({ question: item.question, retrievedDocumentIds: item.expectedDocumentIds, recall: 1, precision: 1, reciprocalRank: 1 })), meanRecall: 1, meanReciprocalRank: 1, scope: 'retrieval-only; does not grade generated answers' }; }
    else if (path.endsWith('/diagnostics')) {
      if (diagnosticsFail) { status = 503; body = { error: 'Synthetic setup check failure. Retry when the server is available.' }; }
      else body = { endpointOrigin: 'http://127.0.0.1:4640', demoOrigins: { crm: 'http://127.0.0.1:4641', support: 'http://127.0.0.1:4642' }, ready: !!agent.publishedVersion, checks: [{ id: 'runtime', status: 'warning', message: 'Explicit synthetic contract fixture; no model request.' }, { id: 'publication', status: agent.publishedVersion ? 'pass' : 'error', message: agent.publishedVersion ? `Ready publication ${agent.publishedVersion}` : 'Publish or activate a ready version.' }] };
    } else if (path.endsWith('/documents/doc_guide') && method === 'PUT') {
      if (documentFails) { documentFails = false; status = 503; body = { error: 'Synthetic document save failure. Retry safely.' }; }
      else { documents = [{ ...documents[0]!, ...route.request().postDataJSON() }]; body = { document: documents[0] }; }
    } else if (path.endsWith('/publish')) {
      const version: PublicationVersion = { number: 2, createdAt: '2026-10-29T10:05:00Z', documentCount: 1, status: 'failed', graphSource: 'tigergraph', error: 'Synthetic sync failure.' };
      versions.push(version); snapshots.set(2, { config: structuredClone(agent), documents: structuredClone(documents) }); status = 201; body = { version, activeVersion: agent.publishedVersion };
    } else if (path.endsWith('/versions/2/retry')) { Object.assign(versions[1]!, { status: 'ready', error: undefined }); agent.publishedVersion = 2; body = { version: versions[1], activeVersion: agent.publishedVersion }; }
    else if (/\/versions\/\d+\/activate$/.test(path)) { const number = Number(path.split('/').at(-2)); agent.publishedVersion = number; body = { version: versions.find(version => version.number === number), activeVersion: number }; }
    else if (path.endsWith('/unpublish')) { agent.publishedVersion = null; body = { activeVersion: null }; }
    else if (/\/versions\/\d+$/.test(path)) { const number = Number(path.split('/').at(-1)); body = { version: versions.find(version => version.number === number), ...snapshots.get(number) }; }
    else { status = 404; body = { error: `Unhandled contract fixture path ${method} ${path}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/'); await expect(page.getByRole('heading', { name: config.name, exact: true })).toBeVisible();
  return { requests, failRetrieval() { retrievalFails = true; }, failDiagnostics() { diagnosticsFail = true; }, completeCandidate() { versions[1]!.status = 'ready'; agent.publishedVersion = 2; } };
}

test('document editing survives tab changes and failed saves, while published knowledge stays immutable and safe', async ({ page }) => {
  await fixture(page);
  await page.getByRole('tab', { name: /^Knowledge/ }).click(); await page.getByRole('button', { name: 'Edit Product guide', exact: true }).click();
  await page.getByLabel('Document text', { exact: true }).fill('Updated synthetic draft knowledge');
  await expect(page.getByRole('button', { name: 'Publish agent', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await page.getByLabel(/^Instructions/).fill('Unsaved configuration remains intact');
  await page.getByRole('tab', { name: /^Knowledge/ }).click(); await expect(page.getByLabel('Document text', { exact: true })).toHaveValue('Updated synthetic draft knowledge');
  await page.getByRole('button', { name: 'Save document', exact: true }).click(); await expect(page.getByText('Synthetic document save failure. Retry safely.', { exact: true })).toBeVisible(); await expect(page.getByLabel('Document text', { exact: true })).toHaveValue('Updated synthetic draft knowledge');
  await page.getByRole('button', { name: 'Save document', exact: true }).click(); await expect(page.getByText('Document updated in the draft.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await expect(page.getByLabel(/^Instructions/)).toHaveValue('Unsaved configuration remains intact');
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await page.getByRole('button', { name: 'Inspect version 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Version 1 snapshot', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByText('Product guide', { exact: true }).click();
  await expect(dialog).toContainText('Original saved knowledge <script>safe text</script>'); await expect(dialog).not.toContainText('Updated synthetic draft knowledge'); expect(await dialog.locator('script').count()).toBe(0);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Inspect version 1', exact: true })).toBeFocused();
});

test('failed publication preserves the active version and supports retry, ready activation, rollback and unpublish', async ({ page }) => {
  const state = await fixture(page); page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Publish agent', exact: true }).click(); await expect(page.getByText('Live v1', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Version 2', exact: true })).toContainText('Publication needs attention'); await expect(page.getByRole('button', { name: 'Activate version 2', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry version 2', exact: true }).click(); await expect(page.getByText('Live v2', { exact: true })).toBeVisible();
  expect(state.requests.filter(request => request.path.endsWith('/publish'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Activate version 1', exact: true }).click(); await expect(page.getByText('Live v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activate version 2', exact: true }).click(); await expect(page.getByText('Live v2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish agent', exact: true }).click(); await expect(page.getByText('No active publication', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Activate version 1', exact: true })).toBeVisible();
  await expect(page.getByText('Agent unpublished. New website sessions are stopped; existing sessions keep their pinned version.', { exact: true })).toBeVisible();
});

test('setup uses configured nondefault origins, reports failed checks honestly, and renders canonical action outcomes on mobile', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByText('OpenAI API unavailable', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await expect(page.locator('pre code')).toContainText('http://127.0.0.1:4640/sdk/guidekit.js'); await expect(page.locator('pre code')).not.toContainText(':4410');
  await expect(page.getByRole('link', { name: 'Open Contact CRM', exact: false })).toHaveAttribute('href', 'http://127.0.0.1:4641/?agentId=agt_dashboard');
  await expect(page.getByRole('link', { name: 'Open the SDK installation lab', exact: true })).toHaveAttribute('href', 'http://127.0.0.1:4641/?install=manual');
  state.failDiagnostics(); await page.getByRole('button', { name: 'Check setup', exact: true }).click(); await expect(page.getByText('Synthetic setup check failure. Retry when the server is available.', { exact: true })).toBeVisible(); await expect(page.getByText('Setup checks passed.', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await expect(page.locator('.activity-item').filter({ hasText: 'Completed synthetic action' }).locator('.badge')).toHaveClass(/badge-green/); await expect(page.locator('.activity-item').filter({ hasText: 'Failed synthetic action' }).locator('.badge')).toHaveClass(/badge-red/);
});

test('candidate readiness polling and legacy version inspection preserve an unsaved configuration draft', async ({ page }) => {
  const state = await fixture(page, { pending: true, legacy: true });
  await expect(page.getByRole('button', { name: 'Publish agent', exact: true })).toBeDisabled(); await page.getByLabel(/^Instructions/).fill('A draft edited during graph synchronization');
  state.completeCandidate(); await expect(page.getByText('Live v2', { exact: true })).toBeVisible({ timeout: 6000 }); await expect(page.getByLabel(/^Instructions/)).toHaveValue('A draft edited during graph synchronization');
  await page.getByRole('tab', { name: 'Install', exact: true }).click(); await expect(page.getByRole('article', { name: 'Version 1', exact: true })).toContainText('Ready snapshot'); await expect(page.getByRole('button', { name: 'Activate version 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check setup', exact: true }).click(); await page.getByRole('tab', { name: 'Agent setup', exact: true }).click(); await expect(page.getByLabel(/^Instructions/)).toHaveValue('A draft edited during graph synchronization');
});

test('viewers preview scoped sources and evaluate expected documents without a model call, and snapshot changes clear cases', async ({ page }) => {
  const state = await fixture(page, { history: true, viewer: true }); await page.getByRole('tab', { name: /^Knowledge/ }).click();
  await page.getByLabel('Retrieval test question', { exact: true }).fill('Where is the billing policy?'); await page.getByRole('button', { name: 'Preview retrieved sources', exact: true }).click(); await expect(page.getByText('Retrieved with TigerGraph relationships.', { exact: true })).toBeVisible(); await expect(page.locator('.retrieval-source')).toContainText('Original saved knowledge <script>safe text</script>'); expect(await page.locator('.retrieval-source script').count()).toBe(0);
  await page.getByText('Evaluate a temporary question set', { exact: true }).click(); await page.getByRole('checkbox', { name: 'Product guide', exact: true }).check(); await page.getByRole('button', { name: 'Add evaluation case', exact: true }).click(); await page.getByRole('button', { name: 'Evaluate 1 case', exact: true }).click(); await expect(page.getByText('Version 1: mean recall 100% · mean reciprocal rank 1.00', { exact: true })).toBeVisible();
  expect(state.requests.find(request => request.path.endsWith('/knowledge-evaluate'))?.body).toEqual({ version: 1, cases: [{ question: 'Where is the billing policy?', expectedDocumentIds: ['doc_guide'] }] }); expect(state.requests.some(request => request.path.includes('/embed/session/ask'))).toBe(false);
  await page.getByLabel('Knowledge snapshot', { exact: true }).selectOption('2'); await page.getByText('Evaluate a temporary question set', { exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Updated product guide', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Remove evaluation case 1', exact: true })).toHaveCount(0); await expect(page.locator('.evaluation-result')).toHaveCount(0);
  state.failRetrieval(); await page.getByRole('button', { name: 'Preview retrieved sources', exact: true }).click(); await expect(page.getByText('Synthetic graph retrieval unavailable. No fallback answer generated.', { exact: true })).toBeVisible(); await expect(page.locator('.retrieval-source')).toHaveCount(0);
});

test('installation pins a reviewed manifest with integrity and usage distinguishes workspace totals from agent durations', async ({ page }) => {
  await fixture(page, { manifest: 'pinned' }); await page.getByRole('tab', { name: 'Install', exact: true }).click(); await expect(page.getByText('Pinned SDK 0.2.0-alpha.1', { exact: false })).toBeVisible(); await expect(page.locator('pre code')).toContainText(`/sdk/releases/${'a'.repeat(24)}/guidekit.js`); await expect(page.locator('pre code')).toContainText(`integrity="sha384-${'A'.repeat(64)}"`); await expect(page.locator('pre code')).toContainText('crossorigin="anonymous"');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await expect(page.getByRole('region', { name: 'Request usage', exact: true })).toContainText('3 / 100 used · 97 remaining across all agents'); await expect(page.getByRole('region', { name: 'Request usage', exact: true })).toContainText('1,240 ms'); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an incompatible SDK manifest clearly falls back to the unversioned development alias', async ({ page }) => {
  await fixture(page, { manifest: 'invalid' }); await page.getByRole('tab', { name: 'Install', exact: true }).click(); await expect(page.getByText('Development alias: unversioned SDK.', { exact: false })).toBeVisible(); await expect(page.locator('pre code')).toContainText('http://127.0.0.1:4640/sdk/guidekit.js'); await expect(page.locator('pre code')).not.toContainText('example.invalid'); await expect(page.locator('pre code')).not.toContainText('integrity=');
});
