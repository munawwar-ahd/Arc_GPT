import { User, UserRole } from '../types/index.js';

export type Permission =
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.disable'
  | 'users.delete'
  | 'roles.assign'
  | 'hod.department.assign'
  | 'student.delete'
  | 'data.import'
  | 'ASK_DATA'
  | 'VIEW_INSIGHTS'
  | 'VIEW_QUERY_HISTORY'
  | 'SAVE_QUERIES'
  | 'EXPORT_RESULTS'
  | 'MANAGE_USERS'
  | 'MANAGE_ROLES'
  | 'VIEW_SCHEMA'
  | 'MANAGE_AI';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    'users.view', 'users.create', 'users.edit', 'users.disable', 'users.delete',
    'roles.assign', 'hod.department.assign', 'student.delete', 'data.import',
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES',
    'EXPORT_RESULTS', 'MANAGE_USERS', 'MANAGE_ROLES', 'VIEW_SCHEMA', 'MANAGE_AI'
  ],
  ADMIN: [
    'users.view', 'users.create', 'users.edit', 'users.disable',
    'roles.assign', 'hod.department.assign', 'student.delete', 'data.import',
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES',
    'EXPORT_RESULTS', 'MANAGE_USERS', 'MANAGE_ROLES', 'VIEW_SCHEMA', 'MANAGE_AI'
  ],
  PRINCIPAL: [
    'users.view',
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS', 'VIEW_SCHEMA'
  ],
  HOD: [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
  FACULTY: [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
  STUDENT: [
    'ASK_DATA', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES'
  ],
  ACCOUNTS: [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
  'PLACEMENT OFFICER': [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
  PLACEMENT_OFFICER: [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
  LIBRARIAN: [
    'ASK_DATA', 'VIEW_INSIGHTS', 'VIEW_QUERY_HISTORY', 'SAVE_QUERIES', 'EXPORT_RESULTS'
  ],
};

export class PermissionsService {
  public hasPermission(user: User, permission: Permission): boolean {
    const roleKey = user.role.toUpperCase().replace(/\s+/g, '_');
    const permissions = ROLE_PERMISSIONS[roleKey] || ROLE_PERMISSIONS[user.role.toUpperCase()] || [];
    return permissions.includes(permission);
  }

  public canAssignRole(actor: User, targetRole: UserRole): boolean {
    const actorRole = actor.role.toUpperCase();
    const desiredRole = targetRole.toUpperCase();

    // No one except existing SUPER_ADMIN can assign/promote to SUPER_ADMIN
    if (desiredRole === 'SUPER_ADMIN') {
      return actorRole === 'SUPER_ADMIN';
    }

    // Admins and Super Admins can assign other roles if they have roles.assign
    if (this.hasPermission(actor, 'roles.assign')) {
      return true;
    }

    return false;
  }

  public canManageUser(actor: User, targetUserRole: UserRole): boolean {
    const actorRole = actor.role.toUpperCase();
    const targetRole = targetUserRole.toUpperCase();

    if (targetRole === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      return false;
    }

    return this.hasPermission(actor, 'users.edit') || this.hasPermission(actor, 'users.create');
  }
}

export const permissionsService = new PermissionsService();
