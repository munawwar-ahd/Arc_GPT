-- ============================================================================
-- ArcGPT — 09_seed_academic_records.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Marks, IAT, attendance, published semester results and backlogs.
--
-- A latent per-student ability score drives every mark, so the dataset behaves
-- like a real cohort: strong students score well across the board and end up
-- with high CGPA and no backlogs, weak students accumulate failures. Marks are
-- NOT uniform random per row.
--
--   ability = arc_rand('ability' || register_number, 22, 98)
--   subject effect = arc_rand('subject' || subject_code, -12, 8)
--   per-assessment noise = arc_rand(...)
--   percentage = clamp(ability + subject effect + noise, 5, 99)
--
-- Which semesters have data
-- ------------------------
--   completed (semester < current) : marks, IAT, attendance, GPA row, backlogs
--   current     (semester = current) : attendance and IAT only, NO end-sem marks
--   future                          : nothing at all
--
-- So "future semester marks" can never be invented: there is no row to find.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 09_seed_academic_records.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.arc_rand(p_seed TEXT, p_lo INT, p_hi INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_lo + abs(('x' || substr(md5(p_seed), 1, 8))::bit(32)::int) % (p_hi - p_lo + 1);
$$;

-- The student's standing ability, and the percentage they tend to score in a
-- given subject. Shared by the marks and IAT logic.
--
-- Calibrated so the cohort behaves like a real one: roughly 12% of marks are a
-- fail and average CGPA lands around 6.5.
CREATE OR REPLACE FUNCTION pg_temp.arc_pct(p_student TEXT, p_subject TEXT, p_extra TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT LEAST(99, GREATEST(5,
        pg_temp.arc_rand('ability' || p_student, 34, 95)::numeric
      + pg_temp.arc_rand('subjeff' || p_subject, -12, 8)::numeric
      + pg_temp.arc_rand('noise' || p_student || p_subject || p_extra, -9, 9)::numeric
    ))::numeric;
$$;

-- Attendance percentage, on a different scale from marks: a student who
-- averages 65% in exams typically sits around 80% in class. Correlated with
-- ability so the two stay coherent, but deliberately given its own spread so
-- the dataset contains clear high, borderline and chronic-absentee students.
CREATE OR REPLACE FUNCTION pg_temp.arc_att(p_student TEXT, p_subject TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT LEAST(100, GREATEST(42,
        pg_temp.arc_rand('ability' || p_student, 34, 95)::numeric
      + pg_temp.arc_rand('attbias' || p_student || p_subject, 8, 30)::numeric
    ))::numeric;
$$;

-- Percentage -> grade point on a 10-point scale.
CREATE OR REPLACE FUNCTION pg_temp.arc_grade_point(p_pct NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_pct >= 90 THEN 10
        WHEN p_pct >= 80 THEN 9
        WHEN p_pct >= 70 THEN 8
        WHEN p_pct >= 60 THEN 7
        WHEN p_pct >= 50 THEN 6
        WHEN p_pct >= 45 THEN 5
        WHEN p_pct >= 40 THEN 4
        ELSE 0
    END::numeric;
$$;

-- ---------------------------------------------------------------------------
-- End-semester marks — completed semesters only.
-- ---------------------------------------------------------------------------
INSERT INTO public.student_marks
    (student_id, offering_id, theory_max_marks, theory_marks_obtained,
     lab_max_marks, lab_marks_obtained, grade_point, letter_grade,
     result_status, published_at)
SELECT
    s.student_id,
    co.offering_id,
    split.max_theory,
    ROUND(split.max_theory * p.pct / 100.0, 2),
    split.max_lab,
    ROUND(split.max_lab * p.pct / 100.0, 2),
    p.gp,
    CASE p.gp WHEN 10 THEN 'O' WHEN 9 THEN 'A+' WHEN 8 THEN 'A'
              WHEN 7 THEN 'B+' WHEN 6 THEN 'B' WHEN 5 THEN 'B-'
              WHEN 4 THEN 'P' ELSE 'F' END,
    CASE WHEN p.gp >= 4 THEN 'PASS' ELSE 'FAIL' END,
    DATE '2025-06-15'
FROM public.student_enrollments se
JOIN public.students s           ON s.student_id = se.student_id
JOIN public.semesters cur        ON cur.semester_id = s.current_semester_id
JOIN public.course_offerings co  ON co.offering_id = se.offering_id
JOIN public.subjects sub         ON sub.subject_id = co.subject_id
JOIN public.semesters sem        ON sem.semester_id = sub.semester_id
CROSS JOIN LATERAL (
    SELECT
        pg_temp.arc_pct(s.register_number, sub.subject_code, 'end') AS pct,
        pg_temp.arc_grade_point(pg_temp.arc_pct(s.register_number, sub.subject_code, 'end')) AS gp
) p
CROSS JOIN LATERAL (
    SELECT
        CASE sub.subject_type
            WHEN 'THEORY'    THEN 100
            WHEN 'THEORY_LAB' THEN 60
            WHEN 'LAB'        THEN 0
            ELSE 0
        END::numeric AS max_theory,
        CASE sub.subject_type
            WHEN 'THEORY'    THEN 0
            WHEN 'THEORY_LAB' THEN 40
            WHEN 'LAB'        THEN 50
            ELSE 100
        END::numeric AS max_lab
) split
WHERE sem.semester_number < cur.semester_number
  AND NOT EXISTS (
      SELECT 1 FROM public.student_marks m
      WHERE m.student_id = se.student_id AND m.offering_id = se.offering_id
  );

-- ---------------------------------------------------------------------------
-- IAT — Internal Assessment Test 1, 2 and 3, out of 40.
-- Recorded for every enrolled subject, completed and current alike.
-- ---------------------------------------------------------------------------
INSERT INTO public.iat_marks
    (student_id, offering_id, iat_number, max_marks, marks_obtained, exam_date)
SELECT
    se.student_id,
    se.offering_id,
    iat.iat_number,
    40,
    ROUND(40 * pg_temp.arc_pct(s.register_number, sub.subject_code, 'iat' || iat.iat_number) / 100.0, 2),
    DATE '2024-09-15' + ((iat.iat_number * 60 + sem.semester_number * 30)::int)
FROM public.student_enrollments se
JOIN public.students s      ON s.student_id = se.student_id
JOIN public.course_offerings co ON co.offering_id = se.offering_id
JOIN public.subjects sub    ON sub.subject_id = co.subject_id
JOIN public.semesters sem   ON sem.semester_id = sub.semester_id
CROSS JOIN generate_series(1, 3) AS iat(iat_number)
WHERE NOT EXISTS (
    SELECT 1 FROM public.iat_marks im
    WHERE im.student_id = se.student_id
      AND im.offering_id = se.offering_id
      AND im.iat_number = iat.iat_number
);

-- ---------------------------------------------------------------------------
-- Attendance — total classes, attended and absent. Percentage is DERIVED in
-- v_attendance_detail, never stored, so the two can never disagree.
-- Wide spread on purpose: high, average, borderline and poor attenders.
-- ---------------------------------------------------------------------------
INSERT INTO public.attendance
    (student_id, offering_id, total_classes, classes_attended, classes_absent)
SELECT
    se.student_id,
    se.offering_id,
    tot.total_classes,
    att.classes_attended,
    tot.total_classes - att.classes_attended AS classes_absent
FROM public.student_enrollments se
JOIN public.students s      ON s.student_id = se.student_id
JOIN public.course_offerings co ON co.offering_id = se.offering_id
JOIN public.subjects sub    ON sub.subject_id = co.subject_id
CROSS JOIN LATERAL (
    SELECT (32 + pg_temp.arc_rand('classes' || sub.subject_code, 0, 18))::int AS total_classes
) tot
CROSS JOIN LATERAL (
    SELECT LEAST(tot.total_classes,
        ROUND(tot.total_classes
              * pg_temp.arc_att(s.register_number, sub.subject_code) / 100.0
             )::int) AS classes_attended
) att
WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.student_id = se.student_id AND a.offering_id = se.offering_id
);

-- ---------------------------------------------------------------------------
-- Published semester results (GPA + running CGPA) for completed semesters.
-- ---------------------------------------------------------------------------
INSERT INTO public.semester_results
    (student_id, semester_id, academic_year_id, total_credits, credits_earned,
     semester_gpa, cgpa_cumulative, result_status, published_at)
SELECT final.student_id, final.semester_id, final.academic_year_id,
       final.total_credits, final.credits_earned, final.semester_gpa,
       final.cgpa_cumulative, final.result_status, final.published_at
FROM (
    SELECT
        g.student_id,
        g.semester_id,
        g.academic_year_id,
        g.total_credits,
        g.credits_earned,
        ROUND(g.semester_gpa::numeric, 2) AS semester_gpa,
        ROUND(SUM(g.semester_gpa * g.credits_earned) OVER w
              / NULLIF(SUM(g.credits_earned) OVER w, 0)::numeric, 2) AS cgpa_cumulative,
        CASE WHEN g.credits_earned < g.total_credits THEN 'FAIL' ELSE 'PASS' END AS result_status,
        DATE '2025-06-15' AS published_at
    FROM (
        SELECT
            m.student_id,
            sem.semester_id,
            co.academic_year_id,
            COALESCE(SUM(sub.credits), 0)                                     AS total_credits,
            -- SUM over an empty set is NULL, so a semester where nothing was
            -- passed must still produce 0, not NULL.
            COALESCE(SUM(sub.credits) FILTER (WHERE m.result_status = 'PASS'), 0) AS credits_earned,
            COALESCE(
                SUM(sub.credits * m.grade_point)
                    / NULLIF(SUM(sub.credits) FILTER (WHERE m.grade_point > 0), 0),
            0) AS semester_gpa
        FROM public.student_marks m
        JOIN public.course_offerings co ON co.offering_id = m.offering_id
        JOIN public.subjects sub         ON sub.subject_id = co.subject_id
        JOIN public.semesters sem        ON sem.semester_id = sub.semester_id
        GROUP BY m.student_id, sem.semester_id, co.academic_year_id
    ) g
    WINDOW w AS (
        PARTITION BY g.student_id ORDER BY g.semester_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
) final
WHERE NOT EXISTS (
    SELECT 1 FROM public.semester_results sr
    WHERE sr.student_id = final.student_id AND sr.semester_id = final.semester_id
);

-- ---------------------------------------------------------------------------
-- Backlogs — one ACTIVE row per (student, subject) that was failed.
-- A few earlier failures are shown as CLEARED so the table has both states.
-- ---------------------------------------------------------------------------
INSERT INTO public.backlogs
    (student_id, subject_id, semester_id, academic_year_id, attempt_number, status, cleared_on)
SELECT
    b.student_id,
    b.subject_id,
    b.semester_id,
    b.academic_year_id,
    1,
    CASE
        WHEN pg_temp.arc_rand('cleared' || b.student_id || b.subject_id, 1, 100) <= 20
            THEN 'CLEARED'
        ELSE 'ACTIVE'
    END,
    CASE
        WHEN pg_temp.arc_rand('cleared' || b.student_id || b.subject_id, 1, 100) <= 20
            THEN DATE '2025-07-10'
        ELSE NULL
    END
FROM (
    SELECT DISTINCT
        m.student_id,
        sub.subject_id,
        sub.semester_id,
        co.academic_year_id
    FROM public.student_marks m
    JOIN public.course_offerings co ON co.offering_id = m.offering_id
    JOIN public.subjects sub         ON sub.subject_id = co.subject_id
    WHERE m.result_status = 'FAIL'
) b
WHERE NOT EXISTS (
    SELECT 1 FROM public.backlogs bl
    WHERE bl.student_id = b.student_id AND bl.subject_id = b.subject_id
);
