import assert from 'node:assert/strict';
import test from 'node:test';
import { backupCli } from '../scripts/backup.js';

test('configured PostgreSQL cannot silently back up a stale local SQLite database', async () => {
  const previous = { url: process.env.GUIDEKIT_DATABASE_URL, owner: process.env.GUIDEKIT_DATABASE_URL_DIRECT, selected: process.env.GUIDEKIT_KNOWLEDGE_PROVIDER };
  try {
    process.env.GUIDEKIT_DATABASE_URL = 'postgresql://synthetic@db.example.invalid/guidekit'; delete process.env.GUIDEKIT_DATABASE_URL_DIRECT;
    await assert.rejects(backupCli(['--data-dir', '/nonexistent-synthetic-data', '--dest', '/nonexistent-synthetic-archive']), /old SQLite file was not backed up/);
    delete process.env.GUIDEKIT_DATABASE_URL; process.env.GUIDEKIT_KNOWLEDGE_PROVIDER = 'postgres';
    await assert.rejects(backupCli([]), /separate GUIDEKIT_DATABASE_URL_DIRECT/);
  } finally {
    for (const [key,value] of Object.entries({ GUIDEKIT_DATABASE_URL: previous.url, GUIDEKIT_DATABASE_URL_DIRECT: previous.owner, GUIDEKIT_KNOWLEDGE_PROVIDER: previous.selected })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
