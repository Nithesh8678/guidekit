/** Manual opt-in integration proof. Uses the signed-in owner's ChatGPT usage. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';
import { createCodexProvider } from '../packages/runtime/src/index.js';
import type { RunResult } from '../packages/contracts/src/index.js';

const directory = await mkdtemp(join(tmpdir(), 'guidekit-live-proof-'));
const provider = createCodexProvider({ model: process.env.GUIDEKIT_MODEL, bin: process.env.GUIDEKIT_CODEX_BIN, cwd: join(directory, 'model') });
const core = createApp({ dataDir: directory, provider, adminOrigins: new Set() });
const server = createServer(core.app);
await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, origin = 'http://127.0.0.1:4411';
const post = async (path: string, body: unknown, token?: string) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Live HTTP proof failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
};
try {
  const status = await provider.status(); assert.ok(status.available && status.authenticated, status.message);
  const owner = core.repo.register({ email: 'synthetic-live-proof@example.invalid', name: 'Synthetic test owner', companyName: 'Synthetic Northstar' }, 'no-login-enabled-for-this-test');
  const agent = core.repo.createAgent(owner.tenant.id, { name: 'Live proof guide', companyName: 'Synthetic Northstar', description: 'Synthetic public test data only.', instructions: 'Answer using the handbook and propose the supplied action for explicit creation requests.', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [origin], allowedActions: ['create_contact'] });
  const doc = core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Synthetic contact handbook', content: 'Synthetic Northstar offers a 17-day trial. To create a contact, supply name and company, choose New, and use Create contact. create_contact requires visitor approval before execution. The host verifies that the record was saved.' });
  core.repo.publish(owner.tenant.id, agent.id);
  const session = await post(`/api/embed/${agent.id}/session`, {}) as { token: string };
  const run = await post('/api/embed/session/ask', {
    requestId: 'synthetic_live_proof', message: 'Tell me the Northstar trial duration, then propose creating a contact named Jamie Rivera at Acme Studio with status New. I will review and confirm the proposal.',
    page: { url: `${origin}/`, title: 'Synthetic Northstar CRM', context: { contacts: [] }, targets: [{ id: 'create-contact', label: 'Create contact', role: 'button' }], actions: [{ name: 'create_contact', description: 'Create a contact after visitor approval and verify its persistence.', requiresConfirmation: true, inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'company', 'status'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, company: { type: 'string', minLength: 1, maxLength: 100 }, status: { type: 'string', enum: ['New', 'Qualified', 'Customer'] } } } }] }
  }, session.token) as RunResult;
  assert.match(run.answer, /17/); assert.ok(run.citations.some(c => c.documentId === doc.id));
  assert.equal(run.action?.name, 'create_contact'); assert.equal(run.action.requiresConfirmation, true);
  assert.equal(run.action.arguments.name, 'Jamie Rivera'); assert.equal(run.action.arguments.company, 'Acme Studio');
  // This explicitly approved synthetic host operation is separate from browser
  // acceptance tests. Write/read a real disposable record before reporting it.
  const recordPath = join(directory, 'synthetic-host-record.json');
  await writeFile(recordPath, JSON.stringify({ receiptId: run.action.receiptId, ...run.action.arguments }), { mode: 0o600 });
  const stored = JSON.parse(await readFile(recordPath, 'utf8')); assert.equal(stored.receiptId, run.action.receiptId);
  await post('/api/embed/session/action-result', { receiptId: run.action.receiptId, status: 'succeeded', message: 'Synthetic host record saved and read back successfully.' }, session.token);
  assert.equal(core.repo.row('SELECT status FROM runs WHERE id=?', run.runId)?.status, 'action_succeeded');
  console.log(JSON.stringify({ realSubscriptionInference: true, groundedAnswer: true, citedPublishedDocument: true, schemaValidatedProposal: true, syntheticHostPersistenceVerified: true, receiptRecorded: true, runtime: await provider.status() }, null, 2));
} finally {
  await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(directory, { recursive: true, force: true });
}
