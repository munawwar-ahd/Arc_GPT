import { pool } from './db.js';
import { User } from '../types/index.js';
import { auditService } from './audit.service.js';

export interface StudentRecord {
  student_id: string;
  register_number: string;
  admission_number?: string | null;
  first_name: string;
  last_name: string;
  department_id: string;
  department_code?: string;
  department_name?: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
}

export class StudentService {
  /**
   * Get students with department scoping.
   * If the authenticated user is an HOD, the department filter is STRICTLY enforced
   * from the HOD's server-side assigned department.
   */
  public async getStudents(
    currentUser: User,
    options: { requestedDepartmentId?: string; status?: string; limit?: number; offset?: number } = {}
  ): Promise<{ students: StudentRecord[]; total: number }> {
    const isHod = currentUser.role.toUpperCase() === 'HOD';
    const limit = Math.min(Math.max(options.limit || 50, 1), 500);
    const offset = Math.max(options.offset || 0, 0);

    let effectiveDepartmentId = options.requestedDepartmentId;

    if (isHod) {
      // STRICT HOD ENFORCEMENT: ignore client-provided department, use authenticated HOD department
      effectiveDepartmentId = currentUser.departmentId ? String(currentUser.departmentId) : undefined;
      if (!effectiveDepartmentId && currentUser.departmentCode) {
        // Resolve from department code
        const deptRes = await pool.query<{ department_id: string }>(
          `SELECT department_id FROM public.departments WHERE UPPER(department_code) = UPPER($1) LIMIT 1`,
          [currentUser.departmentCode]
        );
        effectiveDepartmentId = deptRes.rows[0]?.department_id;
      }
    }

    const conditions: string[] = [];
    const params: any[] = [];

    if (effectiveDepartmentId) {
      params.push(effectiveDepartmentId);
      conditions.push(`s.department_id = $${params.length}`);
    }

    if (options.status) {
      params.push(options.status.toUpperCase());
      conditions.push(`s.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*)::int AS total FROM public.students s ${whereClause}`;
    const countRes = await pool.query<{ total: number }>(countQuery, params);
    const total = countRes.rows[0]?.total || 0;

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const query = `
      SELECT s.student_id, s.register_number, s.admission_number, s.first_name, s.last_name,
             s.department_id, d.department_code, d.department_name, s.status, s.email, s.phone,
             s.created_at
      FROM public.students s
      LEFT JOIN public.departments d ON d.department_id = s.department_id
      ${whereClause}
      ORDER BY s.register_number ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query<StudentRecord>(query, params);
    return { students: result.rows, total };
  }

  public async getStudentById(studentId: string): Promise<StudentRecord | null> {
    if (!studentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)) {
      return null;
    }
    const result = await pool.query<StudentRecord>(
      `SELECT s.student_id, s.register_number, s.admission_number, s.first_name, s.last_name,
              s.department_id, d.department_code, d.department_name, s.status, s.email, s.phone,
              s.created_at
       FROM public.students s
       LEFT JOIN public.departments d ON d.department_id = s.department_id
       WHERE s.student_id = $1 LIMIT 1`,
      [studentId]
    );
    return result.rows[0] || null;
  }

  /**
   * Soft-delete student: updates status to INACTIVE.
   * Does NOT physically delete the database row, preserving historical marks & attendance.
   */
  public async removeStudent(studentId: string, actorUser: User, reason?: string): Promise<StudentRecord> {
    const student = await this.getStudentById(studentId);
    if (!student) {
      throw new Error('Student not found.');
    }

    // If HOD, verify student belongs to HOD's department
    if (actorUser.role.toUpperCase() === 'HOD') {
      const hodDeptId = actorUser.departmentId ? String(actorUser.departmentId) : null;
      const hodDeptCode = actorUser.departmentCode ? actorUser.departmentCode.toUpperCase() : null;
      const matchesDept = (hodDeptId && student.department_id === hodDeptId) ||
                          (hodDeptCode && student.department_code?.toUpperCase() === hodDeptCode);
      if (!matchesDept) {
        throw new Error('FORBIDDEN_CROSS_DEPARTMENT: You cannot remove a student from another department.');
      }
    }

    const updatedResult = await pool.query<StudentRecord>(
      `UPDATE public.students
       SET status = 'INACTIVE'
       WHERE student_id = $1
       RETURNING student_id, register_number, admission_number, first_name, last_name,
                 department_id, status, email, phone, created_at`,
      [studentId]
    );

    const updated = updatedResult.rows[0];

    await auditService.logEvent({
      requestId: `student_remove_${Date.now()}`,
      userId: actorUser.id,
      action: 'STUDENT_REMOVED',
      resource: 'STUDENTS',
      status: 'SUCCESS',
      details: JSON.stringify({
        student_id: student.student_id,
        register_number: student.register_number,
        name: `${student.first_name} ${student.last_name}`.trim(),
        department_code: student.department_code,
        previous_status: student.status,
        new_status: 'INACTIVE',
        reason: reason || 'Admin action',
      }),
    });

    return updated;
  }

  /**
   * Reactivate student: restores status to ACTIVE.
   */
  public async reactivateStudent(studentId: string, actorUser: User): Promise<StudentRecord> {
    const student = await this.getStudentById(studentId);
    if (!student) {
      throw new Error('Student not found.');
    }

    const updatedResult = await pool.query<StudentRecord>(
      `UPDATE public.students
       SET status = 'ACTIVE'
       WHERE student_id = $1
       RETURNING student_id, register_number, admission_number, first_name, last_name,
                 department_id, status, email, phone, created_at`,
      [studentId]
    );

    const updated = updatedResult.rows[0];

    await auditService.logEvent({
      requestId: `student_reactivate_${Date.now()}`,
      userId: actorUser.id,
      action: 'STUDENT_REACTIVATED',
      resource: 'STUDENTS',
      status: 'SUCCESS',
      details: JSON.stringify({
        student_id: student.student_id,
        register_number: student.register_number,
        name: `${student.first_name} ${student.last_name}`.trim(),
        department_code: student.department_code,
        previous_status: student.status,
        new_status: 'ACTIVE',
      }),
    });

    return updated;
  }
}

export const studentService = new StudentService();
