import crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { User, UserRole } from '../types/index.js';
import { auditService } from './audit.service.js';
import { permissionsService } from './permissions.service.js';
import { departmentService } from './department.service.js';

export interface LocalUserRecord {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  password_hash: string;
  role: string;
  department_code?: string | null;
  department_id?: string | null;
  student_id?: string | null;
  status: string;
  last_login?: Date | string | null;
}

export interface AuthenticatedSession {
  user: User;
  token: string;
}

const passwordHashRounds = Number(process.env.BCRYPT_ROUNDS || 12);

export const ALLOWED_USER_EDIT_FIELDS = [
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'departmentCode',
  'departmentId',
  'status',
  'role',
] as const;

function normalizeRole(role: string): UserRole {
  const normalized = role.toUpperCase();
  if (normalized === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (normalized === 'ADMIN') return 'Admin';
  if (normalized === 'PRINCIPAL') return 'Principal';
  if (normalized === 'HOD') return 'HOD';
  if (normalized === 'FACULTY') return 'Faculty';
  if (normalized === 'STUDENT') return 'Student';
  if (normalized === 'ACCOUNTS') return 'Accounts';
  if (normalized === 'PLACEMENT_OFFICER' || normalized === 'PLACEMENT OFFICER') return 'Placement Officer';
  if (normalized === 'LIBRARIAN') return 'Librarian';
  return 'Faculty';
}

function toUser(record: LocalUserRecord): User {
  const role = normalizeRole(record.role);
  return {
    id: record.user_id,
    name: record.full_name,
    email: record.email,
    phone: record.phone || undefined,
    role,
    departmentCode: role === 'Principal' ? undefined : record.department_code || undefined,
    departmentId: role === 'Principal' ? undefined : record.department_id || undefined,
    studentId: record.student_id || undefined,
    status: record.status.toUpperCase() === 'ACTIVE' ? 'active' : 'disabled',
    lastActive: record.last_login ? new Date(record.last_login).toISOString() : undefined,
  };
}

function sessionHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  public async login(email: string, password: string): Promise<AuthenticatedSession | null> {
    const result = await pool.query<LocalUserRecord>(
      `SELECT user_id, full_name, email, phone, password_hash, role, department_code,
              department_id, student_id, status, last_login
       FROM public.arcgpt_users
       WHERE lower(email) = lower($1) AND status = 'ACTIVE'
       LIMIT 1`,
      [email.trim()]
    );
    const record = result.rows[0];
    if (!record || !(await bcrypt.compare(password, record.password_hash))) return null;
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO public.arcgpt_sessions (session_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
      [sessionHash(token), record.user_id]
    );
    await pool.query('UPDATE public.arcgpt_users SET last_login = NOW() WHERE user_id = $1', [record.user_id]);
    return { user: toUser({ ...record, last_login: new Date() }), token };
  }

  public async getUserBySession(token: string): Promise<User | null> {
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
    const result = await pool.query<LocalUserRecord>(
      `SELECT u.user_id, u.full_name, u.email, u.phone, u.password_hash, u.role,
              u.department_code, u.department_id, u.student_id, u.status, u.last_login
       FROM public.arcgpt_sessions s
       JOIN public.arcgpt_users u ON u.user_id = s.user_id
       WHERE s.session_hash = $1 AND s.expires_at > NOW() AND u.status = 'ACTIVE'`,
      [sessionHash(token)]
    );
    const record = result.rows[0];
    if (!record) return null;
    await pool.query('UPDATE public.arcgpt_sessions SET last_seen_at = NOW() WHERE session_hash = $1', [sessionHash(token)]);
    return toUser(record);
  }

  public async logout(token: string): Promise<void> {
    if (!token) return;
    await pool.query('DELETE FROM public.arcgpt_sessions WHERE session_hash = $1', [sessionHash(token)]);
  }

  /**
   * Signs in as the first-run bootstrap administrator using the server-side
   * `LOCAL_ADMIN_*` credentials.
   *
   * This exists for the development auto-session in `server.ts`, which has to
   * issue a real session for a browser that has no login screen of its own —
   * the ArcGPT chat UI is deliberately a single uncredentialed surface. The
   * credentials are read from the process environment and never leave the
   * server, so the browser still only ever holds an HTTP-only session cookie.
   *
   * It is refused in production (see `allowBootstrapSession` in `server.ts`) and
   * performs the same password check as any other login.
   */
  public async loginAsBootstrapUser(): Promise<AuthenticatedSession | null> {
    const email = process.env.LOCAL_ADMIN_EMAIL;
    const password = process.env.LOCAL_ADMIN_PASSWORD;
    if (!email || !password) return null;
    return this.login(email, password);
  }

  public async getUserById(id: string): Promise<User | null> {
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    const result = await pool.query<LocalUserRecord>(
      `SELECT user_id, full_name, email, phone, password_hash, role, department_code,
              department_id, student_id, status, last_login
       FROM public.arcgpt_users WHERE user_id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  public async getAllUsers(): Promise<User[]> {
    const result = await pool.query<LocalUserRecord>(
      `SELECT user_id, full_name, email, phone, password_hash, role, department_code,
              department_id, student_id, status, last_login
       FROM public.arcgpt_users ORDER BY full_name`
    );
    return result.rows.map(toUser);
  }

  public async createUser(
    actorUser: User,
    data: {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      phone?: string;
      departmentCode?: string;
      departmentId?: string;
      studentId?: string;
    }
  ): Promise<User> {
    const role = normalizeRole(data.role);

    // Permission check
    if (!permissionsService.hasPermission(actorUser, 'users.create')) {
      throw new Error('FORBIDDEN: You do not have permission to create users.');
    }

    // Role assignment check (cannot create SUPER_ADMIN unless actor is SUPER_ADMIN)
    if (!permissionsService.canAssignRole(actorUser, role)) {
      throw new Error('FORBIDDEN: You cannot assign the requested role.');
    }

    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('A valid email address is required.');
    }

    // HOD validation: Department is MANDATORY
    let deptId = data.departmentId || null;
    let deptCode = data.departmentCode?.trim().toUpperCase() || null;

    if (role === 'HOD') {
      if (!deptCode && !deptId) {
        throw new Error('Department is mandatory when creating an HOD user.');
      }
      if (deptCode) {
        const dept = await departmentService.getDepartmentByCode(deptCode);
        if (!dept) throw new Error(`Invalid department code '${deptCode}'.`);
        deptId = dept.department_id;
        deptCode = dept.department_code;
      } else if (deptId) {
        const dept = await departmentService.getDepartmentById(deptId);
        if (!dept) throw new Error(`Invalid department ID '${deptId}'.`);
        deptCode = dept.department_code;
      }
    } else if (role === 'Principal') {
      // Principal has institution-wide scope, department is not required
      deptId = null;
      deptCode = null;
    } else if (deptCode) {
      const dept = await departmentService.getDepartmentByCode(deptCode);
      if (dept) {
        deptId = dept.department_id;
        deptCode = dept.department_code;
      }
    }

    // Password security check (minimum 8 chars)
    if (!data.password || data.password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    const passwordHash = await bcrypt.hash(data.password, passwordHashRounds);

    const result = await pool.query<LocalUserRecord>(
      `INSERT INTO public.arcgpt_users
        (full_name, email, phone, password_hash, role, department_code, department_id, student_id)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)
       RETURNING user_id, full_name, email, phone, password_hash, role, department_code,
                 department_id, student_id, status, last_login`,
      [data.name.trim(), email, data.phone?.trim() || null, passwordHash, role, deptCode, deptId, data.studentId || null]
    );

    const created = toUser(result.rows[0]);

    // Audit logs
    await auditService.logEvent({
      requestId: `user_create_${Date.now()}`,
      userId: actorUser.id,
      action: 'USER_CREATED',
      resource: 'USERS',
      status: 'SUCCESS',
      details: JSON.stringify({
        target_user_id: created.id,
        target_email: created.email,
        target_role: created.role,
        department_code: created.departmentCode,
      }),
    });

    if (created.role === 'HOD' && created.departmentCode) {
      await auditService.logEvent({
        requestId: `hod_assign_${Date.now()}`,
        userId: actorUser.id,
        action: 'HOD_DEPARTMENT_ASSIGNED',
        resource: 'USERS',
        status: 'SUCCESS',
        details: JSON.stringify({
          target_user_id: created.id,
          target_role: 'HOD',
          department_code: created.departmentCode,
        }),
      });
    }

    return created;
  }

  /**
   * Production-grade User Edit with field whitelisting, role protection,
   * HOD department validation, and audit logging.
   */
  public async updateUser(
    id: string,
    actorUser: User,
    rawUpdates: Record<string, any>
  ): Promise<User> {
    const current = await this.getUserById(id);
    if (!current) {
      throw new Error('User not found.');
    }

    // Permission check
    if (!permissionsService.hasPermission(actorUser, 'users.edit')) {
      throw new Error('FORBIDDEN: You do not have permission to edit users.');
    }

    // Validate only allowed fields
    const updates: Record<string, any> = {};
    for (const key of Object.keys(rawUpdates)) {
      if (ALLOWED_USER_EDIT_FIELDS.includes(key as any)) {
        updates[key] = rawUpdates[key];
      }
    }

    // Determine target full name (supports either firstName + lastName or name)
    let newName = current.name;
    if (typeof updates.name === 'string' && updates.name.trim()) {
      newName = updates.name.trim();
    } else if (typeof updates.firstName === 'string' || typeof updates.lastName === 'string') {
      const first = typeof updates.firstName === 'string' ? updates.firstName.trim() : '';
      const last = typeof updates.lastName === 'string' ? updates.lastName.trim() : '';
      newName = `${first} ${last}`.trim() || current.name;
    }

    // Role update checks
    let targetRole = current.role;
    if (updates.role && updates.role !== current.role) {
      const candidateRole = normalizeRole(updates.role);

      // Prevent non-SUPER_ADMIN from promoting anyone to SUPER_ADMIN
      if (candidateRole === 'SUPER_ADMIN' && actorUser.role !== 'SUPER_ADMIN') {
        throw new Error('FORBIDDEN: Only a SUPER_ADMIN can assign the SUPER_ADMIN role.');
      }

      // Check roles.assign permission
      if (!permissionsService.canAssignRole(actorUser, candidateRole)) {
        throw new Error('FORBIDDEN: You cannot assign the requested role.');
      }

      targetRole = candidateRole;
    }

    // Department handling
    let deptCode = current.departmentCode || null;
    let deptId = current.departmentId ? String(current.departmentId) : null;

    if (updates.departmentCode !== undefined || updates.departmentId !== undefined) {
      if (updates.departmentCode) {
        const dept = await departmentService.getDepartmentByCode(updates.departmentCode);
        if (!dept) throw new Error(`Invalid department code '${updates.departmentCode}'.`);
        deptCode = dept.department_code;
        deptId = dept.department_id;
      } else if (updates.departmentId) {
        const dept = await departmentService.getDepartmentById(updates.departmentId);
        if (!dept) throw new Error(`Invalid department ID '${updates.departmentId}'.`);
        deptCode = dept.department_code;
        deptId = dept.department_id;
      } else {
        deptCode = null;
        deptId = null;
      }
    }

    if (targetRole === 'Principal') {
      deptCode = null;
      deptId = null;
    }

    // If role is HOD, department is REQUIRED
    if (targetRole === 'HOD' && (!deptCode || !deptId)) {
      throw new Error('Department is mandatory for HOD accounts.');
    }

    // Status handling
    let newStatus = current.status;
    if (updates.status) {
      newStatus = updates.status === 'disabled' || updates.status === 'INACTIVE' ? 'disabled' : 'active';
    }

    // Email handling
    let newEmail = current.email;
    if (typeof updates.email === 'string' && updates.email.trim() && updates.email.trim() !== current.email) {
      const emailCand = updates.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCand)) {
        throw new Error('Invalid email format.');
      }
      newEmail = emailCand;
    }

    // Phone handling
    const newPhone = updates.phone !== undefined ? (typeof updates.phone === 'string' ? updates.phone.trim() : null) : (current.phone || null);

    const dbStatus = newStatus === 'disabled' ? 'INACTIVE' : 'ACTIVE';

    const result = await pool.query<LocalUserRecord>(
      `UPDATE public.arcgpt_users
       SET full_name = $2,
           email = lower($3),
           phone = $4,
           role = $5,
           department_code = $6,
           department_id = $7,
           status = $8,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, full_name, email, phone, password_hash, role, department_code,
                 department_id, student_id, status, last_login`,
      [id, newName, newEmail, newPhone, targetRole, deptCode, deptId, dbStatus]
    );

    const updated = toUser(result.rows[0]);

    // Audit logs for specific changes
    if (current.role !== updated.role) {
      await auditService.logEvent({
        requestId: `role_change_${Date.now()}`,
        userId: actorUser.id,
        action: 'USER_ROLE_CHANGED',
        resource: 'USERS',
        status: 'SUCCESS',
        details: JSON.stringify({
          target_user_id: id,
          old_role: current.role,
          new_role: updated.role,
        }),
      });
    }

    if (current.departmentCode !== updated.departmentCode) {
      if (updated.role === 'HOD') {
        await auditService.logEvent({
          requestId: `hod_dept_change_${Date.now()}`,
          userId: actorUser.id,
          action: current.departmentCode ? 'HOD_DEPARTMENT_CHANGED' : 'HOD_DEPARTMENT_ASSIGNED',
          resource: 'USERS',
          status: 'SUCCESS',
          details: JSON.stringify({
            target_user_id: id,
            old_department: current.departmentCode || 'NONE',
            new_department: updated.departmentCode,
            changed_by: actorUser.id,
          }),
        });
      }
    }

    if (current.status !== updated.status && updated.status === 'disabled') {
      await auditService.logEvent({
        requestId: `user_disable_${Date.now()}`,
        userId: actorUser.id,
        action: 'USER_DISABLED',
        resource: 'USERS',
        status: 'SUCCESS',
        details: JSON.stringify({ target_user_id: id }),
      });
    }

    await auditService.logEvent({
      requestId: `user_update_${Date.now()}`,
      userId: actorUser.id,
      action: 'USER_UPDATED',
      resource: 'USERS',
      status: 'SUCCESS',
      details: JSON.stringify({
        target_user_id: id,
        updated_fields: Object.keys(updates),
      }),
    });

    return updated;
  }

  public async toggleUserStatus(id: string, actorUser: User): Promise<User | null> {
    const user = await this.getUserById(id);
    if (!user) return null;
    return this.updateUser(id, actorUser, { status: user.status === 'active' ? 'disabled' : 'active' });
  }

  public async bootstrapFromEnvironment(): Promise<boolean> {
    const email = process.env.LOCAL_ADMIN_EMAIL;
    const password = process.env.LOCAL_ADMIN_PASSWORD;
    if (!email || !password) return false;
    const result = await pool.query<{ user_id: string }>(
      `INSERT INTO public.arcgpt_users (full_name, email, password_hash, role, status)
       VALUES ($1, lower($2), $3, 'ADMIN', 'ACTIVE')
       ON CONFLICT (email) DO UPDATE SET role = 'ADMIN', status = 'ACTIVE'
       RETURNING user_id`,
      [process.env.LOCAL_ADMIN_NAME || 'ArcGPT Administrator', email, await bcrypt.hash(password, passwordHashRounds)]
    );
    return Boolean(result.rows[0]);
  }
}

export const authService = new AuthService();
