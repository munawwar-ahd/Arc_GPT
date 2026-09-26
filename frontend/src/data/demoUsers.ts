/**
 * Demonstration personas for the /admin portal's persona picker.
 *
 * This is a *display* list only. It used to live in `src/server/auth.service.ts`,
 * which was the old in-memory Express backend. That backend has been replaced by
 * ArcGPT-Backend, so the list was moved here into a client-safe module: the
 * admin login screen and the user-switch modal render these names, emails and
 * roles, and nothing more.
 *
 * It carries no credentials and grants no privilege. Real identity, roles and
 * scoping are resolved server-side by ArcGPT-Backend from the HTTP-only session
 * cookie, which the admin panel's requests already carry.
 */
import { User } from '../types/index.js';

export const DEMO_USERS: User[] = [
  {
    id: 'user_admin_01',
    name: 'Dr. Eleanor Vance',
    email: 'admin.vance@arcai.edu',
    role: 'Admin',
    departmentCode: 'INSTITUTION',
    status: 'active',
    lastActive: 'Just now',
  },
  {
    id: 'user_hod_02',
    name: 'Prof. Rajesh Kumar',
    email: 'hod.aiml@arcai.edu',
    role: 'HOD',
    departmentId: 1,
    departmentCode: 'AIML',
    status: 'active',
    lastActive: '10 mins ago',
  },
  {
    id: 'user_faculty_03',
    name: 'Dr. Sarah Jenkins',
    email: 'faculty.cse@arcai.edu',
    role: 'Faculty',
    departmentId: 2,
    departmentCode: 'CSE',
    status: 'active',
    lastActive: '1 hour ago',
  },
  {
    id: 'user_faculty_04',
    name: 'Prof. Vikram Sharma',
    email: 'faculty.aiml@arcai.edu',
    role: 'Faculty',
    departmentId: 1,
    departmentCode: 'AIML',
    status: 'active',
    lastActive: 'Yesterday',
  },
  {
    id: 'user_hod_05',
    name: 'Dr. Anita Roy',
    email: 'hod.ece@arcai.edu',
    role: 'HOD',
    departmentId: 3,
    departmentCode: 'ECE',
    status: 'active',
    lastActive: '2 days ago',
  },
];
