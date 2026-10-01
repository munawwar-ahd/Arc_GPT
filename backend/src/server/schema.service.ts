import { pool } from './db.js';
import { TableSchema } from '../types/index.js';

const field = (name: string, type: string, description: string, primary = false, references?: { table: string; field: string }) => ({
  name,
  type,
  isPrimary: primary,
  isForeignKey: Boolean(references),
  references,
  description,
});

const defineTable = (
  name: string,
  description: string,
  columns: Array<{ name: string; type: string; description: string; primary?: boolean; references?: { table: string; field: string } }>
): TableSchema => ({
  name,
  description,
  columns: columns.map(column => field(column.name, column.type, column.description, column.primary, column.references)),
});

/**
 * Declared schema for the `arcgpt_new` college ERP database.
 *
 * This array is the single source of truth for three things:
 *
 *   1. `ALLOWED_TABLE_NAMES` — the SQL guardrail allowlist. A table or view
 *      that is not listed here is rejected before execution, no matter what the
 *      model produces.
 *   2. The declared fallback used when live introspection fails.
 *   3. The table and column descriptions injected into the SQL-generation
 *      prompt. `refreshFromDatabase()` overlays the REAL data types and
 *      NOT NULL information on top of these descriptions, so the model always
 *      sees accurate types with human-written meaning.
 *
 * PREFER THE v_* VIEWS. They flatten a whole question family into a single
 * scan with readable column names, which a 7B model handles far more reliably
 * than a hand-written five-table join. The base tables are here for questions
 * the views do not cover.
 */
const DEFAULT_TABLES: TableSchema[] = [
  // =========================================================================
  // READ MODELS — start here
  // =========================================================================
  defineTable('v_student_directory', 'One row per student with everything about them: department, programme, batch, section, year of study, current semester, residency and parents phone numbers pivoted into mother_/father_/guardian_ columns. Use this instead of joining students, departments, programs, batches, sections, semesters and guardians by hand.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true, references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number, e.g. AIML32022A07' },
    { name: 'admission_number', type: 'TEXT', description: 'Unique admission number' },
    { name: 'full_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'first_name', type: 'TEXT', description: 'First name' },
    { name: 'last_name', type: 'TEXT', description: 'Surname' },
    { name: 'gender', type: 'TEXT', description: 'MALE, FEMALE or OTHER' },
    { name: 'date_of_birth', type: 'DATE', description: 'Date of birth' },
    { name: 'phone', type: 'TEXT', description: 'Student phone number' },
    { name: 'email', type: 'TEXT', description: 'Student email address' },
    { name: 'address', type: 'TEXT', description: 'Home address' },
    { name: 'student_status', type: 'TEXT', description: 'ACTIVE, INACTIVE, ON_LEAVE or GRADUATED' },
    { name: 'residence_status', type: 'TEXT', description: 'HOSTELLER or DAY_SCHOLAR' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code: AIML, CSE, ECE or MECH. Filter on this.' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'program_code', type: 'TEXT', description: 'Degree programme code' },
    { name: 'program_name', type: 'TEXT', description: 'Degree programme name' },
    { name: 'degree_level', type: 'TEXT', description: 'UG, PG, DIPLOMA or PHD' },
    { name: 'batch_code', type: 'TEXT', description: 'Admission cohort, e.g. AIML-2022' },
    { name: 'admission_year', type: 'INTEGER', description: 'Year the student was admitted' },
    { name: 'section_code', type: 'TEXT', description: 'Section letter A or B' },
    { name: 'section_name', type: 'TEXT', description: 'Full section name' },
    { name: 'year_of_study', type: 'INTEGER', description: 'Current year of study, 1 to 4' },
    { name: 'year_of_study_name', type: 'TEXT', description: 'First Year, Second Year, Third Year or Fourth Year' },
    { name: 'current_semester_number', type: 'INTEGER', description: 'Semester the student is currently taking, 2 to 8' },
    { name: 'current_semester_name', type: 'TEXT', description: 'Name of the current semester' },
    { name: 'current_academic_year', type: 'TEXT', description: 'Current academic year label, e.g. 2024-25' },
    { name: 'mother_name', type: 'TEXT', description: 'Mother name' },
    { name: 'mother_phone', type: 'TEXT', description: 'Mother phone number' },
    { name: 'father_name', type: 'TEXT', description: 'Father name' },
    { name: 'father_phone', type: 'TEXT', description: 'Father phone number' },
    { name: 'guardian_name', type: 'TEXT', description: 'Guardian name where one is recorded' },
    { name: 'guardian_phone', type: 'TEXT', description: 'Guardian phone number' },
  ]),
  defineTable('student_academic_summary', 'One row per student academic snapshot: derived CGPA, semesters completed, credits earned, active and total backlog counts, and overall attendance. Use for CGPA, backlog-count and overall-attendance questions without any GROUP BY.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true, references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'full_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'residence_status', type: 'TEXT', description: 'HOSTELLER or DAY_SCHOLAR' },
    { name: 'current_cgpa', type: 'NUMERIC', description: 'Cumulative GPA on a 10-point scale, derived from published marks' },
    { name: 'semesters_completed', type: 'INTEGER', description: 'Number of semesters with a published result' },
    { name: 'credits_earned', type: 'NUMERIC', description: 'Total credits earned so far' },
    { name: 'current_backlog_count', type: 'INTEGER', description: 'ACTIVE backlogs, counted from the backlogs table' },
    { name: 'total_backlog_count', type: 'INTEGER', description: 'All backlogs including cleared ones' },
    { name: 'overall_attendance_percentage', type: 'NUMERIC', description: 'Attendance across every subject and semester' },
    { name: 'total_classes', type: 'INTEGER', description: 'Total classes held for the student' },
    { name: 'classes_attended', type: 'INTEGER', description: 'Classes attended' },
  ]),
  defineTable('v_marks_detail', 'Every published end-semester mark with full academic context: student, department, section, subject, semester, academic year, marks, percentage, grade point, letter grade and pass or fail. Only semesters that have actually happened appear. Use for "what did I score in X", "semester 3 marks" and "who failed X".', [
    { name: 'mark_id', type: 'UUID', description: 'Mark record identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student identifier', references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'section_code', type: 'TEXT', description: 'Section letter' },
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'subject_code', type: 'TEXT', description: 'Subject code, e.g. AI201' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name, e.g. Database Management Systems' },
    { name: 'subject_type', type: 'TEXT', description: 'THEORY, LAB, THEORY_LAB or PROJECT' },
    { name: 'credits', type: 'NUMERIC', description: 'Subject credit value' },
    { name: 'semester_id', type: 'UUID', description: 'Semester identifier', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester number 1 to 8' },
    { name: 'semester_name', type: 'TEXT', description: 'Semester name' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year label, e.g. 2023-24' },
    { name: 'theory_max_marks', type: 'NUMERIC', description: 'Maximum theory marks' },
    { name: 'theory_marks_obtained', type: 'NUMERIC', description: 'Theory marks obtained' },
    { name: 'lab_max_marks', type: 'NUMERIC', description: 'Maximum lab marks, 0 for theory subjects' },
    { name: 'lab_marks_obtained', type: 'NUMERIC', description: 'Lab marks obtained' },
    { name: 'total_marks_obtained', type: 'NUMERIC', description: 'Theory plus lab marks obtained' },
    { name: 'total_max_marks', type: 'NUMERIC', description: 'Total maximum marks' },
    { name: 'marks_percentage', type: 'NUMERIC', description: 'Obtained as a percentage of maximum, computed here' },
    { name: 'grade_point', type: 'NUMERIC', description: 'Grade point on a 10-point scale, 0 to 10' },
    { name: 'letter_grade', type: 'TEXT', description: 'O, A+, A, B+, B, B-, P or F' },
    { name: 'result_status', type: 'TEXT', description: 'PASS or FAIL' },
  ]),
  defineTable('v_iat_marks', 'Internal Assessment Test marks with IAT 1, IAT 2 and IAT 3 pivoted side by side out of 40, plus the total and average. Use for "show my IAT marks", "IAT 2 in DBMS" and "who scored below 40 in IAT 1".', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true, references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'section_code', type: 'TEXT', description: 'Section letter' },
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'subject_code', type: 'TEXT', description: 'Subject code' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name' },
    { name: 'credits', type: 'NUMERIC', description: 'Subject credit value' },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester number 1 to 8' },
    { name: 'semester_name', type: 'TEXT', description: 'Semester name' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year label' },
    { name: 'iat1_marks', type: 'NUMERIC', description: 'IAT 1 marks out of 40, null if not recorded' },
    { name: 'iat2_marks', type: 'NUMERIC', description: 'IAT 2 marks out of 40, null if not recorded' },
    { name: 'iat3_marks', type: 'NUMERIC', description: 'IAT 3 marks out of 40, null if not recorded' },
    { name: 'iat_max_marks', type: 'NUMERIC', description: 'Maximum marks per IAT, normally 40' },
    { name: 'total_iat_marks', type: 'NUMERIC', description: 'Sum of all recorded IAT marks' },
    { name: 'average_iat_marks', type: 'NUMERIC', description: 'Average of all recorded IAT marks' },
    { name: 'iat_count', type: 'INTEGER', description: 'How many IATs were recorded' },
  ]),
  defineTable('v_attendance_detail', 'Attendance per student per subject per semester, with the percentage computed from the counts rather than stored. Use for "my attendance", "my DBMS attendance", "below 75 percent" and "how many classes did I miss".', [
    { name: 'attendance_id', type: 'UUID', description: 'Attendance record identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student identifier', references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'section_code', type: 'TEXT', description: 'Section letter' },
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'subject_code', type: 'TEXT', description: 'Subject code' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name' },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester number 1 to 8' },
    { name: 'semester_name', type: 'TEXT', description: 'Semester name' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year label' },
    { name: 'total_classes', type: 'INTEGER', description: 'Classes held for this student in this subject' },
    { name: 'classes_attended', type: 'INTEGER', description: 'Classes attended' },
    { name: 'classes_absent', type: 'INTEGER', description: 'Classes missed' },
    { name: 'attendance_percentage', type: 'NUMERIC', description: 'Attended as a percentage of total, computed here' },
    { name: 'absence_percentage', type: 'NUMERIC', description: 'Absent as a percentage of total, computed here' },
  ]),
  defineTable('v_student_attendance_summary', 'One row per student: total classes, attended, absent, overall attendance percentage and the lowest subject percentage. Use for "who is below 75 percent attendance" with no GROUP BY.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true, references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'total_classes', type: 'INTEGER', description: 'Classes held across every subject' },
    { name: 'classes_attended', type: 'INTEGER', description: 'Classes attended' },
    { name: 'classes_absent', type: 'INTEGER', description: 'Classes missed' },
    { name: 'attendance_percentage', type: 'NUMERIC', description: 'Overall attendance percentage' },
    { name: 'lowest_subject_percentage', type: 'NUMERIC', description: 'Attendance percentage in the weakest subject' },
  ]),
  defineTable('v_backlog_detail', 'Every backlog with the subject and semester it was earned in, the attempt number and whether it is still ACTIVE or has been CLEARED. Use for "which subjects do I have backlogs in" and "who has a backlog in DBMS".', [
    { name: 'backlog_id', type: 'UUID', description: 'Backlog identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student identifier', references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'subject_code', type: 'TEXT', description: 'Subject code' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name' },
    { name: 'credits', type: 'NUMERIC', description: 'Subject credit value' },
    { name: 'backlog_semester', type: 'INTEGER', description: 'Semester in which the subject was failed' },
    { name: 'backlog_academic_year', type: 'TEXT', description: 'Academic year of the failure' },
    { name: 'attempt_number', type: 'INTEGER', description: 'Re-attempt number' },
    { name: 'backlog_status', type: 'TEXT', description: 'ACTIVE or CLEARED' },
    { name: 'cleared_on', type: 'DATE', description: 'Date the backlog was cleared' },
  ]),
  defineTable('v_timetable_detail', 'The weekly class grid: day, period, start and end time, subject, faculty, section, department, year of study and classroom. day_number 1 is Monday. Use for "what class at 2 PM on Monday", "who teaches X" and "timetable for second-year AIML".', [
    { name: 'timetable_id', type: 'UUID', description: 'Timetable row identifier', primary: true },
    { name: 'section_id', type: 'UUID', description: 'Section identifier', references: { table: 'sections', field: 'section_id' } },
    { name: 'section_code', type: 'TEXT', description: 'Section letter A or B' },
    { name: 'section_name', type: 'TEXT', description: 'Full section name' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'year_of_study', type: 'INTEGER', description: 'Year of study, 1 to 4' },
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'subject_code', type: 'TEXT', description: 'Subject code' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name' },
    { name: 'subject_type', type: 'TEXT', description: 'THEORY, LAB, THEORY_LAB or PROJECT' },
    { name: 'credits', type: 'NUMERIC', description: 'Subject credit value' },
    { name: 'offering_id', type: 'UUID', description: 'Course offering identifier', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'faculty_id', type: 'UUID', description: 'Teaching faculty identifier', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'faculty_employee_id', type: 'TEXT', description: 'Faculty employee number' },
    { name: 'faculty_name', type: 'TEXT', description: 'Teaching faculty name' },
    { name: 'faculty_designation', type: 'TEXT', description: 'Faculty designation' },
    { name: 'classroom', type: 'TEXT', description: 'Room code the class meets in' },
    { name: 'room_type', type: 'TEXT', description: 'CLASSROOM, LAB, SEMINAR_HALL or AUDITORIUM' },
    { name: 'day_number', type: 'INTEGER', description: '1 is Monday through 5 is Friday' },
    { name: 'day_name', type: 'TEXT', description: 'MONDAY, TUESDAY, WEDNESDAY, THURSDAY or FRIDAY' },
    { name: 'period_number', type: 'INTEGER', description: 'Period number 1 to 6' },
    { name: 'period_label', type: 'TEXT', description: 'Period label, e.g. Period 4' },
    { name: 'start_time', type: 'TIME', description: 'Class start time. Period 4 starts at 14:00' },
    { name: 'end_time', type: 'TIME', description: 'Class end time' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year label' },
  ]),
  defineTable('v_fee_status', 'Fee bills with amount paid summed from the payment ledger and amount pending computed here, so the two can never disagree. Use for "how much fee is pending", "who has not paid" and "has this student paid the hostel fee".', [
    { name: 'student_fee_id', type: 'UUID', description: 'Bill identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student identifier', references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier', references: { table: 'departments', field: 'department_id' } },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'fee_type_id', type: 'UUID', description: 'Fee type identifier', references: { table: 'fee_types', field: 'fee_type_id' } },
    { name: 'fee_type_code', type: 'TEXT', description: 'COLLEGE_FEE, HOSTEL_FEE, EXAM_FEE, LIBRARY_FEE or TRANSIT_FEE' },
    { name: 'fee_type_name', type: 'TEXT', description: 'Human readable fee name' },
    { name: 'fee_category', type: 'TEXT', description: 'TUITION, HOSTEL, EXAM, LIBRARY or OTHER' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year the bill covers' },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester the bill covers, null for a full-year bill' },
    { name: 'total_amount', type: 'NUMERIC', description: 'Total billed' },
    { name: 'discount', type: 'NUMERIC', description: 'Scholarship or concession deducted' },
    { name: 'due_date', type: 'DATE', description: 'Payment due date' },
    { name: 'amount_paid', type: 'NUMERIC', description: 'Sum of payments recorded against this bill' },
    { name: 'amount_pending', type: 'NUMERIC', description: 'total_amount minus discount minus amount_paid, never negative' },
    { name: 'payment_status', type: 'TEXT', description: 'PAID, PARTIALLY_PAID or UNPAID' },
    { name: 'payment_count', type: 'INTEGER', description: 'Number of payments recorded' },
    { name: 'last_payment_date', type: 'DATE', description: 'Most recent payment date' },
  ]),
  defineTable('v_hostel_allocation', 'Which student lives in which hostel room, with hostel name, room type and allocation status.', [
    { name: 'allocation_id', type: 'UUID', description: 'Allocation identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student identifier', references: { table: 'students', field: 'student_id' } },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number' },
    { name: 'student_name', type: 'TEXT', description: 'first_name and last_name joined' },
    { name: 'department_code', type: 'TEXT', description: 'Short department code' },
    { name: 'hostel_id', type: 'UUID', description: 'Hostel identifier', references: { table: 'hostels', field: 'hostel_id' } },
    { name: 'hostel_name', type: 'TEXT', description: 'Hostel name' },
    { name: 'hostel_type', type: 'TEXT', description: 'BOYS or GIRLS' },
    { name: 'room_number', type: 'TEXT', description: 'Room number within the hostel' },
    { name: 'room_type', type: 'TEXT', description: 'SEATER or SHARED' },
    { name: 'allocation_status', type: 'TEXT', description: 'ALLOCATED or VACATED' },
  ]),
  defineTable('v_student_cgpa', 'Semester GPA and running CGPA for each student, DERIVED from published marks and subject credits. One row per student per completed semester. Use for "what was my GPA in semester 2" and "show my GPA for every completed semester". This view carries no register_number: to name a student, join v_student_directory d ON d.student_id = g.student_id and filter on d.register_number.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true, references: { table: 'students', field: 'student_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester identifier', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester number 1 to 8' },
    { name: 'academic_year', type: 'TEXT', description: 'Academic year label' },
    { name: 'total_credits', type: 'NUMERIC', description: 'Credits registered in the semester' },
    { name: 'graded_credits', type: 'NUMERIC', description: 'Credits that carry a grade point' },
    { name: 'semester_gpa', type: 'NUMERIC', description: 'GPA for this semester on a 10-point scale' },
    { name: 'cgpa_cumulative', type: 'NUMERIC', description: 'Running CGPA up to and including this semester' },
  ]),

  // =========================================================================
  // ACADEMIC STRUCTURE
  // =========================================================================
  defineTable('departments', 'Academic departments. Nothing in the database stores a department name as free text.', [
    { name: 'department_id', type: 'UUID', description: 'Department identifier', primary: true },
    { name: 'department_code', type: 'TEXT', description: 'Short department code: AIML, CSE, ECE or MECH' },
    { name: 'department_name', type: 'TEXT', description: 'Full department name' },
    { name: 'hod_faculty_id', type: 'UUID', description: 'Head of department', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'established_year', type: 'INTEGER', description: 'Year the department was established' },
    { name: 'email', type: 'TEXT', description: 'Department email' },
    { name: 'phone', type: 'TEXT', description: 'Department phone' },
  ]),
  defineTable('programs', 'Degree programmes such as B.Tech, owned by a department.', [
    { name: 'program_id', type: 'UUID', description: 'Programme identifier', primary: true },
    { name: 'department_id', type: 'UUID', description: 'Owning department', references: { table: 'departments', field: 'department_id' } },
    { name: 'program_code', type: 'TEXT', description: 'Programme code, e.g. BT-AIML' },
    { name: 'program_name', type: 'TEXT', description: 'Programme name' },
    { name: 'degree_level', type: 'TEXT', description: 'UG, PG, DIPLOMA or PHD' },
    { name: 'duration_years', type: 'NUMERIC', description: 'Years to complete' },
  ]),
  defineTable('academic_years', 'The academic calendar. One row is flagged is_current.', [
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year identifier', primary: true },
    { name: 'year_label', type: 'TEXT', description: 'Label such as 2024-25' },
    { name: 'start_year', type: 'INTEGER', description: 'Starting calendar year' },
    { name: 'end_year', type: 'INTEGER', description: 'Ending calendar year' },
    { name: 'is_current', type: 'BOOLEAN', description: 'Whether this is the current academic year' },
  ]),
  defineTable('batches', 'Admission cohorts such as AIML-2022.', [
    { name: 'batch_id', type: 'UUID', description: 'Batch identifier', primary: true },
    { name: 'batch_code', type: 'TEXT', description: 'Batch code, e.g. AIML-2022' },
    { name: 'program_id', type: 'UUID', description: 'Programme', references: { table: 'programs', field: 'program_id' } },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'admission_year', type: 'INTEGER', description: 'Year of admission' },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year the cohort was admitted into', references: { table: 'academic_years', field: 'academic_year_id' } },
  ]),
  defineTable('years_of_study', 'Year of study within a programme, 1 to 4 for the seeded cohort.', [
    { name: 'year_of_study_id', type: 'UUID', description: 'Year of study identifier', primary: true },
    { name: 'year_number', type: 'SMALLINT', description: 'Year number, 1 to 4' },
    { name: 'year_name', type: 'TEXT', description: 'First Year, Second Year, Third Year or Fourth Year' },
  ]),
  defineTable('semesters', 'Semester POSITIONS 1 to 8, shared by every academic year. The year-specific fact lives in course_offerings.academic_year_id.', [
    { name: 'semester_id', type: 'UUID', description: 'Semester identifier', primary: true },
    { name: 'semester_number', type: 'SMALLINT', description: 'Semester number, 1 to 8' },
    { name: 'semester_name', type: 'TEXT', description: 'Semester name' },
    { name: 'duration_months', type: 'SMALLINT', description: 'Length in months' },
  ]),
  defineTable('sections', 'A teaching group: one department, one batch, one year of study and one letter. Every department has both an A and a B section per year.', [
    { name: 'section_id', type: 'UUID', description: 'Section identifier', primary: true },
    { name: 'section_code', type: 'TEXT', description: 'Section letter, A or B' },
    { name: 'section_name', type: 'TEXT', description: 'Full section name' },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'batch_id', type: 'UUID', description: 'Batch', references: { table: 'batches', field: 'batch_id' } },
    { name: 'year_of_study_id', type: 'UUID', description: 'Year of study', references: { table: 'years_of_study', field: 'year_of_study_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year this section is currently in', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'capacity', type: 'INTEGER', description: 'Intake capacity' },
  ]),

  // =========================================================================
  // PEOPLE
  // =========================================================================
  defineTable('students', 'The student record. register_number is the business key the college uses.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true },
    { name: 'register_number', type: 'TEXT', description: 'Unique registration number, e.g. AIML32022A07' },
    { name: 'admission_number', type: 'TEXT', description: 'Unique admission number' },
    { name: 'first_name', type: 'TEXT', description: 'First name' },
    { name: 'last_name', type: 'TEXT', description: 'Surname' },
    { name: 'gender', type: 'TEXT', description: 'MALE, FEMALE or OTHER' },
    { name: 'date_of_birth', type: 'DATE', description: 'Date of birth' },
    { name: 'phone', type: 'TEXT', description: 'Phone number' },
    { name: 'email', type: 'TEXT', description: 'Unique email address' },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'program_id', type: 'UUID', description: 'Programme', references: { table: 'programs', field: 'program_id' } },
    { name: 'batch_id', type: 'UUID', description: 'Batch', references: { table: 'batches', field: 'batch_id' } },
    { name: 'section_id', type: 'UUID', description: 'Current section', references: { table: 'sections', field: 'section_id' } },
    { name: 'current_year_of_study_id', type: 'UUID', description: 'Current year of study', references: { table: 'years_of_study', field: 'year_of_study_id' } },
    { name: 'current_semester_id', type: 'UUID', description: 'Semester currently being taken', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'residence_status', type: 'TEXT', description: 'HOSTELLER or DAY_SCHOLAR' },
    { name: 'status', type: 'TEXT', description: 'ACTIVE, INACTIVE, ON_LEAVE or GRADUATED' },
    { name: 'admission_date', type: 'DATE', description: 'Date of admission' },
    { name: 'address', type: 'TEXT', description: 'Home address' },
  ]),
  defineTable('guardians', 'One row per guardian relationship instead of six repeated columns on students. Filter on relation_type to get MOTHER, FATHER or GUARDIAN. Prefer v_student_directory, which pivots these into mother_/father_/guardian_ columns.', [
    { name: 'guardian_id', type: 'UUID', description: 'Guardian record identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'relation_type', type: 'TEXT', description: 'MOTHER, FATHER or GUARDIAN. One row per type per student.' },
    { name: 'guardian_name', type: 'TEXT', description: 'Guardian name' },
    { name: 'phone', type: 'TEXT', description: 'Guardian phone number' },
    { name: 'email', type: 'TEXT', description: 'Guardian email' },
    { name: 'occupation', type: 'TEXT', description: 'Guardian occupation' },
    { name: 'is_primary', type: 'BOOLEAN', description: 'Whether this is the primary contact' },
  ]),
  defineTable('faculty', 'Teaching staff.', [
    { name: 'faculty_id', type: 'UUID', description: 'Faculty identifier', primary: true },
    { name: 'employee_id', type: 'TEXT', description: 'Unique employee number' },
    { name: 'first_name', type: 'TEXT', description: 'First name' },
    { name: 'last_name', type: 'TEXT', description: 'Surname' },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'designation', type: 'TEXT', description: 'Designation, e.g. Professor and Head' },
    { name: 'email', type: 'TEXT', description: 'Unique email address' },
    { name: 'phone', type: 'TEXT', description: 'Phone number' },
    { name: 'date_of_joined', type: 'DATE', description: 'Date joined' },
    { name: 'status', type: 'TEXT', description: 'ACTIVE or INACTIVE' },
  ]),
  defineTable('faculty_subjects', 'Which faculty handle which subjects. Derived from actual teaching assignments.', [
    { name: 'faculty_subject_id', type: 'UUID', description: 'Assignment identifier', primary: true },
    { name: 'faculty_id', type: 'UUID', description: 'Faculty', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'is_primary', type: 'BOOLEAN', description: 'Whether this is the primary subject for that faculty member' },
  ]),

  // =========================================================================
  // SUBJECTS AND DELIVERY
  // =========================================================================
  defineTable('subjects', 'The subject catalogue. Each subject row is owned by one department and one semester and is reused by every section and every student who takes it.', [
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', primary: true },
    { name: 'subject_code', type: 'TEXT', description: 'Unique subject code, e.g. AI201' },
    { name: 'subject_name', type: 'TEXT', description: 'Subject name, e.g. Database Management Systems' },
    { name: 'department_id', type: 'UUID', description: 'Owning department', references: { table: 'departments', field: 'department_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester this subject is taught in', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'credits', type: 'NUMERIC', description: 'Credit value' },
    { name: 'subject_type', type: 'TEXT', description: 'THEORY, LAB, THEORY_LAB or PROJECT' },
    { name: 'lecture_hours', type: 'INTEGER', description: 'Weekly lecture hours' },
    { name: 'practical_hours', type: 'INTEGER', description: 'Weekly practical hours' },
    { name: 'is_elective', type: 'BOOLEAN', description: 'Whether this is an elective' },
  ]),
  defineTable('course_offerings', 'A subject delivered to a section in an academic year, taught by one faculty member. This is the bridge that marks, IAT, attendance and the timetable all hang off.', [
    { name: 'offering_id', type: 'UUID', description: 'Offering identifier', primary: true },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'section_id', type: 'UUID', description: 'Section', references: { table: 'sections', field: 'section_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year of this delivery', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'faculty_id', type: 'UUID', description: 'Teaching faculty member', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'delivery_mode', type: 'TEXT', description: 'CLASSROOM, ONLINE or BLENDED' },
  ]),
  defineTable('student_enrollments', 'Which student is taking which offered subject. This is a relational record, never a comma-separated list.', [
    { name: 'enrollment_id', type: 'UUID', description: 'Enrolment identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'enrolled_on', type: 'DATE', description: 'Date enrolled' },
    { name: 'status', type: 'TEXT', description: 'ENROLLED, DROPPED or COMPLETED' },
  ]),

  // =========================================================================
  // ASSESSMENT
  // =========================================================================
  defineTable('student_marks', 'End-semester marks, one row per student per offered subject. Only semesters that have already happened are populated; there are no future marks. Prefer v_marks_detail.', [
    { name: 'mark_id', type: 'UUID', description: 'Mark record identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'theory_max_marks', type: 'NUMERIC', description: 'Maximum theory marks' },
    { name: 'theory_marks_obtained', type: 'NUMERIC', description: 'Theory marks obtained' },
    { name: 'lab_max_marks', type: 'NUMERIC', description: 'Maximum lab marks, 0 for theory subjects' },
    { name: 'lab_marks_obtained', type: 'NUMERIC', description: 'Lab marks obtained' },
    { name: 'grade_point', type: 'NUMERIC', description: 'Grade point on a 10-point scale, 0 to 10' },
    { name: 'letter_grade', type: 'TEXT', description: 'O, A+, A, B+, B, B-, P or F' },
    { name: 'result_status', type: 'TEXT', description: 'PASS or FAIL' },
    { name: 'published_at', type: 'DATE', description: 'Date the result was published' },
  ]),
  defineTable('iat_marks', 'Internal Assessment Test marks out of 40, three per student per subject. Prefer v_iat_marks, which pivots IAT 1, 2 and 3 side by side.', [
    { name: 'iat_mark_id', type: 'UUID', description: 'IAT mark identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'iat_number', type: 'SMALLINT', description: 'Which IAT: 1, 2 or 3' },
    { name: 'max_marks', type: 'NUMERIC', description: 'Maximum marks, normally 40' },
    { name: 'marks_obtained', type: 'NUMERIC', description: 'Marks obtained' },
    { name: 'exam_date', type: 'DATE', description: 'Date of the IAT' },
  ]),
  defineTable('semester_results', 'Published per-semester GPA and running CGPA. Stored because the college publishes them; v_student_cgpa recomputes the same values from marks so they are always auditable.', [
    { name: 'semester_result_id', type: 'UUID', description: 'Result identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'total_credits', type: 'NUMERIC', description: 'Credits registered' },
    { name: 'credits_earned', type: 'NUMERIC', description: 'Credits earned' },
    { name: 'semester_gpa', type: 'NUMERIC', description: 'GPA for the semester on a 10-point scale' },
    { name: 'cgpa_cumulative', type: 'NUMERIC', description: 'Running CGPA' },
    { name: 'result_status', type: 'TEXT', description: 'PASS or FAIL' },
    { name: 'published_at', type: 'DATE', description: 'Publication date' },
  ]),
  defineTable('backlogs', 'An uncleared subject requirement, one row per student per subject. Never a comma-separated list. At most one ACTIVE row per student per subject.', [
    { name: 'backlog_id', type: 'UUID', description: 'Backlog identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester in which it was failed', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year of the failure', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'attempt_number', type: 'SMALLINT', description: 'Re-attempt number' },
    { name: 'status', type: 'TEXT', description: 'ACTIVE or CLEARED' },
    { name: 'cleared_on', type: 'DATE', description: 'Date the backlog was cleared' },
  ]),
  defineTable('attendance', 'Attendance per student per offered subject, recorded as counts rather than a bare percentage. The percentage is computed in v_attendance_detail.', [
    { name: 'attendance_id', type: 'UUID', description: 'Attendance record identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'total_classes', type: 'INTEGER', description: 'Classes held' },
    { name: 'classes_attended', type: 'INTEGER', description: 'Classes attended' },
    { name: 'classes_absent', type: 'INTEGER', description: 'Classes missed' },
  ]),

  // =========================================================================
  // TIMETABLE
  // =========================================================================
  defineTable('weekdays', 'Days of the teaching week. day_number 1 is Monday.', [
    { name: 'weekday_id', type: 'SMALLINT', description: 'Day identifier, 1 to 6', primary: true },
    { name: 'day_number', type: 'SMALLINT', description: 'Day number, 1 to 6' },
    { name: 'day_name', type: 'TEXT', description: 'MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY or SATURDAY' },
  ]),
  defineTable('period_slots', 'Daily period times. Period 4 starts at 14:00 because of the 12:00-14:00 lunch break.', [
    { name: 'period_id', type: 'SMALLINT', description: 'Period identifier, 1 to 6', primary: true },
    { name: 'period_number', type: 'SMALLINT', description: 'Period number' },
    { name: 'period_label', type: 'TEXT', description: 'Period label' },
    { name: 'start_time', type: 'TIME', description: 'Start time' },
    { name: 'end_time', type: 'TIME', description: 'End time' },
  ]),
  defineTable('classrooms', 'Rooms and laboratories available for teaching.', [
    { name: 'classroom_id', type: 'UUID', description: 'Classroom identifier', primary: true },
    { name: 'room_code', type: 'TEXT', description: 'Unique room code, e.g. AIML-L1' },
    { name: 'room_type', type: 'TEXT', description: 'CLASSROOM, LAB, SEMINAR_HALL or AUDITORIUM' },
    { name: 'capacity', type: 'INTEGER', description: 'Seating capacity' },
    { name: 'building', type: 'TEXT', description: 'Building name' },
    { name: 'department_id', type: 'UUID', description: 'Owning department', references: { table: 'departments', field: 'department_id' } },
  ]),
  defineTable('timetable', 'The weekly grid, one row per (section, day, period). A section is never double-booked, and neither is a faculty member.', [
    { name: 'timetable_id', type: 'UUID', description: 'Timetable row identifier', primary: true },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'section_id', type: 'UUID', description: 'Section', references: { table: 'sections', field: 'section_id' } },
    { name: 'faculty_id', type: 'UUID', description: 'Teaching faculty member', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'classroom_id', type: 'UUID', description: 'Room the class meets in', references: { table: 'classrooms', field: 'classroom_id' } },
    { name: 'weekday_id', type: 'SMALLINT', description: 'Day of the week', references: { table: 'weekdays', field: 'weekday_id' } },
    { name: 'period_id', type: 'SMALLINT', description: 'Period of the day', references: { table: 'period_slots', field: 'period_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'effective_from', type: 'DATE', description: 'Date the slot takes effect' },
    { name: 'effective_to', type: 'DATE', description: 'Date the slot stops applying' },
  ]),

  // =========================================================================
  // FEES
  // =========================================================================
  defineTable('fee_types', 'The kinds of fee the college levies.', [
    { name: 'fee_type_id', type: 'UUID', description: 'Fee type identifier', primary: true },
    { name: 'fee_type_code', type: 'TEXT', description: 'COLLEGE_FEE, HOSTEL_FEE, EXAM_FEE, LIBRARY_FEE or TRANSIT_FEE' },
    { name: 'fee_type_name', type: 'TEXT', description: 'Human readable fee name' },
    { name: 'fee_category', type: 'TEXT', description: 'TUITION, HOSTEL, EXAM, LIBRARY or OTHER' },
    { name: 'is_recurring', type: 'BOOLEAN', description: 'Whether the fee recurs every year' },
  ]),
  defineTable('fee_structure', 'Published fee amount per fee type, academic year and department.', [
    { name: 'fee_structure_id', type: 'UUID', description: 'Fee structure identifier', primary: true },
    { name: 'fee_type_id', type: 'UUID', description: 'Fee type', references: { table: 'fee_types', field: 'fee_type_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'amount', type: 'NUMERIC', description: 'Published amount' },
  ]),
  defineTable('student_fees', 'One bill per student, fee type and academic year. amount_paid is NOT stored: it is summed from fee_payments in v_fee_status.', [
    { name: 'student_fee_id', type: 'UUID', description: 'Bill identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'fee_type_id', type: 'UUID', description: 'Fee type', references: { table: 'fee_types', field: 'fee_type_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year the bill covers', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester the bill covers, null for a full-year bill', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'total_amount', type: 'NUMERIC', description: 'Total billed' },
    { name: 'discount', type: 'NUMERIC', description: 'Scholarship or concession deducted' },
    { name: 'due_date', type: 'DATE', description: 'Payment due date' },
  ]),
  defineTable('fee_payments', 'The payment ledger. v_fee_status sums these rows to derive amount_paid and amount_pending.', [
    { name: 'payment_id', type: 'UUID', description: 'Payment identifier', primary: true },
    { name: 'student_fee_id', type: 'UUID', description: 'Bill the payment settles', references: { table: 'student_fees', field: 'student_fee_id' } },
    { name: 'amount', type: 'NUMERIC', description: 'Amount received' },
    { name: 'payment_date', type: 'DATE', description: 'Date of payment' },
    { name: 'payment_mode', type: 'TEXT', description: 'CASH, CARD, NETBANKING, CHEQUE, UPI or DD' },
    { name: 'reference_no', type: 'TEXT', description: 'Receipt reference number' },
    { name: 'collected_by', type: 'UUID', description: 'Staff member who collected it', references: { table: 'faculty', field: 'faculty_id' } },
  ]),

  // =========================================================================
  // HOSTEL
  // =========================================================================
  defineTable('hostels', 'Hostel blocks, kept out of the student model so it stays extensible.', [
    { name: 'hostel_id', type: 'UUID', description: 'Hostel identifier', primary: true },
    { name: 'hostel_name', type: 'TEXT', description: 'Hostel name' },
    { name: 'hostel_type', type: 'TEXT', description: 'BOYS or GIRLS' },
    { name: 'warden_faculty_id', type: 'UUID', description: 'Warden', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'total_rooms', type: 'INTEGER', description: 'Total rooms in the hostel' },
    { name: 'address', type: 'TEXT', description: 'Campus location' },
  ]),
  defineTable('hostel_rooms', 'Individual hostel rooms and their occupancy.', [
    { name: 'room_id', type: 'UUID', description: 'Room identifier', primary: true },
    { name: 'hostel_id', type: 'UUID', description: 'Hostel', references: { table: 'hostels', field: 'hostel_id' } },
    { name: 'room_number', type: 'TEXT', description: 'Room number within the hostel' },
    { name: 'room_type', type: 'TEXT', description: 'SEATER or SHARED' },
    { name: 'capacity', type: 'INTEGER', description: 'Bed capacity' },
    { name: 'occupied_count', type: 'INTEGER', description: 'Beds currently occupied' },
  ]),
  defineTable('hostel_allocations', 'Which student is allocated to which room in which academic year.', [
    { name: 'allocation_id', type: 'UUID', description: 'Allocation identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'room_id', type: 'UUID', description: 'Room', references: { table: 'hostel_rooms', field: 'room_id' } },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'allocated_on', type: 'DATE', description: 'Date of allocation' },
    { name: 'vacated_on', type: 'DATE', description: 'Date the room was vacated' },
    { name: 'status', type: 'TEXT', description: 'ALLOCATED or VACATED' },
  ]),
];

export const INSTITUTION_TABLE_NAMES = DEFAULT_TABLES.map(table => table.name);
export const ALLOWED_TABLE_NAMES = INSTITUTION_TABLE_NAMES;
export const PROTECTED_TABLES = new Set([
  'arcgpt_users',
  'arcgpt_sessions',
  'ai_queries',
  'saved_queries',
  'ai_conversations',
  'ai_messages',
  'feedback',
  'audit_logs',
  'security_events',
  'system_settings',
  'roles',
  'permissions',
  'role_permissions',
]);

export class SchemaService {
  private tables: TableSchema[] = DEFAULT_TABLES;
  private loadedFromDatabase = false;

  public async refreshFromDatabase(): Promise<boolean> {
    try {
      const result = await pool.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        [INSTITUTION_TABLE_NAMES]
      );

      if (result.rows.length === 0) {
        this.loadedFromDatabase = false;
        return false;
      }

      const grouped = new Map<string, TableSchema>();
      for (const row of result.rows) {
        const existing = DEFAULT_TABLES.find(table => table.name === row.table_name);
        if (!existing) continue;
        const table = grouped.get(row.table_name) || {
          name: existing.name,
          description: existing.description,
          columns: [],
        };
        const declared = existing.columns.find(column => column.name === row.column_name);
        table.columns.push(field(
          row.column_name,
          row.data_type.toUpperCase(),
          declared?.description || 'Database column',
          declared?.isPrimary,
          declared?.references
        ));
        grouped.set(row.table_name, table);
      }

      if (grouped.size > 0) {
        this.tables = DEFAULT_TABLES.map(table => grouped.get(table.name) || table);
        this.loadedFromDatabase = true;
      }
      return this.loadedFromDatabase;
    } catch {
      this.loadedFromDatabase = false;
      return false;
    }
  }

  public isLoadedFromDatabase(): boolean {
    return this.loadedFromDatabase;
  }

  public getAllSchemas(): TableSchema[] {
    return this.tables;
  }

  public getTableSchema(tableName: string): TableSchema | undefined {
    const normalized = tableName.toLowerCase();
    return this.tables.find(table => table.name === normalized);
  }

  /**
   * Selects the subset of tables handed to the model for a given question.
   *
   * The bias is deliberate: the v_* read models are offered alongside the raw
   * tables for most question families, because asking a 7B model to hand-write
   * `students JOIN departments JOIN course_offerings JOIN subjects` is where it
   * starts inventing columns. The view is one scan with the right names already
   * attached. Raw tables are still included so the model can fall back to them
   * for counts and aggregates the view does not expose.
   */
  public getRelevantTables(query: string): string[] {
    const q = query.toLowerCase();
    const relevant = new Set<string>();
    const add = (...tables: string[]) => tables.forEach(table => relevant.add(table));

    if (q.includes('department') || /\b(aiml|cse|ece|mech)\b/.test(q)) add('departments');
    if (q.includes('student') || q.includes('cgpa') || q.includes('backlog') || q.includes('who')) {
      add('students', 'v_student_directory');
    }

    if (q.includes('attendance') || q.includes('absent') || q.includes('present') || q.includes('percentage')
      || q.includes('miss') || q.includes('skip') || q.includes('below 7') || q.includes('below 8')) {
      add('v_attendance_detail', 'v_student_attendance_summary', 'attendance',
        'v_student_directory', 'course_offerings', 'subjects', 'departments', 'students');
    }

    if (q.includes('cgpa') || q.includes('sgpa') || q.includes('gpa') || q.includes('academic')
      || q.includes('grade')) {
      add('v_student_cgpa', 'student_academic_summary', 'semester_results',
        'v_marks_detail', 'v_student_directory', 'students', 'departments');
    }

    // A day, time or period word means the question is genuinely about the
    // schedule. Without one, "who teaches X" is about who is assigned to a
    // subject across ALL semesters, which the timetable cannot answer because
    // it only holds the current semester.
    const scheduleWords = ['timetable', 'schedule', 'class at', 'period', 'monday',
      'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'time'];
    const asksAboutSchedule = scheduleWords.some(word => q.includes(word));

    if (q.includes('faculty') || q.includes('teacher') || q.includes('professor')
      || q.includes('teach') || q.includes('staff') || q.includes('hod') || q.includes('head')) {
      add('faculty', 'faculty_subjects', 'course_offerings', 'subjects', 'sections', 'departments');
      if (asksAboutSchedule) add('v_timetable_detail');
    }

    if (q.includes('subject') || q.includes('course') || q.includes('credit') || q.includes('syllabus')) {
      add('subjects', 'course_offerings', 'faculty', 'sections');
      if (asksAboutSchedule) add('v_timetable_detail');
    }

    if (q.includes('mark') || q.includes('score') || q.includes('result') || q.includes('exam')) {
      add('v_marks_detail', 'student_marks', 'subjects', 'semesters');
    }

    if (q.includes('iat') || q.includes('internal assessment') || q.includes('assessment')) {
      add('v_iat_marks', 'iat_marks', 'v_marks_detail', 'v_student_directory', 'subjects');
    }

    if (q.includes('backlog') || q.includes('arrear') || q.includes('fail')) {
      add('v_backlog_detail', 'backlogs', 'student_academic_summary', 'v_marks_detail',
        'v_student_directory', 'subjects', 'departments');
    }

    if (q.includes('parent') || q.includes('guardian') || q.includes('mother') || q.includes('father')
      || q.includes('contact') || q.includes('address')) {
      add('v_student_directory', 'guardians', 'students', 'departments');
    }

    if (q.includes('hosteller') || q.includes('day scholar') || q.includes('dayscholar')
      || q.includes('residency') || q.includes('residing') || q.includes('hostel') || q.includes('room')) {
      add('v_student_directory', 'v_hostel_allocation', 'hostel_allocations', 'hostel_rooms',
        'hostels', 'students', 'departments');
    }

    if (q.includes('profile') || q.includes('student detail') || q.includes('list students')
      || q.includes('show students') || q.includes('all students') || q.includes('student record')
      || q.includes('contact')) {
      add('v_student_directory', 'students', 'departments');
    }

    if (q.includes('fee') || q.includes('fees') || q.includes('tuition') || q.includes('pending')
      || q.includes('paid') || q.includes('payment') || q.includes('unpaid') || q.includes('due')
      || q.includes('scholarship')) {
      // The flattened read model is offered alone by default. The base tables
      // student_fees and fee_structure sit in the same schema block, the model
      // reaches for the one whose name matches the question, and then asks it
      // for amount_pending — a column only the view has. That is the same
      // failure the timetable branch below prevents by withholding raw tables.
      add('v_fee_status', 'v_student_directory', 'academic_years');
      // The raw tables come back only when the question is actually about the
      // ledger or the published tariff rather than about a balance.
      if (q.includes('payment') || q.includes('receipt') || q.includes('transaction')
        || q.includes('when ') || q.includes('date') || q.includes('discount') || q.includes('concession')) {
        add('student_fees', 'fee_payments', 'fee_types');
      }
      if (q.includes('structure') || q.includes('fee type') || q.includes('how much is the')
        || q.includes('tariff') || q.includes('per year') || q.includes('per semester')) {
        add('fee_structure', 'fee_types');
      }
    }

    // For a genuine schedule question, offer ONLY the flattened read model.
    // The raw timetable / weekdays / period_slots trio is deliberately withheld
    // here: the model reaches for it, then writes day_number and period_number
    // against a table whose real columns are weekday_id and period_id, and the
    // query fails on an undefined column.
    if (asksAboutSchedule) {
      add('v_timetable_detail', 'v_student_directory', 'sections', 'departments');
    }

    if (q.includes('enrol') || q.includes('enroll') || q.includes('taking') || q.includes('registered')) {
      add('student_enrollments', 'course_offerings', 'v_student_directory', 'subjects');
    }

    if (q.includes('section') || q.includes('batch') || q.includes('semester')
      || q.includes('year of study') || q.includes('program') || q.includes('programme')) {
      add('sections', 'batches', 'semesters', 'years_of_study', 'programs', 'academic_years',
        'v_student_directory');
    }

    if (q.includes('classroom') || q.includes('room') || q.includes('lab') || q.includes('laboratory')) {
      add('classrooms', 'departments');
      if (asksAboutSchedule) add('v_timetable_detail');
    }

    if (q.includes('warden') || q.includes('hostel')) {
      add('hostels', 'faculty', 'v_hostel_allocation');
    }

    if (relevant.size === 0) {
      add('v_student_directory', 'student_academic_summary', 'departments', 'v_marks_detail',
        'v_attendance_detail', 'v_timetable_detail', 'v_fee_status');
    }
    return INSTITUTION_TABLE_NAMES.filter(table => relevant.has(table));
  }

  /**
   * A one-line description of each read model that is actually part of THIS
   * question's schema selection.
   *
   * The system prompt uses this instead of a fixed list. A fixed list lets the
   * model recall and use a view that was deliberately withheld because it would
   * give the wrong answer, and it then does exactly that: "who teaches DBMS"
   * reaching for the current-semester-only timetable is precisely this failure.
   * Naming only the read models that were supplied removes the temptation.
   */
  public getRelevantReadModelGuide(query: string): string {
    const supplied = new Set(this.getRelevantTables(query));
    const guide: string[] = [];
    for (const table of this.tables) {
      if (!supplied.has(table.name)) continue;
      if (!/^(v_|student_academic_summary$)/.test(table.name)) continue;
      const firstSentence = table.description.split('.')[0].trim();
      guide.push(`  ${table.name} - ${firstSentence}.`);
    }
    return guide.join('\n');
  }

  public getRelevantSchemaPrompt(query: string): string {
    const relevantTables = this.getRelevantTables(query);
    const tableSet = new Set(relevantTables);
    const schemaText = relevantTables
      .map(name => this.getTableSchema(name))
      .filter((table): table is TableSchema => Boolean(table))
      .map(table => {
        const columns = table.columns
          .map(column => `  - ${column.name} (${column.type})${column.isPrimary ? ' PRIMARY KEY' : ''}${column.references ? ` REFERENCES ${column.references.table}(${column.references.field})` : ''}: ${column.description}`)
          .join('\n');
        return `Table: ${table.name}\nDescription: ${table.description}\nColumns:\n${columns}`;
      })
      .join('\n\n');

    const relevantRels = this.getRelationships().filter(rel => tableSet.has(rel.from) && tableSet.has(rel.to));
    const relsText = relevantRels.length > 0
      ? `\n\nForeign Key Relationships for JOIN:\n${relevantRels.map(r => `- ${r.foreignKey}`).join('\n')}`
      : '';

    return schemaText + relsText;
  }

  public getRelationships() {
    return [
      { from: 'departments', to: 'students', relation: 'one-to-many', foreignKey: 'departments.department_id = students.department_id' },
      { from: 'departments', to: 'faculty', relation: 'one-to-many', foreignKey: 'departments.department_id = faculty.department_id' },
      { from: 'departments', to: 'subjects', relation: 'one-to-many', foreignKey: 'departments.department_id = subjects.department_id' },
      { from: 'departments', to: 'programs', relation: 'one-to-many', foreignKey: 'departments.department_id = programs.department_id' },
      { from: 'departments', to: 'sections', relation: 'one-to-many', foreignKey: 'departments.department_id = sections.department_id' },

      { from: 'programs', to: 'batches', relation: 'one-to-many', foreignKey: 'programs.program_id = batches.program_id' },
      { from: 'batches', to: 'sections', relation: 'one-to-many', foreignKey: 'batches.batch_id = sections.batch_id' },
      { from: 'batches', to: 'students', relation: 'one-to-many', foreignKey: 'batches.batch_id = students.batch_id' },
      { from: 'years_of_study', to: 'sections', relation: 'one-to-many', foreignKey: 'years_of_study.year_of_study_id = sections.year_of_study_id' },
      { from: 'sections', to: 'students', relation: 'one-to-many', foreignKey: 'sections.section_id = students.section_id' },
      { from: 'semesters', to: 'students', relation: 'one-to-many', foreignKey: 'semesters.semester_id = students.current_semester_id' },
      { from: 'semesters', to: 'subjects', relation: 'one-to-many', foreignKey: 'semesters.semester_id = subjects.semester_id' },

      // Parents. One row per relationship type per student.
      { from: 'guardians', to: 'students', relation: 'one-to-many', foreignKey: 'guardians.student_id = students.student_id' },
      { from: 'faculty', to: 'faculty_subjects', relation: 'one-to-many', foreignKey: 'faculty.faculty_id = faculty_subjects.faculty_id' },
      { from: 'subjects', to: 'faculty_subjects', relation: 'one-to-many', foreignKey: 'subjects.subject_id = faculty_subjects.subject_id' },

      // The offering bridge: subject + section + academic year, taught by one
      // faculty member. Every assessment table hangs off offering_id.
      { from: 'subjects', to: 'course_offerings', relation: 'one-to-many', foreignKey: 'subjects.subject_id = course_offerings.subject_id' },
      { from: 'sections', to: 'course_offerings', relation: 'one-to-many', foreignKey: 'sections.section_id = course_offerings.section_id' },
      { from: 'faculty', to: 'course_offerings', relation: 'one-to-many', foreignKey: 'faculty.faculty_id = course_offerings.faculty_id' },
      { from: 'students', to: 'student_enrollments', relation: 'one-to-many', foreignKey: 'students.student_id = student_enrollments.student_id' },
      { from: 'course_offerings', to: 'student_enrollments', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = student_enrollments.offering_id' },

      { from: 'students', to: 'student_marks', relation: 'one-to-many', foreignKey: 'students.student_id = student_marks.student_id' },
      { from: 'course_offerings', to: 'student_marks', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = student_marks.offering_id' },
      { from: 'students', to: 'iat_marks', relation: 'one-to-many', foreignKey: 'students.student_id = iat_marks.student_id' },
      { from: 'course_offerings', to: 'iat_marks', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = iat_marks.offering_id' },
      { from: 'students', to: 'attendance', relation: 'one-to-many', foreignKey: 'students.student_id = attendance.student_id' },
      { from: 'course_offerings', to: 'attendance', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = attendance.offering_id' },
      { from: 'students', to: 'semester_results', relation: 'one-to-many', foreignKey: 'students.student_id = semester_results.student_id' },
      { from: 'semesters', to: 'semester_results', relation: 'one-to-many', foreignKey: 'semesters.semester_id = semester_results.semester_id' },
      { from: 'students', to: 'backlogs', relation: 'one-to-many', foreignKey: 'students.student_id = backlogs.student_id' },
      { from: 'subjects', to: 'backlogs', relation: 'one-to-many', foreignKey: 'subjects.subject_id = backlogs.subject_id' },
      { from: 'semesters', to: 'backlogs', relation: 'one-to-many', foreignKey: 'semesters.semester_id = backlogs.semester_id' },

      // Timetable
      { from: 'sections', to: 'timetable', relation: 'one-to-many', foreignKey: 'sections.section_id = timetable.section_id' },
      { from: 'course_offerings', to: 'timetable', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = timetable.offering_id' },
      { from: 'faculty', to: 'timetable', relation: 'one-to-many', foreignKey: 'faculty.faculty_id = timetable.faculty_id' },
      { from: 'weekdays', to: 'timetable', relation: 'one-to-many', foreignKey: 'weekdays.weekday_id = timetable.weekday_id' },
      { from: 'period_slots', to: 'timetable', relation: 'one-to-many', foreignKey: 'period_slots.period_id = timetable.period_id' },
      { from: 'classrooms', to: 'timetable', relation: 'one-to-many', foreignKey: 'classrooms.classroom_id = timetable.classroom_id' },

      // Fees
      { from: 'fee_types', to: 'fee_structure', relation: 'one-to-many', foreignKey: 'fee_types.fee_type_id = fee_structure.fee_type_id' },
      { from: 'fee_types', to: 'student_fees', relation: 'one-to-many', foreignKey: 'fee_types.fee_type_id = student_fees.fee_type_id' },
      { from: 'students', to: 'student_fees', relation: 'one-to-many', foreignKey: 'students.student_id = student_fees.student_id' },
      { from: 'academic_years', to: 'student_fees', relation: 'one-to-many', foreignKey: 'academic_years.academic_year_id = student_fees.academic_year_id' },
      { from: 'student_fees', to: 'fee_payments', relation: 'one-to-many', foreignKey: 'student_fees.student_fee_id = fee_payments.student_fee_id' },

      // Hostel
      { from: 'hostels', to: 'hostel_rooms', relation: 'one-to-many', foreignKey: 'hostels.hostel_id = hostel_rooms.hostel_id' },
      { from: 'students', to: 'hostel_allocations', relation: 'one-to-many', foreignKey: 'students.student_id = hostel_allocations.student_id' },
      { from: 'hostel_rooms', to: 'hostel_allocations', relation: 'one-to-many', foreignKey: 'hostel_rooms.room_id = hostel_allocations.room_id' },

      // The read models join on student_id and offering_id. They already carry
      // their context columns, so a question spanning two of them normally needs
      // no join at all — which is the point of having them.
      { from: 'v_student_directory', to: 'student_academic_summary', relation: 'one-to-one', foreignKey: 'v_student_directory.student_id = student_academic_summary.student_id' },
      { from: 'v_marks_detail', to: 'v_student_cgpa', relation: 'one-to-many', foreignKey: 'v_marks_detail.student_id = v_student_cgpa.student_id AND v_marks_detail.semester_id = v_student_cgpa.semester_id' },
      { from: 'v_attendance_detail', to: 'v_student_attendance_summary', relation: 'one-to-one', foreignKey: 'v_attendance_detail.student_id = v_student_attendance_summary.student_id' },
    ];
  }
}

export const schemaService = new SchemaService();
