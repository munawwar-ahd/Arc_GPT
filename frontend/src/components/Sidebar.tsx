import React from 'react';
import {
  LayoutDashboard,
  MessageSquareText,
  Lightbulb,
  History,
  BookmarkCheck,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';
import { UserRole } from '../types/index.js';

export type NavTab =
  | 'dashboard'
  | 'ask'
  | 'insights'
  | 'history'
  | 'saved'
  | 'settings'
  | 'admin';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  userRole: UserRole;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  userRole,
}) => {
  // Normal user navigation: exactly the 6 requested items
  const mainNavItems = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'ask' as NavTab, label: 'Ask Data', icon: MessageSquareText },
    { id: 'insights' as NavTab, label: 'Insights', icon: Lightbulb },
    { id: 'history' as NavTab, label: 'Query History', icon: History },
    { id: 'saved' as NavTab, label: 'Saved Queries', icon: BookmarkCheck },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  const isAdmin = userRole === 'Admin';

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col justify-between p-4 min-h-[calc(100vh-4rem)]">
      <div className="space-y-6">
        {/* Main Navigation */}
        <div className="space-y-1">
          <p className="px-3 text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-2">
            Navigation
          </p>
          <nav className="space-y-1">
            {mainNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Protected Admin Area - Visible ONLY to Admin users */}
        {isAdmin && (
          <div className="pt-4 border-t border-slate-100">
            <p className="px-3 text-[11px] font-bold tracking-wider text-purple-700 uppercase mb-2 flex items-center justify-between">
              <span>Administration</span>
              <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[9px] font-extrabold text-purple-800">
                PRO
              </span>
            </p>
            <button
              onClick={() => onSelectTab('admin')}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'admin'
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-purple-900 bg-purple-50/70 hover:bg-purple-100/80 border border-purple-200/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <ShieldAlert className={`h-4 w-4 ${activeTab === 'admin' ? 'text-white' : 'text-purple-700'}`} />
                <span>Admin Console</span>
              </div>
              <ArrowUpRight className={`h-3.5 w-3.5 ${activeTab === 'admin' ? 'text-white' : 'text-purple-500'}`} />
            </button>
          </div>
        )}
      </div>

      {/* Clean User Assistance Footer */}
      <div className="border-t border-slate-100 pt-3">
        <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/80 text-xs text-slate-600 space-y-1">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            <span>Natural Data Assistant</span>
          </p>
          <p className="text-[11px] text-slate-500 leading-tight">
            Ask questions in plain English to explore your organizational data.
          </p>
        </div>
      </div>
    </aside>
  );
};
