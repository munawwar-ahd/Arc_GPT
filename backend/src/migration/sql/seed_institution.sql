-- =============================================================================
-- ArcGPT Local Institution Seed Data
-- =============================================================================

-- 1. ACADEMIC YEARS
INSERT INTO public.academic_years (year_name, start_date, end_date, is_current)
VALUES ('2023-2024', '2023-08-01', '2024-05-31', TRUE)
ON CONFLICT (year_name) DO UPDATE SET is_current = TRUE;

-- 2. DEPARTMENTS (6 Departments)
INSERT INTO public.departments (department_code, department_name) VALUES
    ('CSE', 'Computer Science and Engineering'),
    ('AIML', 'Artificial Intelligence and Machine Learning'),
    ('ECE', 'Electronics and Communication Engineering'),
    ('MECH', 'Mechanical Engineering'),
    ('CIVIL', 'Civil Engineering'),
    ('IT', 'Information Technology')
ON CONFLICT (department_code) DO NOTHING;

-- 3. PROGRAMS
INSERT INTO public.programs (program_code, program_name, department_id, duration_years)
SELECT 'BTECH_' || d.department_code, 'B.Tech in ' || d.department_name, d.department_id, 4
FROM public.departments d
ON CONFLICT (program_code) DO NOTHING;

-- 4. BATCHES
INSERT INTO public.batches (batch_name, academic_year_id, program_id)
SELECT '2023-2027', ay.academic_year_id, p.program_id
FROM public.academic_years ay
CROSS JOIN public.programs p
WHERE ay.year_name = '2023-2024'
AND NOT EXISTS (
    SELECT 1 FROM public.batches b WHERE b.batch_name = '2023-2027' AND b.program_id = p.program_id
);

-- 5. SECTIONS
INSERT INTO public.sections (section_name, batch_id)
SELECT 'A', b.batch_id
FROM public.batches b
WHERE NOT EXISTS (
    SELECT 1 FROM public.sections s WHERE s.section_name = 'A' AND s.batch_id = b.batch_id
);

-- 6. SEMESTERS
INSERT INTO public.semesters (semester_number, academic_year_id, start_date, end_date, is_current)
SELECT 3, ay.academic_year_id, '2023-08-01', '2023-12-15', TRUE
FROM public.academic_years ay
WHERE ay.year_name = '2023-2024'
AND NOT EXISTS (SELECT 1 FROM public.semesters WHERE semester_number = 3);

-- 7. FACULTY
INSERT INTO public.faculty (employee_id, first_name, last_name, department_id, designation, email)
SELECT 
    'FAC-' || d.department_code || '-01',
    CASE d.department_code
        WHEN 'AIML' THEN 'Rajesh'
        WHEN 'CSE' THEN 'Priya'
        WHEN 'ECE' THEN 'Arun'
        WHEN 'MECH' THEN 'Vikram'
        WHEN 'CIVIL' THEN 'Sunil'
        WHEN 'IT' THEN 'Kavita'
    END,
    CASE d.department_code
        WHEN 'AIML' THEN 'Sharma'
        WHEN 'CSE' THEN 'Rao'
        WHEN 'ECE' THEN 'Kumar'
        WHEN 'MECH' THEN 'Singh'
        WHEN 'CIVIL' THEN 'Verma'
        WHEN 'IT' THEN 'Nair'
    END,
    d.department_id,
    'Professor',
    'prof.' || lower(d.department_code) || '@institution.edu'
FROM public.departments d
ON CONFLICT (employee_id) DO NOTHING;

INSERT INTO public.faculty (employee_id, first_name, last_name, department_id, designation, email)
SELECT 
    'FAC-' || d.department_code || '-02',
    CASE d.department_code
        WHEN 'AIML' THEN 'Anita'
        WHEN 'CSE' THEN 'Suresh'
        WHEN 'ECE' THEN 'Meera'
        WHEN 'MECH' THEN 'Ramesh'
        WHEN 'CIVIL' THEN 'Anand'
        WHEN 'IT' THEN 'Deepa'
    END,
    'Gupta',
    d.department_id,
    'Associate Professor',
    'assoc.' || lower(d.department_code) || '@institution.edu'
FROM public.departments d
ON CONFLICT (employee_id) DO NOTHING;

-- 8. SUBJECTS
INSERT INTO public.subjects (subject_code, subject_name, department_id, credits)
SELECT 
    d.department_code || '-301',
    CASE d.department_code
        WHEN 'AIML' THEN 'Machine Learning'
        WHEN 'CSE' THEN 'Data Structures and Algorithms'
        WHEN 'ECE' THEN 'Digital Signal Processing'
        WHEN 'MECH' THEN 'Thermodynamics'
        WHEN 'CIVIL' THEN 'Structural Analysis'
        WHEN 'IT' THEN 'Web Technologies'
    END,
    d.department_id,
    4.0
FROM public.departments d
ON CONFLICT (subject_code) DO NOTHING;

INSERT INTO public.subjects (subject_code, subject_name, department_id, credits)
SELECT 
    d.department_code || '-302',
    CASE d.department_code
        WHEN 'AIML' THEN 'Deep Learning & Neural Networks'
        WHEN 'CSE' THEN 'Database Management Systems'
        WHEN 'ECE' THEN 'Microprocessors & Microcontrollers'
        WHEN 'MECH' THEN 'Fluid Mechanics'
        WHEN 'CIVIL' THEN 'Geotechnical Engineering'
        WHEN 'IT' THEN 'Cloud Computing'
    END,
    d.department_id,
    3.0
FROM public.departments d
ON CONFLICT (subject_code) DO NOTHING;

-- 9. COURSE OFFERINGS
INSERT INTO public.course_offerings (subject_id, faculty_id, semester_id, section_id)
SELECT s.subject_id, f.faculty_id, sem.semester_id, sec.section_id
FROM public.subjects s
JOIN public.faculty f ON f.department_id = s.department_id AND f.employee_id LIKE '%-01'
JOIN public.departments d ON d.department_id = s.department_id
JOIN public.programs p ON p.department_id = d.department_id
JOIN public.batches b ON b.program_id = p.program_id
JOIN public.sections sec ON sec.batch_id = b.batch_id
CROSS JOIN (SELECT semester_id FROM public.semesters WHERE semester_number = 3 LIMIT 1) sem
WHERE NOT EXISTS (
    SELECT 1 FROM public.course_offerings co 
    WHERE co.subject_id = s.subject_id AND co.faculty_id = f.faculty_id
);

-- 10. STUDENTS (Seeding 30 students per department = 180 total)
DO $$
DECLARE
    dept RECORD;
    i INTEGER;
    reg_no TEXT;
    adm_no TEXT;
    f_name TEXT;
    l_name TEXT;
    prog_id UUID;
    btch_id UUID;
    sec_id UUID;
    first_names TEXT[] := ARRAY['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aadhya', 'Ananya', 'Diya', 'Pari', 'Saanvi', 'Myra', 'Ira', 'Avani', 'Riya', 'Isha', 'Ahana', 'Anvi', 'Prisha', 'Khushi', 'Tara'];
    last_names TEXT[] := ARRAY['Sharma', 'Verma', 'Patel', 'Reddy', 'Rao', 'Nair', 'Iyer', 'Pillai', 'Menon', 'Kumar', 'Singh', 'Chopra', 'Kapoor', 'Gupta', 'Joshi', 'Bhat', 'Deshmukh', 'Kulkarni', 'Jadhav', 'More', 'Mehta', 'Shah', 'Modi', 'Agarwal', 'Mittal', 'Bansal', 'Goyal', 'Singhal', 'Saxena', 'Pandey'];
BEGIN
    FOR dept IN SELECT department_id, department_code FROM public.departments ORDER BY department_code LOOP
        SELECT p.program_id, b.batch_id, s.section_id 
        INTO prog_id, btch_id, sec_id
        FROM public.programs p
        JOIN public.batches b ON b.program_id = p.program_id
        JOIN public.sections s ON s.batch_id = b.batch_id
        WHERE p.department_id = dept.department_id
        LIMIT 1;

        FOR i IN 1..30 LOOP
            reg_no := 'REG-' || dept.department_code || '-' || LPAD(i::text, 3, '0');
            adm_no := 'ADM-' || dept.department_code || '-' || LPAD(i::text, 3, '0');
            f_name := first_names[((i - 1) % 30) + 1];
            l_name := last_names[((i - 1) % 30) + 1];

            INSERT INTO public.students (
                register_number, admission_number, first_name, last_name,
                department_id, program_id, batch_id, section_id, status, email
            ) VALUES (
                reg_no, adm_no, f_name, l_name,
                dept.department_id, prog_id, btch_id, sec_id, 'ACTIVE',
                lower(f_name) || '.' || lower(l_name) || i || '@student.institution.edu'
            )
            ON CONFLICT (register_number) DO NOTHING;
        END LOOP;
    END LOOP;
END
$$;

-- 11. STUDENT ACADEMIC SUMMARY (All 180 students)
DO $$
DECLARE
    st RECORD;
    base_cgpa NUMERIC;
    backlogs_val INTEGER;
BEGIN
    FOR st IN SELECT s.student_id, d.department_code, SUBSTRING(s.register_number FROM '[0-9]+$')::integer AS num 
              FROM public.students s 
              JOIN public.departments d ON d.department_id = s.department_id LOOP
        
        -- Give deterministic CGPA between 6.2 and 9.6
        base_cgpa := ROUND((6.5 + ((st.num * 7) % 32) * 0.1)::numeric, 2);
        
        -- Set active backlog count: students with num in (4, 11, 18, 25) have backlogs
        IF st.num IN (4, 11) THEN
            backlogs_val := 2; -- more than 1 active backlog!
        ELSIF st.num IN (18, 25) THEN
            backlogs_val := 1;
        ELSE
            backlogs_val := 0;
        END IF;

        INSERT INTO public.student_academic_summary (student_id, current_cgpa, current_sgpa, backlog_count)
        VALUES (st.student_id, base_cgpa, ROUND((base_cgpa - 0.2)::numeric, 2), backlogs_val)
        ON CONFLICT (student_id) DO UPDATE 
        SET current_cgpa = EXCLUDED.current_cgpa, 
            current_sgpa = EXCLUDED.current_sgpa, 
            backlog_count = EXCLUDED.backlog_count;
    END LOOP;
END
$$;

-- 12. BACKLOGS
DO $$
DECLARE
    st RECORD;
    sub_id UUID;
    sem_id UUID;
BEGIN
    SELECT semester_id INTO sem_id FROM public.semesters WHERE semester_number = 3 LIMIT 1;

    FOR st IN SELECT s.student_id, s.department_id, SUBSTRING(s.register_number FROM '[0-9]+$')::integer AS num
              FROM public.students s LOOP
        
        SELECT subject_id INTO sub_id FROM public.subjects WHERE department_id = st.department_id LIMIT 1;

        IF st.num IN (4, 11) THEN
            -- 2 active backlogs
            INSERT INTO public.backlogs (student_id, subject_id, semester_id, status)
            VALUES (st.student_id, sub_id, sem_id, 'ACTIVE');

            INSERT INTO public.backlogs (student_id, subject_id, semester_id, status)
            SELECT st.student_id, s2.subject_id, sem_id, 'ACTIVE'
            FROM public.subjects s2 
            WHERE s2.department_id = st.department_id AND s2.subject_id <> sub_id
            LIMIT 1;
        ELSIF st.num IN (18, 25) THEN
            -- 1 active backlog
            INSERT INTO public.backlogs (student_id, subject_id, semester_id, status)
            VALUES (st.student_id, sub_id, sem_id, 'ACTIVE');
        END IF;
    END LOOP;
END
$$;

-- 13. ATTENDANCE RECORDS (10 sessions per course offering)
-- Designed so that for AIML, students 1 to 5 have attendance < 75%
DO $$
DECLARE
    co RECORD;
    st RECORD;
    day_idx INTEGER;
    att_date DATE;
    att_status TEXT;
BEGIN
    FOR co IN SELECT offering_id, subject_id, faculty_id FROM public.course_offerings LOOP
        FOR day_idx IN 1..10 LOOP
            att_date := ('2023-09-01'::date + (day_idx * 2 || ' days')::interval)::date;

            FOR st IN 
                SELECT s.student_id, d.department_code, SUBSTRING(s.register_number FROM '[0-9]+$')::integer AS num
                FROM public.students s
                JOIN public.departments d ON d.department_id = s.department_id
                JOIN public.subjects sub ON sub.subject_id = co.subject_id AND sub.department_id = s.department_id
            LOOP
                -- If student is AIML and num <= 5: only attended 5 out of 10 (50% < 75%)
                -- If student is AIML and num between 6 and 8: attended 7 out of 10 (70% < 75%)
                -- Others attend 8, 9, or 10 out of 10 (80%-100%)
                IF st.department_code = 'AIML' AND st.num <= 5 THEN
                    IF day_idx <= 5 THEN
                        att_status := 'PRESENT';
                    ELSE
                        att_status := 'ABSENT';
                    END IF;
                ELSIF st.department_code = 'AIML' AND st.num BETWEEN 6 AND 8 THEN
                    IF day_idx <= 7 THEN
                        att_status := 'PRESENT';
                    ELSE
                        att_status := 'ABSENT';
                    END IF;
                ELSE
                    IF day_idx = 10 AND (st.num % 4 = 0) THEN
                        att_status := 'ABSENT';
                    ELSIF day_idx = 9 AND (st.num % 5 = 0) THEN
                        att_status := 'OD';
                    ELSE
                        att_status := 'PRESENT';
                    END IF;
                END IF;

                INSERT INTO public.attendance (student_id, offering_id, attendance_date, status, marked_by)
                VALUES (st.student_id, co.offering_id, att_date, att_status, co.faculty_id);
            END LOOP;
        END LOOP;
    END LOOP;
END
$$;

-- 14. ASSESSMENTS & MARKS
DO $$
DECLARE
    co RECORD;
    ass_id UUID;
    st RECORD;
BEGIN
    FOR co IN SELECT offering_id, subject_id FROM public.course_offerings LOOP
        INSERT INTO public.assessments (offering_id, assessment_name, assessment_type, max_marks, assessment_date)
        VALUES (co.offering_id, 'Mid-Term Exam', 'EXAM', 100, '2023-10-15')
        RETURNING assessment_id INTO ass_id;

        FOR st IN 
            SELECT s.student_id, SUBSTRING(s.register_number FROM '[0-9]+$')::integer AS num
            FROM public.students s
            JOIN public.subjects sub ON sub.subject_id = co.subject_id AND sub.department_id = s.department_id
        LOOP
            INSERT INTO public.student_marks (student_id, assessment_id, marks_obtained)
            VALUES (st.student_id, ass_id, 60 + ((st.num * 3) % 38));
        END LOOP;
    END LOOP;
END
$$;

-- 15. ASSIGNMENTS & SUBMISSIONS
DO $$
DECLARE
    co RECORD;
    assign_id UUID;
    st RECORD;
BEGIN
    FOR co IN SELECT offering_id, subject_id FROM public.course_offerings LIMIT 1 LOOP
        INSERT INTO public.assignments (offering_id, title, description, due_date, max_marks)
        VALUES (co.offering_id, 'Assignment 1', 'Fundamental algorithms implementation', '2023-09-20', 20)
        RETURNING assignment_id INTO assign_id;

        -- Submit for all students except students with num IN (3, 7, 12)
        FOR st IN 
            SELECT s.student_id, SUBSTRING(s.register_number FROM '[0-9]+$')::integer AS num
            FROM public.students s
            JOIN public.subjects sub ON sub.subject_id = co.subject_id AND sub.department_id = s.department_id
            WHERE SUBSTRING(s.register_number FROM '[0-9]+$')::integer NOT IN (3, 7, 12)
        LOOP
            INSERT INTO public.submissions (assignment_id, student_id, status, marks_awarded)
            VALUES (assign_id, st.student_id, 'SUBMITTED', 18);
        END LOOP;
    END LOOP;
END
$$;

-- Refresh view permissions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_reader') THEN
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO arcgpt_reader;
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO arcgpt_reader;
    END IF;
END
$$;
