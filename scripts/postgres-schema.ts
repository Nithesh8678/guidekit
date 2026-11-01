import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { migratePostgres } from '../apps/server/src/storage/postgres-schema.js';
import { installPostgresKnowledgeSchema } from '../packages/knowledge/src/schema.js';

export async function installProductSchema(options: { connectionString: string; runtimeRole: string; knowledgeRole: string }) {
  for (const role of [options.runtimeRole, options.knowledgeRole]) if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid runtime role name.');
  const pool = new Pool({ connectionString: options.connectionString, max: 1 });
  try {
    const client = await pool.connect(); try { await migratePostgres(client); } finally { client.release(); }
    const roles = await pool.query('SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1::text[])', [[options.runtimeRole, options.knowledgeRole]]);
    if (roles.rows.length !== 2 || roles.rows.some(role => role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb)) throw new Error('Create separate restricted SQL roles before granting runtime access.');
    const platform = `"${options.runtimeRole}"`;
    const tables = ['tenants','users','dashboard_sessions','agents','documents','versions','publication_states','knowledge_fts','embed_sessions','runs','receipts','memberships','account_tokens','audit_events'].map(name => `public."${name}"`).join(',');
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${platform}; GRANT SELECT ON public.guidekit_schema_migrations TO ${platform}; GRANT SELECT,INSERT,UPDATE,DELETE ON ${tables} TO ${platform}; GRANT USAGE,SELECT ON SEQUENCE public.knowledge_fts_id_seq TO ${platform};`);
  } finally { await pool.end(); }
  await installPostgresKnowledgeSchema({ connectionString: options.connectionString, runtimeRole: options.knowledgeRole });
}
async function cli() {
  const { values } = parseArgs({ options: { 'runtime-role': { type: 'string', default: 'guidekit_runtime' }, 'knowledge-role': { type: 'string', default: 'guidekit_retrieval' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run db:schema -- [--runtime-role guidekit_runtime] [--knowledge-role guidekit_retrieval]\nRequires GUIDEKIT_DATABASE_URL_DIRECT for an empty dedicated database. Never uses the migration owner at runtime.'); return; }
  if (!process.env.GUIDEKIT_DATABASE_URL_DIRECT) throw new Error('A separate direct owner migration connection is required.');
  await installProductSchema({ connectionString: process.env.GUIDEKIT_DATABASE_URL_DIRECT, runtimeRole: values['runtime-role']!, knowledgeRole: values['knowledge-role']! });
  console.log('PostgreSQL product and knowledge schemas are installed; restricted runtime grants applied.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cli().catch(() => { console.error('Schema setup failed. Check the dedicated database, migration role and restricted runtime roles. No connection details were logged.'); process.exitCode = 1; });
