import React from 'react';
import { Settings, X, Database, Shield, Server, Cpu, CheckCircle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">System &amp; Engine Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 text-xs text-slate-700">
          <div className="rounded-xl border border-slate-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-blue-600" />
                AI Model Engine
              </span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                Gemini 3.8 Flash
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Server-side GenAI SDK integration with User-Agent telemetry and self-correction loops.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-emerald-600" />
                Database Engine
              </span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                PostgreSQL Compatible
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Currently running in-memory PostgreSQL engine with realistic college dataset. Supabase PostgreSQL connectable via DATABASE_URL env var.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-purple-600" />
                Query Guard Limits
              </span>
              <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                Max 500 Rows
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Strict read-only AST parser blocks DDL/DML, multi-statement injection, and unauthenticated schema inspection.
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
