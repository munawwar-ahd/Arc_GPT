import { schemaService } from './schema.service.js';
import { sqlValidationService } from './sql-validation.service.js';
import { ConversationContextItem, User } from '../types/index.js';
import { buildResultDigest } from './result-interpreter.service.js';

/**
 * Prompt construction for SQL generation.
 *
 * Extracted from the query pipeline without changing what it says. The prompt
 * is the single most delicate part of ArcGPT: it is a hand-written schema
 * briefing, fourteen database facts, and three rules that exist specifically to
 * stop a 7B model inventing columns. It is kept verbatim in one file so it can
 * be reviewed as a document instead of being lost inside a request handler, and
 * so the provider router can reuse it.
 */

export interface PromptContext {
  question: string;
  user: User;
  /** Prior turns, including the SQL and a digest of the rows each returned. */
  conversationHistory: ConversationContextItem[];
}

export function buildSystemPrompt(question: string, user: User): string {
  const authorization = sqlValidationService.getAuthorizationContext(user);
  const principalInstruction = authorization.role === 'PRINCIPAL' ? '\nPRINCIPAL SCOPE: GLOBAL READ across authorized institution data. The Principal has no assigned department. Never infer or add a department filter unless the question explicitly names one.' : '';
  const hodInstruction = authorization.scope === 'ASSIGNED_DEPARTMENT' ? `\nCRITICAL HOD RESTRICTION: The user is the Head of Department (HOD) for department '${user.departmentCode || 'unassigned'}' (id '${user.departmentId || 'unassigned'}'). Apply department_code = '${user.departmentCode || 'unassigned'}' to every read model, and department_id = '${user.departmentId || 'unassigned'}' to every base table that has one. HOD is not authorized to query v_student_directory because it includes guardian contact information; use v_marks_detail, v_attendance_detail or student_academic_summary instead. Any per-student table must join by student_id to a directly scoped students source. Never query unscoped rows. An OR in the WHERE clause, a CTE, a set operation or a nested SELECT is rejected outright for an HOD, so write a single flat SELECT with a direct department filter.` : '';

  return `You are ArcGPT's local SQL generation engine for a college ERP database. Return one JSON object with exactly intent, tables, and sql.
The sql value must be one PostgreSQL read-only SELECT or WITH ... SELECT statement.
Never return DDL, DML, multiple statements, comments, system catalogs, credentials, or arbitrary SQL.
Use ONLY tables and columns supplied below.

HARD CONSTRAINT ON AVAILABILITY: you may reference ONLY the tables and views
that actually appear in the schema block below. A name that is not in that block
does not exist for you, even if it sounds like a plausible part of a college
system. The list below is deliberately short and chosen for this question; do
not reach for a table you were not given.

READ THE READ MODELS FIRST. The base tables are correctly normalised, which means a
question like "my DBMS attendance in semester 3" would otherwise need a
five-table join, and that is where you start inventing columns. The read models
are already flattened, so most questions are ONE table scan.

The read models available for THIS question are exactly these, and no others:
${schemaService.getRelevantReadModelGuide(question)}

Use the base tables only for counts and aggregates the read models do not expose, and
for reference data such as semesters, subjects, faculty, periods and classrooms.

FACTS ABOUT THIS DATABASE:
1. Department codes are exactly 'AIML', 'CSE', 'ECE' and 'MECH'. Filter with department_code = 'AIML', never a department name. Apply this rule strictly and to EVERY predicate you write: if the question NAMES a department you MUST filter on it, and if the question does NOT name a department you MUST NOT add a department filter. Never guess a department. The same applies to a named year of study (year_of_study = 2), a named section (section_code = 'A') and a named semester: if the question names one, filter on it.
2. Restate every constraint from the question as an explicit WHERE predicate. A question like "second year AIML section A at 2 PM Monday" needs department_code = 'AIML' AND year_of_study = 2 AND section_code = 'A' AND day_name = 'MONDAY' AND start_time <= TIME '14:00' AND end_time > TIME '14:00'. Silently dropping one of them returns the wrong rows.
3. residence_status holds 'HOSTELLER' or 'DAY_SCHOLAR'. For "which students are hostellers" query v_student_directory directly, for example: SELECT full_name, register_number, department_code FROM v_student_directory WHERE department_code = 'AIML' AND residence_status = 'HOSTELLER'.
4. Attendance percentage is NOT stored. It is computed in v_attendance_detail as 100 * classes_attended / total_classes. Never divide by anything you invent and never expect a column called attendance_percentage on the base attendance table.
5. CGPA is derived from published marks. v_student_cgpa.semester_gpa and student_academic_summary.current_cgpa are already correct, so "who has the highest CGPA" is: SELECT register_number, full_name, current_cgpa FROM student_academic_summary WHERE current_cgpa IS NOT NULL ORDER BY current_cgpa DESC LIMIT 10. No GROUP BY and no join needed. For a PER-SEMESTER GPA ("what was my GPA in semester 2") use v_student_cgpa, which has semester_number, semester_gpa and cgpa_cumulative but NO register_number, so join it: SELECT g.semester_number, g.semester_gpa, g.cgpa_cumulative FROM v_student_cgpa g JOIN v_student_directory d ON d.student_id = g.student_id WHERE d.register_number = 'AIML32022A07' AND g.semester_number = 2. Only student_academic_summary, v_student_directory, v_marks_detail, v_iat_marks, v_attendance_detail, v_backlog_detail and v_fee_status carry register_number directly.
6. Semester numbers are 1 to 8. semesters is a table of POSITIONS shared by every academic year, so semesters has NO academic_year_id; the year lives in course_offerings.academic_year_id and appears in the views as academic_year.
7. There are NO future marks. Only semesters a student has already completed have rows in v_marks_detail. Never try to filter marks by a future semester.
8. IAT marks are out of 40 and are stored per student, subject and iat_number. v_iat_marks already pivots them into iat1_marks, iat2_marks, iat3_marks, so prefer it over joining iat_marks three times.
9. Fees: v_fee_status.amount_paid is the sum of fee_payments and amount_pending is total_amount - discount - amount_paid. Filter fee_type_code = 'COLLEGE_FEE' or 'HOSTEL_FEE'. payment_status is 'PAID', 'PARTIALLY_PAID' or 'UNPAID'. Never compute pending by hand. amount_pending and amount_paid exist ONLY on v_fee_status: the base table student_fees has total_amount, discount and due_date and nothing else, so never select amount_pending from student_fees and never alias v_fee_status as sf and then read a column it lacks. For one student's pending hostel fee write exactly: SELECT SUM(f.amount_pending) AS pending FROM v_fee_status f WHERE f.register_number = 'AIML32022A07' AND f.fee_type_code = 'HOSTEL_FEE'.
10. Timetable: day_number 1 is Monday, 5 is Friday. Period 4 starts at 14:00, so "at 2 PM" means start_time <= TIME '14:00' AND end_time > TIME '14:00'. Answer EVERY schedule question from v_timetable_detail and nothing else. The raw timetable table stores weekday_id and period_id, not day_number and period_number, so never filter the raw table by a day or period name — it will fail on an undefined column. v_timetable_detail has NO register_number: for a named student, reach it through the section: SELECT t.subject_name, t.faculty_name, t.start_time, t.end_time, t.classroom FROM v_timetable_detail t JOIN v_student_directory d ON d.section_id = t.section_id WHERE d.register_number = 'AIML32022A07' AND t.day_name = 'MONDAY' AND t.start_time <= TIME '14:00' AND t.end_time > TIME '14:00'.
11. IMPORTANT: the timetable only contains the CURRENT semester. For "who teaches <subject>" with no day, time or period in the question, do NOT use the timetable; it will miss every subject from an earlier semester. Query the offering instead: SELECT f.first_name, f.last_name, f.designation, d.department_code, s.subject_code, s.subject_name, sub.subject_name FROM course_offerings co JOIN subjects s ON s.subject_id = co.subject_id JOIN faculty f ON f.faculty_id = co.faculty_id JOIN sections sec ON sec.section_id = co.section_id JOIN departments d ON d.department_id = sec.department_id WHERE s.subject_name ILIKE '%<subject>%'. Only reach for v_timetable_detail when the question mentions a day, a time, a period, a classroom or "timetable"/"schedule".
12. Backlogs: at most one ACTIVE backlog per student per subject. Use v_backlog_detail and filter backlog_status = 'ACTIVE'.
13. Subjects belong to a department AND a semester, and are reused by every section and student. A student's subjects are never stored as a list; the path is students -> sections -> course_offerings -> subjects, or simply use v_marks_detail which is already flat.
14. To answer about one specific student you need their student_id, but a question will usually only give you a name or register_number. Always filter the flat view on register_number, for example: SELECT subject_name, semester_number, total_marks_obtained, total_max_marks, letter_grade FROM v_marks_detail WHERE register_number = 'AIML32022A07'. When the question says "my" or "this student" and supplies no identifier, look for a register_number in the conversation context; if there is none, filter on the name the user gave.
15. FOLLOW-UPS: a question such as "which of them...", "of those...", "how many of these..." refers to the rows returned by the PREVIOUS question. A PREVIOUS RESULT block below lists the identifiers that came back. Constrain this query to those identifiers — for example filter on register_number IN (the values listed) or join back through the same read model — instead of returning the whole department again. If the previous result block is absent, ask nothing further and answer from the question alone.

Do not invent tables or columns. Do not write SELECT *. Name the columns you need.
Three rules that prevent the most common failure:
  a. Every table whose column you reference must appear in FROM or in a JOIN. Never select or filter on a column from a table you did not join. Selecting d.department_code without joining departments fails.
  b. When two tables in scope share a column name, always qualify it with the table alias: sd.department_code, not department_code. Joining two read models that both carry department_code, register_number or student_id makes the bare name ambiguous.
  c. Count and average questions need an aggregate: SELECT AVG(current_cgpa) FROM student_academic_summary WHERE department_code = 'AIML' with no GROUP BY, or add GROUP BY department_code when averaging per department.
Role: ${user.role}; scope: ${authorization.scope}.${principalInstruction}${hodInstruction}`;
}

export function buildUserPrompt(context: PromptContext): string {
  const relevantSchema = schemaService.getRelevantSchemaPrompt(context.question);
  const transcript = buildConversationContext(context.conversationHistory);
  return `Relevant PostgreSQL schema:\n${relevantSchema}\n\nConversation context:\n${transcript || 'None'}\n\nQuestion: ${context.question}\n\nReturn JSON with intent, tables, and sql.`;
}

/**
 * Renders prior turns for the prompt.
 *
 * Each assistant turn carries the SQL it ran and, where the client supplied
 * one, a digest of the rows it returned. The digest is what makes "which of
 * them have backlogs?" answerable: without the identifiers from the previous
 * result, "them" resolves to nothing and the model either re-runs the original
 * broad query or invents a scope. Column names and up to five identifying
 * values are carried — never the whole result set, which would bloat the
 * prompt and leak data the user never asked to see restated.
 */
export function buildConversationContext(history: ConversationContextItem[]): string {
  const recent = history.slice(-6);
  return recent
    .map(item => {
      const parts = [`${item.role.toUpperCase()}: ${item.content}`];
      if (item.sql) parts.push(`[prior SQL: ${item.sql}]`);
      const digest = (item as ConversationContextItem & { resultDigest?: string }).resultDigest;
      if (digest) parts.push(`[PREVIOUS RESULT: ${digest}]`);
      return parts.join(' ');
    })
    .join('\n');
}

export { buildResultDigest };

export interface RepairScopeCheck {
  preserved: boolean;
  /** Literal values from the original statement that the repair dropped. */
  dropped: string[];
}

/**
 * Checks that a repair changed a *name* and nothing else.
 *
 * The repair prompt asks for exactly that, and this is what holds it to it. The
 * SQL validator is not enough on its own: an administrator's queries are
 * legitimately unscoped, so the validator will happily accept a repaired
 * statement that has quietly lost `department_code = 'AIML'` — a statement that
 * is still safe, and no longer answers the question.
 *
 * So every literal the original statement filtered on — a department code, a
 * register number, a threshold, a semester number — must still be present in the
 * repair. A repair that introduces a literal is fine (that is what adding an
 * alias-qualified column looks like); one that *removes* one is not a name fix.
 *
 * Comparing literals rather than parsing the AST keeps this comprehensible and
 * independent of how the model phrased the rest of the query.
 */
export function verifyRepairScope(originalSql: string, repairedSql: string): RepairScopeCheck {
  const original = extractLiterals(originalSql);
  const repaired = new Set(extractLiterals(repairedSql));
  const dropped = original.filter(literal => !repaired.has(literal));
  return { preserved: dropped.length === 0, dropped };
}

/**
 * String and numeric literals in a statement, lowercased.
 *
 * Comment markers and dollar-quoted bodies are stripped first so a name that
 * merely appears inside a comment or inside a string is not mistaken for a
 * filter value.
 */
function extractLiterals(sql: string): string[] {
  const withoutComments = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  const literals = new Set<string>();

  for (const match of withoutComments.matchAll(/'([^']*)'/g)) {
    if (match[1].trim()) literals.add(`'${match[1].toLowerCase()}'`);
  }
  // Numbers that stand alone, not part of an identifier or a qualified name.
  for (const match of withoutComments.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])/g)) {
    literals.add(match[1]);
  }

  return Array.from(literals);
}

/**
 * Prompt for the single repair attempt.
 *
 * PostgreSQL rejected the first statement because it named a column or table
 * that does not exist. That is a *precise* error message — it says exactly which
 * name is wrong — and it is the most useful thing that can be handed back to a
 * model, because the failure is always a name that is nearly right.
 *
 * The real column list for every table the failing statement touched is included
 * verbatim. Without it the model is asked to guess a name again, and guessing is
 * what produced the error.
 *
 * Scope is deliberately narrow: this asks only for a corrected statement. It
 * cannot widen the read, drop the department filter, or escape the allowlist,
 * because the answer goes back through `sqlValidationService.validate` before it
 * is allowed near the database.
 */
export function buildRepairPrompt(params: {
  question: string;
  failedSql: string;
  error: string;
  tables: string[];
}): string {
  const columnBlocks = params.tables
    .map(name => {
      const table = schemaService.getTableSchema(name);
      if (!table) return '';
      const columns = table.columns.map(column => column.name).join(', ');
      return `- ${name}: ${columns}`;
    })
    .filter(Boolean);

  return [
    'The SQL below was rejected by PostgreSQL. The reason is given below.',
    'Return the SAME query with only the reported problem corrected. Do not change what the query asks for,',
    'do not drop a filter, and do not add one that was not in the original question.',
    'A "column does not exist" or "relation does not exist" error means a name is wrong: use only names from the list below.',
    'A GROUP BY error means every selected column must be in the GROUP BY, or wrapped in an aggregate such as MIN(), MAX() or COUNT().',
    '',
    `Question: ${params.question}`,
    '',
    `Rejected SQL: ${params.failedSql}`,
    '',
    `PostgreSQL error: ${params.error}`,
    '',
    'These are the exact columns and tables that exist. Copy the names from here exactly:',
    ...columnBlocks,
    '',
    'Return JSON with intent, tables, and sql.',
  ].join('\n');
}