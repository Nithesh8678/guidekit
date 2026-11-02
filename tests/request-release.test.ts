import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type InferenceProvider } from '../apps/server/src/app.js';
import type { SQLResult } from '../apps/server/src/storage/driver.js';

const website = 'http://127.0.0.1:4411';
const page = { url: `${website}/`, title: 'Synthetic details page', targets: [{ id: 'open_details', label: 'Open details', role: 'button' }], actions: [], context: {} };
const answer = JSON.stringify({ answer: 'Open the highlighted details control.', steps: [{ targetId: 'open_details', text: 'Open details.' }], action: null, citationIds: [] });

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function entered(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic gate was not reached.')), 5_000); })]);
  } finally { clearTimeout(timer); }
}

async function fixture(infer: InferenceProvider['infer']) {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-request-release-'));
  const core = await createApp({ dataDir: directory, testing: true, adminOrigins: new Set(), provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit synthetic provider; no model connection.' }),
    infer, close: async () => {},
  } });
  const server = createServer(core.app);
  const close = async () => {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      try { await core.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const owner = await core.repo.register({ email: 'capacity@example.invalid', name: 'Synthetic tester', companyName: 'Synthetic workspace' }, 'fixture-no-login');
    const agent = await core.repo.createAgent(owner.tenant.id, { name: 'Synthetic Guide', companyName: 'Synthetic', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] });
    await core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Details workflow', content: 'Open details to inspect this page.' });
    await core.repo.publish(owner.tenant.id, agent.id);
    const started = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5_000) });
    assert.equal(started.status, 200);
    const { token } = await started.json() as { token: string };
    const ask = (requestId: string) => fetch(`${base}/api/embed/session/ask`, {
      method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ page, message: 'Show how to open details', requestId }), signal: AbortSignal.timeout(5_000),
    });
    return { core, ask, close };
  } catch (error) { await close(); throw error; }
}

test('a completed HTTP answer releases session capacity before a blocked duration-metadata write', async () => {
  let inferenceCalls = 0, completedWrites = 0;
  const state = await fixture(async () => { inferenceCalls++; return answer; });
  const metadataEntered = gate(), releaseMetadata = gate();
  const pendingWrites: Promise<SQLResult>[] = [];
  const prepare = state.core.repo.db.prepare.bind(state.core.repo.db);
  // Delay only optional telemetry. The actual run insert, answer transaction,
  // retrieval and reads still use the real temporary SQLite driver.
  state.core.repo.db.prepare = sql => {
    const statement = prepare(sql);
    if (sql !== 'UPDATE runs SET duration_ms=? WHERE id=?') return statement;
    return {
      get: statement.get.bind(statement), all: statement.all.bind(statement),
      run(...values) {
        const write = (async () => {
          metadataEntered.resolve();
          await releaseMetadata.promise;
          const result = await statement.run(...values); completedWrites++;
          return result;
        })();
        pendingWrites.push(write);
        return write;
      },
    };
  };
  try {
    const first = await state.ask('completed_first');
    assert.equal(first.status, 200); await first.json();
    await entered(metadataEntered.promise);
    assert.equal(pendingWrites.length, 1); assert.equal(completedWrites, 0);
    // The first response has finished but its telemetry gate is still closed.
    // A real continuation on the same origin-bound session must start now.
    const second = await state.ask('completed_continuation');
    assert.equal(second.status, 200); await second.json();
    assert.equal(inferenceCalls, 2); assert.equal(pendingWrites.length, 2); assert.equal(completedWrites, 0);
    assert.deepEqual((await state.core.repo.rows('SELECT status,duration_ms FROM runs')).map(run => ({ status: run.status, duration: run.duration_ms })), [
      { status: 'answered', duration: null }, { status: 'answered', duration: null },
    ]);
    releaseMetadata.resolve();
    await Promise.all(pendingWrites);
    assert.equal(completedWrites, 2);
    assert.ok((await state.core.repo.rows('SELECT duration_ms FROM runs')).every(run => typeof run.duration_ms === 'number' && run.duration_ms >= 0));
  } finally {
    releaseMetadata.resolve();
    try { await Promise.all(pendingWrites); }
    finally { state.core.repo.db.prepare = prepare; await state.close(); }
  }
});

test('genuinely in-flight inference still rejects another question on the same session', async () => {
  let inferenceCalls = 0;
  const inferenceEntered = gate(), releaseInference = gate();
  const state = await fixture(async () => {
    inferenceCalls++;
    if (inferenceCalls === 1) { inferenceEntered.resolve(); await releaseInference.promise; }
    return answer;
  });
  const first = state.ask('in_flight_first');
  try {
    await entered(inferenceEntered.promise);
    const overlap = await state.ask('in_flight_overlap');
    assert.equal(overlap.status, 429);
    assert.match((await overlap.json() as { error: string }).error, /assistant is busy/i);
    assert.equal(inferenceCalls, 1);
    assert.equal((await state.core.repo.row('SELECT COUNT(*) AS count FROM runs'))!.count, 1);
    releaseInference.resolve();
    const finished = await first; assert.equal(finished.status, 200); await finished.json();
    const continuation = await state.ask('after_in_flight');
    assert.equal(continuation.status, 200); await continuation.json(); assert.equal(inferenceCalls, 2);
  } finally {
    releaseInference.resolve();
    await first.catch(() => undefined);
    await state.close();
  }
});
