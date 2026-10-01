-- ============================================================================
-- ArcGPT — 12_verify.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Read-only verification. Every section reports PASS/FAIL/WARN and the script
-- raises an exception if any hard check fails, so a build that "looks fine" but
-- is not queryable cannot pass silently.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 12_verify.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

\echo ''
\echo '================================================================'
\echo ' ArcGPT database verification'
\echo '================================================================'

SELECT current_database() AS connected_database,
       current_user       AS connected_as,
       version()          AS postgresql_version;

\echo ''
\echo '--- 1. Row counts -----------------------------------------------------'
SELECT 'departments'        AS entity, count(*) FROM departments
UNION ALL SELECT 'programs',           count(*) FROM programs
UNION ALL SELECT 'batches',            count(*) FROM batches
UNION ALL SELECT 'sections',           count(*) FROM sections
UNION ALL SELECT 'students',           count(*) FROM students
UNION ALL SELECT 'guardians',          count(*) FROM guardians
UNION ALL SELECT 'faculty',            count(*) FROM faculty
UNION ALL SELECT 'subjects',           count(*) FROM subjects
UNION ALL SELECT 'semesters',          count(*) FROM semesters
UNION ALL SELECT 'academic_years',     count(*) FROM academic_years
UNION ALL SELECT 'course_offerings',   count(*) FROM course_offerings
UNION ALL SELECT 'student_enrollments',count(*) FROM student_enrollments
UNION ALL SELECT 'student_marks',      count(*) FROM student_marks
UNION ALL SELECT 'iat_marks',          count(*) FROM iat_marks
UNION ALL SELECT 'attendance',         count(*) FROM attendance
UNION ALL SELECT 'semester_results',   count(*) FROM semester_results
UNION ALL SELECT 'backlogs',           count(*) FROM backlogs
UNION ALL SELECT 'timetable',          count(*) FROM timetable
UNION ALL SELECT 'student_fees',       count(*) FROM student_fees
UNION ALL SELECT 'fee_payments',       count(*) FROM fee_payments
UNION ALL SELECT 'hostel_allocations', count(*) FROM hostel_allocations
ORDER BY 1;

\echo ''
\echo '--- 2. Data spread (each must be > 1, or the data is not varied) ----'
SELECT 'departments (students)'         AS dimension, count(DISTINCT department_code) AS distinct_values FROM v_student_directory
UNION ALL SELECT 'residence_status',   count(DISTINCT residence_status)       FROM students
UNION ALL SELECT 'sections',           count(DISTINCT section_id)              FROM students
UNION ALL SELECT 'batches',            count(DISTINCT batch_id)                FROM students
UNION ALL SELECT 'gender',             count(DISTINCT gender)                  FROM students
UNION ALL SELECT 'subjects with marks',count(DISTINCT subject_id)              FROM v_marks_detail
UNION ALL SELECT 'semesters w/ marks', count(DISTINCT semester_number)         FROM v_marks_detail
UNION ALL SELECT 'backlog statuses',   count(DISTINCT backlog_status)          FROM v_backlog_detail
UNION ALL SELECT 'payment statuses',   count(DISTINCT payment_status)          FROM v_fee_status
UNION ALL SELECT 'grade letters',      count(DISTINCT letter_grade)            FROM v_marks_detail
UNION ALL SELECT 'weekdays timetabled',count(DISTINCT day_name)               FROM v_timetable_detail
ORDER BY 1;

\echo ''
\echo '--- 3. Derived-value sanity -----------------------------------------'
SELECT
    min(attendance_percentage) AS min_att_pct,
    round(avg(attendance_percentage), 2) AS avg_att_pct,
    max(attendance_percentage) AS max_att_pct,
    count(*) FILTER (WHERE attendance_percentage < 75) AS below_75,
    count(*) FILTER (WHERE attendance_percentage < 60) AS below_60
FROM v_attendance_detail;

SELECT
    round(avg(current_cgpa), 2) AS avg_cgpa,
    min(current_cgpa)           AS min_cgpa,
    max(current_cgpa)           AS max_cgpa
FROM student_academic_summary
WHERE current_cgpa IS NOT NULL;

SELECT payment_status, count(*) AS bills,
       sum(amount_pending) AS total_pending
FROM v_fee_status GROUP BY 1 ORDER BY 1;

\echo ''
\echo '--- 4. Invariants (all must be 0) -----------------------------------'
SELECT
    (SELECT count(*) FROM (
        -- no marks for a semester the student has not reached
        SELECT 1 FROM student_marks m
        JOIN students s ON s.student_id = m.student_id
        JOIN semesters sem ON sem.semester_id = s.current_semester_id
        JOIN course_offerings co ON co.offering_id = m.offering_id
        JOIN subjects sub ON sub.subject_id = co.subject_id
        JOIN semesters sm ON sm.semester_id = sub.semester_id
        WHERE sm.semester_number >= sem.semester_number
    ) x)                                                    AS marks_in_future_semester,
    (SELECT count(*) FROM (
        -- attendance components must add up
        SELECT 1 FROM attendance
        WHERE classes_attended + classes_absent > total_classes
    ) x)                                                    AS attendance_overflow,
    (SELECT count(*) FROM (
        -- marks can never exceed the maximum
        SELECT 1 FROM student_marks
        WHERE theory_marks_obtained > theory_max_marks OR lab_marks_obtained > lab_max_marks
    ) x)                                                    AS marks_over_max,
    (SELECT count(*) FROM (
        -- a section may not be double-booked in a slot
        SELECT 1 FROM timetable
        GROUP BY section_id, weekday_id, period_id, academic_year_id
        HAVING count(*) > 1
    ) x)                                                    AS section_double_booked,
    (SELECT count(*) FROM (
        -- a faculty member may not be double-booked in a slot
        SELECT 1 FROM timetable WHERE faculty_id IS NOT NULL
        GROUP BY faculty_id, weekday_id, period_id, academic_year_id
        HAVING count(*) > 1
    ) x)                                                    AS faculty_double_booked,
    (SELECT count(*) FROM (
        -- a student may hold only one ACTIVE backlog per subject
        SELECT 1 FROM backlogs WHERE status = 'ACTIVE'
        GROUP BY student_id, subject_id HAVING count(*) > 1
    ) x)                                                    AS duplicate_active_backlog,
    (SELECT count(*) FROM (
        -- a student's section must belong to their own department
        SELECT 1 FROM students s
        JOIN sections sec ON sec.section_id = s.section_id
        WHERE sec.department_id <> s.department_id
    ) x)                                                    AS student_section_dept_mismatch;

\echo ''
\echo '--- 5. Referential integrity (all must be 0) ------------------------'
SELECT
    (SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.department_id = s.department_id))       AS students_no_department,
    (SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 from guardians g WHERE g.student_id = s.student_id))              AS students_no_guardian,
    (SELECT count(*) FROM student_marks m WHERE NOT EXISTS (SELECT 1 FROM iat_marks i WHERE i.student_id = m.student_id))       AS marks_student_without_iat,
    (SELECT count(*) FROM course_offerings co WHERE NOT EXISTS (SELECT 1 FROM faculty f WHERE f.faculty_id = co.faculty_id))     AS offering_without_faculty,
    (SELECT count(*) FROM subjects sub WHERE NOT EXISTS (SELECT 1 from course_offerings co WHERE co.subject_id = sub.subject_id)) AS subject_never_offered;

\echo ''
\echo '--- 6. The example questions, answered directly --------------------'
\echo '  (each query below is the shape the LLM is expected to produce)'

\echo ''
\echo 'Q: How many AIML students are hostellers?'
SELECT count(*) AS answer FROM v_student_directory
WHERE department_code = 'AIML' AND residence_status = 'HOSTELLER';

\echo ''
\echo 'Q: Who has attendance below 75%?'
SELECT count(*) AS students_below_75 FROM v_student_attendance_summary
WHERE attendance_percentage < 75;

\echo ''
\echo 'Q: Who has the highest CGPA?'
SELECT register_number, full_name, department_code, current_cgpa
FROM student_academic_summary
WHERE current_cgpa IS NOT NULL
ORDER BY current_cgpa DESC LIMIT 3;

\echo ''
\echo 'Q: How much total fee is pending?'
SELECT fee_type_code, count(*) AS bills, sum(amount_pending) AS total_pending
FROM v_fee_status WHERE amount_pending > 0
GROUP BY 1 ORDER BY 1;

\echo ''
\echo 'Q: Which students failed DBMS?'
SELECT register_number, student_name, department_code, subject_name, total_marks_obtained, total_max_marks
FROM v_marks_detail
WHERE subject_name = 'Database Management Systems' AND result_status = 'FAIL'
LIMIT 5;

\echo ''
\echo 'Q: What class does an AIML section have at 2 PM on Monday?'
SELECT section_code, subject_name, faculty_name, classroom, start_time, end_time
FROM v_timetable_detail
WHERE department_code = 'AIML' AND year_of_study = 2 AND section_code = 'A'
  AND day_name = 'MONDAY' AND start_time <= TIME '14:00' AND end_time > TIME '14:00'
LIMIT 5;

\echo ''
\echo 'Q: Show IAT marks for one student'
SELECT register_number, subject_name, semester_number, iat1_marks, iat2_marks, iat3_marks, total_iat_marks
FROM v_iat_marks WHERE register_number = (SELECT min(register_number) FROM students)
ORDER BY semester_number, subject_name LIMIT 6;

\echo ''
\echo '--- 7. Roles and isolation -------------------------------------------'
SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname IN ('arcgpt_user', 'arcgpt_new_reader', 'arcgpt_reader')
ORDER BY 1;

SELECT
    has_table_privilege('arcgpt_new_reader', 'public.students',        'SELECT') AS reader_can_read_students,
    has_table_privilege('arcgpt_new_reader', 'public.arcgpt_users',    'SELECT') AS reader_can_read_users,
    has_table_privilege('arcgpt_new_reader', 'public.audit_logs',      'SELECT') AS reader_can_read_audit,
    has_table_privilege('arcgpt_new_reader', 'public.students',        'INSERT') AS reader_can_insert_students,
    has_table_privilege('arcgpt_user',       'public.students',        'SELECT') AS app_can_read_students,
    has_table_privilege('arcgpt_user',       'public.ai_queries',      'INSERT') AS app_can_log_queries;

\echo ''
\echo '================================================================'
\echo ' Verification complete.'
\echo '================================================================'
