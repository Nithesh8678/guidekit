/** Disposable CI database bootstrap; creates no cloud infrastructure and handles no production credentials. */
import { Pool } from 'pg';
const owner = process.env.GUIDEKIT_TEST_POSTGRES_URL, runtime = process.env.GUIDEKIT_TEST_KNOWLEDGE_URL;
if (!owner || !runtime) throw new Error('Explicit disposable test connections are required.');
const admin = new URL(owner), application = new URL(runtime);
if (admin.pathname !== '/guidekit_test' || application.pathname !== '/guidekit_test' || !['127.0.0.1','localhost'].includes(admin.hostname) || application.hostname !== admin.hostname || application.port !== admin.port) throw new Error('CI setup accepts only the dedicated loopback guidekit_test database.');
const name = decodeURIComponent(application.username), password = decodeURIComponent(application.password);
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || !password) throw new Error('Invalid disposable test role.');
const pool = new Pool({ connectionString: owner, max: 1 });
try {
  const existing = await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name]);
  if (!existing.rowCount) await pool.query(`CREATE ROLE "${name}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password.replaceAll("'", "''")}'`);
  console.log('Disposable PostgreSQL test role is prepared.');
} finally { await pool.end(); }
