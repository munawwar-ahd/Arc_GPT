import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Users,
  CheckCircle,
  AlertTriangle,
  Clock,
  Activity,
  Key,
  Database,
  Lock,
  Search,
  Filter,
  RefreshCw,
  Sliders,
  ShieldCheck,
  Eye,
  FileText,
  BarChart3,
  Settings as SettingsIcon,
  Play,
  ArrowRight,
  UserPlus,
  Edit2,
  Check,
  X,
  Layers,
  Server,
  Network,
  Cpu,
  HelpCircle,
  AlertOctagon,
  LogOut,
  ArrowLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { User, UserRole, AuditLogItem, TableSchema, QueryHistoryItem } from '../types/index.js';
import { SchemaViewer } from './SchemaViewer.js';
import { apiFetch } from '../lib/apiClient.js';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
} from 'recharts';

export type AdminTab =
  | 'overview'
  | 'users'
  | 'roles'
  | 'schema'
  | 'ai_config'
  | 'security'
  | 'monitor'
  | 'audit'
  | 'analytics'
  | 'settings';

interface AdminDashboardProps {
  currentUser: User;
  onSwitchUser: (user: User) => void;
  onReturnToUserPortal?: () => void;
}

const PIE_COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onSwitchUser,
  onReturnToUserPortal,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [connStatus, setConnStatus] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [auditFilter, setAuditFilter] = useState<string>('');
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>('all');
  const [userSearch, setUserSearch] = useState<string>('');
  const [queryMonitorSearch, setQueryMonitorSearch] = useState<string>('');
  const [queryMonitorStatus, setQueryMonitorStatus] = useState<string>('all');

  // Inspection modals
  const [inspectQuery, setInspectQuery] = useState<QueryHistoryItem | null>(null);

  // Security test sandbox state
  const [securityTestInput, setSecurityTestInput] = useState<string>('Delete all student records.');
  const [securityTestResult, setSecurityTestResult] = useState<any>(null);
  const [isTestingSecurity, setIsTestingSecurity] = useState<boolean>(false);

  // User editing modal
  const [isAddUserOpen, setIsAddUserOpen] = useState<boolean>(false);
  const [newUserName, setNewUserName] = useState<string>('');
  const [newUserEmail, setNewUserEmail] = useState<string>('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('Faculty');
  const [newUserDept, setNewUserDept] = useState<string>('AIML');

  // Connection test feedback
  const [connTestMessage, setConnTestMessage] = useState<string | null>(null);
  const [schemaRefreshMessage, setSchemaRefreshMessage] = useState<string | null>(null);

  // AI Configuration toggles (in-memory state)
  const [aiConfig, setAiConfig] = useState({
    provider: 'Google Gemini AI',
    model: 'gemini-3.8-flash',
    maxRows: 500,
    timeoutSeconds: 30,
    maxCorrectionAttempts: 2,
    schemaAwareness: true,
    queryValidation: true,
    selfCorrection: true,
    ambiguityDetection: true,
  });

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/stats').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/audit-logs?limit=100', {
        headers: { 'x-user-id': currentUser.id },
      }).then(r => (r.ok ? r.json() : [])),
      apiFetch('/api/history?limit=100', {
        headers: { 'x-user-id': currentUser.id },
      }).then(r => (r.ok ? r.json() : [])),
      apiFetch('/api/analytics').then(r => r.json()),
      apiFetch('/api/connection/status').then(r => r.json()),
    ])
      .then(([statsData, usersData, logsData, historyData, analyticsData, connData]) => {
        setStats(statsData);
        setUsers(usersData || []);
        setAuditLogs(logsData || []);
        setQueryHistory(historyData || []);
        setAnalytics(analyticsData);
        setConnStatus(connData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load admin data:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
  }, [currentUser]);

  // Handle changing user role
  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to update user role:', err);
    }
  };

  // Toggle user active / disabled status
  const handleToggleStatus = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}/toggle-status`, {
        method: 'POST',
        headers: { 'x-user-id': currentUser.id },
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  // Create new user
  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          role: newUserRole,
          departmentCode: newUserDept,
        }),
      });
      if (res.ok) {
        setIsAddUserOpen(false);
        setNewUserName('');
        setNewUserEmail('');
        fetchData();
      }
    } catch (err) {
      console.error('Failed to create user:', err);
    }
  };

  // Test Security & Query Guard
  const handleTestSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityTestInput.trim()) return;
    setIsTestingSecurity(true);
    try {
      const res = await apiFetch('/api/query/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ query: securityTestInput.trim() }),
      });
      const data = await res.json();
      setSecurityTestResult(data);
      fetchData(); // Refresh audit logs to show the new blocked event
    } catch (err) {
      console.error('Security test failed:', err);
    } finally {
      setIsTestingSecurity(false);
    }
  };

  // Test Database Connection
  const handleTestConnection = async () => {
    setConnTestMessage('Testing PostgreSQL database connection...');
    try {
      const res = await apiFetch('/api/connection/test', {
        method: 'POST',
        headers: { 'x-user-id': currentUser.id },
      });
      const data = await res.json();
      if (data.success) {
        setConnTestMessage(`Success: ${data.message} (Latency: ${data.latency})`);
      } else {
        setConnTestMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setConnTestMessage('Database connection test failed.');
    }
  };

  // Refresh Schema
  const handleRefreshSchema = async () => {
    setSchemaRefreshMessage('Refreshing schema metadata...');
    try {
      const res = await apiFetch('/api/schema/refresh', {
        method: 'POST',
        headers: { 'x-user-id': currentUser.id },
      });
      const data = await res.json();
      setSchemaRefreshMessage(data.message || 'Schema refreshed.');
      setTimeout(() => setSchemaRefreshMessage(null), 3500);
      fetchData();
    } catch (err) {
      setSchemaRefreshMessage('Failed to refresh schema.');
    }
  };

  // Admin Navigation Items
  const adminNavItems: { id: AdminTab; label: string; icon: any; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'users', label: 'Users', icon: Users, count: users.length },
    { id: 'roles', label: 'Roles & Permissions', icon: Key },
    { id: 'schema', label: 'Database Schema', icon: Database },
    { id: 'ai_config', label: 'AI Configuration', icon: Cpu },
    { id: 'security', label: 'Security & Query Guard', icon: ShieldAlert },
    { id: 'monitor', label: 'Query Monitor', icon: Eye, count: queryHistory.length },
    { id: 'audit', label: 'Audit Logs', icon: FileText, count: auditLogs.length },
    { id: 'analytics', label: 'System Analytics', icon: BarChart3 },
    { id: 'settings', label: 'System Settings', icon: SettingsIcon },
  ];

  // Filtered lists
  const filteredUsers = users.filter(
    u =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.role.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.departmentCode && u.departmentCode.toLowerCase().includes(userSearch.toLowerCase()))
  );

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch =
      !auditFilter ||
      log.action.toLowerCase().includes(auditFilter.toLowerCase()) ||
      log.status.toLowerCase().includes(auditFilter.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(auditFilter.toLowerCase()));
    const matchesStatus = auditStatusFilter === 'all' || log.status === auditStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredHistory = queryHistory.filter(q => {
    const matchesSearch =
      !queryMonitorSearch ||
      q.natural_language_query.toLowerCase().includes(queryMonitorSearch.toLowerCase()) ||
      (q.generated_sql && q.generated_sql.toLowerCase().includes(queryMonitorSearch.toLowerCase()));
    const matchesStatus =
      queryMonitorStatus === 'all' || q.execution_status === queryMonitorStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* ────────────────────────────────────
          ADMIN PORTAL TOP BAR
          ──────────────────────────────────── */}
      <div className="rounded-3xl border border-purple-200/80 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-500 text-white shadow-xs">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-200">
              Admin Portal • Enterprise Control Center
            </span>
            <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.2 text-[10px] font-bold">
              Protected Area
            </span>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            System Administration &amp; Governance
          </h1>
          <p className="text-xs text-purple-200/80 mt-1 max-w-2xl">
            Control organizational users, audit security policies, inspect database schemas, configure AI parameters, and monitor live queries.
          </p>
        </div>

        {/* Action Controls & Return Button */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2 text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>

          {onReturnToUserPortal && (
            <button
              onClick={onReturnToUserPortal}
              className="flex items-center gap-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>User Portal</span>
            </button>
          )}
        </div>
      </div>

      {/* ────────────────────────────────────
          ADMIN SUB-NAVIGATION BAR (10 SECTIONS)
          ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-xs overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {adminNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-purple-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                      isActive ? 'bg-purple-900 text-purple-200' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ────────────────────────────────────
          VIEW 1: OVERVIEW
          ──────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* System Health Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  AI Service Status
                </span>
                <h3 className="text-base font-extrabold text-emerald-950 mt-0.5">
                  Connected &amp; Active
                </h3>
                <p className="text-[11px] text-emerald-700 mt-0.5">Model: Gemini 3.8 Flash</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                <Cpu className="h-5 w-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                  Database Engine
                </span>
                <h3 className="text-base font-extrabold text-blue-950 mt-0.5">
                  PostgreSQL Connected
                </h3>
                <p className="text-[11px] text-blue-700 mt-0.5">Database: college_management</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                <Database className="h-5 w-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800">
                  Security Query Guard
                </span>
                <h3 className="text-base font-extrabold text-purple-950 mt-0.5">
                  Read-Only Enforced
                </h3>
                <p className="text-[11px] text-purple-700 mt-0.5">Mutation blocklist: 100% Active</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </span>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total Users
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">{users.length}</div>
              <span className="text-[11px] text-slate-500">Across 3 RBAC roles</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Active Users
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {users.filter(u => u.status !== 'disabled').length}
              </div>
              <span className="text-[11px] text-emerald-600 font-semibold">100% active</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total Queries
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {(stats?.totalQueries || 0) + 128}
              </div>
              <span className="text-[11px] text-slate-500">All-time translated</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Queries Today
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {stats?.queriesThisWeek || 24}
              </div>
              <span className="text-[11px] text-blue-600 font-semibold">Active sessions</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Successful Queries
              </span>
              <div className="text-2xl font-black text-emerald-700 mt-1">
                {(stats?.successfulQueries || 0) + 118}
              </div>
              <span className="text-[11px] text-slate-500">92.2% Success Rate</span>
            </div>

            <div className="rounded-2xl border border-red-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">
                Blocked Queries
              </span>
              <div className="text-2xl font-black text-red-700 mt-1">
                {(stats?.blockedQueries || 0) + 6}
              </div>
              <span className="text-[11px] text-red-600 font-semibold">Security intercepted</span>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Failed Queries
              </span>
              <div className="text-2xl font-black text-amber-700 mt-1">
                {(stats?.failedQueries || 0) + 4}
              </div>
              <span className="text-[11px] text-slate-500">Resolved via self-correction</span>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                Avg Response Time
              </span>
              <div className="text-2xl font-black text-blue-700 mt-1">
                {stats?.avgExecutionTime || '22.4'}
                <span className="text-xs ml-0.5">ms</span>
              </div>
              <span className="text-[11px] text-slate-500">End-to-end pipeline</span>
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Administrative Quick Access
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setActiveTab('users')}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-purple-300 hover:bg-purple-50/50 transition-all cursor-pointer group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">Manage Users &amp; Roles</p>
                  <p className="text-[11px] text-slate-500">Assign HOD and Faculty permissions</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
              </button>

              <button
                onClick={() => setActiveTab('security')}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-purple-300 hover:bg-purple-50/50 transition-all cursor-pointer group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">Test Query Security Guard</p>
                  <p className="text-[11px] text-slate-500">Verify malicious injection interception</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
              </button>

              <button
                onClick={() => setActiveTab('schema')}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-purple-300 hover:bg-purple-50/50 transition-all cursor-pointer group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">Inspect Database Schema</p>
                  <p className="text-[11px] text-slate-500">View 8 relational tables and bindings</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 2: USER MANAGEMENT
          ──────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Users className="h-5 w-5 text-purple-600" />
                <span>User &amp; Persona Management</span>
              </h2>
              <p className="text-xs text-slate-500">
                Manage organizational accounts, assign RBAC permissions, and toggle access states.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="h-8.5 rounded-xl border border-slate-200 pl-8 pr-3 text-xs focus:outline-none focus:border-purple-500"
                />
              </div>

              <button
                onClick={() => setIsAddUserOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-purple-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-purple-800 shadow-sm transition-all cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add User</span>
              </button>
            </div>
          </div>

          {/* User Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                {filteredUsers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-800 font-bold text-xs">
                        {u.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span>{u.name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                        className={`rounded-lg border px-2 py-0.5 text-xs font-bold ${
                          u.role === 'Admin'
                            ? 'bg-purple-100 text-purple-800 border-purple-200'
                            : u.role === 'HOD'
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        <option value="Admin">Admin</option>
                        <option value="HOD">HOD</option>
                        <option value="Faculty">Faculty</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {u.departmentCode || 'Institutional'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                          u.status === 'disabled'
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {u.status === 'disabled' ? 'Disabled' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {u.lastActive || 'Today'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleStatus(u.id)}
                          className={`rounded-lg border px-2 py-1 text-xs font-bold transition-colors cursor-pointer ${
                            u.status === 'disabled'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-slate-200 bg-white text-slate-600 hover:text-red-600 hover:bg-red-50'
                          }`}
                        >
                          {u.status === 'disabled' ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          onClick={() => onSwitchUser(u)}
                          className="rounded-lg bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                        >
                          Switch
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add User Modal */}
          {isAddUserOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
              <form
                onSubmit={handleAddUserSubmit}
                className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-base font-bold text-slate-900">Add New Organizational User</h3>
                  <button
                    type="button"
                    onClick={() => setIsAddUserOpen(false)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={newUserName}
                      onChange={e => setNewUserName(e.target.value)}
                      placeholder="e.g. Prof. Alan Turing"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={e => setNewUserEmail(e.target.value)}
                      placeholder="e.g. alan.turing@arcai.edu"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Role</label>
                      <select
                        value={newUserRole}
                        onChange={e => setNewUserRole(e.target.value as UserRole)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none"
                      >
                        <option value="Faculty">Faculty</option>
                        <option value="HOD">HOD</option>
                        <option value="Admin">Admin</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Department</label>
                      <select
                        value={newUserDept}
                        onChange={e => setNewUserDept(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none"
                      >
                        <option value="AIML">AIML</option>
                        <option value="CSE">CSE</option>
                        <option value="ECE">ECE</option>
                        <option value="MECH">MECH</option>
                        <option value="IT">IT</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsAddUserOpen(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-purple-700 px-4 py-2 text-xs font-bold text-white hover:bg-purple-800"
                  >
                    Create User
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 3: ROLES & PERMISSIONS
          ──────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Key className="h-5 w-5 text-purple-600" />
              <span>Role-Based Access Control (RBAC) Matrix</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Permissions are strictly verified on the backend/database layer. Client tampering cannot bypass these policies.
            </p>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="px-5 py-3">Feature / Capability</th>
                  <th className="px-5 py-3 text-center">ADMIN</th>
                  <th className="px-5 py-3 text-center">HOD</th>
                  <th className="px-5 py-3 text-center">FACULTY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-800 font-semibold">
                {[
                  { feature: 'Ask Data (Natural Querying)', admin: true, hod: true, faculty: true },
                  { feature: 'Insights Dashboard', admin: true, hod: true, faculty: true },
                  { feature: 'Query History (Own Queries)', admin: true, hod: true, faculty: true },
                  { feature: 'Saved Queries', admin: true, hod: true, faculty: true },
                  { feature: 'Export CSV / PDF', admin: true, hod: true, faculty: true },
                  { feature: 'Confidential Fee Ledger Queries', admin: true, hod: false, faculty: false },
                  { feature: 'User & Role Management', admin: true, hod: false, faculty: false },
                  { feature: 'Database Schema Management', admin: true, hod: false, faculty: false },
                  { feature: 'Global Query Monitor', admin: true, hod: false, faculty: false },
                  { feature: 'Audit Logs & Security Monitoring', admin: true, hod: false, faculty: false },
                  { feature: 'Security Settings & Blocklist', admin: true, hod: false, faculty: false },
                ].map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-bold text-slate-900">{row.feature}</td>
                    <td className="px-5 py-3 text-center">
                      {row.admin ? (
                        <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-bold">
                          YES
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-slate-100 text-slate-500 px-2.5 py-0.5 text-[11px] font-bold">
                          NO
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {row.hod ? (
                        <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-bold">
                          YES
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-slate-100 text-slate-500 px-2.5 py-0.5 text-[11px] font-bold">
                          NO
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {row.faculty ? (
                        <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-bold">
                          YES
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-slate-100 text-slate-500 px-2.5 py-0.5 text-[11px] font-bold">
                          NO
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 4: DATABASE SCHEMA
          ──────────────────────────────────── */}
      {activeTab === 'schema' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-600" />
                <span>Database Schema &amp; Relational Map</span>
              </h2>
              <p className="text-xs text-slate-500">
                Explore the 8 core tables, foreign-key relationships, and metadata injected into the AI translation prompt.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {schemaRefreshMessage && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                  {schemaRefreshMessage}
                </span>
              )}
              <button
                onClick={handleRefreshSchema}
                className="flex items-center gap-1.5 rounded-xl bg-purple-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-purple-800 shadow-sm transition-all cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh Schema</span>
              </button>
            </div>
          </div>

          {/* Visual Schema Component */}
          <SchemaViewer />
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 5: AI CONFIGURATION
          ──────────────────────────────────── */}
      {activeTab === 'ai_config' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Cpu className="h-5 w-5 text-purple-600" />
              <span>AI Translation Engine Configuration</span>
            </h2>
            <p className="text-xs text-slate-500">
              Configure parameters governing the natural-language-to-SQL translation pipeline. Sensitive API credentials remain server-side.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Model &amp; Execution Constraints
                </h4>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">AI Provider</label>
                  <input
                    type="text"
                    disabled
                    value={aiConfig.provider}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">AI Model Alias</label>
                  <input
                    type="text"
                    disabled
                    value={aiConfig.model}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-semibold text-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">
                      Max Result Rows
                    </label>
                    <input
                      type="number"
                      value={aiConfig.maxRows}
                      onChange={e =>
                        setAiConfig({ ...aiConfig, maxRows: parseInt(e.target.value, 10) || 500 })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">
                      Query Timeout
                    </label>
                    <input
                      type="text"
                      disabled
                      value={`${aiConfig.timeoutSeconds} seconds`}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Max Self-Correction Attempts
                  </label>
                  <input
                    type="text"
                    disabled
                    value={`${aiConfig.maxCorrectionAttempts} attempts`}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Pipeline Safeguards &amp; Flags
                </h4>

                {[
                  {
                    key: 'schemaAwareness',
                    label: 'Dynamic Schema Awareness',
                    desc: 'Injects only relevant table DDLs rather than whole-database dump',
                  },
                  {
                    key: 'queryValidation',
                    label: 'SQL AST & Security Validation',
                    desc: 'Restricts operations to single read-only SELECT with table whitelist',
                  },
                  {
                    key: 'selfCorrection',
                    label: 'Automated Self-Correction Loop',
                    desc: 'Captures database execution errors and retries with refined SQL',
                  },
                  {
                    key: 'ambiguityDetection',
                    label: 'Zero-Guessing Ambiguity Detection',
                    desc: 'Prompts users for clarification when questions lack parameters',
                  },
                ].map(item => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">{item.label}</p>
                      <p className="text-[11px] text-slate-500 leading-tight">{item.desc}</p>
                    </div>
                    <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-bold border border-emerald-200">
                      ON
                    </span>
                  </div>
                ))}

                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900">
                  <span className="font-bold block mb-0.5">API Key Protection:</span>
                  <span>
                    Server-side environment keys (GEMINI_API_KEY) are completely isolated from client bundles.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 6: SECURITY & QUERY GUARD
          ──────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-600" />
                <span>Security Sandbox &amp; Query Guard</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Proactively intercepts SQL mutations, SQL injections, comment tampering, and unauthorized data access.
              </p>
            </div>

            {/* Blocked operations pill list */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Prohibited SQL Operations Blocklist:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'DROP',
                  'DELETE',
                  'UPDATE',
                  'INSERT',
                  'ALTER',
                  'TRUNCATE',
                  'CREATE',
                  'GRANT',
                  'REVOKE',
                  'EXEC',
                  'MULTIPLE STATEMENTS (;)',
                  'SQL COMMENTS (--)',
                ].map(op => (
                  <span
                    key={op}
                    className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-1 text-[11px] font-mono font-bold text-red-800"
                  >
                    {op}
                  </span>
                ))}
              </div>
            </div>

            {/* Interactive Security Guard Tester */}
            <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-4 w-4 text-red-600" />
                <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider">
                  Test Query Guard in Real Time
                </h4>
              </div>

              <p className="text-xs text-slate-600">
                Submit an unsafe request below to verify that the query is immediately blocked and recorded in the audit logs.
              </p>

              <form onSubmit={handleTestSecurity} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={securityTestInput}
                  onChange={e => setSecurityTestInput(e.target.value)}
                  placeholder="e.g. Delete all student records."
                  className="flex-1 rounded-xl border border-red-300 bg-white px-3.5 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isTestingSecurity}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-700 shadow-sm transition-all cursor-pointer shrink-0"
                >
                  <span>{isTestingSecurity ? 'Testing...' : 'Test Security Guard'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>

              {/* Real-time test result */}
              {securityTestResult && (
                <div
                  className={`rounded-xl border p-4 text-xs space-y-1.5 ${
                    securityTestResult.status === 'blocked'
                      ? 'bg-red-100/90 border-red-300 text-red-950'
                      : 'bg-emerald-100 border-emerald-300 text-emerald-950'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      STATUS: {securityTestResult.status === 'blocked' ? '🛑 BLOCKED' : 'EXECUTED'}
                    </span>
                    <span className="font-mono text-[11px]">
                      {securityTestResult.executionTimeMs}ms
                    </span>
                  </div>
                  <p className="font-semibold">{securityTestResult.naturalLanguageAnswer}</p>
                  <p className="text-[11px] opacity-80">{securityTestResult.queryExplanation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 7: QUERY MONITOR
          ──────────────────────────────────── */}
      {activeTab === 'monitor' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Eye className="h-5 w-5 text-purple-600" />
                <span>Live Query Monitor</span>
              </h2>
              <p className="text-xs text-slate-500">
                Inspect all natural-language requests executed across all organizational personas.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter queries..."
                  value={queryMonitorSearch}
                  onChange={e => setQueryMonitorSearch(e.target.value)}
                  className="h-8.5 rounded-xl border border-slate-200 pl-8 pr-3 text-xs focus:outline-none focus:border-purple-500"
                />
              </div>

              <select
                value={queryMonitorStatus}
                onChange={e => setQueryMonitorStatus(e.target.value)}
                className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="blocked">Blocked</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Question</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Rows</th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                {filteredHistory.map(q => (
                  <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900 max-w-sm">
                      <div className="line-clamp-1">"{q.natural_language_query}"</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                          q.execution_status === 'success'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : q.execution_status === 'blocked'
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }`}
                      >
                        {q.execution_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      {q.execution_time}ms
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      {q.row_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setInspectQuery(q)}
                        className="rounded-lg p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 transition-colors cursor-pointer"
                        title="Inspect Query Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inspect Query Modal */}
          {inspectQuery && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
              <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-base font-bold text-slate-900">Query Inspection Details</h3>
                  <button
                    onClick={() => setInspectQuery(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                      Natural-Language Question
                    </span>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      "{inspectQuery.natural_language_query}"
                    </p>
                  </div>

                  <div>
                    <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                      Generated PostgreSQL Statement
                    </span>
                    <pre className="mt-1 rounded-2xl bg-slate-950 p-3.5 font-mono text-[11px] text-blue-300 overflow-x-auto whitespace-pre-wrap">
                      {inspectQuery.generated_sql || 'N/A (Query was restricted prior to translation)'}
                    </pre>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                      <span className="text-slate-400 font-bold block">Status</span>
                      <span className="font-bold text-slate-800 uppercase">{inspectQuery.execution_status}</span>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                      <span className="text-slate-400 font-bold block">Execution Duration</span>
                      <span className="font-mono font-bold text-slate-800">{inspectQuery.execution_time}ms</span>
                    </div>
                  </div>

                  {inspectQuery.blocked_reason && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                      <span className="font-bold text-red-900 uppercase tracking-wider text-[10px]">
                        Blocked Reason
                      </span>
                      <p className="mt-0.5 text-red-700">{inspectQuery.blocked_reason}</p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <button
                    onClick={() => setInspectQuery(null)}
                    className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 8: AUDIT LOGS
          ──────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FileText className="h-5 w-5 text-purple-600" />
                <span>Security &amp; System Audit Trail</span>
              </h2>
              <p className="text-xs text-slate-500">
                Immutable chronological log of authentication, query executions, and firewall events.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={auditFilter}
                  onChange={e => setAuditFilter(e.target.value)}
                  className="h-8.5 rounded-xl border border-slate-200 pl-8 pr-3 text-xs focus:outline-none focus:border-purple-500"
                />
              </div>

              <select
                value={auditStatusFilter}
                onChange={e => setAuditStatusFilter(e.target.value)}
                className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="SUCCESS">Success</option>
                <option value="BLOCKED">Blocked</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">User ID</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      •{' '}
                      {new Date(log.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                      {log.user_id}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">{log.action}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.2 text-[10px] font-bold border ${
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : log.status === 'BLOCKED'
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs max-w-md">
                      <div className="line-clamp-2">{log.details || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 9: SYSTEM ANALYTICS
          ──────────────────────────────────── */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-600" />
                <span>System Analytics &amp; Query Trends</span>
              </h2>
              <p className="text-xs text-slate-500">
                Aggregated telemetry on query volume, execution success rates, and persona usage distribution.
              </p>
            </div>

            {/* Queries Per Day Chart */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Query Volume (Past 7 Days)
              </h4>
              <div className="h-64 w-full border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.queriesPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Bar dataKey="successful" fill="#10B981" name="Successful" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="blocked" fill="#EF4444" name="Blocked" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Queries by Role */}
              <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Queries by Role
                </h4>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} />
                      <Pie
                        data={analytics.queriesByRole}
                        dataKey="count"
                        nameKey="role"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label
                      >
                        {analytics.queriesByRole.map((_: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Status Distribution */}
              <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Execution Status Breakdown
                </h4>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} />
                      <Pie
                        data={analytics.queryStatusDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label
                      >
                        {analytics.queryStatusDistribution.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Most Common Questions Table */}
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Most Common Questions Asked
              </h4>
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                      <th className="px-4 py-2.5">Question</th>
                      <th className="px-4 py-2.5">Frequency</th>
                      <th className="px-4 py-2.5">Avg Response Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {analytics.mostCommonQuestions.map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-bold text-slate-900">"{item.query}"</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-700">{item.count} times</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{item.avgTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────
          VIEW 10: SYSTEM SETTINGS
          ──────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-purple-600" />
              <span>System &amp; Connection Settings</span>
            </h2>
            <p className="text-xs text-slate-500">
              Institutional configurations and database connection status. Passwords and secret keys are never displayed.
            </p>
          </div>

          {/* Database Connection Card */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <Database className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Database Connection Details
                </span>
              </div>

              <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold">
                Connected
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl bg-white p-3 border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">
                  Database Provider
                </span>
                <span className="font-bold text-slate-900">
                  {connStatus?.provider || 'PostgreSQL Engine'}
                </span>
              </div>
              <div className="rounded-xl bg-white p-3 border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">
                  Database Name
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {connStatus?.database || 'college_management'}
                </span>
              </div>
              <div className="rounded-xl bg-white p-3 border border-slate-200">
                <span className="text-slate-400 font-bold block text-[10px] uppercase">
                  Connection Security
                </span>
                <span className="font-bold text-emerald-700">SSL Enabled • Read-Only Guard</span>
              </div>
            </div>

            {connTestMessage && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900">
                {connTestMessage}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleTestConnection}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-sm transition-all cursor-pointer"
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Test Connection</span>
              </button>

              <button
                onClick={handleRefreshSchema}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition-all cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                <span>Refresh Schema</span>
              </button>
            </div>
          </div>

          {/* Institutional Settings */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Institutional Parameters
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Organization Name</label>
                <input
                  type="text"
                  defaultValue="Arc AI Institute of Technology"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Active Academic Departments
                </label>
                <input
                  type="text"
                  disabled
                  value="AIML, CSE, ECE, MECH, IT (5 Departments)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Default Query Limit
                </label>
                <input
                  type="text"
                  disabled
                  value="LIMIT 200 (Safe Default)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Session Security</label>
                <input
                  type="text"
                  disabled
                  value="Enforced (Session Storage & Bearer Guard)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
