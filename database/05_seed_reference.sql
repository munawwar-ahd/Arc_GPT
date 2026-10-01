-- ============================================================================
-- ArcGPT — 05_seed_reference.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Static reference data. All names, employee numbers and phone numbers are
-- FICTIONAL. Phone numbers use the reserved fictional range 9xxxxxxxxx and
-- deliberately avoid any real subscriber pattern.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 05_seed_reference.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- Deterministic pseudo-random integer in [lo, hi], keyed on a text seed.
-- md5-based so the SAME seed always yields the SAME value: the dataset is
-- reproducible across re-runs, which makes review and diffing possible.
CREATE OR REPLACE FUNCTION pg_temp.arc_rand(p_seed TEXT, p_lo INT, p_hi INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_lo + abs(('x' || substr(md5(p_seed), 1, 8))::bit(32)::int) % (p_hi - p_lo + 1);
$$;

-- ---------------------------------------------------------------------------
-- Academic calendar
-- ---------------------------------------------------------------------------
INSERT INTO public.academic_years (year_label, start_year, end_year, is_current) VALUES
    ('2021-22', 2021, 2022, FALSE),
    ('2022-23', 2022, 2023, FALSE),
    ('2023-24', 2023, 2024, FALSE),
    ('2024-25', 2024, 2025, TRUE)
ON CONFLICT (year_label) DO NOTHING;

-- One row per semester POSITION, shared by all academic years.
INSERT INTO public.semesters (semester_number, semester_name, duration_months) VALUES
    (1, 'Semester 1', 6), (2, 'Semester 2', 6),
    (3, 'Semester 3', 6), (4, 'Semester 4', 6),
    (5, 'Semester 5', 6), (6, 'Semester 6', 6),
    (7, 'Semester 7', 6), (8, 'Semester 8', 6)
ON CONFLICT (semester_number) DO NOTHING;

INSERT INTO public.years_of_study (year_number, year_name) VALUES
    (1, 'First Year'),  (2, 'Second Year'),
    (3, 'Third Year'),  (4, 'Fourth Year')
ON CONFLICT (year_number) DO NOTHING;

-- Monday..Saturday. day_number 1 = Monday.
INSERT INTO public.weekdays (weekday_id, day_number, day_name) VALUES
    (1, 1, 'MONDAY'), (2, 2, 'TUESDAY'), (3, 3, 'WEDNESDAY'),
    (4, 4, 'THURSDAY'), (5, 5, 'FRIDAY'), (6, 6, 'SATURDAY')
ON CONFLICT (weekday_id) DO NOTHING;

-- Six periods a day, 50 minutes each, with a 12:00-14:00 lunch break. Period 4
-- therefore starts at 14:00, so a natural question like "what class do I have at
-- 2 PM" resolves cleanly to Period 4.
INSERT INTO public.period_slots (period_id, period_number, period_label, start_time, end_time) VALUES
    (1, 1, 'Period 1', '09:00'::time, '09:50'::time),
    (2, 2, 'Period 2', '10:00'::time, '10:50'::time),
    (3, 3, 'Period 3', '11:10'::time, '12:00'::time),
    (4, 4, 'Period 4', '14:00'::time, '14:50'::time),
    (5, 5, 'Period 5', '15:00'::time, '15:50'::time),
    (6, 6, 'Period 6', '16:00'::time, '16:50'::time)
ON CONFLICT (period_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
INSERT INTO public.departments (department_code, department_name, established_year, email, phone) VALUES
    ('AIML', 'Artificial Intelligence and Machine Learning', 2014, 'aiml@arccollege.edu',  '9840010001'),
    ('CSE',  'Computer Science and Engineering',              2008, 'cse@arccollege.edu',   '9840010002'),
    ('ECE',  'Electronics and Communication Engineering',     2009, 'ece@arccollege.edu',   '9840010003'),
    ('MECH', 'Mechanical Engineering',                          2005, 'mech@arccollege.edu',  '9840010004')
ON CONFLICT (department_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Programmes (one undergraduate programme per department)
-- ---------------------------------------------------------------------------
INSERT INTO public.programs (department_id, program_code, program_name, degree_level, duration_years)
SELECT d.department_id, p.program_code, p.program_name, p.degree_level, p.duration_years::numeric
FROM (VALUES
    ('AIML', 'BT-AIML', 'B.Tech Artificial Intelligence and Machine Learning', 'UG', 4.0),
    ('CSE',  'BT-CSE',  'B.Tech Computer Science and Engineering',              'UG', 4.0),
    ('ECE',  'BT-ECE',  'B.Tech Electronics and Communication Engineering',     'UG', 4.0),
    ('MECH', 'BT-MECH', 'B.Tech Mechanical Engineering',                         'UG', 4.0)
) AS p(dept_code, program_code, program_name, degree_level, duration_years)
JOIN public.departments d ON d.department_code = p.dept_code
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Faculty — 8 per department, 32 total. Fictional names, fictional employee IDs.
-- ---------------------------------------------------------------------------
INSERT INTO public.faculty
    (employee_id, first_name, last_name, department_id, designation, email, phone, date_of_joined, status)
SELECT
    f.employee_id,
    f.first_name,
    f.last_name,
    d.department_id,
    f.designation,
    lower(f.first_name || '.' || f.last_name || '@arccollege.edu'),
    '98' || lpad(pg_temp.arc_rand(f.employee_id, 10000000, 99999999)::text, 8, '0'),
    f.date_of_joined::date,
    'ACTIVE'
FROM (VALUES
    -- AIML
    ('EMP-A001','Ananya','Raghunathan','AIML','Professor and Head',            '2014-06-02'),
    ('EMP-A002','Karthik','Venkataraman','AIML','Associate Professor',           '2016-07-11'),
    ('EMP-A003','Priya','Balasubramanian','AIML','Assistant Professor',          '2018-08-01'),
    ('EMP-A004','Rohit','Chandrasekhar','AIML','Assistant Professor',            '2019-06-17'),
    ('EMP-A005','Sneha','Ranganathan',   'AIML','Assistant Professor',           '2020-07-06'),
    ('EMP-A006','Imran','Sheikh',        'AIML','Lab Instructor',                '2021-08-02'),
    ('EMP-A007','Divya','Krishnamurthy','AIML','Assistant Professor',            '2022-06-13'),
    ('EMP-A008','Naveen','Sundaram',     'AIML','Lab Instructor',                '2023-07-10'),
    -- CSE
    ('EMP-C001','Ramesh','Iyer',         'CSE','Professor and Head',             '2008-06-09'),
    ('EMP-C002','Lakshmi','Narasimhan',  'CSE','Professor',                     '2010-07-05'),
    ('EMP-C003','Vikram','Deshpande',    'CSE','Associate Professor',            '2013-08-12'),
    ('EMP-C004','Meera','Krishnavelu',   'CSE','Assistant Professor',           '2017-06-19'),
    ('EMP-C005','Arjun','Ramachandran',  'CSE','Assistant Professor',           '2019-07-01'),
    ('EMP-C006','Sandhya','Gopinath',    'CSE','Assistant Professor',           '2021-06-14'),
    ('EMP-C007','Harish','Balasubramanian','CSE','Lab Instructor',              '2022-08-08'),
    ('EMP-C008','Nivedita','Chakraborty','CSE','Assistant Professor',          '2023-06-12'),
    -- ECE
    ('EMP-E001','Ganesh','Subramanian',  'ECE','Professor and Head',            '2009-07-06'),
    ('EMP-E002','Bhavana','Kulkarni',    'ECE','Professor',                     '2011-08-01'),
    ('EMP-E003','Suresh','Pillai',       'ECE','Associate Professor',           '2014-06-16'),
    ('EMP-E004','Anjali','Deshmukh',     'ECE','Assistant Professor',           '2018-07-09'),
    ('EMP-E005','Kiran','Namboothiri',   'ECE','Assistant Professor',           '2020-08-17'),
    ('EMP-E006','Rekha','Venkataraman',  'ECE','Lab Instructor',                '2021-07-12'),
    ('EMP-E007','Sanjay','Mahadevan',    'ECE','Assistant Professor',           '2022-06-20'),
    ('EMP-E008','Pooja','Srinivasan',    'ECE','Lab Instructor',                '2023-08-07'),
    -- MECH
    ('EMP-M001','Balaji','Ranganathan',  'MECH','Professor and Head',           '2005-06-13'),
    ('EMP-M002','Sureshkumar','Naidu',   'MECH','Professor',                    '2007-07-02'),
    ('EMP-M003','Vinod','Krishnamurthy', 'MECH','Associate Professor',          '2011-06-20'),
    ('EMP-M004','Deepa','Raghunathan',   'MECH','Assistant Professor',           '2015-07-13'),
    ('EMP-M005','Manoj','Sivakumar',     'MECH','Assistant Professor',           '2018-06-11'),
    ('EMP-M006','Shalini','Venkataraman','MECH','Assistant Professor',           '2020-07-06'),
    ('EMP-M007','Girish','Balasubramanian','MECH','Lab Instructor',              '2021-08-09'),
    ('EMP-M008','Aishwarya','Nandakumar','MECH','Assistant Professor',          '2023-07-17')
) AS f(employee_id, first_name, last_name, dept_code, designation, date_of_joined)
JOIN public.departments d ON d.department_code = f.dept_code
WHERE NOT EXISTS (SELECT 1 FROM public.faculty fx WHERE fx.employee_id = f.employee_id);

-- Head of department for each department (first-listed professor).
UPDATE public.departments d
SET hod_faculty_id = f.faculty_id
FROM public.faculty f
WHERE f.department_id = d.department_id
  AND f.designation = 'Professor and Head'
  AND d.hod_faculty_id IS NULL;

-- ---------------------------------------------------------------------------
-- Classrooms and labs, per department
-- ---------------------------------------------------------------------------
INSERT INTO public.classrooms (room_code, room_type, capacity, building, department_id)
SELECT
    c.room_code, c.room_type, c.capacity::int, c.building, d.department_id
FROM (VALUES
    ('AIML-101','CLASSROOM',   60,'Block A',       'AIML'),
    ('AIML-102','CLASSROOM',   60,'Block A',       'AIML'),
    ('AIML-L1', 'LAB',         30,'Block A',       'AIML'),
    ('AIML-L2', 'LAB',         30,'Block A',       'AIML'),
    ('CSE-201', 'CLASSROOM',   65,'Block B',       'CSE'),
    ('CSE-202', 'CLASSROOM',   65,'Block B',       'CSE'),
    ('CSE-L1',  'LAB',         30,'Block B',       'CSE'),
    ('CSE-L2',  'LAB',         30,'Block B',       'CSE'),
    ('ECE-301', 'CLASSROOM',   60,'Block C',       'ECE'),
    ('ECE-302', 'CLASSROOM',   60,'Block C',       'ECE'),
    ('ECE-L1',  'LAB',         25,'Block C',       'ECE'),
    ('ECE-L2',  'LAB',         25,'Block C',       'ECE'),
    ('MECH-401','CLASSROOM',   60,'Block D',       'MECH'),
    ('MECH-402','CLASSROOM',   60,'Block D',       'MECH'),
    ('MECH-L1', 'LAB',         25,'Block D',       'MECH'),
    ('MECH-L2', 'LAB',         25,'Block D',       'MECH'),
    ('MAIN-HALL','SEMINAR_HALL',120,'Central Block',NULL)
) AS c(room_code, room_type, capacity, building, dept_code)
LEFT JOIN public.departments d ON d.department_code = c.dept_code
ON CONFLICT (room_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Fee types
-- ---------------------------------------------------------------------------
INSERT INTO public.fee_types (fee_type_code, fee_type_name, fee_category, is_recurring) VALUES
    ('COLLEGE_FEE',   'College Tuition Fee',        'TUITION', TRUE),
    ('HOSTEL_FEE',    'Hostel Accommodation Fee',   'HOSTEL',  TRUE),
    ('EXAM_FEE',      'Examination Fee',            'EXAM',    FALSE),
    ('LIBRARY_FEE',   'Library Membership Fee',     'LIBRARY', TRUE),
    ('TRANSIT_FEE',   'Transport Fee',              'OTHER',   TRUE)
ON CONFLICT (fee_type_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Hostels — two blocks per gender
-- ---------------------------------------------------------------------------
INSERT INTO public.hostels (hostel_name, hostel_type, total_rooms, address)
SELECT h.hostel_name, h.hostel_type, h.total_rooms::int, h.address
FROM (VALUES
    ('Aravalli Boys Hostel',   'BOYS',  60, 'North Campus'),
    ('Nilgiri Boys Hostel',    'BOYS',  50, 'North Campus'),
    ('Malai Girls Hostel',      'GIRLS', 55, 'South Campus'),
    ('Kaveri Girls Hostel',     'GIRLS', 45, 'South Campus')
) AS h(hostel_name, hostel_type, total_rooms, address)
WHERE NOT EXISTS (SELECT 1 FROM public.hostels x WHERE x.hostel_name = h.hostel_name);

-- Rooms: 1..N per hostel, capacity 3 (SHARED) or 2 (SEATER on even floors).
INSERT INTO public.hostel_rooms (hostel_id, room_number, room_type, capacity, occupied_count)
SELECT
    h.hostel_id,
    lpad(r.n::text, 3, '0'),
    CASE WHEN r.n % 4 = 0 THEN 'SEATER' ELSE 'SHARED' END,
    CASE WHEN r.n % 4 = 0 THEN 2 ELSE 3 END,
    0
FROM public.hostels h
CROSS JOIN generate_series(1, 20) AS r(n)
WHERE NOT EXISTS (SELECT 1 FROM public.hostel_rooms x WHERE x.hostel_id = h.hostel_id);
