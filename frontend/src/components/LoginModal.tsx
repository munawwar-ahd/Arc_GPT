import React from 'react';
import { Database, ShieldCheck, UserCheck, X, Check, ArrowRight } from 'lucide-react';
import { User, UserRole } from '../types/index.js';
import { DEMO_USERS } from '../data/demoUsers.js';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSelectUser: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSelectUser,
}) => {
  if (!isOpen) return null;

  const roleDescriptions: Record<UserRole, string> = {
    Admin: 'Institutional oversight. Full administrative governance, audit trails, schema views, and unrestricted read-only querying.',
    HOD: 'Departmental Head (AIML). Scoped academic focus for curriculum planning, attendance thresholds, and student performance.',
    Faculty: 'Instructor (CSE). Focused class-level querying, student grades, exams, and attendance monitoring.',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Database className="h-4 w-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Ask your data. Get answers.
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Query structured organizational data using natural language — no SQL required.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Notice */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] text-blue-900 leading-relaxed">
          <span className="font-bold">Development Prototype Notice:</span> These are simulated demonstration profiles. The underlying GEN-09 translation engine is universal and works seamlessly with HR, finance, healthcare, and enterprise relational databases.
        </div>

        {/* User Options */}
        <div className="space-y-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Select Active Demonstration Persona
          </span>

          <div className="space-y-2">
            {DEMO_USERS.map(u => {
              const isSelected = currentUser.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    onSelectUser(u);
                    onClose();
                  }}
                  className={`w-full text-left rounded-xl border p-3.5 transition-all flex items-start justify-between group ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-600/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{u.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                          u.role === 'Admin'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'HOD'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {u.role}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">{u.email}</p>
                    <p className="text-[11px] text-slate-600 pt-0.5 leading-snug">
                      {roleDescriptions[u.role]}
                    </p>
                  </div>

                  <div className="shrink-0 pt-1">
                    {isSelected ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-400 group-hover:border-blue-400 group-hover:text-blue-600">
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
