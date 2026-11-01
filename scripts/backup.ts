import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackup } from './storage-archive.js';
import { createPostgresBackup } from './postgres-archive.js';
export { createBackup, verifyArchive } from './storage-archive.js';

export async function backupCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { 'data-dir': { type: 'string' }, dest: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run backup -- --data-dir PATH --dest NEW_ARCHIVE_DIRECTORY\nBacks up the configured database plus session secret. PostgreSQL requires a separate GUIDEKIT_DATABASE_URL_DIRECT owner connection. Archives contain credentials and must remain private.'); return; }
  const destination = values.dest ?? resolve('.backups', `guidekit-${new Date().toISOString().replaceAll(':', '-')}`);
  const dataDir = values['data-dir'] ?? process.env.GUIDEKIT_DATA_DIR ?? '.data';
  if (process.env.GUIDEKIT_DATABASE_URL || process.env.GUIDEKIT_KNOWLEDGE_PROVIDER === 'postgres') {
    if (!process.env.GUIDEKIT_DATABASE_URL_DIRECT) throw new Error('PostgreSQL backup requires a separate GUIDEKIT_DATABASE_URL_DIRECT operator connection. The old SQLite file was not backed up.');
    const result = await createPostgresBackup({ connectionString: process.env.GUIDEKIT_DATABASE_URL_DIRECT, dataDir, destination });
    console.log(JSON.stringify({ archive: result.archive, format: result.manifest.format, tables: Object.keys(result.manifest.tables).length })); return;
  }
  const result = await createBackup({ dataDir, destination });
  console.log(JSON.stringify({ archive: result.archive, schemaVersion: result.manifest.databaseSchemaVersion, pages: result.manifest.pages }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) backupCli().catch(error => { console.error(error instanceof Error ? error.message : 'Backup failed.'); process.exitCode = 1; });
