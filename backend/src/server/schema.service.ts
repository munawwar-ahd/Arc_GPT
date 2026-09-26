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

const DEFAULT_TABLES: TableSchema[] = [
  defineTable('departments', 'Academic departments.', [
    { name: 'department_id', type: 'UUID', description: 'Department identifier', primary: true },
    { name: 'department_code', type: 'VARCHAR', description: 'Short department code' },
    { name: 'department_name', type: 'VARCHAR', description: 'Department name' },
  ]),
  defineTable('programs', 'Degree programs.', [
    { name: 'program_id', type: 'UUID', description: 'Program identifier', primary: true },
    { name: 'department_id', type: 'UUID', description: 'Owning department', references: { table: 'departments', field: 'department_id' } },
    { name: 'program_code', type: 'VARCHAR', description: 'Program code' },
    { name: 'program_name', type: 'VARCHAR', description: 'Program name' },
    { name: 'degree_level', type: 'VARCHAR', description: 'Degree level' },
  ]),
  defineTable('batches', 'Student cohorts.', [
    { name: 'batch_id', type: 'UUID', description: 'Batch identifier', primary: true },
    { name: 'program_id', type: 'UUID', description: 'Program', references: { table: 'programs', field: 'program_id' } },
    { name: 'batch_name', type: 'VARCHAR', description: 'Batch name' },
    { name: 'start_year', type: 'INTEGER', description: 'Start year' },
    { name: 'end_year', type: 'INTEGER', description: 'End year' },
  ]),
  defineTable('academic_years', 'Academic calendar years.', [
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year identifier', primary: true },
    { name: 'year_label', type: 'VARCHAR', description: 'Year label' },
    { name: 'is_current', type: 'BOOLEAN', description: 'Whether this is the current year' },
  ]),
  defineTable('semesters', 'Semester calendar records.', [
    { name: 'semester_id', type: 'UUID', description: 'Semester identifier', primary: true },
    { name: 'academic_year_id', type: 'UUID', description: 'Academic year', references: { table: 'academic_years', field: 'academic_year_id' } },
    { name: 'semester_number', type: 'INTEGER', description: 'Semester number' },
    { name: 'semester_name', type: 'VARCHAR', description: 'Semester name' },
    { name: 'start_date', type: 'DATE', description: 'Start date' },
    { name: 'end_date', type: 'DATE', description: 'End date' },
  ]),
  defineTable('sections', 'Student sections.', [
    { name: 'section_id', type: 'UUID', description: 'Section identifier', primary: true },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'batch_id', type: 'UUID', description: 'Batch', references: { table: 'batches', field: 'batch_id' } },
    { name: 'section_name', type: 'VARCHAR', description: 'Section name' },
    { name: 'capacity', type: 'INTEGER', description: 'Section capacity' },
  ]),
  defineTable('students', 'Enrolled students.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true },
    { name: 'register_number', type: 'VARCHAR', description: 'Registration number' },
    { name: 'admission_number', type: 'VARCHAR', description: 'Admission number' },
    { name: 'first_name', type: 'VARCHAR', description: 'First name' },
    { name: 'last_name', type: 'VARCHAR', description: 'Last name' },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'program_id', type: 'UUID', description: 'Program', references: { table: 'programs', field: 'program_id' } },
    { name: 'batch_id', type: 'UUID', description: 'Batch', references: { table: 'batches', field: 'batch_id' } },
    { name: 'section_id', type: 'UUID', description: 'Section', references: { table: 'sections', field: 'section_id' } },
    { name: 'status', type: 'VARCHAR', description: 'Enrollment status' },
  ]),
  defineTable('faculty', 'Faculty members.', [
    { name: 'faculty_id', type: 'UUID', description: 'Faculty identifier', primary: true },
    { name: 'employee_id', type: 'VARCHAR', description: 'Employee identifier' },
    { name: 'first_name', type: 'VARCHAR', description: 'First name' },
    { name: 'last_name', type: 'VARCHAR', description: 'Last name' },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'designation', type: 'VARCHAR', description: 'Designation' },
  ]),
  defineTable('subjects', 'Course subjects.', [
    { name: 'subject_id', type: 'UUID', description: 'Subject identifier', primary: true },
    { name: 'subject_code', type: 'VARCHAR', description: 'Subject code' },
    { name: 'subject_name', type: 'VARCHAR', description: 'Subject name' },
    { name: 'department_id', type: 'UUID', description: 'Owning department', references: { table: 'departments', field: 'department_id' } },
    { name: 'credits', type: 'NUMERIC', description: 'Credit count' },
  ]),
  defineTable('course_offerings', 'Subject offerings.', [
    { name: 'offering_id', type: 'UUID', description: 'Offering identifier', primary: true },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'faculty_id', type: 'UUID', description: 'Faculty', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'section_id', type: 'UUID', description: 'Section', references: { table: 'sections', field: 'section_id' } },
  ]),
  defineTable('attendance', 'Individual attendance records.', [
    { name: 'attendance_id', type: 'UUID', description: 'Attendance identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'attendance_date', type: 'DATE', description: 'Attendance date' },
    { name: 'status', type: 'VARCHAR', description: 'PRESENT, OD, or ABSENT' },
    { name: 'marked_by', type: 'UUID', description: 'Marker identifier' },
  ]),
  defineTable('assessments', 'Assessment components.', [
    { name: 'assessment_id', type: 'UUID', description: 'Assessment identifier', primary: true },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'assessment_name', type: 'VARCHAR', description: 'Assessment name' },
    { name: 'assessment_type', type: 'VARCHAR', description: 'Assessment type' },
    { name: 'max_marks', type: 'NUMERIC', description: 'Maximum marks' },
    { name: 'assessment_date', type: 'DATE', description: 'Assessment date' },
  ]),
  defineTable('student_marks', 'Student assessment marks.', [
    { name: 'mark_id', type: 'UUID', description: 'Mark identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'assessment_id', type: 'UUID', description: 'Assessment', references: { table: 'assessments', field: 'assessment_id' } },
    { name: 'marks_obtained', type: 'NUMERIC', description: 'Marks obtained' },
  ]),
  defineTable('assignments', 'Course assignments.', [
    { name: 'assignment_id', type: 'UUID', description: 'Assignment identifier', primary: true },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'assignment_name', type: 'VARCHAR', description: 'Assignment name' },
    { name: 'due_date', type: 'DATE', description: 'Due date' },
    { name: 'max_marks', type: 'NUMERIC', description: 'Maximum marks' },
  ]),
  defineTable('submissions', 'Assignment submissions.', [
    { name: 'submission_id', type: 'UUID', description: 'Submission identifier', primary: true },
    { name: 'assignment_id', type: 'UUID', description: 'Assignment', references: { table: 'assignments', field: 'assignment_id' } },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'submission_date', type: 'TIMESTAMPTZ', description: 'Submission timestamp' },
    { name: 'status', type: 'VARCHAR', description: 'Submission status' },
  ]),
  defineTable('semester_results', 'Semester results.', [
    { name: 'result_id', type: 'UUID', description: 'Result identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'sgpa', type: 'NUMERIC', description: 'Semester GPA' },
  ]),
  defineTable('student_academic_summary', 'Current academic summaries.', [
    { name: 'summary_id', type: 'UUID', description: 'Summary identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'current_cgpa', type: 'NUMERIC', description: 'Current CGPA' },
    { name: 'current_sgpa', type: 'NUMERIC', description: 'Current SGPA' },
    { name: 'backlog_count', type: 'INTEGER', description: 'Active backlog count' },
  ]),
  defineTable('backlogs', 'Student backlog records.', [
    { name: 'backlog_id', type: 'UUID', description: 'Backlog identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'semester_id', type: 'UUID', description: 'Semester', references: { table: 'semesters', field: 'semester_id' } },
    { name: 'status', type: 'VARCHAR', description: 'Backlog status' },
  ]),
  defineTable('timetable', 'Teaching timetable.', [
    { name: 'timetable_id', type: 'UUID', description: 'Timetable identifier', primary: true },
    { name: 'department_id', type: 'UUID', description: 'Department', references: { table: 'departments', field: 'department_id' } },
    { name: 'subject_id', type: 'UUID', description: 'Subject', references: { table: 'subjects', field: 'subject_id' } },
    { name: 'faculty_id', type: 'UUID', description: 'Faculty', references: { table: 'faculty', field: 'faculty_id' } },
    { name: 'day_of_week', type: 'VARCHAR', description: 'Day' },
    { name: 'time_slot', type: 'VARCHAR', description: 'Time slot' },
  ]),
  defineTable('exams', 'Examination records.', [
    { name: 'exam_id', type: 'UUID', description: 'Exam identifier', primary: true },
    { name: 'offering_id', type: 'UUID', description: 'Course offering', references: { table: 'course_offerings', field: 'offering_id' } },
    { name: 'exam_name', type: 'VARCHAR', description: 'Exam name' },
    { name: 'max_marks', type: 'NUMERIC', description: 'Maximum marks' },
  ]),
  defineTable('exam_schedule', 'Examination schedule.', [
    { name: 'exam_schedule_id', type: 'UUID', description: 'Schedule identifier', primary: true },
    { name: 'exam_id', type: 'UUID', description: 'Exam', references: { table: 'exams', field: 'exam_id' } },
    { name: 'exam_date', type: 'DATE', description: 'Exam date' },
    { name: 'start_time', type: 'VARCHAR', description: 'Start time' },
    { name: 'end_time', type: 'VARCHAR', description: 'End time' },
  ]),
  defineTable('announcements', 'Institution announcements.', [
    { name: 'announcement_id', type: 'UUID', description: 'Announcement identifier', primary: true },
    { name: 'department_id', type: 'UUID', description: 'Target department', references: { table: 'departments', field: 'department_id' } },
    { name: 'title', type: 'VARCHAR', description: 'Title' },
    { name: 'content', type: 'TEXT', description: 'Content' },
    { name: 'published_at', type: 'TIMESTAMPTZ', description: 'Publication time' },
  ]),
  defineTable('placement_drives', 'Placement drives.', [
    { name: 'drive_id', type: 'UUID', description: 'Drive identifier', primary: true },
    { name: 'company_name', type: 'VARCHAR', description: 'Company name' },
    { name: 'job_role', type: 'VARCHAR', description: 'Job role' },
    { name: 'ctc_lpa', type: 'NUMERIC', description: 'Compensation' },
    { name: 'drive_date', type: 'DATE', description: 'Drive date' },
    { name: 'status', type: 'VARCHAR', description: 'Drive status' },
  ]),
  defineTable('placement_applications', 'Placement applications.', [
    { name: 'application_id', type: 'UUID', description: 'Application identifier', primary: true },
    { name: 'drive_id', type: 'UUID', description: 'Drive', references: { table: 'placement_drives', field: 'drive_id' } },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'status', type: 'VARCHAR', description: 'Application status' },
  ]),
  defineTable('hostels', 'Hostel records.', [
    { name: 'hostel_id', type: 'UUID', description: 'Hostel identifier', primary: true },
    { name: 'hostel_name', type: 'VARCHAR', description: 'Hostel name' },
  ]),
  defineTable('rooms', 'Room records.', [
    { name: 'room_id', type: 'UUID', description: 'Room identifier', primary: true },
    { name: 'hostel_id', type: 'UUID', description: 'Hostel', references: { table: 'hostels', field: 'hostel_id' } },
    { name: 'room_number', type: 'VARCHAR', description: 'Room number' },
  ]),
  defineTable('hostel_allocations', 'Hostel allocations.', [
    { name: 'allocation_id', type: 'UUID', description: 'Allocation identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'room_id', type: 'UUID', description: 'Room', references: { table: 'rooms', field: 'room_id' } },
  ]),
  defineTable('books', 'Library books.', [
    { name: 'book_id', type: 'UUID', description: 'Book identifier', primary: true },
    { name: 'title', type: 'VARCHAR', description: 'Book title' },
    { name: 'isbn', type: 'VARCHAR', description: 'ISBN' },
  ]),
  defineTable('library_transactions', 'Library transactions.', [
    { name: 'transaction_id', type: 'UUID', description: 'Transaction identifier', primary: true },
    { name: 'book_id', type: 'UUID', description: 'Book', references: { table: 'books', field: 'book_id' } },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'transaction_type', type: 'VARCHAR', description: 'Issue or return' },
    { name: 'transaction_date', type: 'TIMESTAMPTZ', description: 'Transaction date' },
  ]),
  defineTable('bus_routes', 'Transport routes.', [
    { name: 'route_id', type: 'UUID', description: 'Route identifier', primary: true },
    { name: 'route_name', type: 'VARCHAR', description: 'Route name' },
  ]),
  defineTable('bus_stops', 'Transport stops.', [
    { name: 'stop_id', type: 'UUID', description: 'Stop identifier', primary: true },
    { name: 'route_id', type: 'UUID', description: 'Route', references: { table: 'bus_routes', field: 'route_id' } },
    { name: 'stop_name', type: 'VARCHAR', description: 'Stop name' },
  ]),
  defineTable('student_transport', 'Student transport assignments.', [
    { name: 'transport_id', type: 'UUID', description: 'Assignment identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'route_id', type: 'UUID', description: 'Route', references: { table: 'bus_routes', field: 'route_id' } },
    { name: 'stop_id', type: 'UUID', description: 'Stop', references: { table: 'bus_stops', field: 'stop_id' } },
  ]),
  defineTable('student_attendance_percentage', 'Attendance percentage view when present in PostgreSQL.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true },
    { name: 'register_number', type: 'VARCHAR', description: 'Registration number' },
    { name: 'first_name', type: 'VARCHAR', description: 'First name' },
    { name: 'last_name', type: 'VARCHAR', description: 'Last name' },
    { name: 'department_id', type: 'UUID', description: 'Department identifier' },
    { name: 'department_code', type: 'VARCHAR', description: 'Department code' },
    { name: 'department_name', type: 'VARCHAR', description: 'Department name' },
    { name: 'total_classes', type: 'INTEGER', description: 'Attendance records' },
    { name: 'attended_classes', type: 'INTEGER', description: 'PRESENT and OD records' },
    { name: 'absent_classes', type: 'INTEGER', description: 'ABSENT records' },
    { name: 'attendance_percentage', type: 'NUMERIC', description: 'Attended percentage' },
  ]),

  // --- Student expansion: guardians, residency, consolidated profile -------
  // `student_profile_view` is the convenient read-only projection for
  // natural-language questions. It carries guardian contact, so access to it is
  // role-restricted in sql-validation.service.
  defineTable('guardians', 'Parent or guardian contact records, shared between siblings.', [
    { name: 'guardian_id', type: 'UUID', description: 'Guardian identifier', primary: true },
    { name: 'parent_name', type: 'TEXT', description: 'Guardian full name' },
    { name: 'parent_phone', type: 'VARCHAR', description: 'Guardian phone, stored as text so a leading +91 is preserved' },
    { name: 'parent_address', type: 'TEXT', description: 'Guardian residential address' },
    { name: 'relationship', type: 'TEXT', description: 'FATHER, MOTHER, GUARDIAN, UNCLE, AUNT, SIBLING, LEGAL_GUARDIAN or OTHER' },
    { name: 'email', type: 'TEXT', description: 'Optional guardian email' },
  ]),
  defineTable('student_residency', 'Day scholar or hosteller classification, one row per student.', [
    { name: 'residency_id', type: 'UUID', description: 'Residency identifier', primary: true },
    { name: 'student_id', type: 'UUID', description: 'Student', references: { table: 'students', field: 'student_id' } },
    { name: 'residency_type', type: 'TEXT', description: 'DAY_SCHOLAR or HOSTELLER' },
    { name: 'hostel_id', type: 'UUID', description: 'Hostel for a hosteller; always NULL for a day scholar', references: { table: 'hostels', field: 'hostel_id' } },
    { name: 'room_id', type: 'UUID', description: 'Allocated room; always NULL for a day scholar', references: { table: 'rooms', field: 'room_id' } },
  ]),
  defineTable('student_profile_view', 'Read-only student profile: identity, programme, guardian contact, CGPA, derived active backlog count, residency and status. Prefer this over assembling a profile by hand. Contains no authentication data.', [
    { name: 'student_id', type: 'UUID', description: 'Student identifier', primary: true },
    { name: 'register_number', type: 'VARCHAR', description: 'Registration number' },
    { name: 'admission_number', type: 'VARCHAR', description: 'Admission number' },
    { name: 'student_name', type: 'TEXT', description: 'Full name' },
    { name: 'email', type: 'VARCHAR', description: 'Student email' },
    { name: 'phone', type: 'VARCHAR', description: 'Student phone' },
    { name: 'status', type: 'VARCHAR', description: 'ACTIVE, INACTIVE, ALUMNI or SUSPENDED' },
    { name: 'department_code', type: 'VARCHAR', description: 'Department code' },
    { name: 'department_name', type: 'VARCHAR', description: 'Department name' },
    { name: 'program_code', type: 'VARCHAR', description: 'Programme code' },
    { name: 'batch_name', type: 'VARCHAR', description: 'Batch' },
    { name: 'section_name', type: 'VARCHAR', description: 'Section' },
    { name: 'academic_year', type: 'VARCHAR', description: 'Academic year' },
    { name: 'semester_number', type: 'INTEGER', description: 'Current semester' },
    { name: 'parent_name', type: 'TEXT', description: 'Guardian name' },
    { name: 'parent_phone', type: 'VARCHAR', description: 'Guardian phone' },
    { name: 'parent_address', type: 'TEXT', description: 'Guardian address' },
    { name: 'parent_relationship', type: 'TEXT', description: 'Guardian relationship to the student' },
    { name: 'cgpa', type: 'NUMERIC', description: 'Cumulative GPA, read from student_academic_summary' },
    { name: 'sgpa', type: 'NUMERIC', description: 'Semester GPA' },
    { name: 'current_backlog_count', type: 'INTEGER', description: 'Active backlogs, counted from the backlogs table at query time' },
    { name: 'residency_type', type: 'TEXT', description: 'DAY_SCHOLAR or HOSTELLER' },
    { name: 'hostel_name', type: 'VARCHAR', description: 'Hostel name for a hosteller' },
    { name: 'room_number', type: 'VARCHAR', description: 'Room number for a hosteller' },
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

  public getRelevantTables(query: string): string[] {
    const q = query.toLowerCase();
    const relevant = new Set<string>();
    const add = (...tables: string[]) => tables.forEach(table => relevant.add(table));

    if (q.includes('department') || /\b(aiml|cse|ece|mech|it)\b/.test(q)) add('departments');
    if (q.includes('student') || q.includes('cgpa') || q.includes('backlog') || q.includes('who')) add('students');
    if (q.includes('attendance') || q.includes('absent') || q.includes('present') || q.includes('percentage')) {
      // student_profile_view is included because no single table carries both
      // attendance and student details: attendance lives in
      // student_attendance_percentage, and names/parent/residency live in the
      // profile view. Joining the two on student_id is the correct shape for
      // questions like "which hostellers are below 75%".
      add('attendance', 'student_attendance_percentage', 'student_profile_view', 'course_offerings', 'subjects', 'departments', 'students');
    }
    if (q.includes('cgpa') || q.includes('sgpa') || q.includes('academic') || q.includes('grade')) {
      // student_profile_view is offered alongside the raw tables because it
      // already joins CGPA to the student's name, register number and
      // department. Asking the model to hand-join student_academic_summary to
      // students is where it starts inventing columns like students.department_code.
      add('student_academic_summary', 'student_profile_view', 'students', 'departments');
    }
    if (q.includes('faculty') || q.includes('teacher') || q.includes('professor') || q.includes('teach')) {
      add('faculty', 'course_offerings', 'subjects');
    }
    if (q.includes('subject') || q.includes('course') || q.includes('credit')) add('subjects');
    if (q.includes('mark') || q.includes('score') || q.includes('assessment') || q.includes('exam')) {
      add('assessments', 'student_marks', 'exam_schedule', 'exams');
    }
    if (q.includes('assignment') || q.includes('submission') || q.includes('submitted')) {
      add('assignments', 'submissions', 'students');
    }
    if (q.includes('backlog') || q.includes('arrear')) {
      // Same reasoning as CGPA: the profile view exposes a derived
      // current_backlog_count, so no GROUP BY / HAVING is needed.
      add('backlogs', 'student_profile_view', 'students', 'subjects', 'departments');
    }
    // Guardian / parent questions. `student_profile_view` is preferred because it
    // already joins the guardian, CGPA and residency onto the student.
    if (q.includes('parent') || q.includes('guardian') || q.includes('contact') || q.includes('address')) {
      add('student_profile_view', 'guardians', 'students', 'departments');
    }
    // Day scholar / hosteller questions.
    if (q.includes('hosteller') || q.includes('day scholar') || q.includes('dayscholar') || q.includes('residency') || q.includes('residing')) {
      add('student_residency', 'student_profile_view', 'hostels', 'rooms', 'students', 'departments');
    }
    // A student profile is better read from the consolidated view than from a
    // hand-written five-way join.
    if (q.includes('profile') || q.includes('student detail') || q.includes('list students') || q.includes('show students') || q.includes('all students') || q.includes('student record')) {
      add('student_profile_view', 'students', 'departments');
    }
    if (q.includes('placement') || q.includes('company') || q.includes('drive')) add('placement_drives', 'placement_applications');
    if (q.includes('hostel') || q.includes('room')) add('hostels', 'rooms', 'hostel_allocations');
    if (q.includes('library') || q.includes('book') || q.includes('issue')) add('books', 'library_transactions');
    if (q.includes('bus') || q.includes('transport') || q.includes('route')) add('bus_routes', 'bus_stops', 'student_transport');
    if (q.includes('timetable') || q.includes('schedule')) add('timetable');
    if (q.includes('announcement') || q.includes('notice')) add('announcements');
    if (q.includes('program') || q.includes('batch') || q.includes('semester')) add('programs', 'batches', 'semesters', 'academic_years');
    if (relevant.size === 0) add('departments', 'students', 'course_offerings', 'subjects');
    return INSTITUTION_TABLE_NAMES.filter(table => relevant.has(table));
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
      { from: 'students', to: 'attendance', relation: 'one-to-many', foreignKey: 'students.student_id = attendance.student_id' },
      { from: 'course_offerings', to: 'attendance', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = attendance.offering_id' },
      { from: 'faculty', to: 'course_offerings', relation: 'one-to-many', foreignKey: 'faculty.faculty_id = course_offerings.faculty_id' },
      { from: 'subjects', to: 'course_offerings', relation: 'one-to-many', foreignKey: 'subjects.subject_id = course_offerings.subject_id' },
      { from: 'students', to: 'student_marks', relation: 'one-to-many', foreignKey: 'students.student_id = student_marks.student_id' },
      { from: 'assessments', to: 'student_marks', relation: 'one-to-many', foreignKey: 'assessments.assessment_id = student_marks.assessment_id' },
      { from: 'students', to: 'backlogs', relation: 'one-to-many', foreignKey: 'students.student_id = backlogs.student_id' },
      { from: 'subjects', to: 'backlogs', relation: 'one-to-many', foreignKey: 'subjects.subject_id = backlogs.subject_id' },
      { from: 'students', to: 'student_academic_summary', relation: 'one-to-one', foreignKey: 'students.student_id = student_academic_summary.student_id' },
      { from: 'assignments', to: 'submissions', relation: 'one-to-many', foreignKey: 'assignments.assignment_id = submissions.assignment_id' },
      { from: 'students', to: 'submissions', relation: 'one-to-many', foreignKey: 'students.student_id = submissions.student_id' },
      { from: 'course_offerings', to: 'assignments', relation: 'one-to-many', foreignKey: 'course_offerings.offering_id = assignments.offering_id' },
      // Student expansion. A guardian is shared between siblings, so this is
      // one-to-many; residency is one row per student.
      { from: 'guardians', to: 'students', relation: 'one-to-many', foreignKey: 'guardians.guardian_id = students.parent_id' },
      { from: 'students', to: 'student_residency', relation: 'one-to-one', foreignKey: 'students.student_id = student_residency.student_id' },
      { from: 'hostels', to: 'student_residency', relation: 'one-to-many', foreignKey: 'hostels.hostel_id = student_residency.hostel_id' },
      { from: 'rooms', to: 'student_residency', relation: 'one-to-many', foreignKey: 'rooms.room_id = student_residency.room_id' },
      // The two read-only projections join on student_id. Neither carries the
      // other's columns, so a question spanning both needs this join.
      { from: 'student_attendance_percentage', to: 'student_profile_view', relation: 'one-to-one', foreignKey: 'student_attendance_percentage.student_id = student_profile_view.student_id' },
    ];
  }
}

export const schemaService = new SchemaService();
