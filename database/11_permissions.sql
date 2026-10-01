-- ============================================================================
-- ArcGPT — 11_permissions.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Roles and least-privilege grants.
--
-- REQUIRES A SUPERUSER CONNECTION. Creating roles and setting role attributes
-- are cluster-level operations, so run this file as the PostgreSQL superuser
-- (the default for database/run_all.ps1), never as the application role.
-- Everything else in the build runs fine as an ordinary owner.
--
-- Two LOGIN roles, both scoped to arcgpt_new only:
--
--   arcgpt_user        Admin pool. Used for auth, sessions, conversations,
--                      query logging, audit, CSV import and schema
--                      introspection. Can read every institution table, and can
--                      write ONLY the ArcGPT control tables. NOSUPERUSER,
--                      NOCREATEDB, NOCREATEROLE, NOREPLICATION.
--
--   arcgpt_new_reader  Query pool (DB_READONLY_USER). This is the ONLY role the
--                      LLM's generated SQL ever runs as. SELECT on institution
--                      tables and the v_* views; NO privilege at all on the
--                      control tables, so even a validator bypass cannot reach
--                      user credentials or the audit trail.
--
-- The pre-existing `arcgpt_reader` role is deliberately NOT reused: it holds
-- SELECT on tables in arcgpt_institution, which belongs to another project.
--
-- NOTE ON arcgpt_institution
-- -------------------------
-- This script never references, alters or grants anything in that database.
-- PostgreSQL grants CONNECT on every database to PUBLIC by default, so
-- arcgpt_user and arcgpt_new_reader can technically open a connection there,
-- but they hold no USAGE-independent object privilege there and can read
-- nothing. Revoking CONNECT would require modifying that database's ACL,
-- which is out of scope by instruction, so it is left alone deliberately.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 11_permissions.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_user') THEN
        CREATE ROLE arcgpt_user LOGIN PASSWORD 'local-dev-only-change-me';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_new_reader') THEN
        CREATE ROLE arcgpt_new_reader LOGIN PASSWORD 'local-dev-only-change-me';
    END IF;
END
$$;

-- Neither role may create databases, roles or replication, and neither is a
-- superuser. Belt and braces: the guardrail layer already blocks this.
ALTER ROLE arcgpt_user        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE arcgpt_new_reader  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

-- CONNECT only to arcgpt_new.
GRANT CONNECT ON DATABASE arcgpt_new TO arcgpt_user, arcgpt_new_reader;

-- Schema access. The application may read the schema; only the owner may create.
GRANT USAGE ON SCHEMA public TO arcgpt_user, arcgpt_new_reader;

-- ---------------------------------------------------------------------------
-- Every institution table and view, discovered dynamically so a new table is
-- never accidentally left ungranted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'v', 'm')
          -- ArcGPT's own control tables are NOT institution data.
          AND c.relname NOT IN (
              'arcgpt_users', 'arcgpt_sessions', 'ai_queries', 'saved_queries',
              'ai_conversations', 'ai_messages', 'feedback', 'audit_logs',
              'security_events', 'system_settings', 'roles', 'permissions',
              'role_permissions'
          )
    LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO arcgpt_user, arcgpt_new_reader', r.relname);
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Institution writes for the admin CSV import.
--
-- The admin panel's Data Import feature uploads CSV into these four tables, and
-- executeImport upserts (INSERT ... ON CONFLICT DO UPDATE), so it needs INSERT
-- and UPDATE. DELETE is deliberately NOT granted: the application can add and
-- correct institution rows through the reviewed import path, but cannot remove
-- them. Everything else stays read-only to the application.
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE ON
    public.departments,
    public.faculty,
    public.subjects,
    public.students
TO arcgpt_user;

-- ---------------------------------------------------------------------------
-- Control tables: arcgpt_user may read and write them.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.roles, public.permissions, public.role_permissions,
    public.arcgpt_users, public.arcgpt_sessions,
    public.ai_queries, public.saved_queries,
    public.ai_conversations, public.ai_messages,
    public.feedback, public.audit_logs, public.security_events,
    public.system_settings
TO arcgpt_user;

-- ---------------------------------------------------------------------------
-- Explicitly NOT granted to arcgpt_new_reader — the query-path role.
-- arcgpt_user also gets INSERT so the CSV import feature works, but only for
-- institution tables; there is deliberately no INSERT on the control tables
-- beyond what the app needs (sessions, queries, conversations, messages,
-- audit, security events, feedback, saved queries, users).
-- ---------------------------------------------------------------------------
REVOKE ALL ON
    public.roles, public.permissions, public.role_permissions,
    public.arcgpt_users, public.arcgpt_sessions,
    public.ai_queries, public.saved_queries,
    public.ai_conversations, public.ai_messages,
    public.feedback, public.audit_logs, public.security_events,
    public.system_settings
FROM arcgpt_new_reader;

-- ---------------------------------------------------------------------------
-- The application writes these; the reader role never does.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM arcgpt_new_reader;

-- Nobody but the table owner may change the schema.
-- ---------------------------------------------------------------------------
-- Nobody but a table owner may change the schema.
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC, arcgpt_user, arcgpt_new_reader;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_inst INT;
    v_reader_tables INT;
BEGIN
    SELECT count(*) INTO v_inst FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','v')
        AND c.relname NOT IN ('arcgpt_users','arcgpt_sessions','ai_queries','saved_queries',
                              'ai_conversations','ai_messages','feedback','audit_logs',
                              'security_events','system_settings','roles','permissions','role_permissions');
    SELECT count(*) INTO v_reader_tables FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','v')
        AND has_table_privilege('arcgpt_new_reader', c.oid, 'SELECT');

    RAISE NOTICE 'Permissions applied in %.', current_database();
    RAISE NOTICE '  institution tables/views granted to arcgpt_user      : %', v_inst;
    RAISE NOTICE '  institution tables/views readable by arcgpt_new_reader: %', v_reader_tables;
    RAISE NOTICE '  arcgpt_new_reader privilege on arcgpt_users          : %',
        has_table_privilege('arcgpt_new_reader', 'public.arcgpt_users', 'SELECT');
END
$$;
