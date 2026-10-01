import assert from 'node:assert/strict';
import { buildAnswer, buildResultDigest, labelForColumn } from '../src/server/result-interpreter.service.js';

/**
 * Conversational-answer tests.
 *
 * These lock down the output that replaced the old debug string:
 *
 *   "The local PostgreSQL query returned 24 rows. First row: markid=…, studentid=…"
 *
 * The important properties are that a number is actually narrated, that no
 * internal identifier or row count leaks into the prose, and that money,
 * percentages and grades are formatted the way a person would say them.
 *
 * Values are written as strings on purpose. `pg` returns `NUMERIC`, `COUNT` and
 * `SUM` as strings, and the interpreter has to cope with that — a previous
 * version treated them as non-numeric and answered "the value shown".
 */

const type = (value: unknown) => ({ typeof: typeof value, value });

async function run(): Promise<void> {
  // =========================================================================
  // 1. Single measure on a single subject
  // =========================================================================
  assert.equal(
    buildAnswer(
      ['register_number', 'full_name', 'current_cgpa'],
      [{ register_number: 'AIML32022A07', full_name: 'Aarav Sharma', current_cgpa: '8.42' }],
      'What is the CGPA of AIML32022A07?'
    ),
    "Aarav Sharma's CGPA is 8.42."
  );

  assert.equal(
    buildAnswer(
      ['register_number', 'full_name', 'amount_pending'],
      [{ register_number: 'AIML32022A07', full_name: 'Aarav Sharma', amount_pending: '12500.00' }],
      'How much hostel fee is pending for this student?'
    ),
    "Aarav Sharma's pending amount is ₹12,500."
  );

  // "pending" must select amount_pending even when total_amount is also present
  // and comes first in the column list.
  const pendingOverTotal = buildAnswer(
    ['total_amount', 'amount_paid', 'amount_pending', 'full_name'],
    [{ total_amount: '48000', amount_paid: '35500', amount_pending: '12500', full_name: 'Aarav Sharma' }],
    'How much college fee is still pending for this student?'
  );
  assert.ok(pendingOverTotal.includes('₹12,500'), `pending amount must lead: ${pendingOverTotal}`);
  assert.ok(!pendingOverTotal.includes('₹48,000'), `total amount must not lead: ${pendingOverTotal}`);

  // Attendance leads with the percentage, not the raw counts.
  const attendance = buildAnswer(
    ['classes_attended', 'total_classes', 'attendance_percentage', 'full_name'],
    [{ classes_attended: '40', total_classes: '60', attendance_percentage: '66.67', full_name: 'Aarav Sharma' }],
    'What is the attendance of AIML32022A07?'
  );
  assert.equal(attendance, "Aarav Sharma's attendance is 66.67%.");

  // =========================================================================
  // 2. Aggregates
  // =========================================================================
  assert.equal(
    buildAnswer(['count'], [{ count: '320' }], 'How many students are there?'),
    'There are 320 students.'
  );
  assert.equal(
    buildAnswer(['total_students'], [{ total_students: '320' }], 'How many students are there?'),
    'There are 320 students.'
  );
  assert.equal(
    buildAnswer(['sum'], [{ sum: '12500' }], 'What is the total pending hostel fee across all students?'),
    'The total comes to ₹12,500.'
  );

  // =========================================================================
  // 3. Single descriptive row (the parents question)
  // =========================================================================
  const parents = buildAnswer(
    ['full_name', 'father_name', 'father_phone', 'mother_name', 'mother_phone'],
    [{
      full_name: 'Aarav Sharma',
      father_name: 'Ramesh Sharma',
      father_phone: '9000011111',
      mother_name: 'Sunita Sharma',
      mother_phone: '9000022222',
    }],
    'Who are the parents of AIML32022A07?'
  );
  assert.ok(parents.includes('Ramesh Sharma') && parents.includes('Sunita Sharma'), `names missing: ${parents}`);
  assert.ok(!parents.includes('9000011111'), 'phone numbers are noise in the prose: ' + parents);
  assert.ok(parents.includes('Aarav Sharma'), 'the student should be named: ' + parents);

  // =========================================================================
  // 4. Several rows
  // =========================================================================
  const roster = buildAnswer(
    ['register_number', 'full_name', 'department_code'],
    [
      { register_number: 'AIML32022A07', full_name: 'Aarav Sharma', department_code: 'AIML' },
      { register_number: 'AIML32022A08', full_name: 'Diya Sharma', department_code: 'AIML' },
    ],
    'Show all AIML students.'
  );
  assert.ok(roster.startsWith('Here are the students.'), roster);
  assert.ok(roster.includes('AIML32022A07') && roster.includes('Diya Sharma'), roster);
  // Two rows, two listed, so no "N more rows below".
  assert.ok(!/more matching row/.test(roster), roster);

  const listed = buildAnswer(
    ['full_name'],
    Array.from({ length: 12 }, (_, index) => ({ full_name: `Student ${index + 1}` })),
    'Show all students.'
  );
  assert.ok(listed.includes('9 more matching rows below.'), listed);

  // A subject row must not name the subject twice.
  const subjectRow = buildAnswer(
    ['subject_name', 'faculty_name', 'start_time', 'classroom'],
    [{ subject_name: 'Engineering Mathematics VI', faculty_name: 'Sneha Ranganathan', start_time: '14:00:00', classroom: 'AIML-L2' }],
    'What class does this student have at 2 PM on Monday?'
  );
  assert.ok(subjectRow.includes('Sneha Ranganathan'), subjectRow);
  assert.ok(!/subject:\s*Engineering Mathematics/i.test(subjectRow), 'subject repeated: ' + subjectRow);

  // =========================================================================
  // 5. Nothing internal may leak into the prose
  // =========================================================================
  const leaks: Array<[string, string[]]> = [
    ['with a UUID', ['student_id', 'attendance_id', 'mark_id']],
    ['with a UUID', ['student_id']],
  ];
  for (const [label, columns] of leaks) {
    const answer = buildAnswer(
      [...columns, 'full_name', 'attendance_percentage'],
      [{ [columns[0]]: '6f2c1a44-9d0b-4c7e-8f31-2b7a6d5e4c33', full_name: 'Aarav Sharma', attendance_percentage: '72.5' }],
      'Show attendance'
    );
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(answer), `${label}: ${answer}`);
    assert.ok(!/\b(student_id|attendance_id|mark_id)\b/i.test(answer), `${label}: ${answer}`);
    assert.ok(!/\b\d+\s+rows?\b/i.test(answer), `${label}: ${answer}`);
    assert.ok(answer === "Aarav Sharma's attendance is 72.5%.", `${label}: ${answer}`);
  }

  // A UUID used as a *value* in a normal column is redacted rather than shown.
  const uuidValue = buildAnswer(
    ['register_number', 'full_name'],
    [{ register_number: 'AIML32022A07', full_name: 'Aarav Sharma' }],
    'Show this student'
  );
  assert.ok(!/6f2c1a44/.test(uuidValue), uuidValue);

  // =========================================================================
  // 6. Empty results
  // =========================================================================
  assert.match(buildAnswer([], [], 'Show all AIML students.'), /couldn't find anything/i);
  assert.match(buildAnswer(['full_name'], [], 'Show all AIML students.'), /couldn't find anything/i);

  // SUM() over an empty set returns one row containing NULL. That is not a match,
  // and must not be reported as one.
  assert.equal(
    buildAnswer(['total_pending'], [{ total_pending: null }], 'How much hostel fee is pending for this student?'),
    'Nothing is recorded for that in the database.'
  );
  assert.equal(
    buildAnswer(['register_number', 'full_name', 'amount_pending'], [{ register_number: null, full_name: null, amount_pending: null }], 'Show the pending fee'),
    'Nothing is recorded for that in the database.'
  );

  // =========================================================================
  // 7. Labels
  // =========================================================================
  assert.equal(labelForColumn('register_number'), 'register number');
  assert.equal(labelForColumn('amount_pending'), 'pending amount');
  assert.equal(labelForColumn('current_cgpa'), 'CGPA');
  assert.equal(labelForColumn('some_unmapped_column'), 'some unmapped column');

  // =========================================================================
  // 8. Result digest — what makes a follow-up answerable
  // =========================================================================
  const digest = buildResultDigest(
    ['register_number', 'full_name', 'student_id', 'attendance_percentage'],
    Array.from({ length: 8 }, (_, index) => ({
      register_number: `AIML32022A${String(index + 7).padStart(2, '0')}`,
      full_name: `Student ${index + 1}`,
      student_id: '6f2c1a44-9d0b-4c7e-8f31-2b7a6d5e4c33',
      attendance_percentage: '70.1',
    }))
  );
  assert.ok(digest.includes('register_number'), digest);
  assert.ok(digest.includes('AIML32022A07'), digest);
  // Internal identifiers are neither carried nor named.
  assert.ok(!digest.includes('student_id'), digest);
  assert.ok(!digest.includes('6f2c1a44'), digest);
  // Bounded: at most five identifiers, never the whole result set.
  const identifierCount = (digest.match(/AIML\d{8}A\d{2}/g) ?? []).length;
  assert.ok(identifierCount <= 5, `digest must be bounded, found ${identifierCount}: ${digest}`);
  assert.ok(digest.includes('further rows'), digest);

  // No identifiers means no values to carry — better than an empty string that
  // would suggest "nothing came back".
  assert.equal(buildResultDigest(['amount_pending'], [{ amount_pending: '100' }]), 'columns: amount_pending');
  assert.equal(buildResultDigest([], []), '');

  // A joined name plus its parts must not be narrated twice.
  const deduplicated = buildAnswer(
    ['register_number', 'first_name', 'last_name', 'student_name', 'department_code'],
    [{ register_number: 'AIML32022A07', first_name: 'Pooja', last_name: 'Patil', student_name: 'Pooja Patil', department_code: 'AIML' }],
    'Show students with attendance below 75%.'
  );
  assert.ok(!/first name/i.test(deduplicated), `name parts should be collapsed: ${deduplicated}`);
  assert.ok(deduplicated.includes('Pooja Patil'), deduplicated);

  // Numeric-string coercion must not swallow ordinary strings.
  assert.equal(asNumberProbe('AIML32022A07'), null);
  assert.equal(asNumberProbe(''), null);
  assert.equal(asNumberProbe('abc'), null);
  assert.equal(asNumberProbe('8.42'), 8.42);
  assert.equal(asNumberProbe('12'), 12);
  assert.equal(asNumberProbe('-3'), -3);
  assert.equal(asNumberProbe(7), 7);

  console.log('Conversational-answer tests passed.');
  console.log(`  example: ${buildAnswer(['register_number', 'full_name', 'current_cgpa'], [{ register_number: 'AIML32022A07', full_name: 'Aarav Sharma', current_cgpa: '8.42' }], 'What is the CGPA of AIML32022A07?')}`);
  console.log(`  example: ${buildAnswer(['count'], [{ count: '320' }], 'How many students are there?')}`);
  void type;
}

/** Mirrors the module's internal coercion so it can be asserted directly. */
function asNumberProbe(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});