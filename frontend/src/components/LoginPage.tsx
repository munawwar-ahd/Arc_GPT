import React, { useState } from 'react';
import {
  Database,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  Lock,
  Search,
  Code2,
  BarChart3,
  Layers,
  GraduationCap,
  Users,
  Building2,
  Terminal,
} from 'lucide-react';
import { User, UserRole } from '../types/index.js';
import { DEMO_USERS } from '../data/demoUsers.js';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('Admin');
  const [customEmail, setCustomEmail] = useState<string>('admin.vance@arcai.edu');

  const selectedUser = DEMO_USERS.find(u => u.role === selectedRole) || DEMO_USERS[0];

  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    const user = DEMO_USERS.find(u => u.role === role);
    if (user) {
      setCustomEmail(user.email);
    }
  };

  const handleSignIn = (userToLogin: User) => {
    onLogin(userToLogin);
  };

  const roleMeta: Record<
    UserRole,
    {
      title: string;
      badgeColor: string;
      desc: string;
      scope: string[];
      sampleQuery: string;
    }
  > = {
    Admin: {
      title: 'College Administrator',
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
      desc: 'Institutional oversight. Full administrative governance, audit logs, schema inspector, and unrestricted read-only querying.',
      scope: ['All Departments (AIML, CSE, ECE, MECH, IT)', 'Audit Logs & Security Firewall', 'Role Management'],
      sampleQuery: 'What is the average CGPA of each department?',
    },
    HOD: {
      title: 'HOD / Department Head',
      badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
      desc: 'Departmental Head (AIML). Scoped academic focus for curriculum planning, attendance compliance, and student tracking.',
      scope: ['AIML Department Focus', 'Attendance Threshold Compliance (< 75%)', 'Course Marks Analysis'],
      sampleQuery: 'Which AIML students have attendance below 75%?',
    },
    Faculty: {
      title: 'Faculty / Instructor',
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      desc: 'Instructor (CSE). Focused class-level querying, student grades, exams, and attendance monitoring.',
      scope: ['CSE Course Focus (Data Structures, OS)', 'Exam Performance & Grades', 'Class Attendance'],
      sampleQuery: 'Show students who scored below 40 in Data Structures.',
    },
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <header className="w-full border-b border-slate-200/80 bg-white/90 backdrop-blur px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-blue-500 shadow-md shadow-blue-500/20 text-white">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-slate-900 text-lg">Arc AI</span>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200/60">
                GEN-09 Prototype
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium hidden sm:block">
              Natural-Language Data Query Translation System
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="hidden sm:inline text-slate-400">PostgreSQL Ready</span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 border border-emerald-200 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            1,000 Seeded Students
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center w-full">
          {/* Left Column: Login Card & Demo Personas */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/80 px-3 py-1 text-xs font-semibold text-blue-700">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                <span>GEN-09 Natural-Language Translation Engine</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Ask your data.<br />
                <span className="bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-500 bg-clip-text text-transparent">
                  Get answers without SQL.
                </span>
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Query structured organizational databases using normal natural language. Arc AI securely interprets intent, maps relevant schemas, validates read-only queries, and visualizes answers.
              </p>
            </div>

            {/* Persona Switcher & Login Box */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xl shadow-slate-200/50 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Select Demonstration User Persona
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    Role-Based Access Control
                  </span>
                </div>

                {/* Role Tabs */}
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
                  {DEMO_USERS.map(user => {
                    const isSelected = selectedRole === user.role;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => handleSelectRole(user.role)}
                        className={`rounded-lg py-2 px-2 text-xs font-bold transition-all text-center ${
                          isSelected
                            ? 'bg-white text-blue-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        {user.role}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Persona Card Details */}
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/60 to-blue-50/20 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-sm shadow-xs">
                      {selectedUser.name
                        .split(' ')
                        .map(n => n[0])
                        .join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900">{selectedUser.name}</h4>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-bold border ${roleMeta[selectedRole].badgeColor}`}
                        >
                          {roleMeta[selectedRole].title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedUser.email}</p>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {roleMeta[selectedRole].desc}
                </p>

                {/* Scope Points */}
                <div className="space-y-1.5 pt-1 border-t border-slate-200/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Authorized Scope:
                  </span>
                  <div className="grid grid-cols-1 gap-1">
                    {roleMeta[selectedRole].scope.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pre-suggested query for this role */}
                <div className="rounded-lg bg-white p-2.5 border border-slate-200 text-xs text-slate-600">
                  <span className="font-bold text-slate-800">Sample inquiry: </span>
                  <span className="italic text-blue-700 font-medium">"{roleMeta[selectedRole].sampleQuery}"</span>
                </div>
              </div>

              {/* One-Click Sign In Button */}
              <button
                type="button"
                onClick={() => handleSignIn(selectedUser)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 transition-all group"
              >
                <span>Sign in as {selectedUser.name} ({selectedRole})</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </button>

              {/* Safe Authentication & Target Users Notice */}
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-[11px] text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <Lock className="h-3.5 w-3.5 text-amber-700" />
                  <span>Demonstration Environment Notice</span>
                </div>
                <p className="text-amber-800/90 leading-tight">
                  These accounts are safe demonstration personas (Administrator, HOD, Faculty). The underlying translation engine is domain-agnostic and designed for non-technical organizational users across HR, finance, healthcare, and enterprise data systems. Safe demo authentication only — no real personal passwords required.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Engine Features & Live Pipeline Showcase */}
          <div className="lg:col-span-6 space-y-5">
            {/* Visual Pipeline Interactive Preview */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                    <Terminal className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    GEN-09 Translation Pipeline Preview
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Read-Only Verified
                </span>
              </div>

              {/* Step 1: User Question */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  1. Natural-Language Question
                </span>
                <div className="rounded-xl bg-blue-50/80 border border-blue-200 p-3 text-xs font-semibold text-blue-900">
                  "Which AIML students have attendance below 75%?"
                </div>
              </div>

              {/* Step 2: Generated SQL */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  2. Schema-Aware PostgreSQL Generation
                </span>
                <div className="rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-blue-300 leading-relaxed overflow-x-auto">
                  SELECT s.roll_number, s.name, a.percentage<br />
                  FROM students s<br />
                  JOIN departments d ON s.department_id = d.id<br />
                  JOIN attendance a ON s.id = a.student_id<br />
                  WHERE d.code = 'AIML' AND a.percentage &lt; 75.0<br />
                  ORDER BY a.percentage ASC LIMIT 200;
                </div>
              </div>

              {/* Step 3: Verified Result */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  3. Synthesized Natural-Language Answer
                </span>
                <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 text-xs font-semibold text-emerald-950">
                  "5 AIML students currently have attendance below the 75% institutional threshold across their enrolled courses."
                </div>
              </div>
            </div>

            {/* Core Capability Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <h4 className="font-bold text-xs text-slate-900">Read-Only Guard</h4>
                <p className="text-[11px] text-slate-500 leading-tight">
                  AST validator blocks DROP, DELETE, UPDATE, and injection payloads.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                  <Sparkles className="h-4 w-4" />
                </div>
                <h4 className="font-bold text-xs text-slate-900">Zero-Guessing</h4>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Ambiguity detector prompts for specific thresholds before execution.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <h4 className="font-bold text-xs text-slate-900">Smart Charts</h4>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Auto-selects Recharts bar, line, pie, or tabular visualizations.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        <p>
          <strong className="text-slate-700">Arc AI</strong> — Built for GEN-09 Natural-Language Data Query Translation. Universal architecture for enterprise, HR, finance, and educational databases.
        </p>
      </footer>
    </div>
  );
};
