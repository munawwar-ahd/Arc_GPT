import { pool } from './db.js';

export interface DepartmentRecord {
  department_id: string;
  department_code: string;
  department_name: string;
  created_at?: string;
}

export class DepartmentService {
  public async getAllDepartments(): Promise<DepartmentRecord[]> {
    const result = await pool.query<DepartmentRecord>(
      `SELECT department_id, department_code, department_name
       FROM public.departments
       ORDER BY department_code ASC`
    );
    return result.rows;
  }

  public async getDepartmentByCode(code: string): Promise<DepartmentRecord | null> {
    if (!code) return null;
    const result = await pool.query<DepartmentRecord>(
      `SELECT department_id, department_code, department_name
       FROM public.departments
       WHERE UPPER(department_code) = UPPER($1)
       LIMIT 1`,
      [code.trim()]
    );
    return result.rows[0] || null;
  }

  public async getDepartmentById(id: string): Promise<DepartmentRecord | null> {
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    const result = await pool.query<DepartmentRecord>(
      `SELECT department_id, department_code, department_name
       FROM public.departments
       WHERE department_id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] || null;
  }
}

export const departmentService = new DepartmentService();
