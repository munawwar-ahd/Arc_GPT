import React, { useState } from 'react';
import {
  Database,
  ChevronDown,
  LogOut,
  UserCheck,
  ShieldAlert,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { User } from '../types/index.js';

interface HeaderProps {
  currentUser: User;
  onOpenUserModal: () => void;
  onOpenSecurityDemo: () => void;
  onSignOut: () => void;
  onNavigateToAdmin?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onOpenUserModal,
  onOpenSecurityDemo,
  onSignOut,
  onNavigateToAdmin,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const isAdmin = currentUser.role === 'Admin';

  const getBadgeColor = (role: string) => {
    switch (role) {
      case 'Admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'HOD':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Faculty':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/95 px-6 backdrop-blur">
      {/* Brand & Subtitle */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-blue-500 shadow-md shadow-blue-500/20 text-white">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-tight text-slate-900 text-lg">Arc AI</span>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200/60">
              Data Assistant
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium hidden sm:block">
            Natural-Language Organizational Data Platform
          </p>
        </div>
      </div>

      {/* Header Actions & Active Role */}
      <div className="flex items-center gap-3 relative">
        {/* Security Sandbox button - Protected, visible ONLY to Admin role */}
        {isAdmin && (
          <button
            onClick={onOpenSecurityDemo}
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-800 hover:bg-purple-100 transition-colors shadow-2xs"
            title="Admin Security Sandbox"
          >
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <span>Security Sandbox</span>
          </button>
        )}

        {/* User Switcher / Profile Badge with Dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-1.5 pr-3 text-left hover:border-blue-300 hover:shadow-xs transition-all cursor-pointer"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs shadow-xs">
              {currentUser.name
                .split(' ')
                .map(n => n[0])
                .join('')}
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-800">{currentUser.name}</span>
                <span
                  className={`rounded-full px-2 py-0.2 text-[10px] font-bold border ${getBadgeColor(
                    currentUser.role
                  )}`}
                >
                  {currentUser.role}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">{currentUser.email}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          {/* Profile Dropdown */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50 space-y-1">
              <div className="p-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900">{currentUser.name}</p>
                <p className="text-[11px] text-slate-500">{currentUser.email}</p>
                <span
                  className={`mt-1 inline-block rounded px-1.5 py-0.2 text-[10px] font-bold border ${getBadgeColor(
                    currentUser.role
                  )}`}
                >
                  Role: {currentUser.role}
                </span>
              </div>

              <button
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenUserModal();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
              >
                <UserCheck className="h-3.5 w-3.5 text-blue-600" />
                <span>Switch Demo Persona</span>
              </button>

              {isAdmin && onNavigateToAdmin && (
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onNavigateToAdmin();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 text-left cursor-pointer"
                >
                  <ShieldAlert className="h-3.5 w-3.5 text-purple-600" />
                  <span>Admin Console</span>
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenSecurityDemo();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-purple-600" />
                  <span>Security Sandbox</span>
                </button>
              )}

              <div className="border-t border-slate-100 pt-1">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    onSignOut();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 text-left cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 text-red-500" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
