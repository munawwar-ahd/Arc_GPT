CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.roles (role_name, description) VALUES
    ('ADMIN', 'Full system administration access'),
    ('PRINCIPAL', 'Institution-wide academic oversight'),
    ('HOD', 'Department-scoped academic access'),
    ('FACULTY', 'Authorized academic access'),
    ('STUDENT', 'Personal academic record access'),
    ('ACCOUNTS', 'Authorized financial record access'),
    ('PLACEMENT_OFFICER', 'Authorized placement record access'),
    ('LIBRARIAN', 'Authorized library record access')
ON CONFLICT (role_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.arcgpt_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    department_code TEXT,
    department_id UUID,
    student_id UUID,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.arcgpt_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.permissions (permission_name, description) VALUES
    ('ASK_DATA', 'Ask natural-language questions'),
    ('VIEW_INSIGHTS', 'View analytics and insights'),
    ('VIEW_QUERY_HISTORY', 'View query history'),
    ('SAVE_QUERIES', 'Save and manage queries'),
    ('EXPORT_RESULTS', 'Export query results'),
    ('MANAGE_USERS', 'Manage users'),
    ('MANAGE_ROLES', 'Manage roles and permissions'),
    ('VIEW_SCHEMA', 'View database schema'),
    ('MANAGE_AI', 'Manage AI configuration'),
    ('VIEW_QUERY_MONITOR', 'Monitor system queries'),
    ('VIEW_AUDIT_LOGS', 'View audit logs'),
    ('MANAGE_SECURITY', 'Manage security settings'),
    ('VIEW_ANALYTICS', 'View system analytics'),
    ('MANAGE_SETTINGS', 'Manage system settings')
ON CONFLICT (permission_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(role_id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.role_name = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r JOIN public.permissions p ON p.permission_name IN ('ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS')
WHERE r.role_name IN ('PRINCIPAL', 'HOD', 'FACULTY', 'STUDENT', 'ACCOUNTS', 'PLACEMENT_OFFICER', 'LIBRARIAN')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_queries (
    query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    natural_language_query TEXT NOT NULL,
    generated_sql TEXT,
    query_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (query_status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'BLOCKED')),
    result_count INTEGER NOT NULL DEFAULT 0,
    execution_time_ms INTEGER,
    validation_status TEXT,
    validation_message TEXT,
    tables_used TEXT[],
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.saved_queries (
    saved_query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    natural_language_query TEXT NOT NULL,
    generated_sql TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.arcgpt_users(user_id) ON DELETE CASCADE,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.ai_conversations(conversation_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    message TEXT NOT NULL,
    query_id UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.feedback (
    feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    query_id UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    rating TEXT NOT NULL CHECK (rating IN ('HELPFUL', 'NOT_HELPFUL')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT,
    query_id UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.security_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    query_id UUID REFERENCES public.ai_queries(query_id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key TEXT UNIQUE NOT NULL,
    setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    description TEXT,
    updated_by UUID REFERENCES public.arcgpt_users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('ai_configuration', '{"provider":"Ollama","model":"qwen2.5-coder-7b-instruct","schema_awareness":true,"query_validation":true,"self_correction":false,"ambiguity_detection":true,"max_result_rows":500,"query_timeout_seconds":10}'::jsonb, 'Local Ollama query generation configuration')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_arcgpt_users_role ON public.arcgpt_users(role);
CREATE INDEX IF NOT EXISTS idx_arcgpt_sessions_expiry ON public.arcgpt_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_queries_user ON public.ai_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_queries_status ON public.ai_queries(query_status);
CREATE INDEX IF NOT EXISTS idx_ai_queries_created ON public.ai_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_queries_user ON public.saved_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_query ON public.feedback(query_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events(created_at DESC);

DO $$
BEGIN
    IF to_regclass('public.students') IS NOT NULL
       AND to_regclass('public.departments') IS NOT NULL
       AND to_regclass('public.attendance') IS NOT NULL
       AND to_regclass('public.student_attendance_percentage') IS NULL THEN
        EXECUTE $view$
            CREATE VIEW public.student_attendance_percentage AS
            SELECT
                s.student_id,
                s.register_number,
                s.first_name,
                s.last_name,
                s.department_id,
                d.department_code,
                d.department_name,
                COUNT(a.attendance_id)::integer AS total_classes,
                COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) IN ('PRESENT', 'OD'))::integer AS attended_classes,
                COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) = 'ABSENT')::integer AS absent_classes,
                ROUND(
                    100.0 * COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) IN ('PRESENT', 'OD'))
                    / NULLIF(COUNT(a.attendance_id), 0),
                    2
                ) AS attendance_percentage
            FROM public.students s
            LEFT JOIN public.departments d ON d.department_id = s.department_id
            LEFT JOIN public.attendance a ON a.student_id = s.student_id
            GROUP BY s.student_id, s.register_number, s.first_name, s.last_name, s.department_id, d.department_code, d.department_name
        $view$;
    END IF;
END
$$;

DO $$
DECLARE
    table_name text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_reader') THEN
        CREATE ROLE arcgpt_reader NOLOGIN;
    END IF;
    FOREACH table_name IN ARRAY ARRAY['academic_years', 'departments', 'programs', 'batches', 'sections', 'semesters', 'students', 'faculty', 'subjects', 'course_offerings', 'attendance', 'assessments', 'student_marks', 'assignments', 'submissions', 'semester_results', 'student_academic_summary', 'backlogs', 'timetable', 'exams', 'exam_schedule', 'announcements', 'placement_drives', 'placement_applications', 'hostels', 'rooms', 'hostel_allocations', 'books', 'library_transactions', 'bus_routes', 'bus_stops', 'student_transport', 'student_attendance_percentage']
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('GRANT SELECT ON public.%I TO arcgpt_reader', table_name);
        END IF;
    END LOOP;
END
$$;
