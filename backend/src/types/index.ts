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

export interface QueryExecutionResult {
  queryId: string;
  conversationId?: string;
  naturalLanguageQuery: string;
  intent?: string;
  generatedSql?: string;
  sanitizedSql?: string;
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
}
