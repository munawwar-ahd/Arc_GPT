import React, { useState, useEffect } from 'react';
import {
  BookmarkCheck,
  Play,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  Code,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { SavedQuery } from '../types/index.js';
import { apiFetch } from '../lib/apiClient.js';

interface SavedQueriesViewProps {
  onRunQuery: (query: string) => void;
}

const DEFAULT_PRESET_QUERIES: Partial<SavedQuery>[] = [
  {
    id: 101,
    title: 'Low Attendance Students',
    natural_language_query: 'Which AIML students have attendance below 75%?',
    generated_sql: 'SELECT s.roll_number, s.name, a.percentage FROM students s JOIN attendance a ON s.id = a.student_id WHERE a.percentage < 75.0;',
    created_at: new Date().toISOString(),
  },
  {
    id: 102,
    title: 'Department Performance',
    natural_language_query: 'What is the average CGPA by department?',
    generated_sql: 'SELECT d.name, AVG(s.cgpa) FROM departments d JOIN students s ON d.id = s.department_id GROUP BY d.name;',
    created_at: new Date().toISOString(),
  },
  {
    id: 103,
    title: 'Average CGPA',
    natural_language_query: 'What is the average CGPA of each department?',
    generated_sql: 'SELECT d.code, AVG(s.cgpa) FROM departments d JOIN students s ON d.id = s.department_id GROUP BY d.code;',
    created_at: new Date().toISOString(),
  },
  {
    id: 104,
    title: 'Subject Performance',
    natural_language_query: 'Which subject has the lowest average marks?',
    generated_sql: 'SELECT sub.name, AVG(m.marks) as avg_marks FROM marks m JOIN subjects sub ON m.subject_id = sub.id GROUP BY sub.name ORDER BY avg_marks ASC;',
    created_at: new Date().toISOString(),
  },
];

export const SavedQueriesView: React.FC<SavedQueriesViewProps> = ({ onRunQuery }) => {
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState<string>('');

  const fetchSaved = () => {
    setLoading(true);
    apiFetch('/api/saved-queries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setSavedQueries(data);
        } else {
          setSavedQueries(DEFAULT_PRESET_QUERIES as SavedQuery[]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load saved queries:', err);
        setSavedQueries(DEFAULT_PRESET_QUERIES as SavedQuery[]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSaved();
  }, []);

  const handleRename = async (id: number) => {
    if (!newTitle.trim()) return;
    try {
      await fetch(`/api/saved-queries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      setSavedQueries(prev =>
        prev.map(q => (q.id === id ? { ...q, title: newTitle.trim() } : q))
      );
      setEditingId(null);
    } catch (err) {
      console.error('Failed to rename query:', err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/saved-queries/${id}`, { method: 'DELETE' });
      setSavedQueries(prev => prev.filter(q => q.id !== id));
    } catch (err) {
      console.error('Failed to delete query:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BookmarkCheck className="h-5 w-5 text-blue-600" />
            <span>Saved Queries</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Store and organize frequently asked queries for instant one-click re-runs and reporting.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-2 p-8 text-center text-xs text-slate-500">
            Loading saved queries...
          </div>
        ) : savedQueries.length === 0 ? (
          <div className="col-span-2 p-8 text-center text-xs text-slate-500 bg-white rounded-3xl border border-slate-200">
            No saved queries yet. Execute a query and click "Save Query" to keep it here.
          </div>
        ) : (
          savedQueries.map(item => (
            <div
              key={item.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-3 flex flex-col justify-between hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div className="space-y-2">
                {/* Title & Edit */}
                <div className="flex items-center justify-between">
                  {editingId === item.id ? (
                    <div className="flex items-center gap-1.5 flex-1 mr-2">
                      <input
                        type="text"
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        className="w-full rounded-xl border border-blue-500 bg-white px-3 py-1 text-xs font-bold text-slate-900 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => handleRename(item.id)}
                        className="rounded-lg bg-emerald-600 p-1 text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg bg-slate-200 p-1 text-slate-600 hover:bg-slate-300 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                        <BookmarkCheck className="h-3.5 w-3.5" />
                      </span>
                      <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    {editingId !== item.id && (
                      <button
                        onClick={() => {
                          setEditingId(item.id);
                          setNewTitle(item.title);
                        }}
                        className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                        title="Rename"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="rounded-lg p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Natural Question */}
                <p className="text-xs font-semibold text-slate-700 leading-snug">
                  "{item.natural_language_query}"
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {new Date(item.created_at).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>

                <button
                  onClick={() => onRunQuery(item.natural_language_query)}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-sm transition-all cursor-pointer"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Run Again</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
