/**
 * Deterministic result interpretation.
 *
 * This is what replaced a string like:
 *
 *   "The local PostgreSQL query returned 24 rows. First row: studentid=…, markid=…"
 *
 * The previous answer leaked internal keys, UUIDs and a row count dressed up as
 * a sentence. Two things caused it: raw column names straight off the result
 * set, and no attempt to recognise what the numbers meant.
 *
 * The interpretation is done here, in code, rather than by asking the model
 * again. Three reasons:
 *
 *   1. A second LLM call doubles latency for something that is arithmetic.
 *   2. A model narrating rows invents them. A deterministic phrasing of a real
 *      row set cannot.
 *   3. It costs no tokens and cannot be persuaded to leak a UUID.
 *
 * The result is short prose the existing markdown renderer already displays,
 * above the table the UI renders separately. Column names are still the real
 * ones — that is what makes the table readable — but the prose itself never
 * mentions an identifier or a row count.
 */

/** Friendly names for the columns ArcGPT's read models actually produce. */
const COLUMN_LABELS: Record<string, string> = {
  register_number: 'register number',
  register_no: 'register number',
  full_name: 'name',
  student_name: 'student',
  subject_name: 'subject',
  subject_code: 'subject code',
  semester_number: 'semester',
  semester_name: 'semester',
  academic_year: 'academic year',
  department_code: 'department',
  department_name: 'department',
  section_code: 'section',
  year_of_study: 'year of study',
  current_cgpa: 'CGPA',
  cgpa_cumulative: 'CGPA',
  semester_gpa: 'GPA',
  grade_point: 'grade point',
  letter_grade: 'grade',
  total_marks_obtained: 'marks',
  marks_percentage: 'marks',
  total_max_marks: 'out of',
  iat1_marks: 'IAT 1',
  iat2_marks: 'IAT 2',
  iat3_marks: 'IAT 3',
  attendance_percentage: 'attendance',
  classes_attended: 'classes attended',
  total_classes: 'classes held',
  amount_pending: 'pending amount',
  amount_paid: 'amount paid',
  total_amount: 'total amount',
  fee_type_code: 'fee type',
  payment_status: 'payment status',
  backlog_status: 'status',
  backlog_semester: 'semester of failure',
  attendance_id: 'attendance record',
  mark_id: 'mark record',
  backlog_id: 'backlog record',
  timetable_id: 'class slot',
  payment_id: 'payment',
  allocation_id: 'allocation',
  room_number: 'room',
  student_fee_id: 'fee bill',
  day_name: 'day',
  period_label: 'period',
  start_time: 'start time',
  end_time: 'end time',
  classroom: 'room',
  faculty_name: 'faculty',
  first_name: 'first name',
  last_name: 'surname',
  gender: 'gender',
  residence_status: 'residency',
  student_status: 'student status',
  mother_name: 'mother',
  father_name: 'father',
  guardian_name: 'guardian',
  phone: 'phone',
  email: 'email',
  hostel_name: 'hostel',
  total: 'total',
  sum: 'total',
  count: 'count',
  n: 'count',
};

/**
 * True only for values that are genuinely percentages.
 *
 * GPA and CGPA are deliberately excluded. They are averages on a ten-point
 * scale, not percentages, and "Aarav Sharma's CGPA is 8.42%" is wrong in a way
 * that reads like a rounding error and is actually a different quantity.
 */
const PERCENT_COLUMNS = [
  'attendance_percentage',
  'absence_percentage',
  'marks_percentage',
  'percentage',
  'percent',
];

function isPercentColumn(column: string): boolean {
  const lower = column.toLowerCase();
  if (lower === 'percentage' || lower === 'percent') return true;
  if (PERCENT_COLUMNS.includes(lower)) return true;
  return lower.endsWith('_percentage') || lower.endsWith('_percent');
}

/** Marks, grades and GPA are stated plainly: 42, A, 8.42. */
function isPlainNumberColumn(column: string): boolean {
  const lower = column.toLowerCase();
  return /(^|_)(cgpa|gpa|grade_point|marks|score|percentage)$/.test(lower)
    || /marks(_| )?(obtained|max)?$/.test(lower);
}

function isUuid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Coerces a database number to a JS number.
 *
 * Necessary because `pg` does not return `NUMERIC`, `COUNT` or `SUM` as
 * numbers — they arrive as strings, to preserve precision. Treating them as
 * non-numeric is how "How many students are there?" ends up answered with
 * "the value shown": there is no number to format, so the sentence has nothing
 * to say. Everything numeric in this file goes through here first.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isMoneyColumn(column: string): boolean {
  return /^(amount_|total_amount|fee|discount$|paid$|pending$)/.test(column) || /amount/.test(column);
}

function isCountColumn(column: string): boolean {
  const lower = column.toLowerCase();
  return (
    /(^|_)(count|total_classes|classes_attended|classes_absent|students)$/.test(lower) ||
    ['count', 'n', 'num', 'total', 'total_classes', 'classes_attended', 'classes_absent', 'result_count', 'student_count'].includes(lower)
  );
}

/** `AIML32022A07` / `Database Management Systems` are safe to speak aloud. */
/**
 * Columns that identify a *row*, as opposed to describing it.
 *
 * Only these are kept out of the prose. `register_number` is an identifier too,
 * but it is the college's own human-readable handle for a student — the one a
 * member of staff would read out — so it is narrated and a UUID is not.
 */
const INTERNAL_ID_COLUMNS = /(_id$|^id$|_uuid$|^uuid$|^guid$)/i;

function isIdentifierColumn(column: string): boolean {
  return INTERNAL_ID_COLUMNS.test(column);
}

export function labelForColumn(column: string): string {
  const known = COLUMN_LABELS[column.toLowerCase()];
  if (known) return known;
  return column
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(value);
}

/**
 * Formatting hints taken from the question rather than the column.
 *
 * A column called `sum` or `total` carries no unit. When the question is
 * unmistakably about money, a bare aggregate in that result set is money — and
 * rendering it without the rupee sign makes a correct answer look like a
 * different one.
 */
export interface FormatHints {
  money?: boolean;
}

function questionImpliesMoney(question: string): boolean {
  return /\b(fee|fees|hostel|amount|amounts|paid|pending|due|rupee|₹|salary|price|cost|bill)\b/i.test(question);
}

function formatValue(column: string, value: unknown, hints: FormatHints = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  const numeric = asNumber(value);
  if (numeric !== null) {
    if (hints.money || isMoneyColumn(column)) return `₹${formatNumber(numeric, 0)}`;
    if (isPercentColumn(column)) return `${formatNumber(numeric, 2)}%`;
    if (Number.isInteger(numeric)) return formatNumber(numeric, 0);
    return formatNumber(numeric, 2);
  }

  if (typeof value === 'string') {
    if (isUuid(value)) return '—';
    // Timestamps read better truncated to the minute, and a bare ISO string
    // with a Z suffix is noise in a chat bubble.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16).replace('T', ' ');
    return value;
  }

  return String(value);
}

function firstRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  return rows[0] ?? {};
}

/**
 * Finds the single numeric column that best answers a "how much / how many"
 * question, so the sentence leads with it instead of with an identifier.
 *
 * The preference order follows the question's own wording. "How much hostel fee
 * is pending" must lead with `amount_pending` rather than `total_amount`, and
 * "attendance below 75%" with the percentage rather than the raw counts — both
 * are cases where the highest column is not the one asked for.
 */
function primaryMetric(
  columns: string[],
  rows: Record<string, unknown>[],
  question: string
): { column: string; value: number; isPercent: boolean; isMoney: boolean; isCount: boolean } | null {
  const row = firstRow(rows);
  const candidates = columns.filter(column => {
    if (asNumber(row[column]) === null) return false;
    if (isIdentifierColumn(column)) return false;
    if (column.toLowerCase().endsWith('_id')) return false;
    // A ten-digit phone number parses as a number, which would otherwise make
    // "who are the parents of X" answer with a phone number.
    if (isContactColumn(column)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const q = question.toLowerCase();
  const wantsPending = /\bpending|unpaid|outstanding|due\b/.test(q);
  const wantsPaid = /\bpaid|settled|collected\b/.test(q);
  const wantsAttendance = /\battendance|absent|present\b/.test(q);
  const wantsMoney = /\b(fee|fees|hostel|amount|paid|pending|due|rupee|₹)\b/.test(q);
  const wantsCount = /\bhow many|number of|count of\b/.test(q);

  const preferred =
    (wantsPending && candidates.find(column => /pending|outstanding|due/i.test(column))) ||
    (wantsPaid && candidates.find(column => /paid|collected/i.test(column))) ||
    (wantsAttendance && candidates.find(column => isPercentColumn(column))) ||
    (wantsMoney && candidates.find(column => isMoneyColumn(column))) ||
    (wantsCount && candidates.find(column => isCountColumn(column))) ||
    candidates.find(column => isCountColumn(column)) ||
    candidates.find(column => isPercentColumn(column)) ||
    candidates.find(column => isMoneyColumn(column)) ||
    candidates[0];

  const value = asNumber(row[preferred]);
  if (value === null) return null;

  return {
    column: preferred,
    value,
    isPercent: isPercentColumn(preferred),
    isMoney: isMoneyColumn(preferred),
    isCount: isCountColumn(preferred),
  };
}

/**
 * Picks the columns worth putting in prose: identifying columns first, then a
 * couple of measures.
 *
 * Contact details are excluded. A phone number in a sentence is unreadable —
 * `Intl` groups a ten-digit number into `9,00,00,11,111` — and the table
 * directly below still shows every column, so nothing is lost by keeping the
 * prose to what a person would actually say out loud.
 */
function narratableColumns(
  columns: string[],
  rows: Record<string, unknown>[],
  limit: number,
  skip: string[] = []
): string[] {
  const row = firstRow(rows);
  const skipped = new Set(skip.map(column => column.toLowerCase()));
  // When a joined name is already present, the separate first/last columns are
  // the same information twice. "student: Pooja Patil · first name: Pooja ·
  // surname: Patil" is noise, not detail.
  const hasJoinedName = columns.some(column => /^(full_name|student_name|subject_name|faculty_name)$/.test(column));
  const parts = hasJoinedName ? ['first_name', 'last_name'] : [];

  const usable = columns.filter(column => {
    if (skipped.has(column.toLowerCase()) || parts.includes(column.toLowerCase())) return false;
    const value = row[column];
    return value !== null && value !== undefined && value !== '' && !isIdentifierColumn(column);
  });
  const ordered = [
    ...columns.filter(column => NARRATION_PRIORITY.test(column) && usable.includes(column)),
    ...usable.filter(column => !NARRATION_PRIORITY.test(column)),
  ];
  return Array.from(new Set(ordered)).slice(0, limit);
}

function summariseRow(columns: string[], row: Record<string, unknown>, limit = 4, hints: FormatHints = {}): string {
  return informativePairs(columns, row, limit, hints).join(' · ');
}

/** Register numbers are spoken and printed; UUIDs are not. */
function isHumanIdentifier(column: string): boolean {
  return /^(register|admission)_number$/.test(column);
}

/**
 * The order in which columns appear in a narrated row.
 *
 * A person's name first, then whatever else is populated. A register number is
 * deliberately ranked alongside the name rather than after the measures: it is
 * the handle the college itself uses, and an answer that names a student
 * without it is much less useful to the person asking.
 */
const NARRATION_PRIORITY = /^(register_number|admission_number|full_name|student_name|subject_name|faculty_name|hostel_name|day_name|period_label|start_time)$/;

/** The sentence shown above the result table. */
export function buildAnswer(
  columns: string[],
  rows: Record<string, unknown>[],
  question: string,
  intent?: string
): string {
  if (!columns.length || rows.length === 0) {
    return "I couldn't find anything in the database that matches that.";
  }

  const subject = subjectPhrase(question, intent);
  const single = rows.length === 1;
  const metric = primaryMetric(columns, rows, question);
  const row = firstRow(rows);
  const hints: FormatHints = { money: questionImpliesMoney(question) };

  // --- One row. The overwhelmingly common shape for "what is the CGPA of X",
  // "how much hostel fee is pending for X" and "how many students are there".
  if (single) {
    const described = describeRow(columns, row);
    const who = described.name;

    // A pure aggregate: "How many students are there?" → "There are 320
    // students." The subject noun comes from the question, not from a
    // column that does not exist in an aggregate result.
    if (metric?.isCount && isCountLikeQuestion(question)) {
      const noun = /\bstudents?\b/i.test(question) ? 'students' : pluralOf(subject);
      return `${capitalise(countPhrase(question))} ${formatNumber(metric.value, 0)} ${noun}.`;
    }

    // A single measure on a single subject: "…CGPA is 8.42."
    if (metric) {
      const label = labelForColumn(metric.column);
      const value = formatValue(metric.column, metric.value, hints);
      if (who) return `${possessive(who)} ${label} is ${value}.`;
      // No subject column to attach it to — a bare aggregate. A total reads
      // best as a quantity; anything else reads as a field value.
      if (/\b(total|sum|combined|overall|how much)\b/i.test(question) || /^(total|sum)$/i.test(metric.column)) {
        return `The total comes to ${value}.`;
      }
      return `The ${label} is ${value}.`;
    }

    // A single row in which every selected column is NULL is not a match.
    //
    // This is what `SUM()` returns over an empty set: one row, one NULL. So
    // "how much hostel fee is pending for a day scholar" arrives here and would
    // otherwise be reported as "I found a match, but there is no detail
    // recorded for it" — which claims a match that does not exist.
    const populated = columns.filter(column => {
      const value = row[column];
      return value !== null && value !== undefined && value !== '';
    });
    if (populated.length === 0) {
      return 'Nothing is recorded for that in the database.';
    }

    // A single descriptive row with several populated fields — the parents
    // question, a subject record, a timetable slot. The column already used to
    // introduce the sentence is skipped so the budget goes to the detail.
    const skip = who ? [described.column, 'full_name', 'student_name'] : [];
    const details = informativePairs(columns, row, 3, hints, skip);
    if (details.length > 0) {
      return who
        ? `${possessive(who)} ${details.join(' and ')}.`
        : `${capitalise(details.join(' and '))}.`;
    }

    return "I found a match, but there is no detail recorded for it.";
  }

  // --- Several rows. Lead with the count when the question asked for one,
  // otherwise introduce the list and show the first few.
  const lead =
    metric && isCountLikeQuestion(question)
      ? `${capitalise(countPhrase(question))} ${formatNumber(metric.value, 0)} matching ${subject}.`
      : `Here ${single ? 'is' : 'are'} the ${subject}.`;

  const top = rows.slice(0, 3).map(row => summariseRow(columns, row, 4, hints)).filter(Boolean);
  const remaining = rows.length - top.length;
  const trail = remaining > 0 ? ` ${remaining} more matching row${remaining === 1 ? '' : 's'} below.` : '';
  const listing = top.map(item => `${capitalise(item)}.`).join(' ');
  return `${lead}${listing ? ` ${listing}` : ''}${trail}`;
}

/** "how many" / "how much" → "There are" / "The total is". */
function countPhrase(question: string): string {
  if (/\bhow much\b/i.test(question)) return 'The total comes to';
  if (/\bhow many\b/i.test(question)) return 'There are';
  return 'Found';
}

function pluralOf(subject: string): string {
  if (subject.endsWith('s')) return subject;
  return subject.endsWith('y') ? `${subject.slice(0, -1)}ies` : `${subject}s`;
}

function possessive(name: string): string {
  if (!name) return '';
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** `father: Ramesh Sharma` pairs, skipping nulls, identifiers and noise. */
function informativePairs(
  columns: string[],
  row: Record<string, unknown>,
  limit: number,
  hints: FormatHints = {},
  skip: string[] = []
): string[] {
  return narratableColumns(columns, [row], limit, skip)
    .filter(column => !isContactColumn(column))
    .filter(column => row[column] !== null && row[column] !== undefined && row[column] !== '')
    .map(column => `${labelForColumn(column)}: ${formatValue(column, row[column], hints)}`)
    .filter(pair => !pair.endsWith(': —'));
}

/**
 * Contact details stay in the table and out of the sentence.
 *
 * `Intl.NumberFormat('en-IN')` groups a ten-digit phone number into
 * `9,00,00,11,111`, which is not how anyone writes a phone number, and the
 * prose has no room to carry four of them for two parents. The table beneath
 * the answer still has every column.
 */
function isContactColumn(column: string): boolean {
  return /(^|_)(phone|mobile|email|address|contact|contact_number)$/i.test(column);
}

/**
 * What the rows are, in the user's own vocabulary.
 *
 * Deliberately keyword based and short. It picks the noun the question is
 * about — students, marks, fees, timetable — so the sentence reads naturally
 * without inventing a description no query can support.
 */
function subjectPhrase(question: string, intent?: string): string {
  const haystack = `${question} ${intent || ''}`.toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/\b(attendance|absent|present|classes?)\b/, 'attendance records'],
    [/\b(cgpa|gpa|grade point|cgpa)\b/, 'CGPA results'],
    [/\b(iat|internal assessment)\b/, 'IAT marks'],
    [/\b(marks?|scores?|results?)\b/, 'mark records'],
    [/\b(backlogs?|arrears?)\b/, 'backlog records'],
    [/\b(fees?|pending|unpaid|tuition|hostel fee|payments?)\b/, 'fee records'],
    [/\b(timetable|schedule|class at|period)\b/, 'class slots'],
    [/\b(parents?|guardians?|father|mother)\b/, 'guardian records'],
    [/\b(subjects?|courses?|syllabus|credits?)\b/, 'subject records'],
    [/\b(faculty|teacher|professor|teaches?)\b/, 'faculty assignments'],
    [/\b(hostellers?|day scholars?|residenc\w*|rooms?)\b/, 'hostel allocations'],
    [/\b(students?)\b/, 'students'],
  ];
  for (const [pattern, phrase] of table) {
    if (pattern.test(haystack)) return phrase;
  }
  return 'matching records';
}

/**
 * The row's subject: a person, a student, or a thing.
 *
 * Returns which column was used as well, because the caller then skips that
 * column when narrating the remaining detail. Without it a subject row reads
 * "Engineering Mathematics VI's subject: Engineering Mathematics VI", which is
 * the same fact twice.
 */
function describeRow(
  columns: string[],
  row: Record<string, unknown>,
  exclude?: string
): { name: string; column: string } {
  const nameColumns = ['full_name', 'student_name', 'subject_name', 'faculty_name', 'hostel_name'];
  for (const column of nameColumns) {
    if (exclude && column === exclude) continue;
    const value = row[column];
    if (typeof value === 'string' && value.trim()) return { name: value, column };
  }

  const register = row.register_number;
  if (typeof register === 'string' && register.trim()) return { name: register, column: 'register_number' };

  const first = row.first_name;
  if (typeof first === 'string' && first.trim()) {
    const last = typeof row.last_name === 'string' ? row.last_name.trim() : '';
    return { name: `${first}${last ? ` ${last}` : ''}`, column: 'first_name' };
  }
  return { name: '', column: '' };
}

function isCountLikeQuestion(question: string): boolean {
  return /\b(how many|how much|number of|count)\b/i.test(question);
}

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Compact digest of a result set, used as follow-up context.
 *
 * Without this, "Which of them have backlogs?" has nothing to attach "them" to:
 * the model sees the previous question and its SQL, but not *which rows* came
 * back. Sending the column names and the first few register numbers gives the
 * follow-up something concrete to filter on, without shipping the whole table
 * into the prompt.
 */
export function buildResultDigest(
  columns: string[],
  rows: Record<string, unknown>[],
  maxRows = 5
): string {
  if (rows.length === 0) return '';

  // Internal identifiers are dropped: they identify nothing the follow-up needs
  // to filter on, and a register number identifies the same student far better.
  const useful = columns.filter(column => !isIdentifierColumn(column));
  const identifying = columns.filter(column =>
    /^(register_number|admission_number|full_name|student_name|subject_code|room_number)$/.test(column)
  );

  const parts: string[] = [`columns: ${useful.slice(0, 12).join(', ')}`];
  if (identifying.length === 0) return parts.join('; ');

  const values = rows.slice(0, maxRows).map(row =>
    identifying.map(column => String(row[column] ?? '')).filter(Boolean).join(' ')
  ).filter(Boolean);
  if (values.length > 0) {
    parts.push(`${identifying.join('/')}: ${values.join(', ')}`);
  }
  if (rows.length > maxRows) parts.push(`(${rows.length - maxRows} further rows)`);
  return parts.join('; ');
}