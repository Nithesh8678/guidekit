import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Coordinate the local service with offline restore, without touching database contents. */
export function acquireProcessLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, '.service.lock');
  if (existsSync(`${dataDir}.restore.lock`)) throw new Error('An offline restore is in progress. Finish it before starting GuideKit.');
  if (existsSync(path)) {
    let pid: number;
    try { pid = JSON.parse(readFileSync(path, 'utf8')).pid; if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(); }
    catch { throw new Error('The service lock is invalid. Verify no GuideKit process is running before removing it.'); }
    try { process.kill(pid, 0); throw new Error('GuideKit is already running for this data directory.'); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) throw error; }
    unlinkSync(path);
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' });
  // Restore also checks this lock after taking its sibling lock. Cover either interleaving.
  if (existsSync(`${dataDir}.restore.lock`)) { unlinkSync(path); throw new Error('An offline restore is in progress.'); }
  let released = false;
  return () => {
    if (released) return; released = true;
    try { if (JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) unlinkSync(path); } catch { /* A missing lock is already released. */ }
  };
}
