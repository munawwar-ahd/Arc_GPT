import assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { sqlValidationService } from '../src/server/sql-validation.service.js';
import { User } from '../src/types/index.js';

const admin: User = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', email: 'test@example.local', role: 'Admin' };

async function run(): Promise<void> {
  // 1. Valid Read-Only Query
  const count = sqlValidationService.validate('SELECT COUNT(*) AS total_students FROM students;', admin);
  assert.equal(count.isValid, true, 'SELECT COUNT(*) should be valid');

  // 2. Blocked DDL and DML operations
  for (const sql of [
    'DELETE FROM students',
    'DROP TABLE students',
    'TRUNCATE TABLE students',
    'INSERT INTO students (first_name) VALUES (\'Eve\')',
    'UPDATE students SET first_name = \'Eve\'',
    'ALTER TABLE students ADD COLUMN test TEXT',
    'GRANT ALL ON students TO PUBLIC',
    'SELECT student_id FROM students; DROP TABLE students;',
    'SELECT student_id FROM students -- comment',
    'SELECT student_id FROM pg_catalog.pg_authid',
    'SELECT password FROM students',
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT set_config('app.role', 'PRINCIPAL', true)",
    "SELECT current_setting('app.secret')",
  ]) {
    const res = sqlValidationService.validate(sql, admin);
    assert.equal(res.isValid, false, `Expected to block: ${sql}`);
  }

  // 3. RBAC checks
  const faculty: User = { ...admin, role: 'Faculty', departmentCode: 'AIML' };
  assert.equal(sqlValidationService.validate('SELECT fee_id FROM fees', faculty).isValid, false, 'Faculty should not access fees');

  const principal: User = { ...admin, role: 'Principal', departmentCode: 'CSE', departmentId: 'a department must not scope Principal' };
  assert.deepEqual(sqlValidationService.getAuthorizationContext(principal), { role: 'PRINCIPAL', scope: 'GLOBAL' });
  assert.equal(sqlValidationService.validate("SELECT student_id FROM students WHERE department_code = 'CSE'", principal).isValid, true, 'Principal should query any department');
  assert.equal(sqlValidationService.validate('SELECT student_id FROM students', principal).isValid, true, 'Principal global queries must not require a department filter');
  assert.equal(sqlValidationService.validate('SELECT hostel_id FROM hostels', principal).isValid, false, 'Principal must retain sensitive resource restrictions');

  const hod: User = { ...principal, role: 'HOD', departmentCode: 'AIML', departmentId: 'department-aiml' };
  assert.deepEqual(sqlValidationService.getAuthorizationContext(hod), { role: 'HOD', scope: 'ASSIGNED_DEPARTMENT', departmentId: 'department-aiml' });
  assert.equal(sqlValidationService.validate("SELECT student_id FROM students WHERE department_id = 'department-aiml'", hod).isValid, true, 'HOD should query the assigned department');
  assert.equal(sqlValidationService.validate("SELECT attendance_percentage FROM student_attendance_percentage WHERE department_code = 'AIML'", hod).isValid, true, 'HOD should query the assigned department attendance view');
  assert.equal(sqlValidationService.validate("SELECT student_id FROM student_profile_view WHERE department_code = 'AIML'", hod).isValid, false, 'HOD must retain the existing guardian-PII restriction');
  assert.equal(sqlValidationService.validate("SELECT s.student_id FROM students s JOIN student_academic_summary a ON a.student_id = s.student_id WHERE s.department_id = 'department-aiml'", hod).isValid, true, 'HOD may join child data to department-scoped students');
  assert.equal(sqlValidationService.validate("SELECT s.student_id FROM students s JOIN departments d ON d.department_id = s.department_id WHERE d.department_code = 'AIML'", hod).isValid, true, 'HOD may scope students through their joined department');
  assert.equal(sqlValidationService.validate("SELECT student_id FROM students WHERE department_code = 'CSE'", hod).isValid, false, 'HOD must not query another department');
  for (const sql of [
    "SELECT student_id FROM students WHERE department_id = 'department-aiml' OR TRUE",
    "WITH all_students AS (SELECT student_id FROM students) SELECT student_id FROM all_students WHERE department_id = 'department-aiml'",
    "SELECT student_id FROM students WHERE department_id = 'department-aiml' UNION SELECT student_id FROM students",
    "SELECT student_id FROM students WHERE student_id IN (SELECT student_id FROM students WHERE department_id = 'department-aiml')",
  ]) {
    assert.equal(sqlValidationService.validate(sql, hod).isValid, false, `HOD scope must reject structurally unsafe SQL: ${sql}`);
  }

  // 4. Password hashing verification
  const passwordHash = await bcrypt.hash('local-test-password', 4);
  assert.equal(await bcrypt.compare('local-test-password', passwordHash), true, 'Bcrypt hash comparison should match');

  console.log('All Core Security and SQL Validation Tests Passed!');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
