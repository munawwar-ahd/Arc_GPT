import assert from 'node:assert/strict';
import { inventsANumber, renderRowsForNarration } from '../src/server/agent.service.js';

/**
 * The narrator guard.
 *
 * This test exists because the guard exists because of a real defect: the
 * narrator was observed rewriting a correct `80` as `150` and a correct `1.64`
 * as `3.5`. A database assistant that states a wrong figure confidently is
 * worse than one that says nothing, so the check is mechanical and it is
 * tested directly rather than only through the pipeline.
 */

const ROWS_COUNT = 'columns: aiml_student_count; aiml_student_count: 80';
const ROWS_CGPA = 'columns: current_cgpa; current_cgpa: 1.64';

function accepts(label: string, narrative: string, ...sources: string[]) {
  assert.equal(inventsANumber(narrative, ...sources), false, `should have been accepted: ${label}`);
}

function rejects(label: string, narrative: string, ...sources: string[]) {
  assert.equal(inventsANumber(narrative, ...sources), true, `should have been rejected: ${label}`);
}

/** The question is a legitimate origin: a register number carries digits. */
const Q_CGPA = 'what is the CGPA of AIML32022A07?';

// --- the two real failures ---------------------------------------------------
rejects('count inflated to 150', 'There are 150 AIML students.', ROWS_COUNT);
rejects('CGPA inflated to 3.5', 'The CGPA of AIML32022A07 is 3.5.', ROWS_CGPA);

// --- figures that are genuinely in the data ---------------------------------
accepts('count restated', 'There are 80 AIML students.', ROWS_COUNT);
accepts('cgpa restated', 'The CGPA of AIML32022A07 is 1.64.', ROWS_CGPA, Q_CGPA);
accepts('thousands separator', 'The pending fee is ₹1,32,500.', 'columns: pending; pending: 132500');
accepts('comma in data', 'The pending fee is ₹1,32,500.', 'columns: pending; pending: 1,32,500');
accepts('rounding to 2dp', 'A CGPA of 1.6.', ROWS_CGPA);
accepts('percentage suffix', 'Attendance is 56.4%.', 'columns: attendance; attendance: 56.39');
accepts('several figures', 'Aarav scored 42 out of 50 with a CGPA of 8.2.', 'columns: marks, max, cgpa; marks: 42; max: 50; cgpa: 8.2');

// --- small numbers describe presentation, not data --------------------------
accepts('ordinal wording', 'Here are the 5 students you asked for.', ROWS_COUNT);
accepts('year in prose', 'There are 80 students across 8 semesters.', 'columns: n; n: 80');

// --- no numbers at all ------------------------------------------------------
accepts('no figures', 'AIML stands for Artificial Intelligence and Machine Learning.', ROWS_COUNT);

// --- degenerate input -------------------------------------------------------
// A result set with no numbers in it cannot support a figure in the prose. This
// is the case that let "There are 120 AIML students" through when the narrator
// was handed a follow-up digest containing no values at all.
assert.equal(inventsANumber('There are students below the threshold.', 'columns: full_name'), false);
rejects('figure invented from value-less data', 'There are 120 students.', 'columns: full_name');

// --- the narrator must be shown the real values -----------------------------
// A count column has no identifying value, so buildResultDigest drops it. The
// narrator's own renderer must not.
const rendered = renderRowsForNarration(['aiml_student_count'], [{ aiml_student_count: '80' }]);
assert.ok(rendered.includes('80'), `narration input must carry the value, got: ${rendered}`);
rejects('inflated count with real data shown', 'There are 120 AIML students.', rendered);
accepts('true count with real data shown', 'There are 80 AIML students.', rendered);

const multi = renderRowsForNarration(
  ['register_number', 'full_name', 'attendance_percentage'],
  [
    { register_number: 'AIML42021A01', full_name: 'Aarav Sharma', attendance_percentage: '62.52' },
    { register_number: 'AIML42021A03', full_name: 'Vihaan Iyer', attendance_percentage: '59.19' },
  ]
);
accepts('real percentages', 'Aarav Sharma is at 62.52% attendance.', multi);
accepts('rounded percentage', 'Aarav Sharma is at 63% attendance.', multi);
rejects('invented third student', 'Vihaan Iyer is at 41.0% attendance.', multi);

// --- other fabrications -----------------------------------------------------
rejects('different count entirely', 'There are 42 AIML students.', ROWS_COUNT);
rejects('invented cgpa', 'The CGPA is 9.1.', ROWS_CGPA);
rejects('extra figure appended', 'There are 80 AIML students and 12 pending fees.', ROWS_COUNT);

console.log('Narrator accuracy guard tests passed.');
console.log('  rejected: inflated counts, inflated CGPAs, invented fees');
console.log('  accepted: restated figures, separators, rounding, percentages, ordinals');
