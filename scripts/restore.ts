import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { restoreBackup } from './storage-archive.js';
export { restoreBackup, assertOffline } from './storage-archive.js';

export async function restoreCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { source: { type: 'string' }, 'data-dir': { type: 'string' }, port: { type: 'string' }, 'safety-backup': { type: 'string' }, force: { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run restore -- --source ARCHIVE --data-dir NEW_DATA_DIRECTORY --offline [--port 4410]\nExisting data requires explicit --force; the original directory and a safety snapshot are retained.'); return; }
  if (!values.source || !values['data-dir']) throw new Error('Restore requires explicit --source and --data-dir paths.');
  const result = await restoreBackup({ archive: values.source, dataDir: values['data-dir'], offline: values.offline === true, force: values.force, port: values.port === undefined ? 4410 : Number(values.port), safetyBackup: values['safety-backup'] });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) restoreCli().catch(error => { console.error(error instanceof Error ? error.message : 'Restore failed.'); process.exitCode = 1; });
