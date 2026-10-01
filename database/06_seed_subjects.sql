-- ============================================================================
-- ArcGPT — 06_seed_subjects.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- The subject catalogue. Every subject row is owned by exactly one department
-- and belongs to exactly one semester POSITION, so a single subject row is
-- reused by every section and every student that takes it. Nothing here is
-- duplicated per student.
--
-- Two layers:
--   * COMMON_SUBJECTS  — the shared engineering core every department runs
--                        (maths, physics, chemistry, English, graphics, project).
--                        Each department gets its own catalogue row with its own
--                        subject_code, exactly as a real college ERP would.
--   * DEPT_SUBJECTS    — the department-specific core and electives.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 06_seed_subjects.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared engineering core
-- ---------------------------------------------------------------------------
INSERT INTO public.subjects
    (subject_code, subject_name, department_id, semester_id, credits, subject_type, lecture_hours, practical_hours, is_elective)
SELECT
    d.department_code || cs.code_suffix,
    cs.subject_name,
    d.department_id,
    sem.semester_id,
    cs.credits::numeric,
    cs.subject_type,
    cs.lecture_hours::int,
    cs.practical_hours::int,
    FALSE
FROM (VALUES
    -- sem, code_suffix, name, credits, type, lecture_h, practical_h
    (1,'M101','Engineering Mathematics I',            4,'THEORY',   4,0),
    (1,'P101','Engineering Physics',                 4,'THEORY',   4,0),
    (1,'C101','Engineering Chemistry',               4,'THEORY',   4,0),
    (1,'E101','Technical English and Communication', 3,'THEORY',   3,0),
    (1,'G101','Engineering Graphics',                3,'THEORY_LAB',2,2),
    (2,'M102','Engineering Mathematics II',           4,'THEORY',   4,0),
    (2,'P102','Engineering Physics II',              4,'THEORY',   4,0),
    (2,'C102','Engineering Chemistry II',            4,'THEORY',   4,0),
    (2,'S102','Professional Skills and Ethics',      2,'THEORY',   2,0),
    (3,'M201','Engineering Mathematics III',         4,'THEORY',   4,0),
    (4,'M202','Engineering Mathematics IV',          4,'THEORY',   4,0),
    (5,'M301','Engineering Mathematics V',           3,'THEORY',   3,0),
    (6,'M302','Engineering Mathematics VI',          3,'THEORY',   3,0),
    (7,'S701','Entrepreneurship and Startup',        3,'THEORY',   3,0),
    (8,'P801','Major Project Work',                  6,'PROJECT',  0,12)
) AS cs(sem_no, code_suffix, subject_name, credits, subject_type, lecture_hours, practical_hours)
JOIN public.departments d ON TRUE
JOIN public.semesters sem ON sem.semester_number = cs.sem_no
WHERE NOT EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.subject_code = d.department_code || cs.code_suffix
);

-- ---------------------------------------------------------------------------
-- Department-specific core and electives
-- ---------------------------------------------------------------------------
INSERT INTO public.subjects
    (subject_code, subject_name, department_id, semester_id, credits, subject_type, lecture_hours, practical_hours, is_elective)
SELECT
    ds.code,
    ds.subject_name,
    d.department_id,
    sem.semester_id,
    ds.credits::numeric,
    ds.subject_type,
    ds.lecture_hours::int,
    ds.practical_hours::int,
    ds.is_elective
FROM (VALUES
    -- ================= AIML =================
    ('AI101','Programming in Python',            'AIML',1,4,'THEORY_LAB',3,2,FALSE),
    ('AI102','Data Structures',                 'AIML',2,4,'THEORY',    4,0,FALSE),
    ('AI103','Digital Logic Design',            'AIML',2,3,'THEORY_LAB',2,2,FALSE),
    ('AI201','Database Management Systems',     'AIML',3,4,'THEORY_LAB',3,2,FALSE),
    ('AI202','Object Oriented Programming',     'AIML',3,4,'THEORY',    4,0,FALSE),
    ('AI203','Discrete Mathematical Structures','AIML',3,4,'THEORY',    4,0,FALSE),
    ('AI301','Machine Learning',                'AIML',4,4,'THEORY',    4,0,FALSE),
    ('AI302','Computer Networks',               'AIML',4,4,'THEORY',    4,0,FALSE),
    ('AI303','Operating Systems',               'AIML',4,4,'THEORY_LAB',3,2,FALSE),
    ('AI401','Deep Learning',                   'AIML',5,4,'THEORY',    4,0,FALSE),
    ('AI402','Natural Language Processing',     'AIML',5,4,'THEORY',    4,0,FALSE),
    ('AI403','Computer Vision',                 'AIML',5,4,'THEORY_LAB',3,2,FALSE),
    ('AI501','Data Engineering',                'AIML',6,4,'THEORY',    4,0,FALSE),
    ('AI502','Cloud Computing',                 'AIML',6,4,'THEORY_LAB',3,2,FALSE),
    ('AI503','Big Data Analytics',              'AIML',6,4,'THEORY',    4,0,FALSE),
    ('AI601','Reinforcement Learning',          'AIML',7,4,'THEORY',    4,0,FALSE),
    ('AI602','Machine Learning Operations',     'AIML',7,4,'THEORY',    4,0,TRUE),
    ('AI603','Speech and Signal Processing',    'AIML',7,4,'THEORY_LAB',3,2,TRUE),
    ('AI701','Applied Artificial Intelligence', 'AIML',8,4,'THEORY',    4,0,FALSE),
    ('AI702','Research Methodology',            'AIML',8,3,'THEORY',    3,0,TRUE),
    -- ================= CSE =================
    ('CS101','Programming in C',                'CSE',1,4,'THEORY_LAB',3,2,FALSE),
    ('CS102','Computer Organisation',           'CSE',2,4,'THEORY',    4,0,FALSE),
    ('CS103','Data Structures and Algorithms',  'CSE',2,4,'THEORY',    4,0,FALSE),
    ('CS201','Object Oriented Programming',     'CSE',3,4,'THEORY',    4,0,FALSE),
    ('CS202','Database Management Systems',     'CSE',3,4,'THEORY_LAB',3,2,FALSE),
    ('CS203','Operating Systems',               'CSE',4,4,'THEORY',    4,0,FALSE),
    ('CS204','Computer Networks',               'CSE',4,4,'THEORY',    4,0,FALSE),
    ('CS205','Design and Analysis of Algorithms','CSE',4,4,'THEORY',   4,0,FALSE),
    ('CS301','Compiler Design',                 'CSE',5,4,'THEORY',    4,0,FALSE),
    ('CS302','Database Management Systems II',  'CSE',5,4,'THEORY_LAB',3,2,FALSE),
    ('CS303','Theory of Computation',           'CSE',5,4,'THEORY',    4,0,FALSE),
    ('CS401','Machine Learning',                'CSE',6,4,'THEORY',    4,0,FALSE),
    ('CS402','Web Technologies',                'CSE',6,4,'THEORY_LAB',3,2,FALSE),
    ('CS403','Software Engineering',            'CSE',6,4,'THEORY',    4,0,FALSE),
    ('CS501','Distributed Systems',             'CSE',7,4,'THEORY',    4,0,FALSE),
    ('CS502','Data Science',                    'CSE',7,4,'THEORY',    4,0,TRUE),
    ('CS503','Cryptography and Network Security','CSE',7,4,'THEORY',   4,0,TRUE),
    ('CS601','Cloud Computing',                 'CSE',8,4,'THEORY',    4,0,FALSE),
    ('CS602','Mobile Application Development',  'CSE',8,4,'THEORY_LAB',3,2,TRUE),
    -- ================= ECE =================
    ('EC101','Basic Electronics',               'ECE',1,4,'THEORY_LAB',3,2,FALSE),
    ('EC102','Network Analysis',                'ECE',2,4,'THEORY',    4,0,FALSE),
    ('EC103','Signals and Systems',             'ECE',2,4,'THEORY',    4,0,FALSE),
    ('EC201','Analog Circuits',                 'ECE',3,4,'THEORY_LAB',3,2,FALSE),
    ('EC202','Digital Circuits',                'ECE',3,4,'THEORY_LAB',3,2,FALSE),
    ('EC203','Microprocessors and Microcontrollers','ECE',3,4,'THEORY',4,0,FALSE),
    ('EC301','Digital Signal Processing',       'ECE',4,4,'THEORY',    4,0,FALSE),
    ('EC302','Communication Systems',           'ECE',4,4,'THEORY',    4,0,FALSE),
    ('EC303','Control Systems',                 'ECE',4,4,'THEORY',    4,0,FALSE),
    ('EC401','VLSI Design',                     'ECE',5,4,'THEORY_LAB',3,2,FALSE),
    ('EC402','Embedded Systems',                'ECE',5,4,'THEORY',    4,0,FALSE),
    ('EC403','Antenna and Wave Propagation',    'ECE',5,4,'THEORY',    4,0,TRUE),
    ('EC501','Wireless Communication',          'ECE',6,4,'THEORY',    4,0,FALSE),
    ('EC502','Digital Image Processing',        'ECE',6,4,'THEORY_LAB',3,2,FALSE),
    ('EC601','Internet of Things',              'ECE',7,4,'THEORY_LAB',3,2,FALSE),
    ('EC602','Optical Fibre Communication',     'ECE',7,4,'THEORY',    4,0,TRUE),
    ('EC701','Radar and Microwave Engineering', 'ECE',8,4,'THEORY',    4,0,TRUE),
    -- ================= MECH =================
    ('ME101','Engineering Workshop',            'MECH',1,3,'THEORY_LAB',1,4,FALSE),
    ('ME102','Engineering Thermodynamics',      'MECH',2,4,'THEORY',    4,0,FALSE),
    ('ME103','Engineering Mechanics',           'MECH',2,4,'THEORY',    4,0,FALSE),
    ('ME201','Fluid Mechanics',                 'MECH',3,4,'THEORY',    4,0,FALSE),
    ('ME202','Machine Design',                  'MECH',3,4,'THEORY_LAB',3,2,FALSE),
    ('ME203','Manufacturing Processes',         'MECH',3,4,'THEORY',    4,0,FALSE),
    ('ME301','Heat and Mass Transfer',          'MECH',4,4,'THEORY',    4,0,FALSE),
    ('ME302','Strength of Materials',           'MECH',4,4,'THEORY',    4,0,FALSE),
    ('ME303','Theory of Machines',              'MECH',4,4,'THEORY',    4,0,FALSE),
    ('ME401','Automobile Engineering',          'MECH',5,4,'THEORY',    4,0,FALSE),
    ('ME402','Industrial Engineering',          'MECH',5,4,'THEORY',    4,0,FALSE),
    ('ME501','Design of Machine Elements',     'MECH',6,4,'THEORY_LAB',3,2,FALSE),
    ('ME502','CAD and Simulation',              'MECH',6,3,'THEORY_LAB',1,3,FALSE),
    ('ME601','Refrigeration and Air Conditioning','MECH',7,4,'THEORY',  4,0,TRUE),
    ('ME602','Tribology',                       'MECH',7,4,'THEORY',    4,0,TRUE),
    ('ME701','Automotive Electronics',          'MECH',8,4,'THEORY_LAB',3,2,TRUE)
) AS ds(code, subject_name, dept_code, sem_no, credits, subject_type, lecture_hours, practical_hours, is_elective)
JOIN public.departments d ON d.department_code = ds.dept_code
JOIN public.semesters sem ON sem.semester_number = ds.sem_no
WHERE NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.subject_code = ds.code);
