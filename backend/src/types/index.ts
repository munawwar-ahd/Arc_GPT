/**
 * Core domain types for ArcGPT
 */

export type UserRole =
  | 'Admin'
  | 'SUPER_ADMIN'
  | 'Principal'
  | 'HOD'
  | 'Faculty'
  | 'Student'
  | 'Accounts'
  | 'Placement Officer'
  | 'Librarian';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  departmentId?: string | number;
  departmentCode?: string;
  studentId?: string;
  status?: 'active' | 'disabled';
  phone?: string;
  lastActive?: string;
}

export type QueryExecutionStatus = 'success' | 'empty' | 'blocked' | 'failed' | 'unauthorized' | 'clarification_needed' | 'not_available' | 'access_denied' | 'unsupported';

export interface PipelineStep {
  step: number;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  durationMs?: number;
  details?: string;
}

export interface RelationalField {
  name: string;
  type: string;
  isPrimary?: boolean;
  isForeignKey?: boolean;
  references?: {
    table: string;
    field: string;
  };
  description: string;
}

export interface TableSchema {
  name: string;
  description: string;
  columns: RelationalField[];
  rowCount?: number;
}

export interface ChartRecommendation {
  type: 'bar' | 'line' | 'pie' | 'area' | 'none';
  xAxisKey?: string;
  yAxisKey?: string;
  seriesKeys?: string[];
  title: string;
  description: string;
}

/**
 * Which local model produced the SQL for a turn.
 *
 * Echoed back so the chat can show what answered, and so a query is
 * attributable in the log. Deliberately excludes the provider's URL: this
 * travels to the browser, and the endpoint is not part of the answer.
 */
export interface QueryModelInfo {
  id: string;
  name: string;
  provider: 'ollama' | 'lmstudio';
  providerLabel: string;
}

/** A model the backend can talk to, with its availability measured live. */
export interface AvailableModel extends QueryModelInfo {
  available: boolean;
  /** One short line: how the id was resolved, or why it is unusable. */
  detail?: string;
}

export interface QueryExecutionResult {
  queryId: string;
  conversationId?: string;
  naturalLanguageQuery: string;
  intent?: string;
  generatedSql?: string;
  sanitizedSql?: string;
  /**
   * The statement that was rejected for naming a column or table that does not
   * exist, present only when the pipeline corrected it and the correction
   * succeeded. `generatedSql` holds the corrected statement in that case.
   */
  correctedSql?: string;
  columns: string[];
  rows: Record<string, any>[];
  data?: Record<string, any>[];
  rowCount: number;
  naturalLanguageAnswer: string;
  queryExplanation: string;
  visualization?: ChartRecommendation;
  status: QueryExecutionStatus;
  resultStatus?: 'SUCCESS' | 'EMPTY' | 'ERROR' | 'BLOCKED' | 'UNAUTHORIZED' | 'NOT_AVAILABLE' | 'ACCESS_DENIED' | 'UNSUPPORTED';
  executionTimeMs: number;
  clarificationRequired?: boolean;
  clarificationQuestion?: string;
  clarificationSuggestions?: string[];
  blockedReason?: string;
  pipelineSteps: PipelineStep[];
  /** The model that generated this turn's SQL. */
  model?: QueryModelInfo;
  /**
   * Compact digest of the returned rows, echoed so the client can forward it
   * with the next question and a follow-up can refer to the previous result.
   */
  resultDigest?: string;
  isCorrected?: boolean;
  correctionAttempts?: number;
  createdAt: string;
}

export interface QueryHistoryItem {
  id: string;
  user_id: string;
  user_name?: string;
  user_role?: UserRole;
  natural_language_query: string;
  generated_sql: string;
  execution_status: QueryExecutionStatus;
  execution_time: number;
  row_count?: number;
  created_at: string;
  blocked_reason?: string;
}

export interface AuditLogItem {
  id: string;
  user_id: string;
  user_name?: string;
  user_role?: UserRole;
  action: string;
  query_hash: string;
  status: string;
  details?: string;
  created_at: string;
}

export interface FeedbackItem {
  id: number;
  query_history_id: number;
  rating: number; // 1-5 or 1 (up) / -1 (down)
  comment: string;
  created_at: string;
}

export interface SavedQuery {
  id: string;
  user_id: string;
  title: string;
  natural_language_query: string;
  generated_sql: string;
  created_at: string;
}

export interface ConversationContextItem {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  /**
   * Column names and up to five identifying values from the rows this turn
   * returned. It is what lets "which of them have backlogs?" resolve "them".
   */
  resultDigest?: string;
}
