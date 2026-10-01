import assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { sqlValidationService } from '../src/server/sql-validation.service.js';
import { ALLOWED_TABLE_NAMES, PROTECTED_TABLES } from '../src/server/schema.service.js';
import { User } from '../src/types/index.js';

/**
 * Security regression suite for the `arcgpt_new` college ERP schema.
 *
 * This runs WITHOUT PostgreSQL or Ollama. It is the guard on the SQL pipeline:
 * if a change to schema.service.ts or sql-validation.service.ts widens what the
 * model is allowed to run, one of these assertions must fail.
 */

const admin: User = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', email: 'test@example.local', role: 'Admin' };
const AIML = 'AIML';
const AIML_ID = '11111111-1111-1111-1111-111111111111';

async function run(): Promise<void> {
  // =========================================================================
  // 1. Read-only queries that MUST be accepted
  // =========================================================================
  const accepted: Array<[string, string]> = [
    ['plain count', 'SELECT COUNT(*) AS total_students FROM students;'],
    ['flat directory view', "SELECT full_name, register_number, department_code FROM v_student_directory WHERE department_code = 'AIML';"],
    ['cgpa summary', 'SELECT register_number, current_cgpa FROM student_academic_summary ORDER BY current_cgpa DESC LIMIT 10;'],
    ['marks for a student', "SELECT subject_name, semester_number, total_marks_obtained, letter_grade FROM v_marks_detail WHERE register_number = 'AIML32022A07';"],
    ['iat view', 'SELECT subject_name, iat1_marks, iat2_marks, iat3_marks FROM v_iat_marks LIMIT 20;'],
    ['attendance below threshold', 'SELECT student_name, attendance_percentage FROM v_attendance_detail WHERE attendance_percentage < 75;'],
    ['backlogs', "SELECT student_name, subject_name FROM v_backlog_detail WHERE backlog_status = 'ACTIVE';"],
    ['timetable by time', "SELECT subject_name, faculty_name FROM v_timetable_detail WHERE day_name = 'MONDAY' AND start_time <= TIME '14:00' AND end_time > TIME '14:00';"],
    ['fees pending', "SELECT student_name, amount_pending FROM v_fee_status WHERE fee_type_code = 'COLLEGE_FEE' AND amount_pending > 0;"],
    ['department aggregate', 'SELECT department_code, count(*) AS n FROM v_student_directory GROUP BY department_code;'],
    ['raw aggregate with join', 'SELECT d.department_code, count(*) AS n FROM departments d JOIN students s ON s.department_id = d.department_id GROUP BY d.department_code;'],
    ['semester position lookup', 'SELECT semester_number, semester_name FROM semesters WHERE semester_number BETWEEN 1 AND 8;'],
  ];
  for (const [label, sql] of accepted) {
    const res = sqlValidationService.validate(sql, admin);
    assert.equal(res.isValid, true, `Admin should be able to run: ${label} (${res.blockedReason || 'no reason given'})`);
  }

  // =========================================================================
  // 2. DDL, DML and administrative statements that MUST be blocked
  // =========================================================================
  const mustBlock: Array<[string, string]> = [
    ['DELETE', 'DELETE FROM students'],
    ['DROP TABLE', 'DROP TABLE students'],
    ['TRUNCATE', 'TRUNCATE TABLE students'],
    ['INSERT', "INSERT INTO students (register_number) VALUES ('HACK')"],
    ['UPDATE', "UPDATE students SET first_name = 'Eve'"],
    ['ALTER TABLE ADD COLUMN', 'ALTER TABLE students ADD COLUMN test TEXT'],
    ['ALTER TABLE DROP COLUMN', 'ALTER TABLE students DROP COLUMN phone'],
    ['GRANT', 'GRANT ALL ON students TO PUBLIC'],
    ['REVOKE', 'REVOKE SELECT ON students FROM PUBLIC'],
    ['CREATE TABLE', 'CREATE TABLE evil (id int)'],
    ['stacked statement', 'SELECT student_id FROM students; DROP TABLE students;'],
    ['comment injection', 'SELECT student_id FROM students -- comment'],
    ['block comment', 'SELECT student_id FROM students /* sneaky */'],
    ['pg_catalog', 'SELECT student_id FROM pg_catalog.pg_authid'],
    ['password column', 'SELECT password FROM students'],
    ['password_hash column', 'SELECT password_hash FROM arcgpt_users'],
    ['pg_read_file', "SELECT pg_read_file('/etc/passwd')"],
    ['set_config', "SELECT set_config('app.role', 'PRINCIPAL', true)"],
    ['current_setting', "SELECT current_setting('app.secret')"],
    ['pg_sleep', 'SELECT pg_sleep(10)'],
    ['dblink', 'SELECT * FROM dblink(\'conn\', \'select 1\') AS t(a)'],
    ['information_schema', 'SELECT table_name FROM information_schema.tables'],
    ['copy', "COPY students TO '/tmp/out.csv'"],
    ['vacuum', 'VACUUM students'],
    ['analyze', 'ANALYZE students'],
    ['explain', 'EXPLAIN SELECT * FROM students'],
    ['cte insert', 'WITH x AS (DELETE FROM students RETURNING *) SELECT * FROM x'],
    ['update inside subquery', 'SELECT (UPDATE students SET phone = NULL) AS x'],
    ['for update lock', 'SELECT student_id FROM students FOR UPDATE'],
    ['truncate via select', 'SELECT * FROM students INTO newtable'],
  ];
  for (const [label, sql] of mustBlock) {
    const res = sqlValidationService.validate(sql, admin);
    assert.equal(res.isValid, false, `Expected to block ${label}: ${sql}`);
  }

  // =========================================================================
  // 3. Application control tables are never readable by the LLM
  // =========================================================================
  for (const table of PROTECTED_TABLES) {
    const res = sqlValidationService.validate(`SELECT * FROM ${table}`, admin);
    assert.equal(res.isValid, false, `Protected table must be blocked: ${table}`);
  }
  // Even for an administrator, who passes the RBAC layer, the allowlist denies it.
  assert.equal(
    sqlValidationService.validate('SELECT full_name FROM arcgpt_users', admin).isValid,
    false,
    'arcgpt_users must never be readable through the query pipeline'
  );

  // =========================================================================
  // 4. Tables outside the declared allowlist are rejected
  // =========================================================================
  for (const table of ['pg_stat_activity', 'sysusers', 'fake_students', 'student_profile_view', 'student_attendance_percentage', 'course_offerings_v2']) {
    const res = sqlValidationService.validate(`SELECT * FROM ${table}`, admin);
    assert.equal(res.isValid, false, `Unlisted table must be blocked: ${table}`);
  }

  // The allowlist must cover the read models the system prompt tells the model
  // to prefer. If a view is renamed without updating the prompt this fails.
  for (const required of [
    'v_student_directory', 'student_academic_summary', 'v_marks_detail', 'v_iat_marks',
    'v_attendance_detail', 'v_student_attendance_summary', 'v_backlog_detail',
    'v_student_cgpa', 'v_timetable_detail', 'v_fee_status', 'v_hostel_allocation',
    'students', 'departments', 'subjects', 'course_offerings', 'attendance',
    'student_marks', 'iat_marks', 'backlogs', 'timetable', 'fee_payments',
  ]) {
    assert.ok(ALLOWED_TABLE_NAMES.includes(required), `Allowlist must contain ${required}`);
  }
  // No control table may ever leak into the allowlist.
  for (const table of PROTECTED_TABLES) {
    assert.equal(ALLOWED_TABLE_NAMES.includes(table), false, `Control table must not be in the allowlist: ${table}`);
  }

  // =========================================================================
  // 5. Role-based access control
  // =========================================================================
  // Financial and residential data is Accounts-only.
  const faculty: User = { ...admin, role: 'Faculty', departmentCode: AIML, departmentId: AIML_ID };
  assert.equal(
    sqlValidationService.validate('SELECT * FROM v_fee_status', faculty).isValid, false,
    'Faculty must not read fees'
  );
  assert.equal(
    sqlValidationService.validate('SELECT * FROM v_hostel_allocation', faculty).isValid, false,
    'Faculty must not read hostel allocations'
  );
  // The same query is fine for Accounts.
  const accounts: User = { ...admin, role: 'Accounts' };
  assert.equal(
    sqlValidationService.validate('SELECT student_name, amount_pending FROM v_fee_status', accounts).isValid, true,
    'Accounts should read fees'
  );
  // And fine for admin / super admin.
  assert.equal(sqlValidationService.validate('SELECT * FROM v_fee_status', admin).isValid, true, 'Admin should read fees');

  // Faculty must scope student-facing queries to their department.
  assert.equal(
    sqlValidationService.validate('SELECT student_id FROM students', faculty).isValid, false,
    'Faculty must include a department filter'
  );
  assert.equal(
    sqlValidationService.validate("SELECT student_id FROM students WHERE department_id = '11111111-1111-1111-1111-111111111111'", faculty).isValid, true,
    'Faculty should query their own department'
  );

  // Principal has global read, but retains the category restrictions.
  const principal: User = { ...admin, role: 'Principal', departmentCode: 'CSE', departmentId: 'a principal must not be department scoped' };
  assert.deepEqual(sqlValidationService.getAuthorizationContext(principal), { role: 'PRINCIPAL', scope: 'GLOBAL' });
  assert.equal(
    sqlValidationService.validate("SELECT student_id FROM students WHERE department_code = 'CSE'", principal).isValid, true,
    'Principal may query any department'
  );
  assert.equal(
    sqlValidationService.validate('SELECT student_id FROM students', principal).isValid, true,
    'Principal global queries must not require a department filter'
  );
  assert.equal(
    sqlValidationService.validate('SELECT * FROM v_hostel_allocation', principal).isValid, false,
    'Principal must retain sensitive resource restrictions'
  );

  // Guardian contact details are restricted to the three trusted roles.
  for (const role of ['HOD', 'Faculty', 'Student', 'Accounts'] as const) {
    const user: User = { ...admin, role, departmentCode: AIML, departmentId: AIML_ID };
    assert.equal(
      sqlValidationService.validate('SELECT * FROM v_student_directory', user).isValid, false,
      `${role} must not read guardian contact details`
    );
  }
  assert.equal(
    sqlValidationService.validate('SELECT mother_name, mother_phone FROM v_student_directory', principal).isValid, true,
    'Principal may read guardian details'
  );

  // A student may only query their own record.
  const student: User = { ...admin, role: 'Student' };
  assert.equal(
    sqlValidationService.validate('SELECT * FROM v_marks_detail', student).isValid, false,
    'A student query without student_id scope must be blocked'
  );
  assert.equal(
    sqlValidationService.validate('SELECT * FROM v_marks_detail WHERE student_id = (SELECT student_id FROM students LIMIT 1)', student).isValid, true,
    'A student scoped to their own student_id is allowed'
  );

  // =========================================================================
  // 6. HOD department isolation, including the AST structural proof
  // =========================================================================
  const hod: User = { ...admin, role: 'HOD', departmentCode: AIML, departmentId: AIML_ID };
  assert.deepEqual(sqlValidationService.getAuthorizationContext(hod), { role: 'HOD', scope: 'ASSIGNED_DEPARTMENT', departmentId: AIML_ID });

  assert.equal(
    sqlValidationService.validate(`SELECT student_id FROM students WHERE department_id = '${AIML_ID}'`, hod).isValid, true,
    'HOD should query the assigned department'
  );
  assert.equal(
    sqlValidationService.validate("SELECT attendance_percentage FROM v_attendance_detail WHERE department_code = 'AIML'", hod).isValid, true,
    'HOD should query the assigned department attendance view'
  );
  assert.equal(
    sqlValidationService.validate("SELECT subject_name, total_marks_obtained FROM v_marks_detail WHERE department_code = 'AIML'", hod).isValid, true,
    'HOD should query the assigned department marks view'
  );
  assert.equal(
    sqlValidationService.validate("SELECT * FROM v_student_directory WHERE department_code = 'AIML'", hod).isValid, false,
    'HOD must retain the guardian-PII restriction'
  );
  assert.equal(
    sqlValidationService.validate("SELECT s.student_id FROM students s JOIN student_academic_summary a ON a.student_id = s.student_id WHERE s.department_id = '" + AIML_ID + "'", hod).isValid, true,
    'HOD may join child data to department-scoped students'
  );
  assert.equal(
    sqlValidationService.validate("SELECT s.student_id FROM students s JOIN departments d ON d.department_id = s.department_id WHERE d.department_code = 'AIML'", hod).isValid, true,
    'HOD may scope students through their joined department'
  );

  // Naming another department is refused before the AST is even considered.
  assert.equal(
    sqlValidationService.validate("SELECT student_id FROM students WHERE department_code = 'CSE'", hod).isValid, false,
    'HOD must not query another department'
  );
  for (const dept of ['CSE', 'ECE', 'MECH']) {
    assert.equal(
      sqlValidationService.validate(`SELECT * FROM v_student_directory WHERE department_code = '${dept}'`, hod).isValid, false,
      `HOD must not query ${dept}`
    );
  }

  // Structurally unsafe shapes must all be refused.
  const unsafeForHod: Array<[string, string]> = [
    ['OR TRUE widens scope', `SELECT student_id FROM students WHERE department_id = '${AIML_ID}' OR TRUE`],
    ['CTE', `WITH all_students AS (SELECT student_id FROM students) SELECT student_id FROM all_students WHERE department_id = '${AIML_ID}'`],
    ['UNION', `SELECT student_id FROM students WHERE department_id = '${AIML_ID}' UNION SELECT student_id FROM students`],
    ['nested SELECT IN', `SELECT student_id FROM students WHERE student_id IN (SELECT student_id FROM students WHERE department_id = '${AIML_ID}')`],
    ['EXISTS subquery', `SELECT student_id FROM students WHERE EXISTS (SELECT 1 FROM students x WHERE x.student_id = students.student_id) AND department_id = '${AIML_ID}'`],
    ['implicit cross join', `SELECT s.student_id FROM students s, subjects sub WHERE s.department_id = '${AIML_ID}'`],
    ['explicit CROSS JOIN', `SELECT s.student_id FROM students s CROSS JOIN subjects sub WHERE s.department_id = '${AIML_ID}'`],
    ['derived table', `SELECT t.student_id FROM (SELECT * FROM students WHERE department_id = '${AIML_ID}') t`],
    ['no department filter at all', 'SELECT student_id FROM students'],
    ['view with no department filter', 'SELECT * FROM v_attendance_detail'],
  ];
  for (const [label, sql] of unsafeForHod) {
    assert.equal(sqlValidationService.validate(sql, hod).isValid, false, `HOD scope must reject ${label}`);
  }

  // =========================================================================
  // 7. Limit enforcement
  // =========================================================================
  const noLimit = sqlValidationService.validate('SELECT register_number FROM v_student_directory', admin);
  assert.ok(noLimit.isValid && /LIMIT\s+500/i.test(noLimit.sanitizedSql || ''), 'A LIMIT must be appended when absent');
  const bigLimit = sqlValidationService.validate('SELECT register_number FROM v_student_directory LIMIT 5000', admin);
  assert.ok(bigLimit.isValid && /LIMIT\s+500/i.test(bigLimit.sanitizedSql || ''), 'An oversized LIMIT must be rewritten to 500');
  assert.equal(
    sqlValidationService.validate('SELECT register_number FROM v_student_directory LIMIT 0', admin).isValid, false,
    'LIMIT 0 must be rejected'
  );
  // An aggregate is left alone rather than truncated.
  const aggregate = sqlValidationService.validate('SELECT department_code, count(*) FROM v_student_directory GROUP BY department_code', admin);
  assert.ok(aggregate.isValid, 'An aggregate query must remain valid');

  // =========================================================================
  // 8. String-literal masking
  // =========================================================================
  // A blocked keyword inside a string literal must not trip the keyword scan,
  // and the table extractor must not be fooled into thinking fees is in play.
  const masked = sqlValidationService.validate(
    "SELECT * FROM v_student_directory WHERE full_name = 'DROP TABLE students' AND department_code = 'AIML'",
    admin
  );
  assert.equal(masked.isValid, true, 'A DROP TABLE inside a string literal must not block the query');
  // A CTE alias must not be mistaken for a real table.
  const cteAlias = sqlValidationService.validate('WITH students AS (SELECT 1 AS student_id) SELECT student_id FROM students', admin);
  assert.equal(cteAlias.isValid, true, 'A CTE named like a table must not be rejected as an unapproved table');

  // =========================================================================
  // 9. Password hashing
  // =========================================================================
  const passwordHash = await bcrypt.hash('local-test-password', 4);
  assert.equal(await bcrypt.compare('local-test-password', passwordHash), true, 'Bcrypt hash comparison should match');

  console.log('All Core Security and SQL Validation Tests Passed!');
  console.log(`  allowlist size: ${ALLOWED_TABLE_NAMES.length} tables and views`);
  console.log(`  control tables protected: ${PROTECTED_TABLES.size}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
