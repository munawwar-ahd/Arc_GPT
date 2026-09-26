-- =============================================================================
-- ArcGPT — Student Data Model Expansion (schema only, idempotent)
-- =============================================================================
-- Additive migration. Creates no duplicates, drops nothing, and is safe to run
-- more than once. It is safe to run against a database that already has the
-- 180-student seed or the expanded 300-student dataset.
--
-- Design notes are in the file header of the companion seed script. In short:
--   * CGPA is NOT added to `students`. `student_academic_summary` already owns
--     it, and duplicating it would create a second source of truth.
--   * Backlog count is NOT stored as an independent fact. The `backlogs` table
--     is the source of truth and the profile view derives the count from it.
--   * `hostel_allocations` is deliberately left alone; `student_residency` is
--     the single authority for DAY_SCHOLAR vs HOSTELLER.
--
-- Nothing here touches passwords, password hashes or session material. The
-- profile view is read-only and exposes no authentication fields.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. guardians
-- -----------------------------------------------------------------------------
-- One row per family contact. Siblings reference the same guardian, so a
-- guardian's details are never duplicated across student rows.
CREATE TABLE IF NOT EXISTS public.guardians (
    guardian_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_name     TEXT NOT NULL,
    parent_phone    VARCHAR(20) NOT NULL,
    parent_address  TEXT NOT NULL,
    relationship    TEXT NOT NULL DEFAULT 'GUARDIAN',
    email           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.guardians IS
    'Parent/guardian contacts. Shared by siblings via students.parent_id. Contains no authentication data.';

-- parent_name: required, trimmed, sane length.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_parent_name_check') THEN
    ALTER TABLE public.guardians
      ADD CONSTRAINT guardians_parent_name_check
      CHECK (
        parent_name IS NOT NULL
        AND length(btrim(parent_name)) BETWEEN 2 AND 120
        AND parent_name = btrim(parent_name)
      );
  END IF;
END
$do$;

-- parent_phone: VARCHAR (never INTEGER) so a leading +91 survives. Optional
-- spaces, dashes and parentheses are tolerated; 10-15 digits are required.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_parent_phone_check') THEN
    ALTER TABLE public.guardians
      ADD CONSTRAINT guardians_parent_phone_check
      CHECK (
        parent_phone IS NOT NULL
        AND parent_phone ~ '^\+?[0-9][0-9 ()-]{8,18}[0-9]$'
      );
  END IF;
END
$do$;

-- parent_address: free text but must be substantive, not a blank placeholder.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_parent_address_check') THEN
    ALTER TABLE public.guardians
      ADD CONSTRAINT guardians_parent_address_check
      CHECK (length(btrim(parent_address)) BETWEEN 5 AND 500);
  END IF;
END
$do$;

-- relationship: controlled vocabulary, never free text.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_relationship_check') THEN
    ALTER TABLE public.guardians
      ADD CONSTRAINT guardians_relationship_check
      CHECK (relationship IN ('FATHER', 'MOTHER', 'GUARDIAN', 'UNCLE', 'AUNT', 'SIBLING', 'LEGAL_GUARDIAN', 'OTHER'));
  END IF;
END
$do$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_parent_email_check') THEN
    ALTER TABLE public.guardians
      ADD CONSTRAINT guardians_parent_email_check
      CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_guardians_relationship ON public.guardians (relationship);

-- -----------------------------------------------------------------------------
-- 2. students.parent_id
-- -----------------------------------------------------------------------------
-- ON DELETE SET NULL: removing a guardian must not delete a student.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'parent_id'
  ) THEN
    ALTER TABLE public.students ADD COLUMN parent_id UUID;
  END IF;
END
$do$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_parent_id_fkey') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.guardians (guardian_id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_students_parent ON public.students (parent_id);

-- -----------------------------------------------------------------------------
-- 3. hostels and rooms
-- -----------------------------------------------------------------------------
-- Both tables already existed but were empty, so a HOSTELLER could not be
-- assigned anywhere. These are created idempotently and backfilled only if
-- missing; existing hostels/rooms are never modified.
INSERT INTO public.hostels (hostel_id, hostel_name, hostel_type)
SELECT gen_random_uuid(), v.hostel_name, v.hostel_type
FROM (VALUES
    ('Aryabhata Boys Hostel', 'BOYS'),
    ('Sarojini Girls Hostel',  'GIRLS'),
    ('Kalpana Chawla Hostel', 'BOYS'),
    ('Homi Bhabha Hostel',    'BOYS')
) AS v(hostel_name, hostel_type)
WHERE NOT EXISTS (SELECT 1 FROM public.hostels);

-- Room capacity is sized for the expected hosteller population: 4 hostels x 10
-- rooms x ~3 beds seats roughly 120, which covers the configured hosteller
-- percentage of a 300-student cohort.
INSERT INTO public.rooms (room_id, hostel_id, room_number, capacity)
SELECT gen_random_uuid(), h.hostel_id, v.room_number, v.capacity
FROM (VALUES
    ('101', 3::int), ('102', 3), ('103', 3), ('104', 2), ('105', 3),
    ('201', 3),      ('202', 3), ('203', 2), ('204', 3), ('205', 3)
) AS v(room_number, capacity)
CROSS JOIN public.hostels h
WHERE NOT EXISTS (SELECT 1 FROM public.rooms);

-- -----------------------------------------------------------------------------
-- 4. student_residency
-- -----------------------------------------------------------------------------
-- Exactly one row per student. residency_type is the single authority for
-- day-scholar vs hosteller; hostel_allocations is intentionally NOT used as
-- the source of truth for this classification.
CREATE TABLE IF NOT EXISTS public.student_residency (
    residency_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL,
    residency_type TEXT NOT NULL,
    hostel_id      UUID,
    room_id        UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT student_residency_student_id_key UNIQUE (student_id),
    CONSTRAINT student_residency_type_check
      CHECK (residency_type IN ('DAY_SCHOLAR', 'HOSTELLER')),
    CONSTRAINT student_residency_student_fkey
      FOREIGN KEY (student_id) REFERENCES public.students (student_id) ON DELETE CASCADE,
    CONSTRAINT student_residency_hostel_fkey
      FOREIGN KEY (hostel_id) REFERENCES public.hostels (hostel_id) ON DELETE SET NULL,
    CONSTRAINT student_residency_room_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms (room_id) ON DELETE SET NULL,

    -- A day scholar cannot be attached to a hostel or a room.
    CONSTRAINT student_residency_day_scholar_no_hostel_check
      CHECK (residency_type <> 'DAY_SCHOLAR' OR (hostel_id IS NULL AND room_id IS NULL)),

    -- A hosteller must actually be placed somewhere.
    CONSTRAINT student_residency_hosteller_placed_check
      CHECK (residency_type <> 'HOSTELLER' OR hostel_id IS NOT NULL)
);

COMMENT ON TABLE public.student_residency IS
    'One row per student: DAY_SCHOLAR or HOSTELLER, plus hostel/room placement for hostellers.';

CREATE INDEX IF NOT EXISTS idx_student_residency_type ON public.student_residency (residency_type);
CREATE INDEX IF NOT EXISTS idx_student_residency_student ON public.student_residency (student_id);
CREATE INDEX IF NOT EXISTS idx_student_residency_hostel ON public.student_residency (hostel_id);

-- -----------------------------------------------------------------------------
-- 5. student_profile_view
-- -----------------------------------------------------------------------------
-- A single read-only projection for natural-language querying.
--
-- Exposes: identity, academic placement, guardian contact, CGPA (read from
-- student_academic_summary, never stored here), the DERIVED active backlog
-- count (COUNT over `backlogs`, never stored here), residency, and status.
--
-- Deliberately absent: every column of arcgpt_users, including password_hash,
-- and any session or security field. This view cannot reach the users table.
CREATE OR REPLACE VIEW public.student_profile_view AS
SELECT
    s.student_id,
    s.register_number,
    s.admission_number,
    btrim(s.first_name || ' ' || s.last_name)                AS student_name,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.status,
    d.department_id,
    d.department_code,
    d.department_name,
    p.program_code,
    p.program_name,
    bat.batch_name,
    sec.section_name,
    ay.year_name                                           AS academic_year,
    (SELECT sem.semester_number FROM public.semesters sem
      WHERE sem.is_current ORDER BY sem.semester_number DESC LIMIT 1) AS semester_number,
    g.guardian_id                                           AS parent_id,
    g.parent_name,
    g.parent_phone,
    g.parent_address,
    g.relationship                                          AS parent_relationship,
    sa.current_cgpa                                         AS cgpa,
    sa.current_sgpa                                         AS sgpa,
    (SELECT COUNT(*)::int FROM public.backlogs bl
      WHERE bl.student_id = s.student_id AND bl.status = 'ACTIVE') AS current_backlog_count,
    sr.residency_type,
    sr.hostel_id,
    sr.room_id,
    h.hostel_name,
    rm.room_number
FROM public.students s
LEFT JOIN public.departments  d   ON d.department_id     = s.department_id
LEFT JOIN public.programs     p   ON p.program_id        = s.program_id
LEFT JOIN public.batches     bat ON bat.batch_id        = s.batch_id
LEFT JOIN public.sections    sec ON sec.section_id      = s.section_id
LEFT JOIN public.academic_years ay ON ay.academic_year_id = bat.academic_year_id
LEFT JOIN public.guardians   g   ON g.guardian_id       = s.parent_id
LEFT JOIN public.student_academic_summary sa ON sa.student_id = s.student_id
LEFT JOIN public.student_residency sr ON sr.student_id    = s.student_id
LEFT JOIN public.hostels     h   ON h.hostel_id         = sr.hostel_id
LEFT JOIN public.rooms       rm  ON rm.room_id          = sr.room_id;

COMMENT ON VIEW public.student_profile_view IS
    'Read-only student profile projection including guardian contact, CGPA and derived active backlog count. Contains no authentication or session data.';

-- -----------------------------------------------------------------------------
-- 6. Grants for the read-only query role
-- -----------------------------------------------------------------------------
-- file1.sql grants SELECT to arcgpt_reader from a hardcoded table list, which
-- cannot know about tables added later. A PostgreSQL view also does NOT inherit
-- the privileges of the tables it reads: the view has its own owner and needs
-- its own GRANT. Without this the read-only pool is denied
-- student_profile_view entirely, and every profile query fails with
-- "permission denied for view" no matter how correct the generated SQL is.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arcgpt_reader') THEN
    EXECUTE 'GRANT SELECT ON public.guardians TO arcgpt_reader';
    EXECUTE 'GRANT SELECT ON public.student_residency TO arcgpt_reader';
    EXECUTE 'GRANT SELECT ON public.student_profile_view TO arcgpt_reader';
  END IF;
END
$do$;

COMMIT;
