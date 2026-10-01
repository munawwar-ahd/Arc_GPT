-- ============================================================================
-- ArcGPT — 01_control_tables.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- ArcGPT's own control-plane schema: users, sessions, RBAC, query log,
-- conversations, audit trail and security events. These are NOT institution
-- data — they belong to the application and are never exposed to the LLM
-- (see PROTECTED_TABLES in backend/src/server/schema.service.ts).
--
-- Structure is column-for-column identical to the backend's expectations in
-- database.service.ts / auth.service.ts, so the running application needs no
-- code change to use this database.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 01_control_tables.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
    role_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name   TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.roles (role_name, description) VALUES
    ('SUPER_ADMIN',      'Unrestricted system administration'),
    ('ADMIN',            'Full system administration access'),
    ('PRINCIPAL',        'Institution-wide academic oversight'),
    ('HOD',              'Department-scoped academic access'),
    ('FACULTY',          'Authorized academic access, department-scoped'),
    ('STUDENT',          'Personal academic record access only'),
    ('ACCOUNTS',         'Authorized financial record access'),
    ('PLACEMENT_OFFICER','Authorized placement record access'),
    ('LIBRARIAN',        'Authorized library record access')
ON CONFLICT (role_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.permissions (
    permission_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_name TEXT UNIQUE NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.permissions (permission_name, description) VALUES
    ('ASK_DATA',            'Ask natural-language questions'),
    ('VIEW_INSIGHTS',       'View analytics and insights'),
    ('VIEW_QUERY_HISTORY',  'View query history'),
    ('SAVE_QUERIES',        'Save and manage queries'),
    ('EXPORT_RESULTS',      'Export query results'),
    ('MANAGE_USERS',        'Manage users'),
    ('MANAGE_ROLES',        'Manage roles and permissions'),
    ('VIEW_SCHEMA',         'View database schema'),
    ('MANAGE_AI',           'Manage AI configuration'),
    ('VIEW_QUERY_MONITOR',  'Monitor system queries'),
    ('VIEW_AUDIT_LOGS',     'View audit logs'),
    ('MANAGE_SECURITY',     'Manage security settings'),
    ('VIEW_ANALYTICS',      'View system analytics'),
    ('MANAGE_SETTINGS',     'Manage system settings')
ON CONFLICT (permission_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id       UUID NOT NULL REFERENCES public.roles(role_id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Super admin and admin get everything.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.role_name IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT DO NOTHING;

-- Everyone else gets the read/ask baseline.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
JOIN public.permissions p ON p.permission_name IN
    ('ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS')
WHERE r.role_name IN ('PRINCIPAL', 'HOD', 'FACULTY', 'STUDENT',
                      'ACCOUNTS', 'PLACEMENT_OFFICER', 'LIBRARIAN')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.arcgpt_users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,
    department_code TEXT,
    department_id   UUID,
    student_id      UUID,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    phone           TEXT,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.arcgpt_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Query log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_queries (
    query_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    natural_language_query TEXT NOT NULL,
    generated_sql          TEXT,
    query_status           TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (query_status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'BLOCKED')),
    result_count           INTEGER NOT NULL DEFAULT 0,
    execution_time_ms      INTEGER,
    validation_status      TEXT,
    validation_message     TEXT,
    tables_used            TEXT[],
    error_message          TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.saved_queries (
    saved_query_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    title                TEXT NOT NULL,
    natural_language_query TEXT NOT NULL,
    generated_sql        TEXT,
    description          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Conversations (the chat history sidebar reads these)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    title           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
    message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.ai_conversations(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    message         TEXT NOT NULL,
    query_id        UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.feedback (
    feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    query_id    UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    rating      TEXT NOT NULL CHECK (rating IN ('HELPFUL', 'NOT_HELPFUL')),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Audit and security
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_logs (
    log_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    resource   TEXT,
    query_id   UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    details    JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    result     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.security_events (
    event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    query_id    UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    event_type  TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'MEDIUM'
                CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT,
    blocked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    setting_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key  TEXT UNIQUE NOT NULL,
    setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    description  TEXT,
    updated_by   UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('ai_configuration',
        '{"provider":"Ollama","model":"qwen2.5-coder:7b","schema_awareness":true,
          "query_validation":true,"self_correction":false,"ambiguity_detection":true,
          "max_result_rows":500,"query_timeout_seconds":10}'::jsonb,
        'Local Ollama query generation configuration')
ON CONFLICT (setting_key) DO NOTHING;
