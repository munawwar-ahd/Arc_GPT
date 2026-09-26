-- =============================================================================
-- ArcGPT Local Institution Database Schema + Seed Data
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. ACADEMIC YEARS
CREATE TABLE IF NOT EXISTS public.academic_years (
    academic_year_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_name TEXT NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DEPARTMENTS
CREATE TABLE IF NOT EXISTS public.departments (
    department_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code TEXT NOT NULL UNIQUE,
    department_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROGRAMS
CREATE TABLE IF NOT EXISTS public.programs (
    program_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_code TEXT NOT NULL UNIQUE,
    program_name TEXT NOT NULL,
    department_id UUID REFERENCES public.departments(department_id) ON DELETE CASCADE,
    duration_years INTEGER NOT NULL DEFAULT 4,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. BATCHES
CREATE TABLE IF NOT EXISTS public.batches (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_name TEXT NOT NULL,
    academic_year_id UUID REFERENCES public.academic_years(academic_year_id),
    program_id UUID REFERENCES public.programs(program_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SECTIONS
CREATE TABLE IF NOT EXISTS public.sections (
    section_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_name TEXT NOT NULL,
    batch_id UUID REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SEMESTERS
CREATE TABLE IF NOT EXISTS public.semesters (
    semester_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    semester_number INTEGER NOT NULL,
    academic_year_id UUID REFERENCES public.academic_years(academic_year_id),
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. STUDENTS
CREATE TABLE IF NOT EXISTS public.students (
    student_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    register_number TEXT NOT NULL UNIQUE,
    admission_number TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    department_id UUID REFERENCES public.departments(department_id),
    program_id UUID REFERENCES public.programs(program_id),
    batch_id UUID REFERENCES public.batches(batch_id),
    section_id UUID REFERENCES public.sections(section_id),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ALUMNI', 'SUSPENDED')),
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. FACULTY
CREATE TABLE IF NOT EXISTS public.faculty (
    faculty_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    department_id UUID REFERENCES public.departments(department_id),
    designation TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SUBJECTS
CREATE TABLE IF NOT EXISTS public.subjects (
    subject_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_code TEXT NOT NULL UNIQUE,
    subject_name TEXT NOT NULL,
    department_id UUID REFERENCES public.departments(department_id),
    credits NUMERIC(3,1) NOT NULL DEFAULT 3.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. FACULTY SUBJECTS
CREATE TABLE IF NOT EXISTS public.faculty_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id UUID REFERENCES public.faculty(faculty_id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. COURSE OFFERINGS
CREATE TABLE IF NOT EXISTS public.course_offerings (
    offering_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(faculty_id),
    semester_id UUID REFERENCES public.semesters(semester_id),
    section_id UUID REFERENCES public.sections(section_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ATTENDANCE
CREATE TABLE IF NOT EXISTS public.attendance (
    attendance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    offering_id UUID REFERENCES public.course_offerings(offering_id),
    attendance_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PRESENT', 'OD', 'ABSENT')),
    marked_by UUID REFERENCES public.faculty(faculty_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. ASSESSMENTS
CREATE TABLE IF NOT EXISTS public.assessments (
    assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id UUID REFERENCES public.course_offerings(offering_id) ON DELETE CASCADE,
    assessment_name TEXT NOT NULL,
    assessment_type TEXT NOT NULL,
    max_marks NUMERIC(5,2) NOT NULL DEFAULT 100,
    assessment_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. STUDENT MARKS
CREATE TABLE IF NOT EXISTS public.student_marks (
    mark_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES public.assessments(assessment_id) ON DELETE CASCADE,
    marks_obtained NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id UUID REFERENCES public.course_offerings(offering_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    max_marks NUMERIC(5,2) DEFAULT 20,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID REFERENCES public.assignments(assignment_id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    submission_date TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'GRADED', 'LATE')),
    marks_awarded NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. SEMESTER RESULTS
CREATE TABLE IF NOT EXISTS public.semester_results (
    result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    semester_id UUID REFERENCES public.semesters(semester_id),
    sgpa NUMERIC(4,2) NOT NULL,
    total_credits INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. STUDENT ACADEMIC SUMMARY
CREATE TABLE IF NOT EXISTS public.student_academic_summary (
    summary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID UNIQUE REFERENCES public.students(student_id) ON DELETE CASCADE,
    current_cgpa NUMERIC(4,2) NOT NULL DEFAULT 0.0,
    current_sgpa NUMERIC(4,2) NOT NULL DEFAULT 0.0,
    backlog_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. BACKLOGS
CREATE TABLE IF NOT EXISTS public.backlogs (
    backlog_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(subject_id),
    semester_id UUID REFERENCES public.semesters(semester_id),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLEARED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20. TIMETABLE
CREATE TABLE IF NOT EXISTS public.timetable (
    timetable_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id UUID REFERENCES public.course_offerings(offering_id),
    day_of_week TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. EXAMS
CREATE TABLE IF NOT EXISTS public.exams (
    exam_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_name TEXT NOT NULL,
    semester_id UUID REFERENCES public.semesters(semester_id),
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. EXAM SCHEDULE
CREATE TABLE IF NOT EXISTS public.exam_schedule (
    schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID REFERENCES public.exams(exam_id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(subject_id),
    exam_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 23. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS public.announcements (
    announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    department_id UUID REFERENCES public.departments(department_id),
    posted_by UUID REFERENCES public.faculty(faculty_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 24. PLACEMENT DRIVES
CREATE TABLE IF NOT EXISTS public.placement_drives (
    drive_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    job_role TEXT NOT NULL,
    ctc_lpa NUMERIC(6,2),
    drive_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 25. PLACEMENT APPLICATIONS
CREATE TABLE IF NOT EXISTS public.placement_applications (
    application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id UUID REFERENCES public.placement_drives(drive_id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 26. HOSTELS
CREATE TABLE IF NOT EXISTS public.hostels (
    hostel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_name TEXT NOT NULL UNIQUE,
    hostel_type TEXT CHECK (hostel_type IN ('BOYS', 'GIRLS')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 27. ROOMS
CREATE TABLE IF NOT EXISTS public.rooms (
    room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id UUID REFERENCES public.hostels(hostel_id) ON DELETE CASCADE,
    room_number TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 28. HOSTEL ALLOCATIONS
CREATE TABLE IF NOT EXISTS public.hostel_allocations (
    allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(room_id),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    allocated_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 29. BOOKS
CREATE TABLE IF NOT EXISTS public.books (
    book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    isbn TEXT UNIQUE,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT,
    total_copies INTEGER NOT NULL DEFAULT 5,
    available_copies INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 30. LIBRARY TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.library_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES public.books(book_id),
    student_id UUID REFERENCES public.students(student_id),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL DEFAULT CURRENT_DATE + INTERVAL '14 days',
    return_date DATE,
    status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'RETURNED', 'OVERDUE')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 31. BUS ROUTES
CREATE TABLE IF NOT EXISTS public.bus_routes (
    route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_number TEXT NOT NULL UNIQUE,
    route_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 32. BUS STOPS
CREATE TABLE IF NOT EXISTS public.bus_stops (
    stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID REFERENCES public.bus_routes(route_id) ON DELETE CASCADE,
    stop_name TEXT NOT NULL,
    stop_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 33. STUDENT TRANSPORT
CREATE TABLE IF NOT EXISTS public.student_transport (
    transport_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(student_id) ON DELETE CASCADE,
    route_id UUID REFERENCES public.bus_routes(route_id),
    stop_id UUID REFERENCES public.bus_stops(stop_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ATTENDANCE PERCENTAGE VIEW
CREATE OR REPLACE VIEW public.student_attendance_percentage AS
SELECT
    s.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    s.department_id,
    d.department_code,
    d.department_name,
    COUNT(a.attendance_id)::integer AS total_classes,
    COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) IN ('PRESENT', 'OD'))::integer AS attended_classes,
    COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) = 'ABSENT')::integer AS absent_classes,
    ROUND(
        100.0 * COUNT(a.attendance_id) FILTER (WHERE UPPER(a.status) IN ('PRESENT', 'OD'))
        / NULLIF(COUNT(a.attendance_id), 0),
        2
    ) AS attendance_percentage
FROM public.students s
LEFT JOIN public.departments d ON d.department_id = s.department_id
LEFT JOIN public.attendance a ON a.student_id = s.student_id
GROUP BY s.student_id, s.register_number, s.first_name, s.last_name, s.department_id, d.department_code, d.department_name;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_students_dept ON public.students(department_id);
CREATE INDEX IF NOT EXISTS idx_students_program ON public.students(program_id);
CREATE INDEX IF NOT EXISTS idx_students_batch ON public.students(batch_id);
CREATE INDEX IF NOT EXISTS idx_students_section ON public.students(section_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_offering ON public.attendance(offering_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_subjects_dept ON public.subjects(department_id);
CREATE INDEX IF NOT EXISTS idx_offerings_subj ON public.course_offerings(subject_id);
CREATE INDEX IF NOT EXISTS idx_offerings_faculty ON public.course_offerings(faculty_id);
CREATE INDEX IF NOT EXISTS idx_offerings_sem ON public.course_offerings(semester_id);
CREATE INDEX IF NOT EXISTS idx_student_marks_student ON public.student_marks(student_id);
CREATE INDEX IF NOT EXISTS idx_student_marks_assessment ON public.student_marks(assessment_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_student ON public.backlogs(student_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_status ON public.backlogs(status);
CREATE INDEX IF NOT EXISTS idx_academic_summary_student ON public.student_academic_summary(student_id);
