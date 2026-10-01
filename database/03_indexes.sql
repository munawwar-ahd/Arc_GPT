-- ============================================================================
-- ArcGPT — 03_indexes.sql
-- Target database: arcgpt_new   (ONLY. Never arcgpt_institution.)
--
-- Indexes sized for the two access patterns that matter: the SQL-generation
-- model's joins (every FK is indexed) and the chat's per-student lookups.
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'arcgpt_new' THEN
        RAISE EXCEPTION
            'SAFETY ABORT: 03_indexes.sql may only run against arcgpt_new, but the connection is targeting "%". No changes were made.',
            current_database();
    END IF;
END
$$;

-- --- Control plane ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_arcgpt_users_role       ON public.arcgpt_users(role);
CREATE INDEX IF NOT EXISTS idx_arcgpt_sessions_expiry  ON public.arcgpt_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_queries_user         ON public.ai_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_queries_status      ON public.ai_queries(query_status);
CREATE INDEX IF NOT EXISTS idx_ai_queries_created     ON public.ai_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_queries_user     ON public.saved_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user     ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated  ON public.ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation  ON public.ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_query         ON public.feedback(query_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created     ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action      ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events(created_at DESC);

-- --- Academic structure ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_academic_years_current ON public.academic_years(is_current);
CREATE INDEX IF NOT EXISTS idx_programs_department   ON public.programs(department_id);
CREATE INDEX IF NOT EXISTS idx_batches_department    ON public.batches(department_id);
CREATE INDEX IF NOT EXISTS idx_batches_academic_year ON public.batches(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_semesters_number      ON public.semesters(semester_number);
CREATE INDEX IF NOT EXISTS idx_sections_department   ON public.sections(department_id);
CREATE INDEX IF NOT EXISTS idx_sections_batch        ON public.sections(batch_id);
CREATE INDEX IF NOT EXISTS idx_sections_year_of_study ON public.sections(year_of_study_id);

-- --- People ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_faculty_department     ON public.faculty(department_id);
CREATE INDEX IF NOT EXISTS idx_faculty_subjects_fac   ON public.faculty_subjects(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_subjects_subj  ON public.faculty_subjects(subject_id);

CREATE INDEX IF NOT EXISTS idx_students_department    ON public.students(department_id);
CREATE INDEX IF NOT EXISTS idx_students_batch         ON public.students(batch_id);
CREATE INDEX IF NOT EXISTS idx_students_section       ON public.students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_year_of_study ON public.students(current_year_of_study_id);
CREATE INDEX IF NOT EXISTS idx_students_semester      ON public.students(current_semester_id);
CREATE INDEX IF NOT EXISTS idx_students_residence     ON public.students(residence_status);
CREATE INDEX IF NOT EXISTS idx_students_status        ON public.students(status);
-- Department-wide aggregates ("how many AIML students are hostellers").
CREATE INDEX IF NOT EXISTS idx_students_dept_residence
    ON public.students(department_id, residence_status);

CREATE INDEX IF NOT EXISTS idx_guardians_student      ON public.guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_guardians_relation     ON public.guardians(student_id, relation_type);

-- --- Subjects and delivery -------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subjects_department    ON public.subjects(department_id);
CREATE INDEX IF NOT EXISTS idx_subjects_semester      ON public.subjects(semester_id);
CREATE INDEX IF NOT EXISTS idx_subjects_code          ON public.subjects(subject_code);
CREATE INDEX IF NOT EXISTS idx_subjects_name          ON public.subjects(subject_name);

CREATE INDEX IF NOT EXISTS idx_offerings_subject      ON public.course_offerings(subject_id);
CREATE INDEX IF NOT EXISTS idx_offerings_section      ON public.course_offerings(section_id);
CREATE INDEX IF NOT EXISTS idx_offerings_faculty      ON public.course_offerings(faculty_id);
CREATE INDEX IF NOT EXISTS idx_offerings_academic     ON public.course_offerings(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student    ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_offering   ON public.student_enrollments(offering_id);

-- --- Assessment ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_marks_student          ON public.student_marks(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_offering         ON public.student_marks(offering_id);
CREATE INDEX IF NOT EXISTS idx_marks_result           ON public.student_marks(result_status);

CREATE INDEX IF NOT EXISTS idx_iat_student            ON public.iat_marks(student_id);
CREATE INDEX IF NOT EXISTS idx_iat_offering           ON public.iat_marks(offering_id);
CREATE INDEX IF NOT EXISTS idx_iat_number             ON public.iat_marks(iat_number);

CREATE INDEX IF NOT EXISTS idx_semester_results_student ON public.semester_results(student_id);
CREATE INDEX IF NOT EXISTS idx_semester_results_sem    ON public.semester_results(semester_id);

CREATE INDEX IF NOT EXISTS idx_backlogs_student        ON public.backlogs(student_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_subject        ON public.backlogs(subject_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_status         ON public.backlogs(status);

-- --- Attendance ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_student     ON public.attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_offering    ON public.attendance(offering_id);

-- --- Timetable -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_timetable_section      ON public.timetable(section_id);
CREATE INDEX IF NOT EXISTS idx_timetable_offering     ON public.timetable(offering_id);
CREATE INDEX IF NOT EXISTS idx_timetable_faculty      ON public.timetable(faculty_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slot         ON public.timetable(weekday_id, period_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_department  ON public.classrooms(department_id);

-- --- Fees ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_fee_structure_type     ON public.fee_structure(fee_type_id);
CREATE INDEX IF NOT EXISTS idx_fee_structure_year     ON public.fee_structure(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_student   ON public.student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_type      ON public.student_fees(fee_type_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_year      ON public.student_fees(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_fee       ON public.fee_payments(student_fee_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_date      ON public.fee_payments(payment_date);

-- --- Hostel ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hostel_rooms_hostel    ON public.hostel_rooms(hostel_id);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_student   ON public.hostel_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_room      ON public.hostel_allocations(room_id);
