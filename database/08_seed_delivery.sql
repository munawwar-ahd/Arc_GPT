-- ============================================================================
-- ArcGPT — 08_seed_delivery.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Course offerings, faculty assignment, the weekly timetable and student
-- subject enrolment.
--
-- Which academic year a semester falls in
-- ---------------------------------------
--   academic year of semester s  =  admission_year + floor((s - 1) / 2)
--
--   batch 2021: sem 1,2 -> 2021-22 | 3,4 -> 2022-23 | 5,6 -> 2023-24 | 7,8 -> 2024-25
--   batch 2024: sem 1,2 -> 2024-25
--
-- A student currently in year N has therefore completed semesters 1..(2N-1)
-- and is sitting 2N. No offering, mark or result is ever created for a
-- semester the student has not reached.
--
-- Timetable feasibility
-- ---------------------
-- Every section keeps the SAME ordered list of 30 weekly slots (5 days x 6
-- periods). Subject position k meets at slots k+1, k+13 and k+25, which are
-- disjoint, so a section is never double-booked. Because the slot list is
-- identical for every section, a given absolute slot always holds the same
-- subject position k for all sections, so mapping faculty as
-- (section_ordinal + 3k) mod 8 is injective in the section ordinal — neither a
-- section nor a faculty member is ever double-booked. The
-- uq_timetable_faculty_slot index would reject the build if either happened.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 08_seed_delivery.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.arc_rand(p_seed TEXT, p_lo INT, p_hi INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_lo + abs(('x' || substr(md5(p_seed), 1, 8))::bit(32)::int) % (p_hi - p_lo + 1);
$$;

-- ---------------------------------------------------------------------------
-- Reusable derived sets
--
-- _slot is the full weekly grid: 5 days (Mon..Fri) x 6 periods = 30 slots,
-- ordered by day then period, so slot_pos 1..6 is Monday, 7..12 Tuesday, and
-- so on. Subject position k meets three times a week, at slots k+1, k+13 and
-- k+25 — i.e. the same period on Monday, Wednesday and Friday. Those three
-- ranges are disjoint, so no subject is ever double-booked within a section.
--
-- Because the slot list is identical for every section, a given absolute slot
-- always holds the same subject position k for all sections, which is what
-- makes the faculty mapping below conflict-free.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _slot AS
SELECT row_number() OVER (ORDER BY w, p) AS slot_pos,
       w::smallint AS weekday_id,
       p::smallint AS period_id
FROM generate_series(1, 6) AS p(p), generate_series(1, 5) AS w(w);

CREATE TEMP TABLE _dept_faculty AS
SELECT f.faculty_id, f.department_id,
       row_number() OVER (PARTITION BY f.department_id ORDER BY f.employee_id) AS fidx
FROM public.faculty f;

CREATE TEMP TABLE _sections AS
SELECT s.section_id, s.department_id, s.batch_id,
       b.admission_year, yos.year_number,
       row_number() OVER (PARTITION BY s.department_id ORDER BY b.admission_year, s.section_code) AS sect_ordinal
FROM public.sections s
JOIN public.batches b      ON b.batch_id = s.batch_id
JOIN public.years_of_study yos ON yos.year_of_study_id = s.year_of_study_id;

-- ---------------------------------------------------------------------------
-- Course offerings
-- One row per (subject, section, academic year) for every semester the section
-- has actually reached. The faculty member is assigned here and reused by the
-- timetable, so "who teaches this" is always consistent.
-- ---------------------------------------------------------------------------
INSERT INTO public.course_offerings
    (subject_id, section_id, academic_year_id, faculty_id, delivery_mode)
SELECT
    sub.subject_id,
    sec.section_id,
    ay.academic_year_id,
    df.faculty_id,
    CASE WHEN (sec.sect_ordinal + pos.subject_ordinal) % 7 = 0
         THEN 'BLENDED' ELSE 'CLASSROOM' END
FROM _sections sec
JOIN public.subjects sub
     ON sub.department_id = sec.department_id
    AND sub.semester_id IN (
        SELECT sem.semester_id FROM public.semesters sem
        WHERE sem.semester_number <= sec.year_number * 2
    )
JOIN public.semesters sem        ON sem.semester_id = sub.semester_id
-- The academic year in which THIS semester was actually delivered.
JOIN public.academic_years ay
     ON ay.start_year = sec.admission_year + ((sem.semester_number - 1) / 2)
-- 0-based position of this subject within its department+semester list.
-- A correlated COUNT (an aggregate) returns exactly one row; row_number()
-- would return one row per sibling subject and multiply the offering.
CROSS JOIN LATERAL (
    SELECT count(*)::int AS subject_ordinal
    FROM public.subjects sub2
    WHERE sub2.department_id = sec.department_id
      AND sub2.semester_id = sub.semester_id
      AND sub2.subject_code < sub.subject_code
) pos
JOIN _dept_faculty df
     ON df.department_id = sec.department_id
    -- Both operands are >= 0, so % stays non-negative. (Subtracting 1 here
    -- would make the first subject in a semester produce a negative modulo,
    -- which matches no faculty row and silently drops that offering.)
    AND df.fidx = ((sec.sect_ordinal + 3 * pos.subject_ordinal) % 8) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM public.course_offerings co
    WHERE co.subject_id = sub.subject_id
      AND co.section_id = sec.section_id
      AND co.academic_year_id = ay.academic_year_id
);

-- ---------------------------------------------------------------------------
-- Faculty <-> subject handles
-- Derived from what they actually teach, so the two can never disagree.
-- ---------------------------------------------------------------------------
INSERT INTO public.faculty_subjects (faculty_id, subject_id, is_primary)
SELECT DISTINCT co.faculty_id, co.subject_id, TRUE
FROM public.course_offerings co
WHERE co.faculty_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.faculty_subjects fs
      WHERE fs.faculty_id = co.faculty_id AND fs.subject_id = co.subject_id
  );

-- ---------------------------------------------------------------------------
-- Weekly timetable — current semester only, which is what a live college has.
-- ---------------------------------------------------------------------------
INSERT INTO public.timetable
    (offering_id, section_id, faculty_id, classroom_id, weekday_id, period_id,
     academic_year_id, effective_from, effective_to)
SELECT
    co.offering_id,
    co.section_id,
    co.faculty_id,
    cr.classroom_id,
    sl.weekday_id,
    sl.period_id,
    co.academic_year_id,
    DATE '2025-06-01',
    DATE '2025-11-30'
FROM public.course_offerings co
JOIN public.sections sec   ON sec.section_id = co.section_id
JOIN _sections secx        ON secx.section_id = sec.section_id
JOIN public.subjects sub   ON sub.subject_id = co.subject_id
JOIN public.semesters sem  ON sem.semester_id = sub.semester_id
-- Only the semester the section is currently sitting.
CROSS JOIN LATERAL (
    SELECT count(*)::int AS k
    FROM public.subjects sub2
    WHERE sub2.department_id = secx.department_id
      AND sub2.semester_id = sub.semester_id
      AND sub2.subject_code < sub.subject_code
) pos
-- Three meetings a week: the same period on Monday, Wednesday and Friday.
CROSS JOIN LATERAL (
    SELECT s.weekday_id, s.period_id
    FROM _slot s
    WHERE s.slot_pos IN (pos.k + 1, pos.k + 13, pos.k + 25)
) sl
-- Classroom: labs get a lab, theory gets a classroom in the same department.
LEFT JOIN LATERAL (
    SELECT c.classroom_id
    FROM public.classrooms c
    WHERE c.department_id = sec.department_id
      AND c.room_type = CASE WHEN sub.subject_type IN ('LAB', 'THEORY_LAB', 'PROJECT')
                             THEN 'LAB' ELSE 'CLASSROOM' END
    ORDER BY c.room_code
    OFFSET (secx.sect_ordinal + pos.k) % 2
    LIMIT 1
) cr ON TRUE
WHERE sem.semester_number = secx.year_number * 2
  AND NOT EXISTS (
    SELECT 1 FROM public.timetable t
    WHERE t.offering_id = co.offering_id
      AND t.weekday_id = sl.weekday_id
      AND t.period_id = sl.period_id
);

-- ---------------------------------------------------------------------------
-- Student enrolments — which student is taking which offered subject.
-- Replaces any "subjects = 'a,b,c'" column with real relational records.
-- ---------------------------------------------------------------------------
INSERT INTO public.student_enrollments (student_id, offering_id, enrolled_on, status)
SELECT
    st.student_id,
    co.offering_id,
    st.admission_date,
    CASE
        WHEN sem.semester_number < cur.semester_number THEN 'COMPLETED'
        ELSE 'ENROLLED'
    END
FROM public.students st
JOIN public.semesters cur      ON cur.semester_id = st.current_semester_id
JOIN public.sections sec       ON sec.section_id = st.section_id
JOIN public.course_offerings co ON co.section_id = sec.section_id
JOIN public.subjects sub        ON sub.subject_id = co.subject_id
JOIN public.semesters sem       ON sem.semester_id = sub.semester_id
WHERE sem.semester_number <= cur.semester_number
  AND NOT EXISTS (
      SELECT 1 FROM public.student_enrollments se
      WHERE se.student_id = st.student_id AND se.offering_id = co.offering_id
  );
