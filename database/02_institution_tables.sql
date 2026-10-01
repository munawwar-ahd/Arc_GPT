-- ============================================================================
-- ArcGPT — 02_institution_tables.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- The college ERP schema. Normalised, no comma-separated values, no repeated
-- facts, no JSON blobs. Derived values (GPA, CGPA, attendance %, fee pending)
-- are either computed in a view or constrained in the database, never hand-typed.
--
-- Design conventions
--   * UUID primary keys, gen_random_uuid()
--   * Business-natural UNIQUE keys (register_number, subject_code, room_code…)
--   * Enum-like closed sets modelled as named CHECK constraints, always TEXT, so
--     the values read as plain literals in generated SQL.
--   * Read paths exposed through the v_* views created in 04_views.sql so the
--     SQL-generation model rarely needs a multi-table join.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 02_institution_tables.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- ===========================================================================
-- 1. ACADEMIC STRUCTURE
-- ===========================================================================

-- Calendar year, e.g. '2024-25'. One is flagged is_current.
CREATE TABLE IF NOT EXISTS public.academic_years (
    academic_year_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_label       TEXT UNIQUE NOT NULL
                     CHECK (year_label ~ '^\d{4}-\d{2}$'),
    start_year       INTEGER NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
    end_year         INTEGER NOT NULL CHECK (end_year = start_year + 1),
    is_current       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Owning academic unit. Nothing stores a department name as free text.
CREATE TABLE IF NOT EXISTS public.departments (
    department_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code TEXT UNIQUE NOT NULL
                    CHECK (department_code ~ '^[A-Z]{2,10}$'),
    department_name TEXT UNIQUE NOT NULL,
    hod_faculty_id  UUID,
    established_year INTEGER,
    email           TEXT,
    phone           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Degree programme, e.g. B.Tech / M.Tech. Owned by a department.
CREATE TABLE IF NOT EXISTS public.programs (
    program_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id  UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    program_code   TEXT UNIQUE NOT NULL,
    program_name   TEXT NOT NULL,
    degree_level   TEXT NOT NULL CHECK (degree_level IN ('UG', 'PG', 'DIPLOMA', 'PHD')),
    duration_years NUMERIC(3,1) NOT NULL CHECK (duration_years > 0)
);

-- Year of study within a programme (1..4 for the seeded undergraduate cohort).
CREATE TABLE IF NOT EXISTS public.years_of_study (
    year_of_study_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_number      SMALLINT UNIQUE NOT NULL CHECK (year_number BETWEEN 1 AND 8),
    year_name        TEXT UNIQUE NOT NULL
);

-- Admission cohort. batch_code is the human label, e.g. 'AIML-2023'.
CREATE TABLE IF NOT EXISTS public.batches (
    batch_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code       TEXT UNIQUE NOT NULL,
    program_id       UUID NOT NULL REFERENCES public.programs(program_id) ON DELETE RESTRICT,
    department_id    UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    admission_year   INTEGER NOT NULL CHECK (admission_year BETWEEN 2000 AND 2100),
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Semester POSITION, not a calendar instance. There are exactly 8 of these and
-- they are shared by every academic year. This is what lets a subject such as
-- DBMS exist as ONE reusable row that is offered in semester 5 of 2022-23 and
-- again in semester 5 of 2024-25. The year-specific "which subject was taught
-- when, to which section" fact lives in course_offerings.academic_year_id.
CREATE TABLE IF NOT EXISTS public.semesters (
    semester_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    semester_number SMALLINT UNIQUE NOT NULL CHECK (semester_number BETWEEN 1 AND 8),
    semester_name   TEXT UNIQUE NOT NULL,
    duration_months SMALLINT NOT NULL DEFAULT 6 CHECK (duration_months > 0)
);

-- A teaching group: one department + one batch + one year of study + one letter.
CREATE TABLE IF NOT EXISTS public.sections (
    section_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_code     TEXT NOT NULL CHECK (section_code ~ '^[A-Z]$'),
    section_name     TEXT NOT NULL,
    department_id    UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    batch_id         UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE RESTRICT,
    year_of_study_id UUID NOT NULL REFERENCES public.years_of_study(year_of_study_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    capacity         INTEGER NOT NULL CHECK (capacity > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, section_code)
);

-- ===========================================================================
-- 2. PEOPLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.faculty (
    faculty_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    TEXT UNIQUE NOT NULL,
    first_name     TEXT NOT NULL,
    last_name      TEXT NOT NULL,
    department_id  UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    designation    TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    phone          TEXT NOT NULL,
    date_of_joined DATE NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.departments
    DROP CONSTRAINT IF EXISTS departments_hod_faculty_id_fkey;
ALTER TABLE public.departments
    ADD CONSTRAINT departments_hod_faculty_id_fkey
    FOREIGN KEY (hod_faculty_id) REFERENCES public.faculty(faculty_id) ON DELETE SET NULL;

-- The student record. register_number is the business key the college uses.
CREATE TABLE IF NOT EXISTS public.students (
    student_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    register_number          TEXT UNIQUE NOT NULL
                             CHECK (register_number ~ '^[A-Z0-9]{6,20}$'),
    admission_number         TEXT UNIQUE NOT NULL,
    first_name               TEXT NOT NULL,
    last_name                TEXT NOT NULL,
    gender                   TEXT NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    date_of_birth            DATE NOT NULL,
    phone                    TEXT NOT NULL,
    email                    TEXT UNIQUE NOT NULL,
    department_id            UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    program_id               UUID NOT NULL REFERENCES public.programs(program_id) ON DELETE RESTRICT,
    batch_id                 UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE RESTRICT,
    section_id               UUID NOT NULL REFERENCES public.sections(section_id) ON DELETE RESTRICT,
    current_year_of_study_id UUID NOT NULL REFERENCES public.years_of_study(year_of_study_id) ON DELETE RESTRICT,
    current_semester_id      UUID NOT NULL REFERENCES public.semesters(semester_id) ON DELETE RESTRICT,
    residence_status         TEXT NOT NULL
                             CHECK (residence_status IN ('HOSTELLER', 'DAY_SCHOLAR')),
    status                   TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'GRADUATED')),
    admission_date           DATE NOT NULL,
    address                  TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A hosteller must be in a section that belongs to the student's own batch.
    CONSTRAINT students_batch_section_consistent
        CHECK (batch_id IS NOT NULL AND section_id IS NOT NULL)
);

-- One row per guardian relationship. Avoids six repeated columns on students
-- while still answering "mother's name / phone" in a single filtered read.
CREATE TABLE IF NOT EXISTS public.guardians (
    guardian_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('MOTHER', 'FATHER', 'GUARDIAN')),
    guardian_name TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         TEXT,
    occupation    TEXT,
    is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One row per relationship type per student.
    UNIQUE (student_id, relation_type)
);

-- ===========================================================================
-- 3. SUBJECTS AND DELIVERY
-- ===========================================================================

-- A subject is defined once and reused by every section and every student.
CREATE TABLE IF NOT EXISTS public.subjects (
    subject_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_code    TEXT UNIQUE NOT NULL
                    CHECK (subject_code ~ '^[A-Z]{2,6}[0-9]{3,4}$'),
    subject_name    TEXT NOT NULL,
    department_id   UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE RESTRICT,
    semester_id     UUID NOT NULL REFERENCES public.semesters(semester_id) ON DELETE RESTRICT,
    credits         NUMERIC(3,1) NOT NULL CHECK (credits > 0 AND credits <= 12),
    subject_type    TEXT NOT NULL
                    CHECK (subject_type IN ('THEORY', 'LAB', 'THEORY_LAB', 'PROJECT')),
    lecture_hours   INTEGER NOT NULL DEFAULT 0 CHECK (lecture_hours >= 0),
    practical_hours INTEGER NOT NULL DEFAULT 0 CHECK (practical_hours >= 0),
    is_elective     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which faculty handle which subjects. Many-to-many bridge between the two
-- people/organisation tables. Declared here because it needs public.subjects.
CREATE TABLE IF NOT EXISTS public.faculty_subjects (
    faculty_subject_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id         UUID NOT NULL REFERENCES public.faculty(faculty_id) ON DELETE CASCADE,
    subject_id         UUID NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (faculty_id, subject_id)
);

-- A subject delivered to a section in an academic year, taught by one faculty
-- member. This is the bridge table that marks, IAT, attendance and timetable
-- all hang off.
CREATE TABLE IF NOT EXISTS public.course_offerings (
    offering_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id       UUID NOT NULL REFERENCES public.subjects(subject_id) ON DELETE RESTRICT,
    section_id       UUID NOT NULL REFERENCES public.sections(section_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    faculty_id       UUID REFERENCES public.faculty(faculty_id) ON DELETE SET NULL,
    delivery_mode    TEXT NOT NULL DEFAULT 'CLASSROOM'
                     CHECK (delivery_mode IN ('CLASSROOM', 'ONLINE', 'BLENDED')),
    UNIQUE (subject_id, section_id, academic_year_id)
);

-- Which student is taking which offered subject. This replaces any
-- "subjects = 'a,b,c'" text column.
CREATE TABLE IF NOT EXISTS public.student_enrollments (
    enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    offering_id   UUID NOT NULL REFERENCES public.course_offerings(offering_id) ON DELETE RESTRICT,
    enrolled_on   DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'ENROLLED'
                  CHECK (status IN ('ENROLLED', 'DROPPED', 'COMPLETED')),
    UNIQUE (student_id, offering_id)
);

-- ===========================================================================
-- 4. ASSESSMENT
-- ===========================================================================

-- End-semester marks. One row per student per offered subject. Only
-- semesters that have actually happened are populated.
CREATE TABLE IF NOT EXISTS public.student_marks (
    mark_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id             UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    offering_id            UUID NOT NULL REFERENCES public.course_offerings(offering_id) ON DELETE RESTRICT,
    theory_max_marks       NUMERIC(6,2) NOT NULL CHECK (theory_max_marks >= 0),
    theory_marks_obtained  NUMERIC(6,2) NOT NULL CHECK (theory_marks_obtained >= 0),
    lab_max_marks          NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (lab_max_marks >= 0),
    lab_marks_obtained     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (lab_marks_obtained >= 0),
    grade_point            NUMERIC(4,2) CHECK (grade_point >= 0 AND grade_point <= 10),
    letter_grade           TEXT,
    result_status          TEXT NOT NULL CHECK (result_status IN ('PASS', 'FAIL')),
    published_at           TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, offering_id),
    -- Obtained marks can never exceed the maximum, per component and overall.
    CONSTRAINT student_marks_theory_within_max
        CHECK (theory_marks_obtained <= theory_max_marks),
    CONSTRAINT student_marks_lab_within_max
        CHECK (lab_marks_obtained <= lab_max_marks)
);

-- Internal Assessment Test: IAT 1, IAT 2, IAT 3, per student + subject.
CREATE TABLE IF NOT EXISTS public.iat_marks (
    iat_mark_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    offering_id    UUID NOT NULL REFERENCES public.course_offerings(offering_id) ON DELETE RESTRICT,
    iat_number     SMALLINT NOT NULL CHECK (iat_number BETWEEN 1 AND 3),
    max_marks      NUMERIC(5,2) NOT NULL DEFAULT 40 CHECK (max_marks > 0),
    marks_obtained NUMERIC(5,2) NOT NULL CHECK (marks_obtained >= 0),
    exam_date      DATE NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, offering_id, iat_number),
    CONSTRAINT iat_marks_within_max CHECK (marks_obtained <= max_marks)
);

-- Published per-semester GPA and the running CGPA. Stored because the college
-- publishes these, but v_student_cgpa recomputes them from marks so the
-- derived value is always available and auditable.
CREATE TABLE IF NOT EXISTS public.semester_results (
    semester_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id         UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    semester_id        UUID NOT NULL REFERENCES public.semesters(semester_id) ON DELETE RESTRICT,
    academic_year_id   UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    total_credits      NUMERIC(5,1) NOT NULL CHECK (total_credits >= 0),
    credits_earned     NUMERIC(5,1) NOT NULL CHECK (credits_earned >= 0),
    semester_gpa       NUMERIC(4,2) CHECK (semester_gpa >= 0 AND semester_gpa <= 10),
    cgpa_cumulative    NUMERIC(4,2) CHECK (cgpa_cumulative >= 0 AND cgpa_cumulative <= 10),
    result_status      TEXT NOT NULL CHECK (result_status IN ('PASS', 'FAIL')),
    published_at       TIMESTAMPTZ,
    UNIQUE (student_id, semester_id)
);

-- An uncleared subject requirement. Never a comma-separated list.
CREATE TABLE IF NOT EXISTS public.backlogs (
    backlog_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    subject_id      UUID NOT NULL REFERENCES public.subjects(subject_id) ON DELETE RESTRICT,
    semester_id     UUID NOT NULL REFERENCES public.semesters(semester_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    attempt_number  SMALLINT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLEARED')),
    cleared_on      DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT backlogs_cleared_needs_date
        CHECK (status <> 'CLEARED' OR cleared_on IS NOT NULL)
);

-- A student can hold at most one ACTIVE backlog per subject.
CREATE UNIQUE INDEX IF NOT EXISTS uq_backlogs_active_per_subject
    ON public.backlogs (student_id, subject_id) WHERE status = 'ACTIVE';

-- ===========================================================================
-- 5. ATTENDANCE
-- ===========================================================================

-- Aggregate per student + offered subject, exactly as the college records it:
-- how many classes were held, attended and missed. Percentage is derived in
-- v_attendance_detail rather than stored, so it can never disagree.
CREATE TABLE IF NOT EXISTS public.attendance (
    attendance_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    offering_id      UUID NOT NULL REFERENCES public.course_offerings(offering_id) ON DELETE RESTRICT,
    total_classes    INTEGER NOT NULL CHECK (total_classes > 0),
    classes_attended INTEGER NOT NULL CHECK (classes_attended >= 0),
    classes_absent   INTEGER NOT NULL CHECK (classes_absent >= 0),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, offering_id),
    -- Present + absent can never exceed the classes actually held.
    CONSTRAINT attendance_components_within_total
        CHECK (classes_attended + classes_absent <= total_classes)
);

-- ===========================================================================
-- 6. TIMETABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.weekdays (
    weekday_id SMALLINT PRIMARY KEY CHECK (weekday_id BETWEEN 1 AND 7),
    day_number SMALLINT UNIQUE NOT NULL CHECK (day_number BETWEEN 1 AND 7),
    day_name   TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.period_slots (
    period_id     SMALLINT PRIMARY KEY CHECK (period_id BETWEEN 1 AND 12),
    period_number SMALLINT UNIQUE NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    period_label  TEXT NOT NULL,
    start_time    TIME NOT NULL,
    end_time      TIME NOT NULL,
    CONSTRAINT period_slots_time_order CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS public.classrooms (
    classroom_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code     TEXT UNIQUE NOT NULL,
    room_type     TEXT NOT NULL DEFAULT 'CLASSROOM'
                  CHECK (room_type IN ('CLASSROOM', 'LAB', 'SEMINAR_HALL', 'AUDITORIUM')),
    capacity      INTEGER NOT NULL CHECK (capacity > 0),
    building      TEXT,
    department_id UUID REFERENCES public.departments(department_id) ON DELETE SET NULL
);

-- One row per (section, weekday, period). A section cannot be double-booked.
CREATE TABLE IF NOT EXISTS public.timetable (
    timetable_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id     UUID NOT NULL REFERENCES public.course_offerings(offering_id) ON DELETE CASCADE,
    section_id      UUID NOT NULL REFERENCES public.sections(section_id) ON DELETE CASCADE,
    faculty_id      UUID REFERENCES public.faculty(faculty_id) ON DELETE SET NULL,
    classroom_id    UUID REFERENCES public.classrooms(classroom_id) ON DELETE SET NULL,
    weekday_id      SMALLINT NOT NULL REFERENCES public.weekdays(weekday_id) ON DELETE RESTRICT,
    period_id       SMALLINT NOT NULL REFERENCES public.period_slots(period_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE CASCADE,
    effective_from  DATE,
    effective_to    DATE,
    UNIQUE (section_id, weekday_id, period_id, academic_year_id)
);

-- A faculty member cannot be in two places at once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_faculty_slot
    ON public.timetable (faculty_id, weekday_id, period_id, academic_year_id)
    WHERE faculty_id IS NOT NULL;

-- ===========================================================================
-- 7. FEES
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.fee_types (
    fee_type_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fee_type_code TEXT UNIQUE NOT NULL
                 CHECK (fee_type_code ~ '^[A-Z_]{3,30}$'),
    fee_type_name TEXT NOT NULL,
    fee_category  TEXT NOT NULL
                 CHECK (fee_category IN ('TUITION', 'HOSTEL', 'EXAM', 'LIBRARY', 'OTHER')),
    is_recurring  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Published amount for a fee type, in a given academic year, for a given
-- department. Fees genuinely differ by department, so the structure is
-- per-department rather than one "everyone pays X" row.
CREATE TABLE IF NOT EXISTS public.fee_structure (
    fee_structure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fee_type_id      UUID NOT NULL REFERENCES public.fee_types(fee_type_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    department_id    UUID NOT NULL REFERENCES public.departments(department_id) ON DELETE CASCADE,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fee_type_id, academic_year_id, department_id)
);

-- One bill per student / fee type / academic year (+ semester where applicable).
-- amount_paid is NOT stored: it is summed from fee_payments in v_fee_status so
-- it can never drift from the payment ledger.
CREATE TABLE IF NOT EXISTS public.student_fees (
    student_fee_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    fee_type_id     UUID NOT NULL REFERENCES public.fee_types(fee_type_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    semester_id     UUID REFERENCES public.semesters(semester_id) ON DELETE RESTRICT,
    total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    due_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT student_fees_discount_within_total CHECK (discount <= total_amount)
);

-- semester_id is nullable, so a plain UNIQUE would not dedupe NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fees_bill
    ON public.student_fees (
        student_id, fee_type_id, academic_year_id,
        COALESCE(semester_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

CREATE TABLE IF NOT EXISTS public.fee_payments (
    payment_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_fee_id UUID NOT NULL REFERENCES public.student_fees(student_fee_id) ON DELETE CASCADE,
    amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date  DATE NOT NULL,
    payment_mode  TEXT NOT NULL DEFAULT 'UPI'
                  CHECK (payment_mode IN ('CASH', 'CARD', 'NETBANKING', 'CHEQUE', 'UPI', 'DD')),
    reference_no  TEXT NOT NULL,
    collected_by  UUID REFERENCES public.faculty(faculty_id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================================
-- 8. HOSTEL (kept out of the student model so it stays extensible)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.hostels (
    hostel_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_name       TEXT UNIQUE NOT NULL,
    hostel_type       TEXT NOT NULL CHECK (hostel_type IN ('BOYS', 'GIRLS')),
    warden_faculty_id UUID REFERENCES public.faculty(faculty_id) ON DELETE SET NULL,
    total_rooms       INTEGER NOT NULL CHECK (total_rooms >= 0),
    address           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.hostel_rooms (
    room_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id     UUID NOT NULL REFERENCES public.hostels(hostel_id) ON DELETE CASCADE,
    room_number   TEXT NOT NULL,
    room_type     TEXT NOT NULL DEFAULT 'SHARED' CHECK (room_type IN ('SEATER', 'SHARED')),
    capacity      INTEGER NOT NULL CHECK (capacity > 0),
    occupied_count INTEGER NOT NULL DEFAULT 0 CHECK (occupied_count >= 0),
    UNIQUE (hostel_id, room_number),
    CONSTRAINT hostel_rooms_occupancy_within_capacity CHECK (occupied_count <= capacity)
);

CREATE TABLE IF NOT EXISTS public.hostel_allocations (
    allocation_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    room_id        UUID NOT NULL REFERENCES public.hostel_rooms(room_id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(academic_year_id) ON DELETE RESTRICT,
    allocated_on   DATE NOT NULL,
    vacated_on     DATE,
    status         TEXT NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN ('ALLOCATED', 'VACATED')),
    UNIQUE (student_id, academic_year_id)
);

-- ===========================================================================
-- 9. Post-constraints
-- ===========================================================================

-- An offering's section must belong to the same department as the subject.
DO $$
DECLARE
    bad_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO bad_count
    FROM public.course_offerings co
    JOIN public.sections sec ON sec.section_id = co.section_id
    JOIN public.subjects sub ON sub.subject_id = co.subject_id
    WHERE sec.department_id <> sub.department_id;
    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Offering/section department mismatch in % row(s)', bad_count;
    END IF;
END
$$;
