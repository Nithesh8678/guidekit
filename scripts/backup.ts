import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackup } from './storage-archive.js';
export { createBackup, verifyArchive } from './storage-archive.js';

export async function backupCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { 'data-dir': { type: 'string' }, dest: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run backup -- --data-dir PATH --dest NEW_ARCHIVE_DIRECTORY\nOnline SQLite snapshot plus session secret; archives contain credentials and must remain private.'); return; }
  const destination = values.dest ?? resolve('.backups', `guidekit-${new Date().toISOString().replaceAll(':', '-')}`);
  const result = await createBackup({ dataDir: values['data-dir'] ?? process.env.GUIDEKIT_DATA_DIR ?? '.data', destination });
  console.log(JSON.stringify({ archive: result.archive, schemaVersion: result.manifest.databaseSchemaVersion, pages: result.manifest.pages }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) backupCli().catch(error => { console.error(error instanceof Error ? error.message : 'Backup failed.'); process.exitCode = 1; });
