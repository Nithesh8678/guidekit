import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Repository } from '../apps/server/src/database.js';

/** Preview by default. Never deletes knowledge, publications, accounts or active receipts. */
export function retainHistory(repo: Repository, days: number, apply = false) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error('Retention days must be an integer from 1 to 3650.');
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString(), grace = Date.now() - 86_400_000;
  const eligible = "SELECT r.id FROM runs r JOIN embed_sessions e ON e.id=r.session_id WHERE r.created_at<? AND e.expires<? AND r.status NOT IN ('running','awaiting_confirmation')";
  const runs = Number(repo.row(`SELECT COUNT(*) AS count FROM runs WHERE id IN (${eligible})`, cutoff, grace)!.count);
  const audit = Number(repo.row('SELECT COUNT(*) AS count FROM audit_events WHERE created_at<?', cutoff)!.count);
  if (apply) repo.transaction(() => {
    repo.db.prepare(`DELETE FROM receipts WHERE run_id IN (${eligible})`).run(cutoff, grace);
    repo.db.prepare(`DELETE FROM runs WHERE id IN (${eligible})`).run(cutoff, grace);
    repo.db.prepare('DELETE FROM embed_sessions WHERE expires<? AND id NOT IN (SELECT session_id FROM runs)').run(grace);
    repo.db.prepare('DELETE FROM account_tokens WHERE expires<?').run(grace);
    repo.db.prepare('DELETE FROM dashboard_sessions WHERE expires<?').run(Date.now());
    repo.db.prepare('DELETE FROM audit_events WHERE created_at<?').run(cutoff);
  });
  return { applied: apply, cutoff, eligibleRuns: runs, eligibleAuditEvents: audit, note: 'Knowledge, versions, accounts and pending/running work are retained. External TigerGraph data and local account outbox files are unaffected.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('Usage: npm run retention -- --days 30 [--data-dir .data] [--apply]\nDefaults to a preview. Take a verified backup before --apply.');
  else {
    const allowed = new Set(['--days', '--data-dir', '--apply']);
    let directory = '.data', days = 30, apply = false;
    for (let i = 0; i < args.length; i++) { const arg = args[i]!; if (!allowed.has(arg)) throw new Error('Unknown retention option. Use --help.'); if (arg === '--apply') apply = true; else { const value = args[++i]; if (!value) throw new Error('Missing retention option value.'); if (arg === '--days') days = Number(value); else directory = value; } }
    const repo = new Repository(resolve(directory)); try { console.log(JSON.stringify(retainHistory(repo, days, apply), null, 2)); } finally { repo.close(); }
  }
}
