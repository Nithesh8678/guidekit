import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../apps/server/src/database.js';
import { Publications } from '../apps/server/src/publications.js';
import { acquireProcessLock } from '../apps/server/src/process-lock.js';
import type { TigerGraphProvider, GraphSnapshot } from '../packages/graph/src/index.js';

const config = { name: 'Test guide', companyName: 'Test company', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: ['http://127.0.0.1:4411'], allowedActions: [] };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };

test('publication candidates preserve the active snapshot through failures, retries, rollback and late completion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-publish-')), repo = new Repository(dir);
  const owner = repo.register({ email: 'release@example.invalid', name: 'Release owner', companyName: 'Release' }, 'test-hash');
  const other = repo.register({ email: 'other@example.invalid', name: 'Other owner', companyName: 'Other' }, 'test-hash');
  const agent = repo.createAgent(owner.tenant.id, config), document = repo.addDocument(owner.tenant.id, agent.id, { title: 'Contact guide', content: 'The first immutable content.' });
  let fail = false, gate: ReturnType<typeof deferred> | undefined; const calls: GraphSnapshot[] = [];
  const graph: TigerGraphProvider = {
    status: async () => ({ configured: true, connected: true, message: 'Explicit test graph.' }),
    retrieve: async () => ({ source: 'tigergraph', citations: [], paths: [] }),
    syncVersion: async snapshot => { calls.push(structuredClone(snapshot)); await gate?.promise; if (fail) throw new Error('private provider detail must not escape'); return { vertices: 3, edges: 2 }; }
  };
  const publications = new Publications(repo, graph);
  try {
    await t.test('first candidate is invisible until graph readiness; concurrent publish is rejected', async () => {
      gate = deferred(); const pending = publications.publish(owner.tenant.id, agent.id); await Promise.resolve();
      assert.equal(repo.detail(owner.tenant.id, agent.id).versions[0]!.status, 'syncing');
      assert.equal(repo.agent(owner.tenant.id, agent.id).publishedVersion, null);
      assert.throws(() => repo.published(agent.id), /no published version/);
      await assert.rejects(publications.publish(owner.tenant.id, agent.id), /preparing a version/);
      gate.resolve(); const result = await pending; gate = undefined;
      assert.equal(result.version.status, 'ready'); assert.equal(result.activeVersion, 1);
    });
    await t.test('failed graph candidate leaves the prior publication usable and hides provider details', async () => {
      repo.updateDocument(owner.tenant.id, agent.id, document.id, { title: 'Updated guide', content: 'The second content.' }); fail = true;
      const result = await publications.publish(owner.tenant.id, agent.id);
      assert.equal(result.version.number, 2); assert.equal(result.version.status, 'failed'); assert.equal(result.activeVersion, 1);
      assert.doesNotMatch(result.version.error!, /private provider/);
      assert.equal(repo.published(agent.id).documents[0]!.content, 'The first immutable content.');
      assert.throws(() => publications.activate(owner.tenant.id, agent.id, 2), /not ready/);
    });
    await t.test('retry syncs the saved snapshot even after draft edits and activation is tenant scoped', async () => {
      repo.updateDocument(owner.tenant.id, agent.id, document.id, { title: 'Draft three', content: 'Third unpublished content.' }); fail = false;
      const result = await publications.prepare(owner.tenant.id, agent.id, 2);
      assert.equal(result.activeVersion, 2); assert.equal(result.version.number, 2);
      assert.equal(calls.at(-1)!.documents[0]!.content, 'The second content.');
      assert.throws(() => repo.version(other.tenant.id, agent.id, 2), /not found/);
      await assert.rejects(publications.publish(other.tenant.id, agent.id), /not found/);
      assert.throws(() => publications.activate(other.tenant.id, agent.id, 1), /not found/);
    });
    await t.test('rollback fences a later candidate and next version numbers remain monotonic', async () => {
      gate = deferred(); const pending = publications.publish(owner.tenant.id, agent.id); await Promise.resolve();
      publications.activate(owner.tenant.id, agent.id, 1); gate.resolve(); const result = await pending; gate = undefined;
      assert.equal(result.version.number, 3); assert.equal(result.version.status, 'ready'); assert.equal(result.activeVersion, 1);
      publications.activate(owner.tenant.id, agent.id, 3);
      assert.equal((await publications.publish(owner.tenant.id, agent.id)).version.number, 4);
    });
    await t.test('unpublish fences a pending sync while pinned snapshots remain readable', async () => {
      gate = deferred(); const pending = publications.publish(owner.tenant.id, agent.id); await Promise.resolve();
      repo.unpublish(owner.tenant.id, agent.id); gate.resolve(); const result = await pending; gate = undefined;
      assert.equal(result.version.number, 5); assert.equal(result.activeVersion, null);
      assert.throws(() => repo.published(agent.id), /no published/);
      assert.equal(repo.published(agent.id, 1).documents[0]!.content, 'The first immutable content.');
    });
    await t.test('restart makes interrupted preparation retryable and graph removal cannot activate graph versions', async () => {
      const version = repo.publish(owner.tenant.id, agent.id, 'tigergraph');
      const restarted = new Publications(repo);
      assert.equal(repo.version(owner.tenant.id, agent.id, version.number).version.status, 'failed');
      const retried = await restarted.prepare(owner.tenant.id, agent.id, version.number);
      assert.equal(retried.version.status, 'failed');
      assert.throws(() => restarted.activate(owner.tenant.id, agent.id, 1), /requires TigerGraph/);
      await restarted.close();
    });
  } finally { gate?.resolve(); await publications.close(); repo.close(); await rm(dir, { recursive: true, force: true }); }
});

test('graph configuration upgrades verify the active local snapshot without activating newer drafts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-upgrade-')); let repo = new Repository(dir);
  const owner = repo.register({ email: 'upgrade@example.invalid', name: 'Upgrade owner', companyName: 'Upgrade' }, 'test-hash');
  const agent = repo.createAgent(owner.tenant.id, config); repo.addDocument(owner.tenant.id, agent.id, { title: 'Guide', content: 'Saved company knowledge.' });
  repo.publish(owner.tenant.id, agent.id); repo.publish(owner.tenant.id, agent.id); repo.activateVersion(owner.tenant.id, agent.id, 1); repo.close();
  repo = new Repository(dir); const gate = deferred();
  const graph: TigerGraphProvider = { status: async () => ({ configured: true, connected: true, message: 'Fixture' }), retrieve: async () => ({ source: 'tigergraph', citations: [], paths: [] }), syncVersion: async () => { await gate.promise; return { vertices: 1, edges: 0 }; } };
  const publications = new Publications(repo, graph);
  try {
    assert.equal(repo.agent(owner.tenant.id, agent.id).publishedVersion, 1);
    assert.throws(() => repo.published(agent.id), /preparing/);
    gate.resolve(); await publications.close();
    assert.equal(repo.published(agent.id).graphSource, 'tigergraph'); assert.equal(repo.published(agent.id).version, 1);
    assert.equal(repo.version(owner.tenant.id, agent.id, 2).version.status, 'failed');
  } finally { gate.resolve(); await publications.close(); repo.close(); await rm(dir, { recursive: true, force: true }); }
});

test('service lock rejects live instances and restore coordination, releases cleanly, and recovers stale PID locks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guidekit-lock-'));
  try {
    const release = acquireProcessLock(dir); assert.throws(() => acquireProcessLock(dir), /already running/); release(); release();
    await writeFile(join(dir, '.service.lock'), JSON.stringify({ pid: 2147483647 })); acquireProcessLock(dir)();
    await writeFile(join(dir, '.service.lock'), 'invalid'); assert.throws(() => acquireProcessLock(dir), /lock is invalid/); await rm(join(dir, '.service.lock'));
    await mkdir(`${dir}.restore.lock`); assert.throws(() => acquireProcessLock(dir), /restore is in progress/);
  } finally { await rm(`${dir}.restore.lock`, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});
