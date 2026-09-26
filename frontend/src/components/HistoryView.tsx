import React, { useState, useEffect } from 'react';
import {
  History,
  CheckCircle,
  AlertOctagon,
  Clock,
  Play,
  Search,
  Filter,
  Code,
  UserCheck,
  ChevronRight,
  Eye,
  X,
  Trash2,
} from 'lucide-react';
import { QueryHistoryItem } from '../types/index.js';
import { apiFetch } from '../lib/apiClient.js';

interface HistoryViewProps {
  onRerunQuery: (query: string) => void;
  onViewResult?: (item: QueryHistoryItem) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onRerunQuery, onViewResult }) => {
  const [historyItems, setHistoryItems] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inspectItem, setInspectItem] = useState<QueryHistoryItem | null>(null);

  const fetchHistory = () => {
    setLoading(true);
    apiFetch('/api/history?limit=100')
      .then(res => res.json())
      .then(data => {
        setHistoryItems(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load history:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistoryItems(prev => prev.filter(i => i.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete query:', e);
    }
  };

  const filtered = historyItems.filter(item => {
    const matchesSearch =
      item.natural_language_query.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.generated_sql && item.generated_sql.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || item.execution_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-blue-600" />
            <span>Query History</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Review your previously asked questions, execution times, and results.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search history..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-8.5 rounded-xl border border-slate-200 pl-8 pr-3 text-xs focus:border-blue-500 focus:outline-none bg-white shadow-2xs"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none shadow-2xs"
          >
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="blocked">Blocked</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading query history...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No query history entries found. Run queries from "Ask Data" to populate your log.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Question</th>
                  <th className="px-4 py-3">Date / Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Execution Time</th>
                  <th className="px-4 py-3">Results</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                {filtered.map(item => {
                  const isBlocked = item.execution_status === 'blocked';
                  const isFailed = item.execution_status === 'failed';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3.5 font-bold text-slate-900 max-w-md">
                        <div className="line-clamp-1">"{item.natural_language_query}"</div>
                        {item.blocked_reason && (
                          <div className="text-[11px] text-red-600 font-normal line-clamp-1 mt-0.5">
                            Reason: {item.blocked_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 text-[11px]">
                        {new Date(item.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        •{' '}
                        {new Date(item.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isBlocked ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-bold text-red-800 border border-red-200">
                            Blocked
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                            Success
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap font-mono text-slate-600 text-[11px]">
                        {item.execution_time}ms
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-600 font-medium">
                        {item.row_count !== undefined ? `${item.row_count} rows` : '—'}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setInspectItem(item)}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700 shadow-2xs transition-colors cursor-pointer"
                            title="View Result Details"
                          >
                            <Eye className="h-3 w-3" />
                            <span>View Result</span>
                          </button>

                          <button
                            onClick={() => onRerunQuery(item.natural_language_query)}
                            className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 shadow-2xs transition-colors cursor-pointer"
                            title="Run Again"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            <span>Run Again</span>
                          </button>

                          <button
                            onClick={() => handleDelete(item.id)}
                            className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 shadow-2xs transition-colors cursor-pointer"
                            title="Delete Query"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Inspection Modal */}
      {inspectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Query Details</h3>
              <button
                onClick={() => setInspectItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
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
                  "{inspectItem.natural_language_query}"
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                  Generated Query Statement
                </span>
                <pre className="mt-1 rounded-2xl bg-slate-950 p-3.5 font-mono text-[11px] text-blue-300 overflow-x-auto whitespace-pre-wrap">
                  {inspectItem.generated_sql || 'N/A (Query was restricted prior to database translation)'}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                  <span className="text-slate-400 font-bold block">Execution Time</span>
                  <span className="font-mono font-bold text-slate-800">{inspectItem.execution_time}ms</span>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                  <span className="text-slate-400 font-bold block">Rows Returned</span>
                  <span className="font-mono font-bold text-slate-800">{inspectItem.row_count ?? 0}</span>
                </div>
              </div>

              {inspectItem.blocked_reason && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                  <span className="font-bold text-red-900 uppercase tracking-wider text-[10px]">
                    Security / Reason
                  </span>
                  <p className="mt-0.5 text-red-700">{inspectItem.blocked_reason}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => {
                  onRerunQuery(inspectItem.natural_language_query);
                  setInspectItem(null);
                }}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-sm transition-all cursor-pointer"
              >
                Run Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
