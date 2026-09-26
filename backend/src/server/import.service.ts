import { pool } from './db.js';
import { User } from '../types/index.js';
import { auditService } from './audit.service.js';

export const ALLOWED_IMPORT_TABLES = [
  'students',
  'faculty',
  'departments',
  'subjects',
  'attendance',
  'student_marks',
  'assignments',
  'backlogs',
] as const;

export type ImportTableName = (typeof ALLOWED_IMPORT_TABLES)[number];

export interface ImportFieldDefinition {
  name: string;
  label: string;
  required: boolean;
  type: 'string' | 'email' | 'number' | 'date' | 'uuid';
  description: string;
  sample: string;
}

export interface TableImportConfig {
  tableName: ImportTableName;
  fields: ImportFieldDefinition[];
  dbTable: string;
  uniqueKey?: string;
}

export const IMPORT_CONFIGS: Record<ImportTableName, TableImportConfig> = {
  departments: {
    tableName: 'departments',
    dbTable: 'public.departments',
    uniqueKey: 'department_code',
    fields: [
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Unique code e.g. AIML, CSE', sample: 'AI_DS' },
      { name: 'department_name', label: 'Department Name', required: true, type: 'string', description: 'Full name', sample: 'Artificial Intelligence and Data Science' },
    ],
  },
  students: {
    tableName: 'students',
    dbTable: 'public.students',
    uniqueKey: 'register_number',
    fields: [
      { name: 'register_number', label: 'Register Number', required: true, type: 'string', description: 'Unique institution registration number', sample: '24AIML001' },
      { name: 'first_name', label: 'First Name', required: true, type: 'string', description: 'First name', sample: 'Rahul' },
      { name: 'last_name', label: 'Last Name', required: true, type: 'string', description: 'Last name', sample: 'Kumar' },
      { name: 'email', label: 'Email', required: false, type: 'email', description: 'Student email address', sample: 'rahul.kumar@arcai.edu' },
      { name: 'phone', label: 'Phone', required: false, type: 'string', description: 'Phone number', sample: '9876543210' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Existing department code', sample: 'AIML' },
      { name: 'admission_number', label: 'Admission Number', required: false, type: 'string', description: 'Unique admission number', sample: 'ADM-2024-001' },
      { name: 'status', label: 'Status', required: false, type: 'string', description: 'ACTIVE, INACTIVE, ALUMNI, SUSPENDED', sample: 'ACTIVE' },
    ],
  },
  faculty: {
    tableName: 'faculty',
    dbTable: 'public.faculty',
    uniqueKey: 'employee_id',
    fields: [
      { name: 'employee_id', label: 'Employee ID', required: true, type: 'string', description: 'Unique faculty employee ID', sample: 'EMP-AIML-010' },
      { name: 'first_name', label: 'First Name', required: true, type: 'string', description: 'First name', sample: 'Priya' },
      { name: 'last_name', label: 'Last Name', required: true, type: 'string', description: 'Last name', sample: 'Nair' },
      { name: 'designation', label: 'Designation', required: true, type: 'string', description: 'e.g. Assistant Professor, Professor', sample: 'Associate Professor' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Existing department code', sample: 'AIML' },
      { name: 'email', label: 'Email', required: false, type: 'email', description: 'Faculty email', sample: 'priya.nair@arcai.edu' },
      { name: 'phone', label: 'Phone', required: false, type: 'string', description: 'Phone number', sample: '9876501234' },
    ],
  },
  subjects: {
    tableName: 'subjects',
    dbTable: 'public.subjects',
    uniqueKey: 'subject_code',
    fields: [
      { name: 'subject_code', label: 'Subject Code', required: true, type: 'string', description: 'Unique subject code', sample: 'AI301' },
      { name: 'subject_name', label: 'Subject Name', required: true, type: 'string', description: 'Full subject title', sample: 'Deep Learning and Neural Networks' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Existing department code', sample: 'AIML' },
      { name: 'credits', label: 'Credits', required: false, type: 'number', description: 'Course credit value', sample: '4.0' },
    ],
  },
  attendance: {
    tableName: 'attendance',
    dbTable: 'public.attendance',
    fields: [
      { name: 'register_number', label: 'Student Register Number', required: true, type: 'string', description: 'Student identifier', sample: '24AIML001' },
      { name: 'attendance_date', label: 'Date', required: true, type: 'date', description: 'YYYY-MM-DD', sample: '2025-02-15' },
      { name: 'status', label: 'Status', required: true, type: 'string', description: 'PRESENT, ABSENT, OD, LATE', sample: 'PRESENT' },
      { name: 'remarks', label: 'Remarks', required: false, type: 'string', description: 'Optional comments', sample: 'On time' },
    ],
  },
  student_marks: {
    tableName: 'student_marks',
    dbTable: 'public.student_marks',
    fields: [
      { name: 'register_number', label: 'Student Register Number', required: true, type: 'string', description: 'Student identifier', sample: '24AIML001' },
      { name: 'marks_obtained', label: 'Marks Obtained', required: true, type: 'number', description: 'Numeric score', sample: '88.5' },
      { name: 'max_marks', label: 'Max Marks', required: false, type: 'number', description: 'Maximum score possible', sample: '100' },
      { name: 'grade', label: 'Grade', required: false, type: 'string', description: 'Letter grade e.g. A, B+', sample: 'A+' },
    ],
  },
  assignments: {
    tableName: 'assignments',
    dbTable: 'public.assignments',
    fields: [
      { name: 'title', label: 'Title', required: true, type: 'string', description: 'Assignment title', sample: 'Assignment 3 - Convolutional Nets' },
      { name: 'description', label: 'Description', required: false, type: 'string', description: 'Brief description', sample: 'Implement ResNet on CIFAR-10' },
      { name: 'due_date', label: 'Due Date', required: false, type: 'date', description: 'YYYY-MM-DD', sample: '2025-03-30' },
      { name: 'max_marks', label: 'Max Marks', required: false, type: 'number', description: 'Maximum points', sample: '50' },
    ],
  },
  backlogs: {
    tableName: 'backlogs',
    dbTable: 'public.backlogs',
    fields: [
      { name: 'register_number', label: 'Student Register Number', required: true, type: 'string', description: 'Student identifier', sample: '24AIML001' },
      { name: 'subject_code', label: 'Subject Code', required: true, type: 'string', description: 'Subject code with backlog', sample: 'AI201' },
      { name: 'attempt_count', label: 'Attempt Count', required: false, type: 'number', description: 'Number of attempts', sample: '1' },
      { name: 'status', label: 'Status', required: false, type: 'string', description: 'ACTIVE, CLEARED', sample: 'ACTIVE' },
    ],
  },
};

export interface ParseValidationError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportPreviewResult {
  tableName: ImportTableName;
  totalRows: number;
  validCount: number;
  errorCount: number;
  previewRows: Record<string, any>[];
  errors: ParseValidationError[];
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Parse header line
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }

  return { headers, rows };
}

export class ImportService {
  public getAllowedTables(): { name: ImportTableName; label: string; fieldCount: number }[] {
    return ALLOWED_IMPORT_TABLES.map(table => ({
      name: table,
      label: table.charAt(0).toUpperCase() + table.slice(1).replace(/_/g, ' '),
      fieldCount: IMPORT_CONFIGS[table].fields.length,
    }));
  }

  public getCsvTemplate(tableName: ImportTableName): string {
    const config = IMPORT_CONFIGS[tableName];
    if (!config) throw new Error(`Unknown table '${tableName}'`);

    const headers = config.fields.map(f => f.name).join(',');
    const sampleRow = config.fields.map(f => `"${f.sample}"`).join(',');
    return `${headers}\n${sampleRow}\n`;
  }

  public async validateImport(tableName: ImportTableName, csvContent: string): Promise<ImportPreviewResult> {
    const config = IMPORT_CONFIGS[tableName];
    if (!config) throw new Error(`Unknown table '${tableName}'`);

    const { headers, rows } = parseCsv(csvContent);
    const errors: ParseValidationError[] = [];

    if (rows.length === 0) {
      return {
        tableName,
        totalRows: 0,
        validCount: 0,
        errorCount: 1,
        previewRows: [],
        errors: [{ row: 0, message: 'CSV file contains no data rows.' }],
      };
    }

    // Check required headers
    for (const field of config.fields) {
      if (field.required && !headers.includes(field.name)) {
        errors.push({
          row: 1,
          field: field.name,
          message: `Missing required column header: '${field.name}' (${field.label})`,
        });
      }
    }

    if (errors.length > 0) {
      return {
        tableName,
        totalRows: rows.length,
        validCount: 0,
        errorCount: errors.length,
        previewRows: rows.slice(0, 10),
        errors,
      };
    }

    // Cache departments for foreign key checks
    const deptRows = await pool.query<{ department_id: string; department_code: string }>(
      'SELECT department_id, UPPER(department_code) AS department_code FROM public.departments'
    );
    const validDeptCodes = new Set(deptRows.rows.map(d => d.department_code));

    // Cache students if needed
    let validStudentRegs = new Set<string>();
    if (['attendance', 'student_marks', 'backlogs'].includes(tableName)) {
      const studentRows = await pool.query<{ register_number: string }>(
        'SELECT UPPER(register_number) AS register_number FROM public.students'
      );
      validStudentRegs = new Set(studentRows.rows.map(s => s.register_number));
    }

    const seenUniqueKeys = new Set<string>();

    rows.forEach((row, index) => {
      const rowNum = index + 2; // Line 1 is header

      // Check unique key duplicates inside CSV
      if (config.uniqueKey && row[config.uniqueKey]) {
        const val = row[config.uniqueKey].trim().toUpperCase();
        if (seenUniqueKeys.has(val)) {
          errors.push({
            row: rowNum,
            field: config.uniqueKey,
            message: `Duplicate ${config.uniqueKey} found in uploaded file: '${row[config.uniqueKey]}'`,
          });
        }
        seenUniqueKeys.add(val);
      }

      // Validate each field
      for (const field of config.fields) {
        const val = row[field.name]?.trim();

        if (field.required && (!val || val === '')) {
          errors.push({
            row: rowNum,
            field: field.name,
            message: `Row ${rowNum}: Required field '${field.name}' is empty.`,
          });
          continue;
        }

        if (val) {
          if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            errors.push({
              row: rowNum,
              field: field.name,
              message: `Row ${rowNum}: Invalid email format '${val}'.`,
            });
          }

          if (field.type === 'number' && isNaN(Number(val))) {
            errors.push({
              row: rowNum,
              field: field.name,
              message: `Row ${rowNum}: '${val}' is not a valid number.`,
            });
          }

          if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            errors.push({
              row: rowNum,
              field: field.name,
              message: `Row ${rowNum}: Date must be in YYYY-MM-DD format, got '${val}'.`,
            });
          }

          // Foreign Key validations
          if (field.name === 'department_code' && !validDeptCodes.has(val.toUpperCase())) {
            errors.push({
              row: rowNum,
              field: 'department_code',
              message: `Row ${rowNum}: Invalid department code '${val}'. Must match an existing department.`,
            });
          }

          if (field.name === 'register_number' && ['attendance', 'student_marks', 'backlogs'].includes(tableName)) {
            if (!validStudentRegs.has(val.toUpperCase())) {
              errors.push({
                row: rowNum,
                field: 'register_number',
                message: `Row ${rowNum}: Student with register number '${val}' does not exist.`,
              });
            }
          }
        }
      }
    });

    const errorCount = errors.length;
    const validCount = Math.max(0, rows.length - errors.map(e => e.row).filter((v, i, a) => a.indexOf(v) === i).length);

    return {
      tableName,
      totalRows: rows.length,
      validCount,
      errorCount,
      previewRows: rows.slice(0, 15),
      errors: errors.slice(0, 50),
    };
  }

  public async executeImport(
    tableName: ImportTableName,
    csvContent: string,
    actorUser: User
  ): Promise<{ success: boolean; importedCount: number; message: string }> {
    const config = IMPORT_CONFIGS[tableName];
    if (!config) throw new Error(`Unknown table '${tableName}'`);

    const validation = await this.validateImport(tableName, csvContent);
    if (validation.errorCount > 0) {
      throw new Error(`Validation failed with ${validation.errorCount} error(s). First error: ${validation.errors[0]?.message}`);
    }

    const { rows } = parseCsv(csvContent);
    if (rows.length === 0) {
      throw new Error('No rows to import.');
    }

    // Resolve departments map
    const deptRows = await pool.query<{ department_id: string; department_code: string }>(
      'SELECT department_id, UPPER(department_code) AS department_code FROM public.departments'
    );
    const deptMap = new Map(deptRows.rows.map(d => [d.department_code, d.department_id]));

    // Resolve student register numbers if needed
    const studentMap = new Map<string, string>();
    if (['attendance', 'student_marks', 'backlogs'].includes(tableName)) {
      const studentRows = await pool.query<{ student_id: string; register_number: string }>(
        'SELECT student_id, UPPER(register_number) AS register_number FROM public.students'
      );
      studentRows.rows.forEach(s => studentMap.set(s.register_number, s.student_id));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;

      for (const row of rows) {
        if (tableName === 'departments') {
          await client.query(
            `INSERT INTO public.departments (department_code, department_name)
             VALUES ($1, $2)
             ON CONFLICT (department_code) DO UPDATE SET department_name = EXCLUDED.department_name`,
            [row.department_code.trim().toUpperCase(), row.department_name.trim()]
          );
          insertedCount++;
        } else if (tableName === 'students') {
          const deptId = deptMap.get(row.department_code.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.students (register_number, admission_number, first_name, last_name, department_id, email, phone, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (register_number) DO UPDATE
             SET first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 department_id = EXCLUDED.department_id,
                 email = EXCLUDED.email,
                 phone = EXCLUDED.phone,
                 status = EXCLUDED.status`,
            [
              row.register_number.trim(),
              row.admission_number?.trim() || null,
              row.first_name.trim(),
              row.last_name.trim(),
              deptId,
              row.email?.trim() || null,
              row.phone?.trim() || null,
              (row.status?.trim() || 'ACTIVE').toUpperCase(),
            ]
          );
          insertedCount++;
        } else if (tableName === 'faculty') {
          const deptId = deptMap.get(row.department_code.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.faculty (employee_id, first_name, last_name, designation, department_id, email, phone)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (employee_id) DO UPDATE
             SET first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 designation = EXCLUDED.designation,
                 department_id = EXCLUDED.department_id,
                 email = EXCLUDED.email,
                 phone = EXCLUDED.phone`,
            [
              row.employee_id.trim(),
              row.first_name.trim(),
              row.last_name.trim(),
              row.designation.trim(),
              deptId,
              row.email?.trim() || null,
              row.phone?.trim() || null,
            ]
          );
          insertedCount++;
        } else if (tableName === 'subjects') {
          const deptId = deptMap.get(row.department_code.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.subjects (subject_code, subject_name, department_id, credits)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (subject_code) DO UPDATE
             SET subject_name = EXCLUDED.subject_name,
                 department_id = EXCLUDED.department_id,
                 credits = EXCLUDED.credits`,
            [
              row.subject_code.trim().toUpperCase(),
              row.subject_name.trim(),
              deptId,
              Number(row.credits || 3.0),
            ]
          );
          insertedCount++;
        } else if (tableName === 'attendance') {
          const studentId = studentMap.get(row.register_number.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.attendance (student_id, attendance_date, status, remarks)
             VALUES ($1, $2, $3, $4)`,
            [
              studentId,
              row.attendance_date.trim(),
              row.status.trim().toUpperCase(),
              row.remarks?.trim() || null,
            ]
          );
          insertedCount++;
        } else if (tableName === 'student_marks') {
          const studentId = studentMap.get(row.register_number.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.student_marks (student_id, marks_obtained, max_marks, grade)
             VALUES ($1, $2, $3, $4)`,
            [
              studentId,
              Number(row.marks_obtained),
              Number(row.max_marks || 100),
              row.grade?.trim() || null,
            ]
          );
          insertedCount++;
        } else if (tableName === 'assignments') {
          await client.query(
            `INSERT INTO public.assignments (title, description, due_date, max_marks)
             VALUES ($1, $2, $3, $4)`,
            [
              row.title.trim(),
              row.description?.trim() || null,
              row.due_date?.trim() || null,
              Number(row.max_marks || 100),
            ]
          );
          insertedCount++;
        } else if (tableName === 'backlogs') {
          const studentId = studentMap.get(row.register_number.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.backlogs (student_id, attempt_count, status)
             VALUES ($1, $2, $3)`,
            [
              studentId,
              Number(row.attempt_count || 1),
              (row.status?.trim() || 'ACTIVE').toUpperCase(),
            ]
          );
          insertedCount++;
        }
      }

      await client.query('COMMIT');

      await auditService.logEvent({
        requestId: `import_${Date.now()}`,
        userId: actorUser.id,
        action: 'DATA_IMPORTED',
        resource: tableName.toUpperCase(),
        status: 'SUCCESS',
        details: JSON.stringify({
          tableName,
          importedCount: insertedCount,
          totalRows: rows.length,
        }),
      });

      return {
        success: true,
        importedCount: insertedCount,
        message: `Import completed: ${insertedCount} records imported successfully.`,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const importService = new ImportService();
