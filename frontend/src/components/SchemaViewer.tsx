import React, { useState, useEffect } from 'react';
import {
  Network,
  Table,
  Key,
  Link as LinkIcon,
  ChevronRight,
  Database,
  ArrowDown,
  Layers,
  Search,
} from 'lucide-react';
import { TableSchema } from '../types/index.js';
import { apiFetch } from '../lib/apiClient.js';

interface SchemaViewerProps {
  onSelectSampleQuery?: (query: string) => void;
}

export const SchemaViewer: React.FC<SchemaViewerProps> = ({ onSelectSampleQuery }) => {
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('students');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    apiFetch('/api/schema')
      .then(res => res.json())
      .then(data => {
        setTables(data.tables || []);
        setRelationships(data.relationships || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load schema:', err);
        setLoading(false);
      });
  }, []);

  const activeSchema = tables.find(t => t.name === selectedTable) || tables[0];

  const filteredTables = tables.filter(t =>
    t.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    t.columns.some(c => c.name.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Network className="h-5 w-5 text-blue-600" />
          <span>Relational Database Schema Explorer</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Explore the College Management Database entities, relational foreign-key bindings, and table definitions powering Arc AI.
        </p>
      </div>

      {/* Visual Relational Hierarchy Flow Diagram */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/70 via-blue-50/20 to-white p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-blue-600" />
            <span>Relational Entity Dependency Graph</span>
          </span>
          <span className="text-[11px] text-slate-500">Foreign Key Mapping Flow</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Track 1: Attendance Flow */}
          <div className="rounded-xl border border-blue-200/60 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-blue-900">Attendance Relational Chain</span>
              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                Path A
              </span>
            </div>
            <div className="flex flex-col items-center space-y-2 text-xs">
              <button
                onClick={() => setSelectedTable('departments')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'departments'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-blue-50'
                }`}
              >
                Departments (id, name, code)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-blue-500" />
                <span>1 : N (students.department_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('students')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'students'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-blue-50'
                }`}
              >
                Students (id, roll_number, name, cgpa)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-blue-500" />
                <span>1 : N (attendance.student_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('attendance')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'attendance'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-blue-50'
                }`}
              >
                Attendance (student_id, subject_id, percentage)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-blue-500" />
                <span>N : 1 (attendance.subject_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('subjects')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'subjects'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-blue-50'
                }`}
              >
                Subjects (id, name, code, credits)
              </button>
            </div>
          </div>

          {/* Track 2: Marks & Academic Flow */}
          <div className="rounded-xl border border-indigo-200/60 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-indigo-900">Academic Marks Chain</span>
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                Path B
              </span>
            </div>
            <div className="flex flex-col items-center space-y-2 text-xs">
              <button
                onClick={() => setSelectedTable('students')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'students'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-indigo-50'
                }`}
              >
                Students (id, roll_number, name)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-indigo-500" />
                <span>1 : N (marks.student_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('marks')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'marks'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-indigo-50'
                }`}
              >
                Marks (student_id, subject_id, marks, max_marks)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-indigo-500" />
                <span>N : 1 (marks.subject_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('subjects')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'subjects'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-indigo-50'
                }`}
              >
                Subjects (id, name, department_id)
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <ArrowDown className="h-3.5 w-3.5 text-indigo-500" />
                <span>1 : N (exams.subject_id)</span>
              </div>
              <button
                onClick={() => setSelectedTable('exams')}
                className={`w-full py-2 px-3 rounded-lg border text-center font-bold transition-all ${
                  selectedTable === 'exams'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-indigo-50'
                }`}
              >
                Exams (id, subject_id, exam_name, exam_date)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table Column Inspector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Table Selector List */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search tables or columns..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full h-8 rounded-lg border border-slate-200 pl-8 pr-3 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            {filteredTables.map(t => {
              const isSelected = selectedTable === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => setSelectedTable(t.name)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Table className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                    <span>{t.name}</span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {t.columns.length} cols
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Table Details */}
        {activeSchema && (
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Table className="h-4 w-4 text-blue-600" />
                  <span>Table: {activeSchema.name}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeSchema.description}</p>
              </div>

              {onSelectSampleQuery && (
                <button
                  onClick={() => onSelectSampleQuery(`Show top 10 records from ${activeSchema.name}`)}
                  className="text-xs text-blue-600 font-semibold hover:underline"
                >
                  Query Sample &rarr;
                </button>
              )}
            </div>

            {/* Column Specs */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-500 uppercase">
                    <th className="px-3 py-2">Column</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Key Constraint</th>
                    <th className="px-3 py-2">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {activeSchema.columns.map(col => (
                    <tr key={col.name} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                        {col.name}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-500 text-[11px]">
                        {col.type}
                      </td>
                      <td className="px-3 py-2.5">
                        {col.isPrimary ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                            <Key className="h-3 w-3" /> PK
                          </span>
                        ) : col.isForeignKey ? (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                            <LinkIcon className="h-3 w-3" /> FK &rarr; {col.references?.table}.{col.references?.field}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs">
                        {col.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
