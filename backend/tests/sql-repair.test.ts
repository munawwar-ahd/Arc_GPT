import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { buildRepairPrompt, verifyRepairScope } from '../src/server/sql-prompt.service.js';
import { sqlValidationService } from '../src/server/sql-validation.service.js';
import { schemaService } from '../src/server/schema.service.js';
import { User } from '../src/types/index.js';

/**
 * Tests for the single repair attempt.
 *
 * A repair prompt is the most attractive place in this pipeline to smuggle
 * something past the guardrails: it is the one moment the model is explicitly
 * invited to rewrite a statement it has already been told was wrong. So the
 * properties that matter are:
 *
 *   1. the corrected statement goes back through the same validator, and
 *   2. the repair cannot widen a read, drop a filter, or leave the allowlist.
 *
 * The prompt itself is also checked to hand over the real column names, since a
 * repair that cannot see them is just a second guess.
 */

const admin: User = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Admin',
  email: 'test@example.local',
  role: 'Admin',
};

async function run(): Promise<void> {
  // =========================================================================
  // 1. The repair prompt carries the real column names
  // =========================================================================
  const prompt = buildRepairPrompt({
    question: 'Show AIML students below 75 percent attendance with their CGPA.',
    failedSql:
      "SELECT s.register_number, s.overall_attendance_percentage FROM v_student_attendance_summary s WHERE s.department_code = 'AIML'",
    error: 'column s.overall_attendance_percentage does not exist',
    tables: ['v_student_attendance_summary'],
  });

  assert.ok(prompt.includes('v_student_attendance_summary'), prompt);
  // The names that actually exist must be visible, or the model guesses again.
  // Checked on the column-list block only: the rejected SQL and the PostgreSQL
  // error are *meant* to repeat the bad name, so that the model knows what to
  // correct.
  const columnList = prompt.slice(prompt.indexOf('Copy the names from here exactly:'));
  assert.ok(columnList.includes('attendance_percentage'), `real column names must be listed:\n${columnList}`);
  assert.ok(!columnList.includes('overall_attendance_percentage'), `fake name must not be offered:\n${columnList}`);
  assert.ok(prompt.includes('column s.overall_attendance_percentage does not exist'), prompt);
  assert.ok(/Return JSON with intent, tables, and sql\./.test(prompt), prompt);
  // And it is explicit that the query's meaning must not change.
  assert.ok(/do not drop a filter/i.test(prompt), prompt);

  // A table that is not in the declared schema contributes nothing rather than
  // throwing, since the failing SQL may have named something that does not exist.
  const withUnknown = buildRepairPrompt({
    question: 'q',
    failedSql: 'SELECT 1 FROM nope',
    error: 'relation "nope" does not exist',
    tables: ['nope', 'students'],
  });
  assert.ok(!withUnknown.includes('- nope:'), withUnknown);
  assert.ok(withUnknown.includes('- students:'), withUnknown);

  // =========================================================================
  // 2. The validator is what stands between a repair and the database
  // =========================================================================
  // Everything a repair might plausibly produce, checked against the same
  // validator the first attempt used. Note that a dropped department filter is
  // *allowed* for an administrator, by design — global read scope. Scope
  // preservation is a separate concern and is tested in section 3.
  const hostileRepairs: Array<[string, string, boolean]> = [
    ['widen to every student', 'SELECT full_name FROM students', true],
    ['drop the department filter', "SELECT register_number, attendance_percentage FROM v_attendance_detail WHERE attendance_percentage < 75", true],
    ['read a control table', 'SELECT email, password_hash FROM arcgpt_users', false],
    ['read the audit trail', 'SELECT action, query_hash FROM audit_logs', false],
    ['system catalog', 'SELECT relname FROM pg_catalog.pg_class', false],
    ['write', 'DELETE FROM students', false],
    ['drop', 'DROP TABLE students', false],
    ['stacked statement', 'SELECT 1; DROP TABLE students', false],
    ['comment smuggling', 'SELECT 1 -- fixed', false],
    ['unknown table', 'SELECT * FROM hr_salaries', false],
    ['sleep', 'SELECT pg_sleep(10)', false],
  ];
  for (const [label, sql, expectedAllowed] of hostileRepairs) {
    const result = sqlValidationService.validate(sql, admin);
    assert.equal(result.isValid, expectedAllowed, `repair "${label}": ${result.blockedReason || 'allowed'}`);
  }

  // The legitimate repair — the same query with the column name corrected — is
  // accepted, and gets the LIMIT the validator always applies.
  const corrected = sqlValidationService.validate(
    "SELECT s.register_number, s.student_name, s.attendance_percentage FROM v_student_attendance_summary s WHERE s.department_code = 'AIML' AND s.attendance_percentage < 75",
    admin
  );
  assert.equal(corrected.isValid, true, corrected.blockedReason);
  assert.ok(/LIMIT 500/i.test(corrected.sanitizedSql || ''), corrected.sanitizedSql);

  // =========================================================================
  // 3. A repair may fix a name and nothing else
  // =========================================================================
  const original = "SELECT s.register_number, s.overall_attendance_percentage FROM v_student_attendance_summary s WHERE s.department_code = 'AIML' AND s.attendance_percentage < 75";

  // The intended repair: the same query with the column renamed.
  const nameFixed = "SELECT s.register_number, s.attendance_percentage FROM v_student_attendance_summary s WHERE s.department_code = 'AIML' AND s.attendance_percentage < 75";
  assert.equal(verifyRepairScope(original, nameFixed).preserved, true);

  // Silently widening the read: the department filter is gone. Still a *safe*
  // statement for an administrator, and no longer an answer to the question.
  const departmentDropped = "SELECT s.register_number, s.attendance_percentage FROM v_student_attendance_summary s WHERE s.attendance_percentage < 75";
  const droppedDept = verifyRepairScope(original, departmentDropped);
  assert.equal(droppedDept.preserved, false);
  assert.ok(droppedDept.dropped.includes("'aiml'"), droppedDept.dropped.join(','));

  // Loosening a threshold.
  assert.equal(
    verifyRepairScope(original, nameFixed.replace('< 75', '< 100')).preserved,
    false,
    'a repair must not loosen the threshold it was given'
  );

  // Turning one student into all of them.
  const registerDropped = verifyRepairScope(
    "SELECT register_number FROM v_student_directory WHERE register_number = 'AIML32022A07'",
    'SELECT register_number FROM v_student_directory'
  );
  assert.equal(registerDropped.preserved, false);
  assert.ok(registerDropped.dropped.includes("'aiml32022a07'"));

  // Adding a literal is fine: that is what a corrected predicate looks like.
  assert.equal(
    verifyRepairScope(
      'SELECT register_number FROM v_student_directory',
      "SELECT register_number FROM v_student_directory WHERE register_number = 'AIML32022A07'"
    ).preserved,
    true
  );

  // A dropped value that only appears inside a comment is not a dropped filter.
  assert.equal(
    verifyRepairScope(
      "SELECT register_number FROM v_student_directory WHERE register_number = 'AIML32022A07'",
      "-- register_number = 'AIML32022A07' was here\nSELECT register_number FROM v_student_directory WHERE register_number = 'AIML32022A07'"
    ).preserved,
    true
  );

  // =========================================================================
  // 3. The pipeline really does re-validate a repair
  // =========================================================================
  // Asserted at the source level: the repair branch must not reach
  // executeSql without a validate() call in between.
  const pipelineSource = fs.readFileSync(
    path.resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'server', 'sql-generation.service.ts'),
    'utf8'
  );
  assert.ok(
    pipelineSource.includes('sqlValidationService.validate(repaired.sql, user)'),
    'a repaired statement must be re-validated by the same validator'
  );
  assert.equal(
    (pipelineSource.match(/sqlValidationService\.validate\(/g) ?? []).length,
    2,
    'exactly two validate calls: the original and the repair'
  );
  assert.ok(
    !/executeSql\(repaired\.sql\)/.test(pipelineSource),
    'a repair must never be executed without passing validation first'
  );

  // The repair prompt may only be spent on the two "wrong name" error classes,
  // never on a permission denial or a timeout.
  assert.ok(/isNameError = code === '42703' \|\| code === '42P01'/.test(pipelineSource), pipelineSource);
  // And it is capped.
  assert.ok(/const EXECUTION_ATTEMPTS = 2/.test(pipelineSource), 'repair must be bounded');
  assert.ok(/attempt >= EXECUTION_ATTEMPTS/.test(pipelineSource), 'the cap must actually be enforced');

  // =========================================================================
  // 4. The declared schema the prompt reads from is the one the DB reports
  // =========================================================================
  const view = schemaService.getTableSchema('v_student_attendance_summary');
  assert.ok(view, 'v_student_attendance_summary must be declared');
  assert.ok(
    view.columns.some(column => column.name === 'attendance_percentage'),
    'the declared column must match the real view, or the repair repeats the same mistake'
  );
  assert.ok(
    !view.columns.some(column => column.name === 'overall_attendance_percentage'),
    'overall_attendance_percentage belongs to student_academic_summary, not this view'
  );

  console.log('SQL-repair tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});