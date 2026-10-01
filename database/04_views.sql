-- ============================================================================
-- ArcGPT — 04_views.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Read models for the LLM and for the admin dashboards.
--
-- Why these exist: the base tables are correctly normalised, which means the
-- questions the product is asked ("my DBMS attendance in sem 3") need a
-- five-table join. A 7B model gets that wrong. Each view below flattens one
-- question family into a single scan with human-readable column names, so the
-- model can usually answer with ONE table.
--
-- All derived numbers (attendance %, GPA, CGPA, amount paid, amount pending)
-- are COMPUTED here from base tables, so they cannot drift out of sync.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 04_views.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- v_student_directory — one row per student, everything about them.
-- Use this for "list students", "show student details", "who is a hosteller",
-- and for any question that needs the student's name next to their department.
-- Guardians are pivoted into mother_/father_/guardian_ columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_student_directory AS
SELECT
    s.student_id,
    s.register_number,
    s.admission_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)              AS full_name,
    s.gender,
    s.date_of_birth,
    s.phone,
    s.email,
    s.address,
    s.status                                             AS student_status,
    s.admission_date,
    s.residence_status,                                 -- HOSTELLER or DAY_SCHOLAR
    s.department_id,
    d.department_code,
    d.department_name,
    s.program_id,
    pr.program_code,
    pr.program_name,
    pr.degree_level,
    s.batch_id,
    b.batch_code,
    b.admission_year,
    s.section_id,
    sec.section_code,
    sec.section_name,
    s.current_year_of_study_id,
    yos.year_number                                     AS year_of_study,
    yos.year_name                                       AS year_of_study_name,
    s.current_semester_id,
    sem.semester_number                                 AS current_semester_number,
    sem.semester_name                                   AS current_semester_name,
    ay.year_label                                       AS current_academic_year,
    g_mother.guardian_name                              AS mother_name,
    g_mother.phone                                      AS mother_phone,
    g_father.guardian_name                              AS father_name,
    g_father.phone                                      AS father_phone,
    g_guard.guardian_name                               AS guardian_name,
    g_guard.phone                                       AS guardian_phone
FROM public.students s
JOIN public.departments d      ON d.department_id = s.department_id
JOIN public.programs pr        ON pr.program_id = s.program_id
JOIN public.batches b          ON b.batch_id = s.batch_id
JOIN public.sections sec       ON sec.section_id = s.section_id
JOIN public.years_of_study yos ON yos.year_of_study_id = s.current_year_of_study_id
JOIN public.semesters sem      ON sem.semester_id = s.current_semester_id
JOIN public.academic_years ay  ON ay.academic_year_id = sec.academic_year_id
LEFT JOIN public.guardians g_mother ON g_mother.student_id = s.student_id AND g_mother.relation_type = 'MOTHER'
LEFT JOIN public.guardians g_father ON g_father.student_id = s.student_id AND g_father.relation_type = 'FATHER'
LEFT JOIN public.guardians g_guard ON g_guard.student_id = s.student_id AND g_guard.relation_type = 'GUARDIAN';

-- ---------------------------------------------------------------------------
-- v_student_cgpa — GPA and running CGPA DERIVED from published marks.
-- Base of the GPA/CGPA family of questions. One row per student per semester.
--
-- NOTE: this view carries no register_number, full_name or department_code. It
-- is keyed on student_id, and a question naming a student joins
-- v_student_directory on that id. That is deliberate: adding the identifying
-- columns here would duplicate what every other read model already carries, and
-- `src/server/schema.service.ts` declares this view to match exactly what is
-- below. If those columns are ever added, the declared schema and the SQL
-- prompt (fact 5) must change in the same commit, or the model will be told
-- about columns the database does not have.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_student_cgpa AS
WITH subject_grades AS (
    SELECT
        m.student_id,
        sem.semester_id,
        sem.semester_number,
        ay.academic_year_id,
        sub.subject_id,
        sub.credits,
        m.grade_point
    FROM public.student_marks m
    JOIN public.course_offerings co ON co.offering_id = m.offering_id
    JOIN public.subjects sub         ON sub.subject_id = co.subject_id
    JOIN public.semesters sem        ON sem.semester_id = sub.semester_id
    JOIN public.academic_years ay    ON ay.academic_year_id = co.academic_year_id
    WHERE m.grade_point IS NOT NULL
),
semester_totals AS (
    SELECT
        student_id,
        semester_id,
        semester_number,
        academic_year_id,
        SUM(credits)                                          AS total_credits,
        SUM(credits)                                          AS graded_credits,
        SUM(credits * grade_point)
            / NULLIF(SUM(credits), 0)                         AS semester_gpa
    FROM subject_grades
    GROUP BY student_id, semester_id, semester_number, academic_year_id
)
SELECT
    st.student_id,
    st.semester_id,
    st.semester_number,
    st.academic_year_id,
    ay.year_label                                        AS academic_year,
    st.total_credits,
    st.graded_credits,
    ROUND(st.semester_gpa::numeric, 2)                    AS semester_gpa,
    ROUND(
        (SUM(st.semester_gpa * st.graded_credits) OVER w)
        / NULLIF(SUM(st.graded_credits) OVER w, 0)
    , 2)                                                  AS cgpa_cumulative
FROM semester_totals st
JOIN public.academic_years ay ON ay.academic_year_id = st.academic_year_id
WINDOW w AS (
    PARTITION BY st.student_id
    ORDER BY st.semester_number
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
);

-- ---------------------------------------------------------------------------
-- student_academic_summary — one row per student, the academic snapshot.
-- Kept un-prefixed because the admin dashboard's Quick Insights tile reads
-- AVG(current_cgpa) from this name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.student_academic_summary AS
SELECT
    s.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)              AS full_name,
    s.department_id,
    d.department_code,
    d.department_name,
    s.residence_status,
    s.current_year_of_study_id,
    cg.current_cgpa,
    cg.semesters_completed,
    cg.credits_earned,
    COALESCE(bl.current_backlog_count, 0)             AS current_backlog_count,
    COALESCE(bl.total_backlog_count, 0)              AS total_backlog_count,
    att.overall_attendance_percentage,
    att.total_classes,
    att.classes_attended
FROM public.students s
JOIN public.departments d ON d.department_id = s.department_id
LEFT JOIN LATERAL (
    SELECT
        MAX(g.cgpa_cumulative)                        AS current_cgpa,
        COUNT(*)                                      AS semesters_completed,
        SUM(g.graded_credits)                         AS credits_earned
    FROM public.v_student_cgpa g
    WHERE g.student_id = s.student_id
) cg ON TRUE
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE b.status = 'ACTIVE')   AS current_backlog_count,
        COUNT(*)                                      AS total_backlog_count
    FROM public.backlogs b
    WHERE b.student_id = s.student_id
) bl ON TRUE
LEFT JOIN LATERAL (
    SELECT
        ROUND(100.0 * SUM(a.classes_attended) / NULLIF(SUM(a.total_classes), 0), 2)
                                                    AS overall_attendance_percentage,
        SUM(a.total_classes)                         AS total_classes,
        SUM(a.classes_attended)                      AS classes_attended
    FROM public.attendance a
    WHERE a.student_id = s.student_id
) att ON TRUE;

-- ---------------------------------------------------------------------------
-- v_marks_detail — every published mark with its full academic context.
-- Use for "what did I score in DBMS", "semester 3 marks", "who failed X".
-- NOTE: only semesters that have already happened appear here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_marks_detail AS
SELECT
    m.mark_id,
    m.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)          AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    co.section_id,
    sec.section_code,
    sub.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.subject_type,
    sub.credits,
    sem.semester_id,
    sem.semester_number,
    sem.semester_name,
    ay.year_label                                  AS academic_year,
    m.theory_max_marks,
    m.theory_marks_obtained,
    m.lab_max_marks,
    m.lab_marks_obtained,
    (m.theory_marks_obtained + m.lab_marks_obtained)                       AS total_marks_obtained,
    (m.theory_max_marks + m.lab_max_marks)                                 AS total_max_marks,
    ROUND(100.0 * (m.theory_marks_obtained + m.lab_marks_obtained)
          / NULLIF((m.theory_max_marks + m.lab_max_marks), 0), 2)          AS marks_percentage,
    m.grade_point,
    m.letter_grade,
    m.result_status
FROM public.student_marks m
JOIN public.students s            ON s.student_id = m.student_id
JOIN public.departments d         ON d.department_id = s.department_id
JOIN public.course_offerings co   ON co.offering_id = m.offering_id
JOIN public.sections sec          ON sec.section_id = co.section_id
JOIN public.subjects sub          ON sub.subject_id = co.subject_id
JOIN public.semesters sem         ON sem.semester_id = sub.semester_id
JOIN public.academic_years ay     ON ay.academic_year_id = co.academic_year_id;

-- ---------------------------------------------------------------------------
-- v_iat_marks — IAT 1/2/3 pivoted side by side, with total.
-- Use for "show my IAT marks", "IAT 2 in DBMS", "who scored below 40 in IAT 1".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_iat_marks AS
SELECT
    i.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    co.section_id,
    sec.section_code,
    sub.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.credits,
    sem.semester_number,
    sem.semester_name,
    ay.year_label                            AS academic_year,
    MAX(CASE WHEN i.iat_number = 1 THEN i.marks_obtained END) AS iat1_marks,
    MAX(CASE WHEN i.iat_number = 2 THEN i.marks_obtained END) AS iat2_marks,
    MAX(CASE WHEN i.iat_number = 3 THEN i.marks_obtained END) AS iat3_marks,
    MAX(i.max_marks)                                              AS iat_max_marks,
    SUM(i.marks_obtained)                                         AS total_iat_marks,
    ROUND(AVG(i.marks_obtained), 2)                               AS average_iat_marks,
    COUNT(*)                                                      AS iat_count
FROM public.iat_marks i
JOIN public.students s          ON s.student_id = i.student_id
JOIN public.departments d       ON d.department_id = s.department_id
JOIN public.course_offerings co ON co.offering_id = i.offering_id
JOIN public.sections sec        ON sec.section_id = co.section_id
JOIN public.subjects sub        ON sub.subject_id = co.subject_id
JOIN public.semesters sem       ON sem.semester_id = sub.semester_id
JOIN public.academic_years ay   ON ay.academic_year_id = co.academic_year_id
GROUP BY i.student_id, s.register_number, s.first_name, s.last_name,
         s.department_id, d.department_code, d.department_name,
         co.section_id, sec.section_code,
         sub.subject_id, sub.subject_code, sub.subject_name, sub.credits,
         sem.semester_number, sem.semester_name, ay.year_label;

-- ---------------------------------------------------------------------------
-- v_attendance_detail — attendance with the percentage computed here.
-- Use for "my attendance", "my DBMS attendance", "below 75%", "classes missed".
-- The percentage is never stored, so it cannot disagree with the counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_attendance_detail AS
SELECT
    a.attendance_id,
    a.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    s.current_year_of_study_id,
    co.section_id,
    sec.section_code,
    sub.subject_id,
    sub.subject_code,
    sub.subject_name,
    sem.semester_number,
    sem.semester_name,
    ay.year_label                            AS academic_year,
    a.total_classes,
    a.classes_attended,
    a.classes_absent,
    ROUND(100.0 * a.classes_attended / NULLIF(a.total_classes, 0), 2)
                                                AS attendance_percentage,
    ROUND(100.0 * a.classes_absent   / NULLIF(a.total_classes, 0), 2)
                                                AS absence_percentage
FROM public.attendance a
JOIN public.students s          ON s.student_id = a.student_id
JOIN public.departments d       ON d.department_id = s.department_id
JOIN public.course_offerings co ON co.offering_id = a.offering_id
JOIN public.sections sec        ON sec.section_id = co.section_id
JOIN public.subjects sub        ON sub.subject_id = co.subject_id
JOIN public.semesters sem       ON sem.semester_id = sub.semester_id
JOIN public.academic_years ay   ON ay.academic_year_id = co.academic_year_id;

-- Student-level attendance roll-up, for "overall attendance" without GROUP BY.
CREATE OR REPLACE VIEW public.v_student_attendance_summary AS
SELECT
    s.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    SUM(a.total_classes)                      AS total_classes,
    SUM(a.classes_attended)                   AS classes_attended,
    SUM(a.classes_absent)                     AS classes_absent,
    ROUND(100.0 * SUM(a.classes_attended) / NULLIF(SUM(a.total_classes), 0), 2)
                                                AS attendance_percentage,
    MIN(v.attendance_percentage)              AS lowest_subject_percentage
FROM public.students s
JOIN public.departments d       ON d.department_id = s.department_id
LEFT JOIN public.attendance a  ON a.student_id = s.student_id
LEFT JOIN LATERAL (
    SELECT MIN(ad.attendance_percentage) AS attendance_percentage
    FROM public.v_attendance_detail ad
    WHERE ad.student_id = s.student_id
) v ON TRUE
GROUP BY s.student_id, s.register_number, s.first_name, s.last_name,
         s.department_id, d.department_code, d.department_name, v.attendance_percentage;

-- ---------------------------------------------------------------------------
-- v_backlog_detail — active and cleared backlogs with subject context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_backlog_detail AS
SELECT
    b.backlog_id,
    b.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    b.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.credits,
    b.semester_id,
    sem.semester_number                       AS backlog_semester,
    ay.year_label                             AS backlog_academic_year,
    b.attempt_number,
    b.status                                  AS backlog_status,
    b.cleared_on
FROM public.backlogs b
JOIN public.students s       ON s.student_id = b.student_id
JOIN public.departments d    ON d.department_id = s.department_id
JOIN public.subjects sub     ON sub.subject_id = b.subject_id
JOIN public.semesters sem    ON sem.semester_id = b.semester_id
JOIN public.academic_years ay ON ay.academic_year_id = b.academic_year_id;

-- ---------------------------------------------------------------------------
-- v_timetable_detail — the weekly grid, one row per class slot.
-- Use for "what class at 2 PM Monday", "who teaches X", "timetable for 2nd year AIML".
-- day_number 1 = Monday .. 5 = Friday. start_time/end_time are real TIME values.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_timetable_detail AS
SELECT
    t.timetable_id,
    t.section_id,
    sec.section_code,
    sec.section_name,
    sec.department_id,
    d.department_code,
    d.department_name,
    yos.year_number                                       AS year_of_study,
    sub.subject_id,
    sub.subject_code,
    sub.subject_name,
    sub.subject_type,
    sub.credits,
    co.offering_id,
    t.faculty_id,
    f.employee_id                                         AS faculty_employee_id,
    (f.first_name || ' ' || f.last_name)                  AS faculty_name,
    f.designation                                          AS faculty_designation,
    t.classroom_id,
    cr.room_code                                           AS classroom,
    cr.room_type,
    w.weekday_id,
    w.day_number,
    w.day_name,
    p.period_id,
    p.period_number,
    p.period_label,
    p.start_time,
    p.end_time,
    ay.year_label                                          AS academic_year
FROM public.timetable t
JOIN public.sections sec        ON sec.section_id = t.section_id
JOIN public.departments d       ON d.department_id = sec.department_id
JOIN public.years_of_study yos  ON yos.year_of_study_id = sec.year_of_study_id
JOIN public.course_offerings co ON co.offering_id = t.offering_id
JOIN public.subjects sub        ON sub.subject_id = co.subject_id
LEFT JOIN public.faculty f      ON f.faculty_id = t.faculty_id
LEFT JOIN public.classrooms cr  ON cr.classroom_id = t.classroom_id
JOIN public.weekdays w          ON w.weekday_id = t.weekday_id
JOIN public.period_slots p      ON p.period_id = t.period_id
JOIN public.academic_years ay   ON ay.academic_year_id = t.academic_year_id;

-- ---------------------------------------------------------------------------
-- v_fee_status — bills with paid / pending DERIVED from the payment ledger.
-- amount_paid is summed from fee_payments, never hand-typed, so the two can
-- never disagree. Use for "how much fee is pending", "who hasn't paid".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_fee_status AS
SELECT
    sf.student_fee_id,
    sf.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    sf.fee_type_id,
    ft.fee_type_code,
    ft.fee_type_name,
    ft.fee_category,
    sf.academic_year_id,
    ay.year_label                            AS academic_year,
    sf.semester_id,
    sem.semester_number,
    sf.total_amount,
    sf.discount,
    sf.due_date,
    COALESCE(pay.amount_paid, 0)              AS amount_paid,
    GREATEST(sf.total_amount - sf.discount - COALESCE(pay.amount_paid, 0), 0)
                                                AS amount_pending,
    CASE
        WHEN COALESCE(pay.amount_paid, 0) >= (sf.total_amount - sf.discount) THEN 'PAID'
        WHEN COALESCE(pay.amount_paid, 0) = 0                                  THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID'
    END                                       AS payment_status,
    pay.payment_count,
    pay.last_payment_date
FROM public.student_fees sf
JOIN public.students s          ON s.student_id = sf.student_id
JOIN public.departments d       ON d.department_id = s.department_id
JOIN public.fee_types ft        ON ft.fee_type_id = sf.fee_type_id
JOIN public.academic_years ay   ON ay.academic_year_id = sf.academic_year_id
LEFT JOIN public.semesters sem  ON sem.semester_id = sf.semester_id
LEFT JOIN LATERAL (
    SELECT
        SUM(fp.amount)        AS amount_paid,
        COUNT(*)              AS payment_count,
        MAX(fp.payment_date)  AS last_payment_date
    FROM public.fee_payments fp
    WHERE fp.student_fee_id = sf.student_fee_id
) pay ON TRUE;

-- ---------------------------------------------------------------------------
-- v_hostel_allocation — who lives where, with hostel and room names.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_hostel_allocation AS
SELECT
    ha.allocation_id,
    ha.student_id,
    s.register_number,
    s.first_name,
    s.last_name,
    (s.first_name || ' ' || s.last_name)      AS student_name,
    s.department_id,
    d.department_code,
    d.department_name,
    ha.room_id,
    h.hostel_id,
    h.hostel_name,
    h.hostel_type,
    hr.room_number,
    hr.room_type,
    hr.capacity                             AS room_capacity,
    ha.academic_year_id,
    ay.year_label                           AS academic_year,
    ha.allocated_on,
    ha.vacated_on,
    ha.status                               AS allocation_status
FROM public.hostel_allocations ha
JOIN public.students s        ON s.student_id = ha.student_id
JOIN public.departments d     ON d.department_id = s.department_id
JOIN public.hostel_rooms hr   ON hr.room_id = ha.room_id
JOIN public.hostels h         ON h.hostel_id = hr.hostel_id
JOIN public.academic_years ay ON ay.academic_year_id = ha.academic_year_id;
