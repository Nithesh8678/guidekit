import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = /(^|\/)(\.data|\.backups|account-outbox|node_modules|artifacts|test-results|playwright-report)(\/|$)|(^|\/)\.env(\.|$)(?!example$)|\.(sqlite|db)(-|$)|auth\.json$|(^|\/)\.service\.lock$|\.restore\.lock$|\.secret$/;
const secret = /(?:sk-[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
let bad = 0;
for (const name of names) {
  if (forbidden.test(name) || secret.test(readFileSync(name, 'utf8'))) { console.error(`Potential secret or runtime artifact: ${name}`); bad++; }
}
if (bad) process.exit(1);
console.log(`Checked ${names.length} tracked files; no known secret patterns or runtime artifacts.`);
