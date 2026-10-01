-- ============================================================================
-- ArcGPT — 07_seed_structure_students.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Batches, sections, students and guardians.
--
-- Cohort shape (academic year 2024-25 is current):
--   batch 2021 -> year of study 4, currently in semester 8 (semesters 1-7 done)
--   batch 2022 -> year of study 3, currently in semester 6 (semesters 1-5 done)
--   batch 2023 -> year of study 2, currently in semester 4 (semesters 1-3 done)
--   batch 2024 -> year of study 1, currently in semester 2 (semester 1 done)
-- Semester 9+ does not exist, and no marks are ever written for a semester a
-- student has not reached yet.
--
-- All names are fictional. All contact numbers use the reserved documentation
-- prefix 90000 / 98765 so no real subscriber can be matched.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 07_seed_structure_students.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- Deterministic pseudo-random integer in [lo, hi] keyed on a text seed.
-- md5-based, so the same seed always yields the same value and the dataset is
-- reproducible. Defined in every seed file that needs it so each file can be
-- executed on its own in pgAdmin without depending on a previous session.
CREATE OR REPLACE FUNCTION pg_temp.arc_rand(p_seed TEXT, p_lo INT, p_hi INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_lo + abs(('x' || substr(md5(p_seed), 1, 8))::bit(32)::int) % (p_hi - p_lo + 1);
$$;

-- ---------------------------------------------------------------------------
-- Batches — one admission cohort per department per year
-- ---------------------------------------------------------------------------
INSERT INTO public.batches (batch_code, program_id, department_id, admission_year, academic_year_id)
SELECT
    d.department_code || '-' || b.admission_year,
    pr.program_id,
    d.department_id,
    b.admission_year,
    ay.academic_year_id
FROM (VALUES (2021),(2022),(2023),(2024)) AS b(admission_year)
CROSS JOIN public.departments d
JOIN public.programs pr ON pr.department_id = d.department_id
JOIN public.academic_years ay ON ay.start_year = b.admission_year
WHERE NOT EXISTS (
    SELECT 1 FROM public.batches x WHERE x.batch_code = d.department_code || '-' || b.admission_year
);

-- ---------------------------------------------------------------------------
-- Sections — A and B for every batch, so every department has two sections
-- per year of study (the design must not assume one section per department).
-- ---------------------------------------------------------------------------
INSERT INTO public.sections
    (section_code, section_name, department_id, batch_id, year_of_study_id, academic_year_id, capacity)
SELECT
    sc.section_code,
    d.department_code || '-' || b.admission_year || '-' || sc.section_code,
    d.department_id,
    b.batch_id,
    yos.year_of_study_id,
    ay_current.academic_year_id,
    60
FROM public.batches b
JOIN public.departments d     ON d.department_id = b.department_id
JOIN public.academic_years ay ON ay.academic_year_id = b.academic_year_id
-- Year of study is derived from how long the cohort has been running.
JOIN public.years_of_study yos ON yos.year_number = (2025 - b.admission_year)
CROSS JOIN (VALUES ('A'), ('B')) AS sc(section_code)
JOIN public.academic_years ay_current ON ay_current.is_current
WHERE NOT EXISTS (
    SELECT 1 FROM public.sections s WHERE s.batch_id = b.batch_id AND s.section_code = sc.section_code
);

-- ---------------------------------------------------------------------------
-- Students — 10 per section x 32 sections = 320 students.
--
-- Names are generated deterministically from fictional first/last name pools so
-- the dataset is varied but byte-for-byte reproducible on a re-run. The modulus
-- arithmetic is chosen so every (first, last) pair is unique.
-- ---------------------------------------------------------------------------
INSERT INTO public.students
    (register_number, admission_number, first_name, last_name, gender, date_of_birth,
     phone, email, department_id, program_id, batch_id, section_id,
     current_year_of_study_id, current_semester_id, residence_status, status,
     admission_date, address)

WITH dept_list AS (
    SELECT d.department_id, pr.program_id, d.department_code,
           row_number() OVER (ORDER BY d.department_code) AS dept_ordinal
    FROM public.departments d
    JOIN public.programs pr ON pr.department_id = d.department_id
),
batch_list AS (
    SELECT b.batch_id, b.department_id, b.admission_year, d.department_code,
           yos.year_of_study_id, yos.year_number
    FROM public.batches b
    JOIN public.departments d     ON d.department_id = b.department_id
    JOIN public.years_of_study yos ON yos.year_number = (2025 - b.admission_year)
),
section_list AS (
    SELECT s.section_id, s.batch_id, s.department_id, s.section_code
    FROM public.sections s
),
-- Every (section, sequence-in-section) pair becomes one student.
slots AS (
    SELECT
        sec.section_id,
        bl.batch_id,
        bl.department_id,
        bl.year_of_study_id,
        bl.year_number,
        dl.program_id,
        dl.department_code,
        dl.dept_ordinal,
        bl.admission_year,
        sec.section_code,
        q.seq AS seq_in_section,
        row_number() OVER (ORDER BY dl.dept_ordinal, bl.admission_year, sec.section_code, q.seq) AS n
    FROM section_list sec
    JOIN batch_list bl ON bl.batch_id = sec.batch_id
    JOIN dept_list dl ON dl.department_id = sec.department_id
    CROSS JOIN generate_series(1, 10) AS q(seq)
),
named AS (
    SELECT
        sl.*,
        -- Gender alternates; the first-name index therefore advances every 2.
        CASE WHEN sl.n % 2 = 1 THEN 'MALE' ELSE 'FEMALE' END AS gender,
        CASE WHEN sl.n % 2 = 1 THEN
            (ARRAY['Aarav','Vihaan','Arjun','Reyansh','Kabir','Ishaan','Rohan','Aditya',
                   'Karthik','Siddharth','Nikhil','Varun','Yash','Tarun','Gaurav','Rahul',
                   'Vivek','Anand','Mohan','Ramesh','Suresh','Krishna','Ajay','Vinay'])
        [(sl.n / 2) % 24 + 1]
        ELSE
            (ARRAY['Aanya','Diya','Saanvi','Riya','Anjali','Meera','Divya','Sneha',
                   'Pooja','Lakshmi','Nivedita','Sanjana','Keerthana','Bhavana','Shreya',
                   'Aishwarya','Harini','Deepa','Vasudha','Kavya','Monika','Rashmi','Ishita',
                   'Nandhini'])
        [(sl.n / 2) % 24 + 1]
        END AS first_name,
        (ARRAY['Sharma','Iyer','Nair','Reddy','Rao','Patil','Menon','Gupta',
               'Deshpande','Kulkarni','Chatterjee','Banerjee','Pillai','Krishnan',
               'Ramesh','Subramanian','Venkataraman','Balasubramanian','Chandrasekhar',
               'Ranganathan'])[(sl.n / 3) % 20 + 1] AS last_name
    FROM slots sl
)
SELECT
    -- e.g. AIML42021A01 = dept AIML, year of study 4, admitted 2021, section A, student 1
    nm.department_code || nm.year_number::int || nm.admission_year::int
        || nm.section_code || lpad(nm.seq_in_section::int::text, 2, '0'),
    'ADM' || nm.admission_year::int || lpad(nm.n::int::text, 5, '0'),
    nm.first_name,
    nm.last_name,
    nm.gender,
    -- Age tracks the year of study: year 1 students are the youngest.
    DATE ((2007 - nm.year_number)::int || '-' ||
          lpad(pg_temp.arc_rand('dobm' || nm.n, 1, 12)::text, 2, '0') || '-' ||
          lpad(pg_temp.arc_rand('dodb' || nm.n, 1, 28)::text, 2, '0')),
    '90000' || lpad(nm.n::text, 5, '0'),
    lower(nm.first_name || '.' || nm.last_name || nm.n::int || '@student.arccollege.edu'),
    nm.department_id,
    nm.program_id,
    nm.batch_id,
    nm.section_id,
    nm.year_of_study_id,
    sem.semester_id,
    -- ~45% hostellers, so both residency types are well represented.
    CASE WHEN pg_temp.arc_rand('res' || nm.n, 1, 100) <= 45 THEN 'HOSTELLER' ELSE 'DAY_SCHOLAR' END,
    'ACTIVE',
    DATE (nm.admission_year::int || '-08-01') + pg_temp.arc_rand('adm' || nm.n, 0, 20),
    (10 + pg_temp.arc_rand('addr' || nm.n, 1, 220))::int || ', ' ||
    ((ARRAY['Anna Nagar','K.K. Nagar','Gandhipuram','R.s. Puram','Mylapore','Alwarpet',
            'Velachery','T. Nagar','Adyar','Porur','Nandambakkam','Chromepet',
            'Ambattur','Pallikaranai','Perungudi','Tambaram']::text[])
        [pg_temp.arc_rand('loctype' || nm.n, 1, 16)]) || ', Chennai 6000' ||
    lpad(pg_temp.arc_rand('pin' || nm.n, 5, 99)::text, 2, '0')
FROM named nm
JOIN public.batches bl      ON bl.batch_id = nm.batch_id
JOIN public.semesters sem   ON sem.semester_number = nm.year_number * 2
WHERE NOT EXISTS (SELECT 1 FROM public.students s2 WHERE s2.register_number = nm.department_code || nm.year_number::int
        || nm.admission_year::int || nm.section_code || lpad(nm.seq_in_section::int::text, 2, '0'));

-- ---------------------------------------------------------------------------
-- Guardians — up to three per student (mother, father, and a guardian where
-- applicable). Modelled as rows, not six repeated columns on students.
-- ---------------------------------------------------------------------------
INSERT INTO public.guardians
    (student_id, relation_type, guardian_name, phone, email, occupation, is_primary)

WITH father_names AS (
    SELECT name FROM unnest(ARRAY['Suresh','Ramesh','Ganesh','Mohan','Balaji','Karthik',
        'Vikram','Sanjay','Arjun','Naveen','Vinod','Manoj','Girish','Bala','Ravi',
        'Shankar','Natarajan','Prakash','Sundar','Krishnan','Rajan','Selvam',
        'Thirumurugan','Ashok']) AS t(name)
),
mother_names AS (
    SELECT name FROM unnest(ARRAY['Lakshmi','Meena','Radhika','Kavitha','Sujatha','Anitha',
        'Vijaya','Kalpana','Shanthi','Sudha','Geetha','Bhuvaneswari','Nagalakshmi',
        'Sarojini','Padmavathi','Varalakshmi','Ramadevi','Jayashree','Kirthika',
        'Ammu','Revathi','Chitra','Poornima','Saraswathi']) AS t(name)
),
guardian_names AS (
    SELECT name FROM unnest(ARRAY['Anil','Sunil','Gopal','Rakesh','Mahesh','Nagesh',
        'Satish','Jagdish','Deepak','Mahendra','Prakash','Suresh']) AS t(name)
),
base AS (
    SELECT
        s.student_id,
        row_number() OVER (ORDER BY s.register_number) AS idx
    FROM public.students s
)
-- Mother — exactly one per student.
SELECT
    b.student_id, 'MOTHER', m.name,
    '90000' || lpad((b.idx * 3 + 1)::text, 5, '0'),
    lower(replace(m.name, ' ', '.') || '@example.invalid'),
    ((ARRAY['Homemaker','Teacher','Nurse','Farmer','Shopkeeper','Accountant',
             'Government Employee','Tailor','Pharmacist','Bank Clerk']::text[])
        [pg_temp.arc_rand('occ-m' || b.student_id, 1, 10)]),
    TRUE
FROM base b
CROSS JOIN LATERAL (
    SELECT mn.name FROM mother_names mn
    ORDER BY mn.name
    OFFSET pg_temp.arc_rand('mname' || b.student_id, 0, 23) LIMIT 1
) m
WHERE NOT EXISTS (
    SELECT 1 FROM public.guardians g
    WHERE g.student_id = b.student_id AND g.relation_type = 'MOTHER'
)
UNION ALL
-- Father — exactly one per student.
SELECT
    b.student_id, 'FATHER', f.name,
    '90000' || lpad((b.idx * 3 + 2)::text, 5, '0'),
    lower(replace(f.name, ' ', '.') || '@example.invalid'),
    ((ARRAY['Engineer','Teacher','Farmer','Businessman','Driver','Doctor',
             'Government Employee','Electrician','Shopkeeper','Bank Manager']::text[])
        [pg_temp.arc_rand('occ-f' || b.student_id, 1, 10)]),
    FALSE
FROM base b
CROSS JOIN LATERAL (
    SELECT fn.name FROM father_names fn
    ORDER BY fn.name
    OFFSET pg_temp.arc_rand('fname' || b.student_id, 0, 23) LIMIT 1
) f
WHERE NOT EXISTS (
    SELECT 1 FROM public.guardians g
    WHERE g.student_id = b.student_id AND g.relation_type = 'FATHER'
)
UNION ALL
-- Guardian — only some students, chosen deterministically (~25%).
SELECT
    b.student_id, 'GUARDIAN', g.name,
    '90000' || lpad((b.idx * 3 + 3)::text, 5, '0'),
    lower(replace(g.name, ' ', '.') || '@example.invalid'),
    'Relative',
    FALSE
FROM base b
CROSS JOIN LATERAL (
    SELECT gn.name FROM guardian_names gn
    ORDER BY gn.name
    OFFSET pg_temp.arc_rand('gname' || b.student_id, 0, 11) LIMIT 1
) g
WHERE pg_temp.arc_rand('guard' || b.student_id, 1, 100) <= 25
  AND NOT EXISTS (
      SELECT 1 FROM public.guardians g
      WHERE g.student_id = b.student_id AND g.relation_type = 'GUARDIAN'
  );

-- ---------------------------------------------------------------------------
-- Normalise faculty contact numbers onto the reserved fictional prefix too.
-- ---------------------------------------------------------------------------
UPDATE public.faculty
SET phone = '98765' || lpad(pg_temp.arc_rand('fphone' || employee_id, 10000, 99999)::text, 5, '0')
WHERE phone NOT LIKE '98765%';

-- Give the hostels a warden drawn from faculty.
UPDATE public.hostels h
SET warden_faculty_id = (
    SELECT fx.faculty_id
    FROM public.faculty fx
    ORDER BY pg_temp.arc_rand('warden' || h.hostel_name || fx.employee_id, 1, 100000)
    LIMIT 1
)
WHERE h.warden_faculty_id IS NULL;
