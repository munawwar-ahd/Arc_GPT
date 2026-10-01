import { pool } from './db.js';
import { User } from '../types/index.js';
import { auditService } from './audit.service.js';

/**
 * Tables that can be bulk-loaded from a flat CSV.
 *
 * Only the flat reference and identity tables are listed. The assessment and
 * attendance tables all key on `offering_id` — the bridge that records which
 * subject was delivered to which section in which academic year — and cannot be
 * addressed by a human-readable CSV column without a resolution layer that
 * would be far more fragile than a preview. Those tables are populated by the
 * academic pipeline instead, so they are deliberately not importable.
 */
export const ALLOWED_IMPORT_TABLES = [
  'departments',
  'faculty',
  'subjects',
  'students',
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
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Unique short code, 2-10 upper-case letters', sample: 'AIML' },
      { name: 'department_name', label: 'Department Name', required: true, type: 'string', description: 'Full department name', sample: 'Artificial Intelligence and Machine Learning' },
      { name: 'established_year', label: 'Established Year', required: false, type: 'number', description: 'Year the department was established', sample: '2014' },
      { name: 'email', label: 'Email', required: false, type: 'email', description: 'Department email', sample: 'aiml@arccollege.edu' },
      { name: 'phone', label: 'Phone', required: false, type: 'string', description: 'Department phone', sample: '9840010001' },
    ],
  },
  faculty: {
    tableName: 'faculty',
    dbTable: 'public.faculty',
    uniqueKey: 'employee_id',
    fields: [
      { name: 'employee_id', label: 'Employee ID', required: true, type: 'string', description: 'Unique faculty employee number', sample: 'EMP-A009' },
      { name: 'first_name', label: 'First Name', required: true, type: 'string', description: 'First name', sample: 'Priya' },
      { name: 'last_name', label: 'Last Name', required: true, type: 'string', description: 'Surname', sample: 'Balasubramanian' },
      { name: 'designation', label: 'Designation', required: true, type: 'string', description: 'e.g. Assistant Professor, Professor and Head', sample: 'Associate Professor' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Must match an existing department', sample: 'AIML' },
      { name: 'email', label: 'Email', required: true, type: 'email', description: 'Must be unique', sample: 'priya.balasubramanian@arccollege.edu' },
      { name: 'phone', label: 'Phone', required: true, type: 'string', description: 'Phone number', sample: '9876501234' },
      { name: 'date_of_joined', label: 'Date Joined', required: true, type: 'date', description: 'YYYY-MM-DD', sample: '2024-07-01' },
    ],
  },
  subjects: {
    tableName: 'subjects',
    dbTable: 'public.subjects',
    uniqueKey: 'subject_code',
    fields: [
      { name: 'subject_code', label: 'Subject Code', required: true, type: 'string', description: 'Unique code, 2-6 upper-case letters then 3-4 digits', sample: 'AI201' },
      { name: 'subject_name', label: 'Subject Name', required: true, type: 'string', description: 'Full subject title', sample: 'Database Management Systems' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Owning department, must match an existing one', sample: 'AIML' },
      { name: 'semester_number', label: 'Semester Number', required: true, type: 'number', description: 'Semester position 1 to 8', sample: '3' },
      { name: 'credits', label: 'Credits', required: true, type: 'number', description: 'Credit value, greater than 0', sample: '4' },
      { name: 'subject_type', label: 'Subject Type', required: false, type: 'string', description: 'THEORY, LAB, THEORY_LAB or PROJECT. Defaults to THEORY.', sample: 'THEORY_LAB' },
    ],
  },
  students: {
    tableName: 'students',
    dbTable: 'public.students',
    uniqueKey: 'register_number',
    fields: [
      { name: 'register_number', label: 'Register Number', required: true, type: 'string', description: 'Unique registration number, 6-20 upper-case letters and digits', sample: 'AIML12024A01' },
      { name: 'admission_number', label: 'Admission Number', required: true, type: 'string', description: 'Unique admission number', sample: 'ADM202400001' },
      { name: 'first_name', label: 'First Name', required: true, type: 'string', description: 'First name', sample: 'Rohan' },
      { name: 'last_name', label: 'Last Name', required: true, type: 'string', description: 'Surname', sample: 'Nair' },
      { name: 'gender', label: 'Gender', required: true, type: 'string', description: 'MALE, FEMALE or OTHER', sample: 'MALE' },
      { name: 'date_of_birth', label: 'Date of Birth', required: true, type: 'date', description: 'YYYY-MM-DD', sample: '2006-04-18' },
      { name: 'department_code', label: 'Department Code', required: true, type: 'string', description: 'Must match an existing department', sample: 'AIML' },
      { name: 'batch_code', label: 'Batch Code', required: true, type: 'string', description: 'Admission cohort, e.g. AIML-2024. Must already exist.', sample: 'AIML-2024' },
      { name: 'section_code', label: 'Section Code', required: true, type: 'string', description: 'Single letter A-Z. Must already exist for the batch.', sample: 'A' },
      { name: 'residence_status', label: 'Residence Status', required: true, type: 'string', description: 'HOSTELLER or DAY_SCHOLAR', sample: 'DAY_SCHOLAR' },
      { name: 'email', label: 'Email', required: true, type: 'email', description: 'Must be unique', sample: 'rohan.nair@student.arccollege.edu' },
      { name: 'phone', label: 'Phone', required: true, type: 'string', description: 'Phone number', sample: '9000000123' },
      { name: 'admission_date', label: 'Admission Date', required: true, type: 'date', description: 'YYYY-MM-DD', sample: '2024-08-01' },
      { name: 'status', label: 'Status', required: false, type: 'string', description: 'ACTIVE, INACTIVE, ON_LEAVE or GRADUATED. Defaults to ACTIVE.', sample: 'ACTIVE' },
      { name: 'address', label: 'Address', required: false, type: 'string', description: 'Home address', sample: '12, Anna Nagar, Chennai 600040' },
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

    // Students are no longer imported by register_number reference, but the
    // batch/section pair still has to resolve against existing academic
    // structure, so those lookups are cached for the students table only.
    let validBatchSections = new Set<string>();
    let validSemesterNumbers = new Set<number>();
    if (tableName === 'students') {
      const sectionRows = await pool.query<{ batch_code: string; section_code: string }>(
        `SELECT UPPER(b.batch_code) AS batch_code, s.section_code
         FROM public.sections s
         JOIN public.batches b ON b.batch_id = s.batch_id`
      );
      validBatchSections = new Set(sectionRows.rows.map(s => `${s.batch_code}|${s.section_code}`));
    }
    if (tableName === 'subjects') {
      const semRows = await pool.query<{ semester_number: number }>(
        'SELECT semester_number FROM public.semesters'
      );
      validSemesterNumbers = new Set(semRows.rows.map(s => s.semester_number));
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
          // A department_code must name an EXISTING department - except when the
          // import target IS departments, where the column is the new
          // department's own key and so cannot already exist.
          if (field.name === 'department_code'
              && tableName !== 'departments'
              && !validDeptCodes.has(val.toUpperCase())) {
            errors.push({
              row: rowNum,
              field: 'department_code',
              message: `Row ${rowNum}: Invalid department code '${val}'. Must match an existing department.`,
            });
          }

          // A student can only be placed in a section that already exists for
          // their batch, so both halves of the pair are checked together.
          if (tableName === 'students' && row.batch_code && row.section_code) {
            const key = `${row.batch_code.trim().toUpperCase()}|${row.section_code.trim().toUpperCase()}`;
            if (!validBatchSections.has(key)) {
              errors.push({
                row: rowNum,
                field: 'section_code',
                message: `Row ${rowNum}: No section '${row.section_code.trim()}' exists for batch '${row.batch_code.trim()}'. Create the batch and its sections first.`,
              });
            }
          }

          if (field.name === 'semester_number' && !validSemesterNumbers.has(Number(val))) {
            errors.push({
              row: rowNum,
              field: 'semester_number',
              message: `Row ${rowNum}: '${val}' is not a valid semester. Must be 1 to 8.`,
            });
          }

          if (field.name === 'gender' && !['MALE', 'FEMALE', 'OTHER'].includes(val.toUpperCase())) {
            errors.push({
              row: rowNum,
              field: 'gender',
              message: `Row ${rowNum}: Gender must be MALE, FEMALE or OTHER, got '${val}'.`,
            });
          }

          if (field.name === 'residence_status' && !['HOSTELLER', 'DAY_SCHOLAR'].includes(val.toUpperCase())) {
            errors.push({
              row: rowNum,
              field: 'residence_status',
              message: `Row ${rowNum}: Residence status must be HOSTELLER or DAY_SCHOLAR, got '${val}'.`,
            });
          }

          if (field.name === 'subject_type' && !['THEORY', 'LAB', 'THEORY_LAB', 'PROJECT'].includes(val.toUpperCase())) {
            errors.push({
              row: rowNum,
              field: 'subject_type',
              message: `Row ${rowNum}: Subject type must be THEORY, LAB, THEORY_LAB or PROJECT, got '${val}'.`,
            });
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

    // --- Resolution maps -------------------------------------------------
    // The schema is properly normalised, so a flat CSV has to be resolved into
    // foreign keys before it can be inserted. Every lookup is done once up
    // front so the per-row loop stays a single statement.
    const deptRows = await pool.query<{ department_id: string; department_code: string }>(
      'SELECT department_id, UPPER(department_code) AS department_code FROM public.departments'
    );
    const deptMap = new Map(deptRows.rows.map(d => [d.department_code, d.department_id]));

    const programMap = new Map<string, string>();
    if (tableName === 'students') {
      const programRows = await pool.query<{ program_id: string; department_code: string }>(
        `SELECT pr.program_id, UPPER(d.department_code) AS department_code
         FROM public.programs pr
         JOIN public.departments d ON d.department_id = pr.department_id`
      );
      programRows.rows.forEach(p => {
        if (!programMap.has(p.department_code)) programMap.set(p.department_code, p.program_id);
      });
    }

    // batch + section -> the ids a student row needs, plus the year of study
    // and admission year implied by the batch.
    interface StudentPlacement {
      batchId: string; sectionId: string; programId: string;
      yearOfStudyId: string; admissionYear: number; currentAcademicYearId: string;
    }
    const placementMap = new Map<string, StudentPlacement>();
    if (tableName === 'students') {
      const placeRows = await pool.query<{
        batch_code: string; section_code: string; batch_id: string; section_id: string;
        program_id: string; year_of_study_id: string; admission_year: number;
        academic_year_id: string;
      }>(
        `SELECT UPPER(b.batch_code) AS batch_code,
                s.section_code,
                b.batch_id,
                s.section_id,
                b.program_id,
                s.year_of_study_id,
                b.admission_year,
                s.academic_year_id
         FROM public.sections s
         JOIN public.batches b ON b.batch_id = s.batch_id`
      );
      placeRows.rows.forEach(p => {
        placementMap.set(`${p.batch_code}|${p.section_code}`, {
          batchId: p.batch_id,
          sectionId: p.section_id,
          programId: p.program_id,
          yearOfStudyId: p.year_of_study_id,
          admissionYear: p.admission_year,
          currentAcademicYearId: p.academic_year_id,
        });
      });
    }

    // The semester a student is currently sitting is 2 x their year of study.
    const semesterByYearMap = new Map<number, string>();
    if (tableName === 'students') {
      const semRows = await pool.query<{ semester_number: number; semester_id: string }>(
        'SELECT semester_number, semester_id FROM public.semesters'
      );
      semRows.rows.forEach(s => semesterByYearMap.set(s.semester_number, s.semester_id));
    }

    const semesterNumberMap = new Map<number, string>();
    if (tableName === 'subjects') {
      const semRows = await pool.query<{ semester_number: number; semester_id: string }>(
        'SELECT semester_number, semester_id FROM public.semesters'
      );
      semRows.rows.forEach(s => semesterNumberMap.set(s.semester_number, s.semester_id));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;

      for (const row of rows) {
        if (tableName === 'departments') {
          await client.query(
            `INSERT INTO public.departments (department_code, department_name, established_year, email, phone)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (department_code) DO UPDATE
             SET department_name = EXCLUDED.department_name,
                 established_year = EXCLUDED.established_year,
                 email = EXCLUDED.email,
                 phone = EXCLUDED.phone`,
            [
              row.department_code.trim().toUpperCase(),
              row.department_name.trim(),
              row.established_year ? Number(row.established_year) : null,
              row.email?.trim() || null,
              row.phone?.trim() || null,
            ]
          );
          insertedCount++;
        } else if (tableName === 'faculty') {
          const deptId = deptMap.get(row.department_code.trim().toUpperCase());
          await client.query(
            `INSERT INTO public.faculty
               (employee_id, first_name, last_name, department_id, designation, email, phone, date_of_joined)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (employee_id) DO UPDATE
             SET first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 designation = EXCLUDED.designation,
                 department_id = EXCLUDED.department_id,
                 email = EXCLUDED.email,
                 phone = EXCLUDED.phone,
                 date_of_joined = EXCLUDED.date_of_joined`,
            [
              row.employee_id.trim(),
              row.first_name.trim(),
              row.last_name.trim(),
              deptId,
              row.designation.trim(),
              row.email.trim(),
              row.phone.trim(),
              row.date_of_joined.trim(),
            ]
          );
          insertedCount++;
        } else if (tableName === 'subjects') {
          const deptId = deptMap.get(row.department_code.trim().toUpperCase());
          const semesterId = semesterNumberMap.get(Number(row.semester_number));
          await client.query(
            `INSERT INTO public.subjects
               (subject_code, subject_name, department_id, semester_id, credits, subject_type, lecture_hours, practical_hours)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0)
             ON CONFLICT (subject_code) DO UPDATE
             SET subject_name = EXCLUDED.subject_name,
                 department_id = EXCLUDED.department_id,
                 semester_id = EXCLUDED.semester_id,
                 credits = EXCLUDED.credits,
                 subject_type = EXCLUDED.subject_type`,
            [
              row.subject_code.trim().toUpperCase(),
              row.subject_name.trim(),
              deptId,
              semesterId,
              Number(row.credits),
              (row.subject_type?.trim() || 'THEORY').toUpperCase(),
            ]
          );
          insertedCount++;
        } else if (tableName === 'students') {
          const deptCode = row.department_code.trim().toUpperCase();
          const deptId = deptMap.get(deptCode);
          const placement = placementMap.get(
            `${row.batch_code.trim().toUpperCase()}|${row.section_code.trim().toUpperCase()}`
          );
          if (!placement) {
            throw new Error(`No section '${row.section_code}' exists for batch '${row.batch_code}'.`);
          }
          // The cohort's current semester is 2 x its year of study.
          const yearRows = await client.query<{ year_number: number }>(
            'SELECT year_number FROM public.years_of_study WHERE year_of_study_id = $1',
            [placement.yearOfStudyId]
          );
          const yearNumber = yearRows.rows[0]?.year_number ?? 1;
          const currentSemesterId = semesterByYearMap.get(yearNumber * 2) ?? null;

          await client.query(
            `INSERT INTO public.students
               (register_number, admission_number, first_name, last_name, gender, date_of_birth,
                department_id, program_id, batch_id, section_id, current_year_of_study_id,
                current_semester_id, residence_status, email, phone, admission_date, status, address)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT (register_number) DO UPDATE
             SET first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 gender = EXCLUDED.gender,
                 department_id = EXCLUDED.department_id,
                 batch_id = EXCLUDED.batch_id,
                 section_id = EXCLUDED.section_id,
                 residence_status = EXCLUDED.residence_status,
                 email = EXCLUDED.email,
                 phone = EXCLUDED.phone,
                 status = EXCLUDED.status,
                 address = EXCLUDED.address,
                 updated_at = NOW()`,
            [
              row.register_number.trim().toUpperCase(),
              row.admission_number.trim(),
              row.first_name.trim(),
              row.last_name.trim(),
              row.gender.trim().toUpperCase(),
              row.date_of_birth.trim(),
              deptId,
              placement.programId,
              placement.batchId,
              placement.sectionId,
              placement.yearOfStudyId,
              currentSemesterId,
              row.residence_status.trim().toUpperCase(),
              row.email.trim(),
              row.phone.trim(),
              row.admission_date.trim(),
              (row.status?.trim() || 'ACTIVE').toUpperCase(),
              row.address?.trim() || null,
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
