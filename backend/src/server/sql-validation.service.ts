import { parse } from 'pgsql-ast-parser';
import { User } from '../types/index.js';
import { ALLOWED_TABLE_NAMES, PROTECTED_TABLES } from './schema.service.js';

export interface SqlValidationResult {
  isValid: boolean;
  sanitizedSql?: string;
  blockedReason?: string;
  detectedTables: string[];
  referencedColumns: string[];
}

export interface QueryAuthorizationContext {
  role: string;
  scope: 'GLOBAL' | 'ASSIGNED_DEPARTMENT' | 'USER';
  departmentId?: string | number;
}

const BLOCKED_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE',
  'MERGE', 'CALL', 'EXEC', 'EXECUTE', 'COPY', 'VACUUM', 'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'SAVEPOINT', 'DO', 'LOCK', 'NOTIFY', 'LISTEN', 'UNLISTEN', 'SET', 'RESET', 'SHOW',
  'EXPLAIN', 'INTO', 'FOR UPDATE', 'FOR SHARE',
]);

const BLOCKED_IDENTIFIERS = [
  'password', 'password_hash', 'secret', 'token', 'api_key', 'apikey', 'credential', 'private_key',
  'pg_catalog', 'information_schema', 'auth', 'current_user', 'session_user', 'current_database', 'current_setting', 'set_config',
  'pg_sleep', 'sleep', 'load_file', 'dblink', 'postgres_fdw',
  'pg_read_file', 'pg_read_binary_file', 'pg_write_file', 'pg_ls_dir', 'pg_ls_logdir', 'pg_ls_waldir', 'pg_stat_file',
  'pg_execute_server_program', 'lo_import', 'lo_export',
];

/**
 * Financial and residential records. These are money and living arrangements,
 * not academic data, so only the Accounts role may read them.
 */
const SENSITIVE_TABLES = new Set([
  'student_fees', 'fee_payments', 'fee_structure', 'fee_types', 'v_fee_status',
  'hostels', 'hostel_rooms', 'hostel_allocations', 'v_hostel_allocation',
]);

/**
 * Guardian contact details are personal data, not academic records.
 *
 * `guardians` is the source table and `v_student_directory` projects the same
 * columns as mother_/father_/guardian_ columns, so both are restricted. An HOD
 * or Faculty member asking about attendance or CGPA has no reason to be handed
 * parents' phone numbers, and the read-only pool would happily return them.
 * Only roles already trusted with institution-wide student administration may
 * see this.
 */
const GUARDIAN_PII_TABLES = new Set(['guardians', 'v_student_directory']);
const GUARDIAN_PII_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PRINCIPAL']);

const ACADEMIC_TABLES = new Set([
  'students', 'v_student_directory', 'departments', 'faculty', 'subjects',
  'course_offerings', 'attendance', 'v_attendance_detail', 'v_student_attendance_summary',
  'student_marks', 'v_marks_detail', 'iat_marks', 'v_iat_marks', 'semester_results',
  'v_student_cgpa', 'student_academic_summary', 'backlogs', 'v_backlog_detail',
  'timetable', 'v_timetable_detail', 'sections', 'batches', 'semesters', 'programs',
  'years_of_study', 'student_enrollments', 'enrollments',
]);

/**
 * Tables that carry no department_id of their own, so department scoping has to
 * be reached through a join. Used by the HOD structural proof.
 */
const DEPARTMENT_KEY_TABLES = new Set([
  'departments', 'sections', 'subjects', 'v_student_directory', 'v_marks_detail',
  'v_attendance_detail', 'v_student_attendance_summary', 'v_backlog_detail',
  'v_iat_marks', 'v_timetable_detail', 'v_hostel_allocation', 'students', 'faculty',
]);

function maskQuotedSql(sql: string): string {
  let output = '';
  let quote = '';
  let dollarTag = '';
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        output += ' '.repeat(dollarTag.length);
        index += dollarTag.length - 1;
        dollarTag = '';
      } else {
        output += ' ';
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          output += '  ';
          index += 1;
        } else {
          output += ' ';
          quote = '';
        }
      } else {
        output += ' ';
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += ' ';
      continue;
    }
    if (character === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        output += ' '.repeat(dollarTag.length);
        index += dollarTag.length - 1;
        continue;
      }
    }
    output += character;
  }
  return output;
}

function stripCodeFence(sql: string): string {
  return sql.trim().replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function removeTrailingSemicolon(masked: string, sql: string): { masked: string; sql: string } {
  let maskedValue = masked.trimEnd();
  let sqlValue = sql.trimEnd();
  if (maskedValue.endsWith(';')) {
    maskedValue = maskedValue.slice(0, -1).trimEnd();
    sqlValue = sqlValue.slice(0, -1).trimEnd();
  }
  return { masked: maskedValue, sql: sqlValue };
}

function extractCteNames(masked: string): Set<string> {
  const names = new Set<string>();
  const pattern = /(?:\bwith\s+(?:recursive\s+)?|,)\s*([a-z_][a-z0-9_$]*)\s+as\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) names.add(match[1].toLowerCase());
  return names;
}

function extractTables(masked: string): string[] {
  const tables = new Set<string>();
  const pattern = /\b(?:from|join)\s+(?:(?:public)\.)?([a-z_][a-z0-9_$]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) tables.add(match[1].toLowerCase());
  return Array.from(tables);
}

function extractColumns(masked: string): string[] {
  const columns = new Set<string>();
  const pattern = /\b(?:[a-z_][a-z0-9_$]*\.)?([a-z_][a-z0-9_$]*)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const value = match[1].toLowerCase();
    if (!['select', 'from', 'where', 'join', 'on', 'and', 'or', 'as', 'by', 'group', 'order', 'limit', 'offset', 'having', 'distinct', 'case', 'when', 'then', 'else', 'end', 'with', 'union', 'all', 'not', 'in', 'is', 'null', 'asc', 'desc', 'using', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'returning', 'filter', 'over', 'partition', 'rows', 'range', 'values', 'true', 'false'].includes(value)) {
      columns.add(value);
    }
  }
  return Array.from(columns);
}

function roleName(user: User): string {
  return user.role.toUpperCase();
}

function hasAny(sql: string, values: string[]): boolean {
  return values.some(value => new RegExp(`\\b${value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(sql));
}

type SqlAstRecord = Record<string, unknown>;

function isSqlAstRecord(value: unknown): value is SqlAstRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectAstRecords(value: unknown, records: SqlAstRecord[] = []): SqlAstRecord[] {
  if (Array.isArray(value)) {
    value.forEach(item => collectAstRecords(item, records));
  } else if (isSqlAstRecord(value)) {
    records.push(value);
    Object.values(value).forEach(item => collectAstRecords(item, records));
  }
  return records;
}

function astName(value: unknown): string | undefined {
  if (typeof value === 'string') return value.toLowerCase();
  if (!isSqlAstRecord(value) || typeof value.name !== 'string') return undefined;
  return value.name.toLowerCase();
}

function astAlias(value: unknown, fallback: string): string {
  return isSqlAstRecord(value) && typeof value.alias === 'string'
    ? value.alias.toLowerCase()
    : fallback.toLowerCase();
}

function astRef(value: unknown): { table?: string; name?: string } | undefined {
  if (!isSqlAstRecord(value) || value.type !== 'ref') return undefined;
  const table = isSqlAstRecord(value.table) ? astName(value.table) : undefined;
  return { table, name: astName(value.name) };
}

function astLiteral(value: unknown): string | undefined {
  if (!isSqlAstRecord(value)) return undefined;
  if (value.type === 'string' && typeof value.value === 'string') return value.value.toUpperCase();
  if (value.type === 'integer' && typeof value.value === 'number') return String(value.value);
  return undefined;
}

function collectAndTerms(expression: unknown, terms: SqlAstRecord[]): boolean {
  if (!isSqlAstRecord(expression)) return false;
  if (expression.type === 'binary' && typeof expression.op === 'string') {
    const operator = expression.op.toUpperCase();
    if (operator === 'OR') return false;
    if (operator === 'AND') {
      return collectAndTerms(expression.left, terms) && collectAndTerms(expression.right, terms);
    }
  }
  terms.push(expression);
  return true;
}

function hasDepartmentEquality(
  terms: SqlAstRecord[],
  alias: string,
  fieldName: string,
  expected: string,
  allowUnqualified: boolean
): boolean {
  return terms.some(term => {
    if (term.type !== 'binary' || typeof term.op !== 'string' || term.op !== '=') return false;
    const leftRef = astRef(term.left);
    const rightRef = astRef(term.right);
    const leftValue = astLiteral(term.left);
    const rightValue = astLiteral(term.right);
    const matches = (reference: { table?: string; name?: string } | undefined, literal: string | undefined) =>
      reference?.name === fieldName && (reference.table === alias || (allowUnqualified && !reference.table)) && literal === expected.toUpperCase();
    return matches(leftRef, rightValue) || matches(rightRef, leftValue);
  });
}

function hasStudentJoin(joinConditions: unknown[], childAlias: string, studentAliases: Set<string>): boolean {
  return collectAstRecords(joinConditions).some(node => {
    if (node.type !== 'binary' || node.op !== '=') return false;
    const left = astRef(node.left);
    const right = astRef(node.right);
    return Boolean(
      left?.name === 'student_id' && right?.name === 'student_id' &&
      ((left.table === childAlias && right.table && studentAliases.has(right.table)) ||
        (right.table === childAlias && left.table && studentAliases.has(left.table)))
    );
  });
}

function hasDepartmentJoin(joinConditions: unknown[], sourceAlias: string, departmentAliases: Set<string>): boolean {
  return collectAstRecords(joinConditions).some(node => {
    if (node.type !== 'binary' || node.op !== '=') return false;
    const left = astRef(node.left);
    const right = astRef(node.right);
    return Boolean(
      left?.name === 'department_id' && right?.name === 'department_id' &&
      ((left.table === sourceAlias && right.table && departmentAliases.has(right.table)) ||
        (right.table === sourceAlias && left.table && departmentAliases.has(left.table)))
    );
  });
}

function validateHodAst(sql: string, user: User): string | undefined {
  if (!user.departmentCode || !user.departmentId) {
    return 'REQUEST_BLOCKED: HOD account has no assigned department.';
  }

  let statements: unknown[];
  try {
    statements = parse(sql) as unknown[];
  } catch {
    return 'REQUEST_BLOCKED: HOD query could not be structurally validated.';
  }
  if (statements.length !== 1 || !isSqlAstRecord(statements[0]) || statements[0].type !== 'select') {
    return 'REQUEST_BLOCKED: HOD queries must be a single, directly scoped SELECT.';
  }

  const statement = statements[0];
  const astRecords = collectAstRecords(statement);
  if (astRecords.filter(node => node.type === 'select').length !== 1 ||
      astRecords.some(node => ['with', 'union', 'intersect', 'except'].includes(String(node.type)))) {
    return 'REQUEST_BLOCKED: HOD queries cannot use CTEs, set operations, or nested SELECT statements.';
  }

  const whereTerms: SqlAstRecord[] = [];
  if (!collectAndTerms(statement.where, whereTerms)) {
    return 'REQUEST_BLOCKED: HOD queries cannot use disjunctions that could widen department scope.';
  }

  if (!Array.isArray(statement.from) || statement.from.length === 0) {
    return 'REQUEST_BLOCKED: HOD queries must read a department-scoped institution table.';
  }

  const sources: Array<{ table: string; alias: string }> = [];
  const joinConditions: unknown[] = [];
  for (const source of statement.from) {
    if (!isSqlAstRecord(source) || source.type !== 'table') {
      return 'REQUEST_BLOCKED: HOD queries cannot read nested or derived tables.';
    }
    const tableName = astName(source.name);
    if (!tableName) return 'REQUEST_BLOCKED: HOD query contains an unresolved table reference.';
    const nameRecord = isSqlAstRecord(source.name) ? source.name : undefined;
    sources.push({ table: tableName, alias: astAlias(nameRecord, tableName) });
    if (isSqlAstRecord(source.join)) {
      if (typeof source.join.type !== 'string' || source.join.type.toUpperCase() === 'CROSS JOIN' || !source.join.on) {
        return 'REQUEST_BLOCKED: HOD queries cannot use cross joins or unverified joins.';
      }
      joinConditions.push(source.join.on);
    } else if (sources.length > 1) {
      return 'REQUEST_BLOCKED: HOD queries cannot use implicit cross joins.';
    }
  }

  // The v_* read models already carry department_code / department_id, so a
  // single-source query can be proven scoped by a direct equality on them.
  const directCodeTables = new Set([
    'v_student_directory', 'v_marks_detail', 'v_attendance_detail',
    'v_student_attendance_summary', 'v_backlog_detail', 'v_iat_marks',
    'v_timetable_detail', 'v_hostel_allocation', 'student_academic_summary',
  ]);
  const directIdTables = new Set(['students', 'faculty', 'subjects', 'sections', 'batches']);
  // Tables that only make sense underneath a proven student. The v_* read
  // models are listed because they carry student_id too, so joining one to a
  // department-scoped `students` alias is exactly as safe as joining the raw
  // assessment tables it was built from.
  const studentChildTables = new Set([
    'attendance', 'student_marks', 'iat_marks', 'backlogs', 'semester_results',
    'student_enrollments', 'v_student_cgpa',
    'v_attendance_detail', 'v_student_attendance_summary', 'v_marks_detail',
    'v_iat_marks', 'v_backlog_detail', 'v_hostel_allocation', 'student_academic_summary',
  ]);
  // Reference data with no department of its own and nothing sensitive on it.
  const unscopeableButHarmless = new Set([
    'semesters', 'years_of_study', 'academic_years', 'weekdays', 'period_slots',
    'programs', 'classrooms',
  ]);
  const departmentAliases = new Set<string>();
  const studentAliases = new Set<string>();

  for (const source of sources) {
    if (directCodeTables.has(source.table) && hasDepartmentEquality(whereTerms, source.alias, 'department_code', user.departmentCode, sources.length === 1)) {
      departmentAliases.add(source.alias);
    } else if ((directIdTables.has(source.table) || directCodeTables.has(source.table)) && hasDepartmentEquality(whereTerms, source.alias, 'department_id', String(user.departmentId), sources.length === 1)) {
      departmentAliases.add(source.alias);
    } else if (source.table === 'departments' &&
        (hasDepartmentEquality(whereTerms, source.alias, 'department_code', user.departmentCode, sources.length === 1) ||
          hasDepartmentEquality(whereTerms, source.alias, 'department_id', String(user.departmentId), sources.length === 1))) {
      departmentAliases.add(source.alias);
    }
  }

  for (const source of sources) {
    if (!departmentAliases.has(source.alias) && (directIdTables.has(source.table) || directCodeTables.has(source.table)) &&
        hasDepartmentJoin(joinConditions, source.alias, departmentAliases)) {
      departmentAliases.add(source.alias);
    }
    if (departmentAliases.has(source.alias) && (source.table === 'students' || source.table === 'v_student_directory')) {
      studentAliases.add(source.alias);
    }
  }

  for (const source of sources) {
    if (departmentAliases.has(source.alias)) continue;
    if (unscopeableButHarmless.has(source.table)) continue;
    if (studentChildTables.has(source.table) && hasStudentJoin(joinConditions, source.alias, studentAliases)) continue;
    return `REQUEST_BLOCKED: HOD source '${source.table}' is not proven to be restricted to the assigned department.`;
  }
  return undefined;
}

export class SqlValidationService {
  public getAuthorizationContext(user: User): QueryAuthorizationContext {
    const role = roleName(user);
    if (role === 'PRINCIPAL' || role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return { role, scope: 'GLOBAL' };
    }
    if (role === 'HOD') {
      return { role, scope: 'ASSIGNED_DEPARTMENT', departmentId: user.departmentId };
    }
    return { role, scope: 'USER', departmentId: user.departmentId };
  }

  public validate(rawSql: string, user?: User): SqlValidationResult {
    if (!rawSql || typeof rawSql !== 'string') {
      return { isValid: false, blockedReason: 'Empty or invalid SQL statement provided.', detectedTables: [], referencedColumns: [] };
    }

    const cleaned = stripCodeFence(rawSql);
    if (!cleaned || cleaned.length > 10000) {
      return { isValid: false, blockedReason: 'SQL statement is empty or exceeds the complexity limit.', detectedTables: [], referencedColumns: [] };
    }
    if (/(--|\/\*|\*\/|#)/.test(cleaned)) {
      return { isValid: false, blockedReason: 'Query blocked: SQL comments are not permitted.', detectedTables: [], referencedColumns: [] };
    }

    const initialMasked = maskQuotedSql(cleaned);
    const normalized = removeTrailingSemicolon(initialMasked, cleaned);
    if (normalized.masked.includes(';')) {
      return { isValid: false, blockedReason: 'Query blocked: multiple SQL statements are not permitted.', detectedTables: [], referencedColumns: [] };
    }
    if (!/^(select|with)\b/i.test(normalized.masked.trim())) {
      return { isValid: false, blockedReason: 'Query blocked: only read-only SELECT statements are permitted.', detectedTables: [], referencedColumns: [] };
    }

    const tokens = normalized.masked.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) || [];
    for (const token of tokens) {
      // BLOCKED_KEYWORDS is declared in upper case, and the token stream is
      // lower case, so the lookup MUST upper-case the token. Comparing raw
      // lower-case tokens against the set silently never matches, which would
      // let a data-modifying CTE such as
      //   WITH x AS (DELETE FROM students RETURNING *) SELECT * FROM x
      // through the "must start with SELECT or WITH" gate untouched.
      if (BLOCKED_KEYWORDS.has(token.toUpperCase())) {
        return { isValid: false, blockedReason: `Query blocked: disallowed operation '${token.toUpperCase()}' detected.`, detectedTables: [], referencedColumns: [] };
      }
    }
    for (const identifier of BLOCKED_IDENTIFIERS) {
      if (hasAny(normalized.masked, [identifier])) {
        return { isValid: false, blockedReason: `Query blocked: protected identifier '${identifier}' is not available.`, detectedTables: [], referencedColumns: [] };
      }
    }

    const cteNames = extractCteNames(normalized.masked);
    const detectedTables = extractTables(normalized.masked).filter(table => !cteNames.has(table));
    for (const table of detectedTables) {
      if (PROTECTED_TABLES.has(table) || table.startsWith('pg_') || table === 'roles' || table === 'permissions') {
        return { isValid: false, blockedReason: `Query blocked: access to protected table '${table}' is prohibited.`, detectedTables, referencedColumns: [] };
      }
      if (!ALLOWED_TABLE_NAMES.includes(table)) {
        return { isValid: false, blockedReason: `Query blocked: table '${table}' is not an approved institution table.`, detectedTables, referencedColumns: [] };
      }
    }

    const joinCount = (normalized.masked.match(/\bjoin\b/gi) || []).length;
    const cteCount = cteNames.size;
    if (joinCount > 12 || cteCount > 8) {
      return { isValid: false, blockedReason: 'Query blocked: SQL complexity exceeds the configured limit.', detectedTables, referencedColumns: [] };
    }

    const authorization = this.authorizeTables(detectedTables, normalized.sql, normalized.masked, user);
    if (!authorization.allowed) {
      return { isValid: false, blockedReason: authorization.reason, detectedTables, referencedColumns: [] };
    }

    let sanitizedSql = normalized.sql;
    const limitMatch = sanitizedSql.match(/\blimit\s+(\d+)\b/i);
    if (limitMatch) {
      const limit = Number(limitMatch[1]);
      if (limit < 1) {
        return { isValid: false, blockedReason: 'Query blocked: LIMIT must be a positive integer.', detectedTables, referencedColumns: [] };
      }
      if (limit > 500) sanitizedSql = sanitizedSql.replace(/\blimit\s+\d+\b/i, 'LIMIT 500');
    } else {
      const isAggregate = /\b(group\s+by|count\s*\(|avg\s*\(|sum\s*\(|min\s*\(|max\s*\()\b/i.test(normalized.masked);
      if (!isAggregate) sanitizedSql = `${sanitizedSql} LIMIT 500`;
    }

    return {
      isValid: true,
      sanitizedSql,
      detectedTables,
      referencedColumns: extractColumns(normalized.masked),
    };
  }

  public authorizeTables(tables: string[], rawSql: string, maskedSql: string, user?: User): { allowed: boolean; reason?: string } {
    if (!user) return { allowed: false, reason: 'Authentication is required before database access.' };
    const role = roleName(user);
    const tableSet = new Set(tables);
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') return { allowed: true };
    // Checked before the per-category rules below because guardian data is
    // personal rather than financial, placement or library material.
    if (tables.some(table => GUARDIAN_PII_TABLES.has(table)) && !GUARDIAN_PII_ROLES.has(role)) {
      return {
        allowed: false,
        reason: 'Your role cannot query parent or guardian contact details. Ask an administrator.',
      };
    }
    if (tables.some(table => PROTECTED_TABLES.has(table))) {
      return { allowed: false, reason: 'Your role cannot query application control or audit data.' };
    }
    if ([...tableSet].some(table => SENSITIVE_TABLES.has(table)) && !['ACCOUNTS'].includes(role)) {
      return { allowed: false, reason: 'Your role cannot query fee, hostel, or room allocation records.' };
    }

    // Principal has global read scope across authorized institution data, but
    // still passes the category-specific permission checks above.
    if (role === 'PRINCIPAL') return { allowed: true };

    // STUDENT isolation: Must have student_id scope
    if (role === 'STUDENT') {
      const studentTables = [
        'students', 'v_student_directory', 'attendance', 'v_attendance_detail',
        'v_student_attendance_summary', 'student_marks', 'v_marks_detail', 'iat_marks',
        'v_iat_marks', 'backlogs', 'v_backlog_detail', 'semester_results', 'v_student_cgpa',
        'student_academic_summary', 'student_enrollments', 'v_timetable_detail',
      ];
      if (studentTables.some(table => tableSet.has(table)) && !/\bstudent_id\b/i.test(rawSql)) {
        return { allowed: false, reason: 'Student queries must include a student_id scope.' };
      }
    }

    // HOD Department Isolation Enforcement
    if (role === 'HOD') {
      const hodDeptCode = (user.departmentCode || '').toUpperCase().trim();
      const allDepts = ['AIML', 'CSE', 'ECE', 'MECH'];
      const forbiddenDepts = allDepts.filter(d => d !== hodDeptCode);

      // 1. Check if query references any other department in raw SQL (literals or identifiers)
      for (const dept of forbiddenDepts) {
        const deptRegex = new RegExp(`\\b${dept}\\b`, 'i');
        if (deptRegex.test(rawSql)) {
          return {
            allowed: false,
            reason: `REQUEST_BLOCKED: HOD is assigned to ${hodDeptCode || 'another department'} and cannot query data from ${dept}.`,
          };
        }
      }

      // Also check unquoted department_id assignment to another department e.g. department_id = CSE
      for (const dept of forbiddenDepts) {
        if (new RegExp(`department_id\\s*=\\s*['"]?${dept}['"]?`, 'i').test(rawSql) ||
            new RegExp(`department_code\\s*=\\s*['"]?${dept}['"]?`, 'i').test(rawSql)) {
          return {
            allowed: false,
            reason: `REQUEST_BLOCKED: Access to data outside your assigned department (${hodDeptCode}) is prohibited.`,
          };
        }
      }

      // 2. Department-scoped tables MUST include the HOD's department filter.
      // The v_* read models are included because an HOD has no legitimate reason
      // to see another department's roster, marks or attendance roll-up.
      const scopedTables = [
        'students', 'v_student_directory', 'student_academic_summary',
        'attendance', 'v_attendance_detail', 'v_student_attendance_summary',
        'student_marks', 'v_marks_detail', 'iat_marks', 'v_iat_marks',
        'backlogs', 'v_backlog_detail', 'semester_results', 'v_student_cgpa',
        'student_enrollments', 'faculty', 'subjects', 'course_offerings',
        'sections', 'batches', 'timetable', 'v_timetable_detail',
      ];

      if (scopedTables.some(table => tableSet.has(table))) {
        const hasDeptField = hasAny(rawSql, ['department_code', 'department_name', 'department_id']);
        const hasHodScope = (hodDeptCode && new RegExp(`\\b${hodDeptCode}\\b`, 'i').test(rawSql)) ||
                            (user.departmentId && rawSql.includes(String(user.departmentId)));

        if (!hasDeptField || !hasHodScope) {
          return {
            allowed: false,
            reason: `REQUEST_BLOCKED: HOD queries must be strictly scoped to your assigned department (${hodDeptCode || 'assigned'}).`,
          };
        }
      }

      const structuralFailure = validateHodAst(rawSql, user);
      if (structuralFailure) return { allowed: false, reason: structuralFailure };
    }

    if (role === 'FACULTY') {
      const scopedTables = [
        'students', 'v_student_directory', 'student_academic_summary',
        'attendance', 'v_attendance_detail', 'v_student_attendance_summary',
        'student_marks', 'v_marks_detail', 'iat_marks', 'v_iat_marks',
        'backlogs', 'v_backlog_detail', 'semester_results', 'v_student_cgpa',
        'student_enrollments',
      ];
      if (scopedTables.some(table => tableSet.has(table)) && !hasAny(rawSql, ['department_code', 'department_name', 'department_id'])) {
        return { allowed: false, reason: 'Department-scoped roles must include a department filter.' };
      }
    }

    return { allowed: true };
  }
}

export const sqlValidationService = new SqlValidationService();
