import crypto from 'crypto';
import { pool, query, withReadOnlyTransaction, checkPostgresConnection, readerConfigured } from './db.js';
import { describeError } from './errors.js';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  resultStatus: 'SUCCESS' | 'EMPTY' | 'ERROR';
  truncated?: boolean;
  errorDetail?: string;
}

export interface AiQueryRecord {
  query_id?: string;
  user_id?: string | null;
  natural_language_query: string;
  generated_sql?: string | null;
  query_status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'BLOCKED';
  result_count?: number;
  execution_time_ms?: number;
  validation_status?: string;
  validation_message?: string;
  tables_used?: string[];
  error_message?: string;
  created_at?: string;
}

export interface SecurityEventRecord {
  event_id?: string;
  user_id?: string | null;
  query_id?: string | null;
  event_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description?: string;
  blocked?: boolean;
  created_at?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface AuditLogRecord {
  log_id?: string;
  user_id?: string | null;
  action: string;
  resource?: string;
  query_id?: string | null;
  details?: Record<string, unknown>;
  ip_address?: string;
  result?: string;
  created_at?: string;
}

const defaultAiConfiguration = {
  provider: 'Ollama',
  model: process.env.OLLAMA_MODEL || 'qwen2.5-coder-7b-instruct',
  schema_awareness: true,
  query_validation: true,
  self_correction: false,
  ambiguity_detection: true,
  max_result_rows: 500,
  query_timeout_seconds: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10000) / 1000,
};

function uuidOrNull(value?: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

function mapHistory(row: Record<string, any>): Record<string, unknown> {
  const status = String(row.query_status || 'FAILED').toLowerCase();
  return {
    id: row.query_id,
    user_id: row.user_id,
    natural_language_query: row.natural_language_query,
    generated_sql: row.generated_sql || '',
    execution_status: status,
    execution_time: row.execution_time_ms || 0,
    row_count: row.result_count || 0,
    created_at: row.created_at,
    blocked_reason: row.validation_message || row.error_message || undefined,
  };
}

export class DatabaseService {
  public async initialize(): Promise<void> {
    const connected = await checkPostgresConnection();
    if (connected) {
      console.log(`[DB INIT] PostgreSQL connected to database ${process.env.DB_NAME || 'arcgpt_new'}.`);
      try {
        // NOTE: no DDL here. The schema, including arcgpt_users.phone, is
        // created by database/01_control_tables.sql. Running ALTER TABLE at
        // startup would require the application to own its tables, which
        // conflicts with keeping the schema owned by the migration role. The
        // statements below are idempotent DML the app is explicitly granted.
        await query(`
          INSERT INTO public.permissions (permission_name, description) VALUES
            ('users.view', 'View institution users'),
            ('users.create', 'Create institution users'),
            ('users.edit', 'Edit institution user profiles and roles'),
            ('users.disable', 'Disable or enable users'),
            ('users.delete', 'Delete users'),
            ('roles.assign', 'Assign roles to users'),
            ('hod.department.assign', 'Assign or change HOD department'),
            ('student.delete', 'Remove student from active records'),
            ('data.import', 'Upload and import institution data')
          ON CONFLICT (permission_name) DO NOTHING;
        `);
        await query(`
          INSERT INTO public.role_permissions (role_id, permission_id)
          SELECT r.role_id, p.permission_id
          FROM public.roles r
          CROSS JOIN public.permissions p
          WHERE r.role_name IN ('ADMIN', 'SUPER_ADMIN')
          ON CONFLICT DO NOTHING;
        `);
      } catch (migError) {
        console.warn('[DB INIT] Migration warning:', describeError(migError));
      }
    } else {
      console.warn('[DB INIT] PostgreSQL is offline. The server will remain available for diagnostics.');
    }
  }

  public async checkHealth(): Promise<{ connected: boolean; readOnlyRoleConfigured: boolean }> {
    return { connected: await checkPostgresConnection(), readOnlyRoleConfigured: readerConfigured };
  }

  public async executeSql(sql: string): Promise<QueryResult> {
    const result = await withReadOnlyTransaction(async client => client.query(sql));
    const columns = (result.fields || []).map(field => field.name);
    const allRows = (result.rows || []).map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
    )) as Record<string, unknown>[];
    const maxRows = Number(process.env.MAX_RESULT_ROWS || 500);
    const rows = allRows.slice(0, maxRows);
    return {
      columns,
      rows,
      rowCount: rows.length,
      resultStatus: rows.length === 0 ? 'EMPTY' : 'SUCCESS',
      truncated: allRows.length > rows.length,
    };
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const result = await query<{ exists: string | null }>('SELECT to_regclass($1)::text AS exists', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.exists);
  }

  private async countTable(tableName: string): Promise<number> {
    if (!(await this.tableExists(tableName))) throw new Error(`PostgreSQL table '${tableName}' is not initialized.`);
    const result = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${tableName}`);
    return Number(result.rows[0]?.count || 0);
  }


  public async insertAiQuery(record: AiQueryRecord): Promise<string> {
    const queryId = uuidOrNull(record.query_id) || crypto.randomUUID();
    await query(
      `INSERT INTO public.ai_queries
        (query_id, user_id, natural_language_query, generated_sql, query_status,
         result_count, execution_time_ms, validation_status, validation_message, tables_used, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        queryId,
        uuidOrNull(record.user_id),
        record.natural_language_query,
        record.generated_sql || null,
        record.query_status,
        record.result_count || 0,
        record.execution_time_ms || null,
        record.validation_status || null,
        record.validation_message || null,
        record.tables_used || [],
        record.error_message || null,
      ]
    );
    return queryId;
  }

  public async insertQueryHistory(
    userId: string,
    naturalQuery: string,
    sql: string,
    status: 'success' | 'empty' | 'blocked' | 'failed',
    durationMs: number,
    rowCount: number,
    blockedReason?: string
  ): Promise<string> {
    return this.insertAiQuery({
      user_id: userId,
      natural_language_query: naturalQuery,
      generated_sql: sql,
      query_status: status === 'success' || status === 'empty' ? 'SUCCESS' : status === 'blocked' ? 'BLOCKED' : 'FAILED',
      result_count: rowCount,
      execution_time_ms: durationMs,
      validation_status: status === 'blocked' ? 'BLOCKED' : 'VALIDATED',
      validation_message: blockedReason,
      error_message: blockedReason,
    });
  }

  public async getQueryHistory(limit = 50, userId?: string): Promise<Record<string, unknown>[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const result = userId
      ? await query('SELECT * FROM public.ai_queries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, boundedLimit])
      : await query('SELECT * FROM public.ai_queries ORDER BY created_at DESC LIMIT $1', [boundedLimit]);
    return result.rows.map(mapHistory);
  }

  public async getAllAiQueries(limit = 100): Promise<Record<string, unknown>[]> {
    return this.getQueryHistory(limit);
  }

  public async deleteHistory(id: string, userId?: string): Promise<boolean> {
    if (!uuidOrNull(id)) return false;
    const result = userId
      ? await query('DELETE FROM public.ai_queries WHERE query_id = $1 AND user_id = $2', [id, userId])
      : await query('DELETE FROM public.ai_queries WHERE query_id = $1', [id]);
    return (result.rowCount || 0) > 0;
  }

  public async insertSecurityEvent(record: SecurityEventRecord): Promise<string> {
    const eventId = uuidOrNull(record.event_id) || crypto.randomUUID();
    await query(
      `INSERT INTO public.security_events
        (event_id, user_id, query_id, event_type, severity, description, blocked)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, uuidOrNull(record.user_id), uuidOrNull(record.query_id), record.event_type, record.severity, record.description || null, record.blocked || false]
    );
    return eventId;
  }

  public async getSecurityEvents(limit = 50): Promise<Record<string, unknown>[]> {
    const result = await query('SELECT * FROM public.security_events ORDER BY created_at DESC LIMIT $1', [Math.min(Math.max(limit, 1), 500)]);
    return result.rows.map(row => ({ ...row, id: row.event_id }));
  }

  public async insertAuditLog(record: AuditLogRecord): Promise<string> {
    const logId = uuidOrNull(record.log_id) || crypto.randomUUID();
    await query(
      `INSERT INTO public.audit_logs
        (log_id, user_id, action, resource, query_id, details, ip_address, result)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [logId, uuidOrNull(record.user_id), record.action, record.resource || null, uuidOrNull(record.query_id), JSON.stringify(record.details || {}), record.ip_address || null, record.result || null]
    );
    return logId;
  }

  public async getAuditLogs(limit = 100): Promise<Record<string, unknown>[]> {
    const result = await query('SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT $1', [Math.min(Math.max(limit, 1), 500)]);
    return result.rows.map(row => ({
      id: row.log_id,
      user_id: row.user_id,
      action: row.action,
      query_hash: row.details?.queryHash || '',
      status: row.result || 'SUCCESS',
      details: typeof row.details === 'string' ? row.details : JSON.stringify(row.details || {}),
      created_at: row.created_at,
    }));
  }

  public async getSavedQueries(userId: string): Promise<Record<string, unknown>[]> {
    const result = await query(
      `SELECT saved_query_id, user_id, title, natural_language_query, generated_sql, description, created_at, updated_at
       FROM public.saved_queries WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(row => ({ ...row, id: row.saved_query_id }));
  }

  public async createSavedQuery(userId: string, title: string, naturalQuery: string, description?: string): Promise<string> {
    const result = await query<{ saved_query_id: string }>(
      `INSERT INTO public.saved_queries (user_id, title, natural_language_query, description)
       VALUES ($1, $2, $3, $4) RETURNING saved_query_id`,
      [userId, title.trim(), naturalQuery.trim(), description?.trim() || null]
    );
    return result.rows[0].saved_query_id;
  }

  public async updateSavedQuery(id: string, userId: string, title: string, naturalQuery: string): Promise<boolean> {
    const result = await query(
      `UPDATE public.saved_queries SET title = $3, natural_language_query = $4, updated_at = NOW()
       WHERE saved_query_id = $1 AND user_id = $2`,
      [id, userId, title.trim(), naturalQuery.trim()]
    );
    return (result.rowCount || 0) > 0;
  }

  public async deleteSavedQuery(id: string, userId: string): Promise<boolean> {
    const result = await query('DELETE FROM public.saved_queries WHERE saved_query_id = $1 AND user_id = $2', [id, userId]);
    return (result.rowCount || 0) > 0;
  }

  public async insertFeedback(queryId: string, rating: 'HELPFUL' | 'NOT_HELPFUL', comment: string | undefined, userId: string): Promise<void> {
    if (!uuidOrNull(queryId)) throw new Error('A valid query ID is required for feedback.');
    await query(
      `INSERT INTO public.feedback (user_id, query_id, rating, comment)
       VALUES ($1, $2, $3, $4)`,
      [userId, queryId, rating, comment?.trim() || null]
    );
  }

  public async getAiConfiguration(): Promise<Record<string, unknown>> {
    try {
      const result = await query<{ setting_value: Record<string, unknown> }>(
        `SELECT setting_value FROM public.system_settings WHERE setting_key = 'ai_configuration' LIMIT 1`
      );
      return { ...defaultAiConfiguration, ...(result.rows[0]?.setting_value || {}) };
    } catch {
      return defaultAiConfiguration;
    }
  }

  public async updateAiConfiguration(config: Record<string, unknown>, updatedBy: string): Promise<void> {
    const allowedKeys = new Set(Object.keys(defaultAiConfiguration));
    const sanitized = Object.fromEntries(Object.entries(config).filter(([key]) => allowedKeys.has(key)));
    await query(
      `INSERT INTO public.system_settings (setting_key, setting_value, description, updated_by)
       VALUES ('ai_configuration', $1::jsonb, 'Local Ollama query generation configuration', $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify({ ...defaultAiConfiguration, ...sanitized }), updatedBy]
    );
  }

  public async getSystemStatistics(): Promise<Record<string, unknown>> {
    const [students, departments, faculty, subjects, queries, saved, successful, blocked, failed, week, average] = await Promise.all([
      this.countTable('students'),
      this.countTable('departments'),
      this.countTable('faculty'),
      this.countTable('subjects'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.ai_queries'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.saved_queries'),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.ai_queries WHERE query_status = 'SUCCESS'`),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.ai_queries WHERE query_status = 'BLOCKED'`),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.ai_queries WHERE query_status = 'FAILED'`),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.ai_queries WHERE created_at >= NOW() - INTERVAL '7 days'`),
      query<{ average: string | null }>(`SELECT AVG(execution_time_ms)::text AS average FROM public.ai_queries WHERE execution_time_ms IS NOT NULL`),
    ]);
    const totalQueries = Number(queries.rows[0]?.count || 0);
    return {
      totalQueries,
      savedQueries: Number(saved.rows[0]?.count || 0),
      queriesThisWeek: Number(week.rows[0]?.count || 0),
      recentInsights: Number(successful.rows[0]?.count || 0),
      successfulQueries: Number(successful.rows[0]?.count || 0),
      blockedQueries: Number(blocked.rows[0]?.count || 0),
      failedQueries: Number(failed.rows[0]?.count || 0),
      avgExecutionTime: Number(average.rows[0]?.average || 0),
      schemaStats: { students, faculty, departments, subjects },
    };
  }

  public async getQuickInsights(): Promise<Record<string, unknown>[]> {
    const result = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.students) AS student_count,
         (SELECT ROUND(AVG(current_cgpa), 2) FROM public.student_academic_summary) AS average_cgpa,
         (SELECT COUNT(*)::int
            FROM public.v_student_attendance_summary
           WHERE attendance_percentage < 75) AS low_attendance_students`
    );
    const row = result.rows[0] || {};
    return [
      { id: 'students', subtitle: 'Institution', badge: String(row.student_count ?? 0), badgeColor: 'bg-blue-100 text-blue-800 border-blue-200', title: 'Enrolled students', statValue: row.student_count ?? 0, statSubtext: 'students', explanation: 'Counted from the local students table.', query: 'How many students are there?' },
      { id: 'cgpa', subtitle: 'Academic', badge: 'CGPA', badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200', title: 'Average CGPA', statValue: row.average_cgpa ?? '—', statSubtext: 'current average', explanation: 'Calculated from local student academic summaries.', query: 'What is the average CGPA of each department?' },
      { id: 'attendance', subtitle: 'Attendance', badge: 'LOW', badgeColor: 'bg-amber-100 text-amber-800 border-amber-200', title: 'Below 75% attendance', statValue: row.low_attendance_students ?? 0, statSubtext: 'students', explanation: 'Counted from per-student attendance roll-ups.', query: 'Which AIML students have attendance below 75%?' },
    ];
  }

  public async getSystemAnalytics(): Promise<Record<string, unknown>> {
    const [daily, statuses, roles] = await Promise.all([
      query(`SELECT created_at::date AS day, COUNT(*)::int AS count FROM public.ai_queries GROUP BY created_at::date ORDER BY day DESC LIMIT 30`),
      query(`SELECT query_status AS status, COUNT(*)::int AS count FROM public.ai_queries GROUP BY query_status ORDER BY status`),
      query(`SELECT role, COUNT(*)::int AS count FROM public.arcgpt_users GROUP BY role ORDER BY role`),
    ]);
    return {
      queriesPerDay: daily.rows,
      queriesByRole: roles.rows,
      queryStatusDistribution: statuses.rows,
      mostCommonQuestions: [],
    };
  }

  public async getRolesAndPermissions(): Promise<Record<string, unknown>[]> {
    try {
      const result = await query('SELECT role_name, description FROM public.roles ORDER BY role_name');
      if (result.rows.length > 0) return result.rows;
    } catch {
      return [];
    }
    return [];
  }

  public async ensureConversation(userId: string, conversationId: string | undefined, title: string): Promise<string> {
    if (conversationId && uuidOrNull(conversationId)) {
      const existing = await query('SELECT conversation_id FROM public.ai_conversations WHERE conversation_id = $1 AND user_id = $2', [conversationId, userId]);
      if (existing.rows[0]) return conversationId;
    }
    const result = await query<{ conversation_id: string }>(
      `INSERT INTO public.ai_conversations (user_id, title) VALUES ($1, $2) RETURNING conversation_id`,
      [userId, title.slice(0, 120)]
    );
    return result.rows[0].conversation_id;
  }

  public async appendConversationMessage(conversationId: string, role: 'user' | 'assistant', message: string, queryId?: string): Promise<void> {
    await query(
      `INSERT INTO public.ai_messages (conversation_id, role, message, query_id)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, role, message, uuidOrNull(queryId)]
    );
  }

  public async listConversations(userId: string, limit = 50): Promise<ConversationSummary[]> {
    if (!uuidOrNull(userId)) return [];
    const result = await query<ConversationSummary>(
      `SELECT c.conversation_id AS id,
              COALESCE(NULLIF(c.title, ''), 'New Arc') AS title,
              c.updated_at AS "updatedAt",
              COUNT(m.message_id)::int AS "messageCount"
       FROM public.ai_conversations c
       LEFT JOIN public.ai_messages m ON m.conversation_id = c.conversation_id
       WHERE c.user_id = $1
       GROUP BY c.conversation_id
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Returns the ordered turns of one conversation, or `null` when the
   * conversation does not exist *for this user* — an unreadable id and a
   * missing one are deliberately indistinguishable so the route cannot be used
   * to probe for other users' conversation ids.
   */
  public async getConversationMessages(userId: string, conversationId: string): Promise<ConversationMessage[] | null> {
    if (!uuidOrNull(userId) || !uuidOrNull(conversationId)) return null;
    const owner = await query<{ conversation_id: string }>(
      'SELECT conversation_id FROM public.ai_conversations WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId]
    );
    if (!owner.rows[0]) return null;
    const result = await query<ConversationMessage>(
      `SELECT message_id AS id, role, message AS content, created_at AS "createdAt"
       FROM public.ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, message_id ASC`,
      [conversationId]
    );
    return result.rows;
  }

  public async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    if (!uuidOrNull(userId) || !uuidOrNull(conversationId)) return false;
    const result = await query(
      'DELETE FROM public.ai_conversations WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async getConnectionStatus(): Promise<Record<string, unknown>> {
    const isConnected = await checkPostgresConnection();
    if (!isConnected) {
      return {
        status: 'Disconnected',
        database: process.env.DB_NAME || 'arcgpt_new',
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        studentCount: 0,
        departmentCount: 0,
        tablesCount: 0,
        ssl: false,
        poolActive: pool.totalCount,
        poolIdle: pool.idleCount,
        latencyMs: 0,
      };
    }
    const start = Date.now();
    const [students, departments, tables] = await Promise.all([
      this.countTable('students'),
      this.countTable('departments'),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`),
    ]);
    const latencyMs = Date.now() - start;
    return {
      status: 'Connected',
      database: process.env.DB_NAME || 'arcgpt_new',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      studentCount: students,
      departmentCount: departments,
      tablesCount: Number(tables.rows[0]?.count || 0),
      ssl: false,
      poolActive: pool.totalCount,
      poolIdle: pool.idleCount,
      latencyMs,
    };
  }

  public async getDebugReport(): Promise<Record<string, unknown>> {
    const isConnected = await checkPostgresConnection();
    if (!isConnected) {
      return {
        connected: false,
        studentsCount: 0,
        departmentsCount: 0,
        sampleStudents: [],
      };
    }
    const [studentsRes, deptsRes, sampleRes] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.students'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.departments'),
      query('SELECT student_id, register_number, first_name, last_name FROM public.students LIMIT 5'),
    ]);
    return {
      connected: true,
      studentsCount: Number(studentsRes.rows[0]?.count || 0),
      departmentsCount: Number(deptsRes.rows[0]?.count || 0),
      sampleStudents: sampleRes.rows,
    };
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
}

export const databaseService = new DatabaseService();
