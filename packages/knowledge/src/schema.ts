import { Pool } from 'pg';
import { fail } from './chunks.js';

export const KNOWLEDGE_SCHEMA_VERSION = 1;
/** Versioned, server-only schema. No runtime auto-migration or browser credentials. */
export const POSTGRES_KNOWLEDGE_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS guidekit_knowledge;
REVOKE ALL ON SCHEMA guidekit_knowledge FROM PUBLIC;
CREATE TABLE IF NOT EXISTS guidekit_knowledge.metadata (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), schema_version integer NOT NULL);
INSERT INTO guidekit_knowledge.metadata(singleton,schema_version) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS guidekit_knowledge.versions (
 tenant_id text NOT NULL, agent_id text NOT NULL, version integer NOT NULL CHECK(version>0),
 manifest text NOT NULL CHECK(length(manifest)=64), embedding_model text NOT NULL,
 dimensions integer NOT NULL CHECK(dimensions=384), chunk_count integer NOT NULL CHECK(chunk_count>=0 AND chunk_count<=5000),
 allowed_actions jsonb NOT NULL CHECK(jsonb_typeof(allowed_actions)='array'), ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,agent_id,version)
);
CREATE TABLE IF NOT EXISTS guidekit_knowledge.documents (
 tenant_id text NOT NULL, agent_id text NOT NULL, version integer NOT NULL, document_id text NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180), content text NOT NULL, content_hash text NOT NULL CHECK(length(content_hash)=64),
 PRIMARY KEY(tenant_id,agent_id,version,document_id),
 FOREIGN KEY(tenant_id,agent_id,version) REFERENCES guidekit_knowledge.versions(tenant_id,agent_id,version)
);
CREATE TABLE IF NOT EXISTS guidekit_knowledge.chunks (
 tenant_id text NOT NULL, agent_id text NOT NULL, version integer NOT NULL, document_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0), source_start integer NOT NULL CHECK(source_start>=0), source_end integer NOT NULL CHECK(source_end>source_start),
 source_char_start integer NOT NULL CHECK(source_char_start>=0), source_char_end integer NOT NULL CHECK(source_char_end>source_char_start),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180), excerpt text NOT NULL CHECK(length(excerpt) BETWEEN 1 AND 900),
 embedding vector(384) NOT NULL,
 lexical tsvector GENERATED ALWAYS AS (
   setweight(to_tsvector('simple'::regconfig,title),'A') || setweight(to_tsvector('english'::regconfig,title),'A') ||
   setweight(to_tsvector('simple'::regconfig,excerpt),'B') || setweight(to_tsvector('english'::regconfig,excerpt),'B')
 ) STORED,
 PRIMARY KEY(tenant_id,agent_id,version,document_id,ordinal),
 FOREIGN KEY(tenant_id,agent_id,version,document_id) REFERENCES guidekit_knowledge.documents(tenant_id,agent_id,version,document_id)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_scope ON guidekit_knowledge.chunks(tenant_id,agent_id,version);
CREATE INDEX IF NOT EXISTS knowledge_chunks_lexical ON guidekit_knowledge.chunks USING gin(lexical);
ALTER TABLE guidekit_knowledge.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidekit_knowledge.versions FORCE ROW LEVEL SECURITY;
ALTER TABLE guidekit_knowledge.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidekit_knowledge.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE guidekit_knowledge.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidekit_knowledge.chunks FORCE ROW LEVEL SECURITY;
DO $policies$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='guidekit_knowledge' AND tablename='versions' AND policyname='scope_isolation') THEN
    CREATE POLICY scope_isolation ON guidekit_knowledge.versions USING(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true)) WITH CHECK(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true));
    CREATE POLICY scope_isolation ON guidekit_knowledge.documents USING(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true)) WITH CHECK(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true));
    CREATE POLICY scope_isolation ON guidekit_knowledge.chunks USING(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true)) WITH CHECK(tenant_id=current_setting('guidekit.tenant_id',true) AND agent_id=current_setting('guidekit.agent_id',true) AND version::text=current_setting('guidekit.version',true));
  END IF;
END $policies$;
-- A restrictive scope boundary also survives an accidentally broad permissive policy.
DO $boundaries$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['versions','documents','chunks'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='guidekit_knowledge' AND tablename=table_name AND policyname='scope_boundary') THEN
   EXECUTE format('CREATE POLICY scope_boundary ON guidekit_knowledge.%I AS RESTRICTIVE USING(tenant_id=current_setting(''guidekit.tenant_id'',true) AND agent_id=current_setting(''guidekit.agent_id'',true) AND version::text=current_setting(''guidekit.version'',true)) WITH CHECK(tenant_id=current_setting(''guidekit.tenant_id'',true) AND agent_id=current_setting(''guidekit.agent_id'',true) AND version::text=current_setting(''guidekit.version'',true))',table_name);
  END IF;
 END LOOP;
END $boundaries$;
CREATE OR REPLACE FUNCTION guidekit_knowledge.reject_ready_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,guidekit_knowledge AS $guard$
BEGIN
 IF TG_TABLE_NAME='versions' THEN
   IF OLD.ready THEN RAISE EXCEPTION 'Published knowledge is immutable'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM guidekit_knowledge.versions WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND agent_id=COALESCE(NEW.agent_id,OLD.agent_id) AND version=COALESCE(NEW.version,OLD.version) AND ready) THEN RAISE EXCEPTION 'Published knowledge is immutable'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $guard$;
DO $triggers$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='knowledge_immutable_version' AND tgrelid='guidekit_knowledge.versions'::regclass) THEN
  CREATE TRIGGER knowledge_immutable_version BEFORE UPDATE OR DELETE ON guidekit_knowledge.versions FOR EACH ROW EXECUTE FUNCTION guidekit_knowledge.reject_ready_mutation();
  CREATE TRIGGER knowledge_immutable_document BEFORE INSERT OR UPDATE OR DELETE ON guidekit_knowledge.documents FOR EACH ROW EXECUTE FUNCTION guidekit_knowledge.reject_ready_mutation();
  CREATE TRIGGER knowledge_immutable_chunk BEFORE INSERT OR UPDATE OR DELETE ON guidekit_knowledge.chunks FOR EACH ROW EXECUTE FUNCTION guidekit_knowledge.reject_ready_mutation();
 END IF;
END $triggers$;
REVOKE ALL ON ALL TABLES IN SCHEMA guidekit_knowledge FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guidekit_knowledge FROM PUBLIC;
`;

/** Run only with a separate direct migration connection. The app role must already exist. */
export async function installPostgresKnowledgeSchema(options: { connectionString: string; runtimeRole: string }): Promise<void> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(options.runtimeRole)) fail('invalid_config', 'Invalid PostgreSQL knowledge runtime role.');
  const pool = new Pool({ connectionString: options.connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const role = await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1', [options.runtimeRole]);
    if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls || role.rows[0].rolcreaterole || role.rows[0].rolcreatedb) fail('invalid_config', 'Knowledge runtime role must exist without superuser, BYPASSRLS, CREATEROLE or CREATEDB privileges.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(POSTGRES_KNOWLEDGE_SCHEMA);
      const roleName = `"${options.runtimeRole}"`;
      await client.query(`GRANT USAGE ON SCHEMA guidekit_knowledge TO ${roleName}; GRANT SELECT ON guidekit_knowledge.metadata TO ${roleName}; GRANT SELECT,INSERT,UPDATE ON guidekit_knowledge.versions TO ${roleName}; GRANT SELECT,INSERT ON guidekit_knowledge.documents,guidekit_knowledge.chunks TO ${roleName};`);
      const schema = await client.query('SELECT schema_version FROM guidekit_knowledge.metadata WHERE singleton=true');
      if (schema.rows[0]?.schema_version !== KNOWLEDGE_SCHEMA_VERSION) fail('invalid_config', 'PostgreSQL knowledge schema version is incompatible.');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } finally { await pool.end(); }
}
