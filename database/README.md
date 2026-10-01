# ArcGPT — `arcgpt_new` database build

The college ERP database that ArcGPT queries. Built for the `arcgpt_new`
database on PostgreSQL 16.

> **Safety.** Every file in this directory refuses to run against any database
> other than `arcgpt_new`. Each one opens with a `current_database()` guard that
> raises and makes **no** changes if the connection points elsewhere. Other
> databases on this server belong to other projects and are never referenced.

---

## Build order

Apply in this order. The runner does it for you.

| # | File | What it creates |
| --- | --- | --- |
| 01 | `01_control_tables.sql` | ArcGPT's own control schema: roles, permissions, `arcgpt_users`, `arcgpt_sessions`, query log, saved queries, conversations, messages, feedback, audit and security logs, system settings |
| 02 | `02_institution_tables.sql` | The 30 ERP tables: academic structure, people, subjects and delivery, assessment, attendance, timetable, fees, hostel |
| 03 | `03_indexes.sql` | Every foreign key indexed, plus the reporting access patterns |
| 04 | `04_views.sql` | The 11 `v_*` read models the LLM queries instead of hand-written joins |
| 05 | `05_seed_reference.sql` | Academic calendar, days, period slots, departments, programmes, faculty, classrooms, fee types, hostels and rooms |
| 06 | `06_seed_subjects.sql` | The subject catalogue: shared engineering core plus per-department core and electives, all 8 semesters |
| 07 | `07_seed_structure_students.sql` | Batches, sections, 320 students, guardians |
| 08 | `08_seed_delivery.sql` | Course offerings, faculty assignments, the weekly timetable, student enrolments |
| 09 | `09_seed_academic_records.sql` | Marks, IAT 1-3, attendance, published GPA/CGPA, backlogs |
| 10 | `10_seed_finance_hostel.sql` | Fee structure, bills, the payment ledger, hostel allocations, demo app users |
| 11 | `11_permissions.sql` | The `arcgpt_user` and `arcgpt_new_reader` roles and their grants |
| 12 | `12_verify.sql` | Read-only verification. Reports row counts, data spread, invariants and live answers to the example questions |

### Run everything

```powershell
powershell -ExecutionPolicy Bypass -File database\run_all.ps1
```

With `-Reset` it first drops and recreates the `public` schema **inside
`arcgpt_new`**. It never drops the database itself.

```powershell
# from a clean database
powershell -ExecutionPolicy Bypass -File database\run_all.ps1 -Reset

# verify only
psql -h localhost -U <superuser> -d arcgpt_new -f database\12_verify.sql
```

> `11_permissions.sql` creates roles and sets role attributes, so it needs a
> **superuser** connection. The runner defaults to `-DbUser postgres`. Every
> other file runs fine as an ordinary database owner.

### By hand in pgAdmin 4

Open the query tool with `arcgpt_new` selected, then run each file in numeric
order. The guard at the top of each file means running one against the wrong
database is a no-op error rather than a mess.

---

## The two runtime roles

| Role | Pool | Can do |
| --- | --- | --- |
| `arcgpt_user` | `DB_USER` | Auth, sessions, conversations, query log, audit, CSV import. Reads every institution table and view. Writes only the control tables. Not a superuser, cannot create databases or roles. |
| `arcgpt_new_reader` | `DB_READONLY_USER` | **The only role generated SQL ever runs as.** `SELECT` on institution tables and views. No privilege whatsoever on the control tables. |

`DB_READONLY_*` is not optional. Without it, `readerPool` aliases the admin pool
and the only thing preventing a write is the validator plus `BEGIN READ ONLY`.

A separate reader role is used rather than the pre-existing `arcgpt_reader`,
which holds `SELECT` on tables in a **different project's** database and is
therefore left completely untouched.

---

## Schema

### Read models — query these

| View | Answers |
| --- | --- |
| `v_student_directory` | Everything about a student, with `mother_`/`father_`/`guardian_` contact columns pivoted in |
| `student_academic_summary` | One row per student: `current_cgpa`, `current_backlog_count`, `overall_attendance_percentage` |
| `v_marks_detail` | Every published mark with subject, semester, academic year, percentage, grade point, letter grade, pass/fail |
| `v_iat_marks` | IAT 1, 2 and 3 side by side out of 40, plus total and average |
| `v_attendance_detail` | Per student per subject: total, attended, absent, and the computed percentage |
| `v_student_attendance_summary` | One row per student, overall and worst-subject attendance |
| `v_backlog_detail` | Every backlog with its subject, semester and `ACTIVE`/`CLEARED` state |
| `v_student_cgpa` | Per student per semester `semester_gpa` and running `cgpa_cumulative`, derived from marks. Keyed on `student_id` — join `v_student_directory` to name a student |
| `v_timetable_detail` | The weekly grid: day, period, start/end time, subject, faculty, section, classroom |
| `v_fee_status` | Bills with `amount_paid` summed from payments and `amount_pending` computed |
| `v_hostel_allocation` | Who lives in which hostel room |

### Design decisions worth knowing

**Derived values are never stored.** Attendance percentage, GPA, CGPA, amount
paid and amount pending are all computed in views from base facts, so they cannot
drift out of sync with the data they summarise. The only duplicated values are
`semester_results.semester_gpa` / `cgpa_cumulative`, which the college actually
publishes — and `v_student_cgpa` recomputes them so the derived figure is always
available and auditable.

**`semesters` holds positions, not calendar instances.** There are exactly 8
rows, shared by every academic year. That is what lets `Database Management
Systems` be **one** subject row reused by every section and every student, rather
than duplicated per cohort. The year-specific fact — which subject went to which
section in which year — lives in `course_offerings.academic_year_id`.

**`course_offerings` is the bridge.** A subject delivered to a section in an
academic year, taught by one faculty member. `student_marks`, `iat_marks`,
`attendance` and `timetable` all hang off `offering_id`, which is what makes
"this student's DBMS mark in semester 3" a well-defined question.

**No future data.** A student in year *N* during 2024-25 has completed semesters
`1..2N-1` and is sitting `2N`. Completed semesters have marks; the current
semester has attendance and IATs but no end-semester marks; later semesters have
nothing at all. So "future marks" cannot be invented — there is no row to find.

**No comma-separated values anywhere.** A student's subjects are
`student_enrollments` rows; their backlogs are `backlogs` rows; their guardians
are `guardians` rows distinguished by `relation_type`.

**Attendance is counts, not a bare percentage.** `total_classes`,
`classes_attended`, `classes_absent`, with a CHECK that attended + absent can
never exceed total.

---

## Demo data

All fictional. Names come from fictional Indian name pools; every contact number
uses the reserved documentation prefixes `90000` and `98765` so no real subscriber
can be matched. Emails use `@arccollege.edu` and `@example.invalid`.

Marks are not uniform noise. A latent per-student ability score
(`arc_rand('ability' || register_number, 34, 95)`) drives every mark, so strong
students score well across the board and end up with high CGPA and no backlogs,
while weaker students accumulate failures. Attendance uses a related but
independent scale, so the dataset contains clear high, borderline and chronic
absentee students.

Because the generator is an md5 hash of a seed string rather than `random()`, the
whole dataset is **deterministic**: a rebuild produces byte-identical data, so
diffs and review are meaningful.

Current spread:

- 4 departments (AIML, CSE, ECE, MECH), 4 batches, 32 sections, 320 students
- 132 subjects across all 8 semesters
- average CGPA ≈ 6.6, average attendance ≈ 83%, ~12% of marks are a fail
- fees in all three states: fully paid, partially paid, unpaid

---

## Connecting ArcGPT

`backend/.env`:

```ini
DB_HOST=localhost
DB_PORT=5432
DB_NAME=arcgpt_new
DB_USER=arcgpt_user
DB_PASSWORD=<local secret>
DB_READONLY_USER=arcgpt_new_reader
DB_READONLY_PASSWORD=<local secret>
```

Never put any of these in a `VITE_*` variable. Those are inlined into the public
browser bundle at build time.

If you change the roles' passwords in PostgreSQL, update `.env` to match — the
`psql` runner in this folder also takes `-DbUser` / `-DbPass`.
