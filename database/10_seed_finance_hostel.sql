-- ============================================================================
-- ArcGPT — 10_seed_finance_hostel.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Fee structure, per-student bills, the payment ledger and hostel allocation.
--
-- amount_pending is NEVER stored on student_fees. It is computed in
-- v_fee_status as  total_amount - discount - SUM(fee_payments.amount),
-- so a bill and its payments can never disagree.
--
-- Payment states are spread deliberately: fully paid, partially paid and
-- completely unpaid, for both college and hostel fees.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 10_seed_finance_hostel.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.arc_rand(p_seed TEXT, p_lo INT, p_hi INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_lo + abs(('x' || substr(md5(p_seed), 1, 8))::bit(32)::int) % (p_hi - p_lo + 1);
$$;

-- ---------------------------------------------------------------------------
-- Published fee amounts, per department per academic year.
-- Fees genuinely differ by department, so there is one row per
-- (fee type, academic year, department).
-- ---------------------------------------------------------------------------
INSERT INTO public.fee_structure (fee_type_id, academic_year_id, department_id, amount)
SELECT
    ft.fee_type_id,
    ay.academic_year_id,
    d.department_id,
    (CASE ft.fee_type_code
        WHEN 'COLLEGE_FEE' THEN
            CASE d.department_code
                WHEN 'AIML' THEN 125000
                WHEN 'ECE'  THEN 112000
                ELSE 100000
            END
        WHEN 'HOSTEL_FEE'  THEN 65000
        WHEN 'EXAM_FEE'    THEN 3500
        WHEN 'LIBRARY_FEE' THEN 2500
        WHEN 'TRANSIT_FEE' THEN 8000
    END + (ay.start_year - 2021) * 2500)::numeric
FROM public.fee_types ft
CROSS JOIN public.academic_years ay
CROSS JOIN public.departments d
WHERE NOT EXISTS (
    SELECT 1 FROM public.fee_structure fs
    WHERE fs.fee_type_id = ft.fee_type_id
      AND fs.academic_year_id = ay.academic_year_id
      AND fs.department_id = d.department_id
);

-- ---------------------------------------------------------------------------
-- Bills — college fee for every student every year they have been enrolled,
-- hostel fee only for hostellers.
-- ---------------------------------------------------------------------------
INSERT INTO public.student_fees
    (student_id, fee_type_id, academic_year_id, semester_id, total_amount, discount, due_date)
SELECT
    b.student_id,
    ft.fee_type_id,
    ay.academic_year_id,
    NULL,
    fs.amount,
    -- A small scholarship for a deterministic minority.
    CASE WHEN pg_temp.arc_rand('disc' || b.student_id || ft.fee_type_code, 1, 100) <= 12
         THEN ROUND(fs.amount * 0.25, 2) ELSE 0 END,
    DATE (ay.start_year || '-09-30')
FROM (
    SELECT DISTINCT s.student_id, b.admission_year, s.department_id
    FROM public.students s
    JOIN public.batches b ON b.batch_id = s.batch_id
) b
JOIN public.academic_years ay ON ay.start_year = b.admission_year
JOIN public.fee_types ft ON ft.fee_type_code = 'COLLEGE_FEE'
JOIN public.fee_structure fs
     ON fs.fee_type_id = ft.fee_type_id
    AND fs.academic_year_id = ay.academic_year_id
    AND fs.department_id = b.department_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.student_fees sf
    WHERE sf.student_id = b.student_id
      AND sf.fee_type_id = ft.fee_type_id
      AND sf.academic_year_id = ay.academic_year_id
      AND sf.semester_id IS NULL
);

-- Hostel bills for hostellers only.
INSERT INTO public.student_fees
    (student_id, fee_type_id, academic_year_id, semester_id, total_amount, discount, due_date)
SELECT
    b.student_id,
    ft.fee_type_id,
    ay.academic_year_id,
    NULL,
    fs.amount,
    0,
    DATE (ay.start_year || '-08-31')
FROM (
    SELECT DISTINCT s.student_id, b.admission_year, s.department_id
    FROM public.students s
    JOIN public.batches b ON b.batch_id = s.batch_id
    WHERE s.residence_status = 'HOSTELLER'
) b
JOIN public.academic_years ay ON ay.start_year = b.admission_year
JOIN public.fee_types ft ON ft.fee_type_code = 'HOSTEL_FEE'
JOIN public.fee_structure fs
     ON fs.fee_type_id = ft.fee_type_id
    AND fs.academic_year_id = ay.academic_year_id
    AND fs.department_id = b.department_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.student_fees sf
    WHERE sf.student_id = b.student_id
      AND sf.fee_type_id = ft.fee_type_id
      AND sf.academic_year_id = ay.academic_year_id
      AND sf.semester_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Payments — the ledger. v_fee_status sums this to derive amount_paid.
--
-- Distribution is deliberate so all three payment states are answerable:
--   ~15% fully paid, ~35% partially paid, ~50% unpaid.
-- ---------------------------------------------------------------------------
INSERT INTO public.fee_payments
    (student_fee_id, amount, payment_date, payment_mode, reference_no, collected_by)
SELECT
    sf.student_fee_id,
    pay.amount,
    pay.payment_date,
    pay.payment_mode,
    'RCPT-' || pay.payment_date::text || '-' || lpad((row_number() OVER (ORDER BY sf.student_fee_id))::int::text, 7, '0'),
    (SELECT f.faculty_id FROM public.faculty f
      ORDER BY pg_temp.arc_rand('cashier' || sf.student_fee_id || f.employee_id, 1, 100000) LIMIT 1)
FROM public.student_fees sf
JOIN public.academic_years ay ON ay.academic_year_id = sf.academic_year_id
CROSS JOIN LATERAL (
    SELECT
        sf.total_amount - sf.discount AS payable,
        pg_temp.arc_rand('payroll' || sf.student_fee_id, 1, 100) AS roll
) base
CROSS JOIN LATERAL (
    SELECT
        CASE
            WHEN base.roll <= 15 THEN base.payable                              -- fully paid
            WHEN base.roll <= 50 THEN ROUND(base.payable
                        * pg_temp.arc_rand('partial' || sf.student_fee_id, 20, 90) / 100.0, 2)
            ELSE NULL                                                          -- unpaid
        END AS amount,
        CASE
            WHEN base.roll <= 50
            THEN DATE (ay.start_year || '-' ||
                 lpad(pg_temp.arc_rand('paymonth' || sf.student_fee_id, 6, 9)::text, 2, '0') || '-' ||
                 lpad(pg_temp.arc_rand('payday' || sf.student_fee_id, 1, 28)::text, 2, '0'))
            ELSE NULL
        END AS payment_date,
        (ARRAY['UPI','NETBANKING','CARD','CASH','CHEQUE','DD']::text[])
            [pg_temp.arc_rand('paymode' || sf.student_fee_id, 1, 6)] AS payment_mode
) pay
WHERE pay.amount IS NOT NULL
  AND pay.amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.fee_payments fp WHERE fp.student_fee_id = sf.student_fee_id
  );

-- ---------------------------------------------------------------------------
-- Hostel allocation — hostellers only, into a hostel matching their gender.
-- Room occupancy is then recomputed from the allocations so it cannot drift.
-- ---------------------------------------------------------------------------
WITH hostellers AS (
    SELECT
        s.student_id,
        s.gender,
        row_number() OVER (PARTITION BY s.gender ORDER BY s.register_number) AS rn
    FROM public.students s
    WHERE s.residence_status = 'HOSTELLER'
      AND pg_temp.arc_rand('roomalloc' || s.student_id, 1, 100) <= 85
),
rooms AS (
    SELECT
        hr.room_id,
        hr.capacity,
        h.hostel_type,
        row_number() OVER (PARTITION BY h.hostel_type ORDER BY hr.room_number) AS room_seq,
        count(*)     OVER (PARTITION BY h.hostel_type)                            AS room_count
    FROM public.hostel_rooms hr
    JOIN public.hostels h ON h.hostel_id = hr.hostel_id
),
assigned AS (
    -- Round-robin across the rooms, so occupancy spreads evenly instead of
    -- every student landing in the first room alphabetically. Matching on the
    -- computed room index yields exactly ONE room per student.
    SELECT
        ho.student_id,
        r.room_id,
        r.capacity
    FROM hostellers ho
    JOIN rooms r
      ON r.hostel_type = CASE WHEN ho.gender = 'MALE' THEN 'BOYS' ELSE 'GIRLS' END
     AND r.room_seq = ((ho.rn - 1) % r.room_count) + 1
),
seated AS (
    -- Round-robin spreads students across rooms, but a 2-bed room can still
    -- receive a third student, so cap each room at its own capacity.
    SELECT
        a.student_id,
        a.room_id,
        a.capacity,
        row_number() OVER (PARTITION BY a.room_id ORDER BY a.student_id) AS seat_in_room
    FROM assigned a
)
INSERT INTO public.hostel_allocations
    (student_id, room_id, academic_year_id, allocated_on, vacated_on, status)
SELECT
    s.student_id,
    s.room_id,
    ay.academic_year_id,
    DATE (ay.start_year || '-07-20'),
    NULL,
    'ALLOCATED'
FROM seated s
JOIN public.academic_years ay ON ay.is_current
WHERE s.seat_in_room <= s.capacity
  AND NOT EXISTS (
      SELECT 1 FROM public.hostel_allocations ha
      WHERE ha.student_id = s.student_id
        AND ha.academic_year_id = ay.academic_year_id
  );

-- Occupancy recomputed from the allocations, not maintained by hand.
UPDATE public.hostel_rooms hr
SET occupied_count = COALESCE(occ.n, 0)
FROM (
    SELECT room_id, count(*)::int AS n
    FROM public.hostel_allocations
    WHERE status = 'ALLOCATED'
    GROUP BY room_id
) occ
WHERE hr.room_id = occ.room_id;

-- ---------------------------------------------------------------------------
-- Two live ArcGPT application users matching the demo roles, so the admin panel
-- has real accounts to switch between.
--
-- DEMO CREDENTIALS — email admin@institution.edu / principal@institution.edu,
-- password AdminPassword123! (bcrypt cost 12). Change both immediately in any
-- real deployment; LOCAL_ADMIN_PASSWORD in backend/.env re-bootstraps the admin.
-- ---------------------------------------------------------------------------
INSERT INTO public.arcgpt_users (full_name, email, password_hash, role, department_code, department_id, status)
VALUES
    ('ArcGPT Administrator', 'admin@institution.edu',
     '$2b$12$VxdTNxQLHyQ7kvcnkGYPVOtbVWVv1x8FfS.q359vvGDZvmz6Ydf7K',
     'ADMIN', NULL, NULL, 'ACTIVE'),
    ('Dr. Srinivasan Alavandar', 'principal@institution.edu',
     '$2b$12$VxdTNxQLHyQ7kvcnkGYPVOtbVWVv1x8FfS.q359vvGDZvmz6Ydf7K',
     'PRINCIPAL', NULL, NULL, 'ACTIVE')
ON CONFLICT (email) DO NOTHING;
