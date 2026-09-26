-- =============================================================================
-- ArcGPT — Student expansion verification suite (read-only)
-- =============================================================================
-- Every check here is a SELECT. Nothing in this file modifies data.
-- Run with:  psql -d arcgpt_institution -f verify_student_expansion.sql
-- =============================================================================

\pset border 2

\echo ''
\echo '### TEST 1 — total student count'
SELECT COUNT(*) AS total_students,
       COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_students
FROM students;

\echo ''
\echo '### TEST 2 — ACTIVE students per department (expect the configured 50 each)'
SELECT d.department_code,
       d.department_name,
       COUNT(*) FILTER (WHERE s.status = 'ACTIVE') AS active_students
FROM departments d
LEFT JOIN students s ON s.department_id = d.department_id
GROUP BY d.department_code, d.department_name
ORDER BY d.department_code;

\echo ''
\echo '### TEST 3 — duplicate register numbers (expect 0 rows)'
SELECT register_number, COUNT(*) FROM students
GROUP BY register_number HAVING COUNT(*) > 1;

\echo ''
\echo '### TEST 4 — duplicate admission numbers (expect 0 rows)'
SELECT admission_number, COUNT(*) FROM students
WHERE admission_number IS NOT NULL
GROUP BY admission_number HAVING COUNT(*) > 1;

\echo ''
\echo '### TEST 5 — residency split (expect both categories)'
SELECT residency_type,
       COUNT(*) AS students,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM student_residency
GROUP BY residency_type ORDER BY residency_type;

\echo ''
\echo '### TEST 5b — day scholars must never carry a hostel or room'
SELECT COUNT(*) AS violations
FROM student_residency
WHERE residency_type = 'DAY_SCHOLAR' AND (hostel_id IS NOT NULL OR room_id IS NOT NULL);

\echo ''
\echo '### TEST 5c — hostellers must always be placed'
SELECT COUNT(*) AS violations
FROM student_residency
WHERE residency_type = 'HOSTELLER' AND hostel_id IS NULL;

\echo ''
\echo '### TEST 6 — cached backlog_count vs derived count (expect 0)'
SELECT COUNT(*) AS mismatches
FROM student_academic_summary sa
WHERE sa.backlog_count <> (
    SELECT COUNT(*)::int FROM backlogs b
     WHERE b.student_id = sa.student_id AND b.status = 'ACTIVE'
);

\echo ''
\echo '### TEST 6b — backlog distribution (expect a spread, not one value)'
SELECT n AS active_backlogs, COUNT(*) AS students
FROM (
    SELECT s.student_id,
           (SELECT COUNT(*) FROM backlogs b
             WHERE b.student_id = s.student_id AND b.status = 'ACTIVE') AS n
    FROM students s
) t
GROUP BY n ORDER BY n;

\echo ''
\echo '### TEST 7 — CGPA values (expect a wide spread of valid numerics)'
SELECT COUNT(DISTINCT current_cgpa) AS distinct_values,
       MIN(current_cgpa) AS min_cgpa,
       MAX(current_cgpa) AS max_cgpa,
       ROUND(AVG(current_cgpa), 3) AS avg_cgpa,
       COUNT(*) FILTER (WHERE current_cgpa < 5.5 OR current_cgpa > 10) AS out_of_range
FROM student_academic_summary;

\echo ''
\echo '### TEST 7b — CGPA must not be a single fixed value within a department (expect 0)'
SELECT COUNT(*) AS departments_with_one_cgpa
FROM (
    SELECT department_code
    FROM student_profile_view
    GROUP BY department_code
    HAVING COUNT(DISTINCT cgpa) = 1
) t;

\echo ''
\echo '### TEST 8 — parent relationships (expect 0 without a guardian, 0 orphans)'
SELECT
    (SELECT COUNT(*) FROM students WHERE parent_id IS NULL)                          AS students_without_guardian,
    (SELECT COUNT(*) FROM guardians g
      WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.parent_id = g.guardian_id)) AS orphan_guardians,
    (SELECT COUNT(DISTINCT parent_id) FROM students WHERE parent_id IS NOT NULL)      AS distinct_guardians;

\echo ''
\echo '### TEST 8b — shared guardians (siblings modelled, not duplicated)'
SELECT students_per_guardian, COUNT(*) AS guardians
FROM (
    SELECT parent_id, COUNT(*) AS students_per_guardian
    FROM students WHERE parent_id IS NOT NULL GROUP BY parent_id
) t
GROUP BY students_per_guardian ORDER BY students_per_guardian;

\echo ''
\echo '### TEST 8c — parent phone stored as text with the +91 prefix preserved'
SELECT COUNT(*) AS guardians,
       COUNT(*) FILTER (WHERE parent_phone LIKE '+91%') AS with_plus91
FROM guardians;

\echo ''
\echo '### TEST 9 — attendance computed from actual records, spread by student'
SELECT
    CASE
        WHEN attendance_percentage >= 95 THEN '95%+'
        WHEN attendance_percentage >= 85 THEN '85-95%'
        WHEN attendance_percentage >= 75 THEN '75-85%'
        WHEN attendance_percentage >= 60 THEN '60-75%'
        ELSE 'below 60%'
    END AS band,
    COUNT(*) AS students
FROM student_attendance_percentage
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '### TEST 10 — no hardcoded department attendance pattern'
SELECT d.department_name,
       COUNT(*) AS attendance_records,
       ROUND(100.0 * COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'OD')) / COUNT(*), 2) AS pct_attended
FROM attendance a
JOIN students s    ON s.student_id = a.student_id
JOIN departments d ON d.department_id = s.department_id
GROUP BY d.department_name
ORDER BY pct_attended;

\echo ''
\echo '### TEST 10b — the spread itself (expect non-zero stddev: no bias was imposed)'
SELECT ROUND(STDDEV(pct)::numeric, 4) AS stddev_across_departments,
       ROUND(MIN(pct)::numeric, 2)     AS lowest,
       ROUND(MAX(pct)::numeric, 2)     AS highest
FROM (
    SELECT 100.0 * COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'OD')) / COUNT(*) AS pct
    FROM attendance a JOIN students s ON s.student_id = a.student_id
    GROUP BY s.department_id
) t;

\echo ''
\echo '### TEST 10c — CGPA averaged by department (must differ)'
SELECT d.department_code, ROUND(AVG(sa.current_cgpa), 2) AS avg_cgpa
FROM students s
JOIN departments d ON d.department_id = s.department_id
JOIN student_academic_summary sa ON sa.student_id = s.student_id
GROUP BY d.department_code ORDER BY d.department_code;

\echo ''
\echo '### TEST 11 — referential integrity (every column must be 0)'
SELECT
    (SELECT COUNT(*) FROM students s WHERE s.department_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.department_id = s.department_id))    AS bad_department_fk,
    (SELECT COUNT(*) FROM students s WHERE s.program_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM programs p WHERE p.program_id = s.program_id))             AS bad_program_fk,
    (SELECT COUNT(*) FROM students s WHERE s.batch_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.batch_id = s.batch_id))                 AS bad_batch_fk,
    (SELECT COUNT(*) FROM students s WHERE s.section_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sections sec WHERE sec.section_id = s.section_id))         AS bad_section_fk,
    (SELECT COUNT(*) FROM students s WHERE s.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM guardians g WHERE g.guardian_id = s.parent_id))            AS bad_parent_fk,
    (SELECT COUNT(*) FROM attendance a WHERE NOT EXISTS
        (SELECT 1 FROM students s WHERE s.student_id = a.student_id))                           AS bad_attendance_student,
    (SELECT COUNT(*) FROM attendance a WHERE NOT EXISTS
        (SELECT 1 FROM course_offerings co WHERE co.offering_id = a.offering_id))                AS bad_attendance_offering,
    (SELECT COUNT(*) FROM backlogs b WHERE NOT EXISTS
        (SELECT 1 FROM subjects sub WHERE sub.subject_id = b.subject_id))                        AS bad_backlog_subject,
    (SELECT COUNT(*) FROM student_residency sr WHERE NOT EXISTS
        (SELECT 1 FROM students s WHERE s.student_id = sr.student_id))                           AS bad_residency_student;

\echo ''
\echo '### TEST 12 — the profile view exposes no authentication material'
SELECT COUNT(*) AS leaked_security_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'student_profile_view'
  AND column_name ~* 'password|secret|token|credential|session|hash';

\echo ''
\echo '### TEST 13 — sample of the expanded dataset'
SELECT register_number, student_name, department_code, cgpa,
       current_backlog_count, residency_type, parent_name, parent_phone
FROM student_profile_view
ORDER BY register_number
LIMIT 10;
