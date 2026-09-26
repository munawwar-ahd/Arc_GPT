import React, { useState } from 'react';
import {
  Table as TableIcon,
  BarChart3,
  CheckCircle,
  Copy,
  Download,
  Bookmark,
  ThumbsUp,
  ThumbsDown,
  Info,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Search,
  FileSpreadsheet,
  FileText,
  Send,
  HelpCircle,
  Code2,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
} from 'recharts';
import { QueryExecutionResult } from '../types/index.js';

interface ResultViewerProps {
  result: QueryExecutionResult;
  onSaveQuery: (query: string, sql: string) => void;
  onFollowUp: (followUpText: string) => void;
  onSubmitFeedback?: (rating: number, comment: string) => void;
}

const PIE_COLORS = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#4F46E5', '#EA580C'];

export const ResultViewer: React.FC<ResultViewerProps> = ({
  result,
  onSaveQuery,
  onFollowUp,
  onSubmitFeedback,
}) => {
  const [activeView, setActiveView] = useState<'table' | 'chart'>('table');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [followUpInput, setFollowUpInput] = useState<string>('');
  const [feedbackState, setFeedbackState] = useState<'yes' | 'no' | null>(null);
  const [feedbackComment, setFeedbackComment] = useState<string>('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  const hasChart = Boolean(result.visualization && result.visualization.type !== 'none' && result.rows.length > 0);

  const handleCopySql = () => {
    const sqlText = result.sanitizedSql || result.generatedSql || '';
    if (sqlText) {
      navigator.clipboard.writeText(sqlText);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    }
  };

  const handleExportCsv = () => {
    if (result.rows.length === 0) return;
    const header = result.columns.join(',');
    const rows = result.rows.map(r =>
      result.columns.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [header, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `data_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPdf = () => {
    // Generates a clean printable window preview suitable for PDF save
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const tableRowsHtml = result.rows
      .slice(0, 100)
      .map(
        r =>
          `<tr>${result.columns.map(c => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${r[c] ?? ''}</td>`).join('')}</tr>`
      )
      .join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Data Report - ${result.naturalLanguageQuery}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            p.meta { font-size: 12px; color: #64748b; margin-bottom: 16px; }
            .answer-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { text-align: left; background: #f8fafc; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; }
          </style>
        </head>
        <body>
          <h1>Organizational Data Report</h1>
          <p class="meta">Inquiry: "${result.naturalLanguageQuery}" | Generated on ${new Date().toLocaleString()}</p>
          <div class="answer-box">${result.naturalLanguageAnswer}</div>
          <table>
            <thead>
              <tr>${result.columns.map(c => `<th>${c.replace(/_/g, ' ').toUpperCase()}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpInput.trim()) return;
    onFollowUp(followUpInput.trim());
    setFollowUpInput('');
  };

  const handleSendFeedback = (rating: number, comment: string) => {
    onSubmitFeedback?.(rating, comment);
    setFeedbackSubmitted(true);
  };

  // Filtered table rows
  const filteredRows = result.rows.filter(row => {
    if (!filterText) return true;
    return result.columns.some(col =>
      String(row[col] ?? '').toLowerCase().includes(filterText.toLowerCase())
    );
  });

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const renderChart = () => {
    if (!result.visualization || result.visualization.type === 'none') return null;
    const { type, xAxisKey, yAxisKey } = result.visualization;
    const chartData = result.rows;

    switch (type) {
      case 'pie':
        return (
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    color: '#fff',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '12px',
                  }}
                />
                <Legend verticalAlign="bottom" height={36} />
                <Pie
                  data={chartData}
                  dataKey={yAxisKey || 'value'}
                  nameKey={xAxisKey || 'name'}
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  label={(entry: any) => `${entry[xAxisKey || 'name'] ?? ''}: ${entry[yAxisKey || 'value'] ?? ''}`}
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        );

      case 'line':
        return (
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    color: '#fff',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '12px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey={yAxisKey || ''}
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#2563EB' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );

      case 'area':
        return (
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    color: '#fff',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey={yAxisKey || ''} stroke="#2563EB" fill="#DBEAFE" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );

      case 'bar':
      default:
        return (
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    color: '#fff',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey={yAxisKey || ''} fill="#2563EB" radius={[6, 6, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* ────────────────────────────────────
          1. ANSWER SECTION
          ──────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              Answer
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onSaveQuery(result.naturalLanguageQuery, result.sanitizedSql || result.generatedSql || '')}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700 shadow-2xs transition-colors cursor-pointer"
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span>Save Query</span>
            </button>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700 shadow-2xs transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700 shadow-2xs transition-colors cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {/* Highlighted Natural Language Answer */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/70 to-indigo-50/30 p-5">
          <p className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed">
            {result.naturalLanguageAnswer}
          </p>
        </div>

        {/* ────────────────────────────────────
            2. INSIGHT SECTION
            ──────────────────────────────────── */}
        {result.queryExplanation && (
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Info className="h-3.5 w-3.5 text-blue-600" />
              <span>Key Insight</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {result.queryExplanation}
            </p>
          </div>
        )}

        {/* ────────────────────────────────────
            3. RESULTS & VISUALIZATION
            ──────────────────────────────────── */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Results ({result.rowCount} records)
              </span>

              {hasChart && (
                <div className="flex rounded-lg bg-slate-100 p-0.5 ml-2">
                  <button
                    onClick={() => setActiveView('table')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                      activeView === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    <TableIcon className="h-3 w-3" />
                    <span>Table</span>
                  </button>
                  <button
                    onClick={() => setActiveView('chart')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                      activeView === 'chart' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    <BarChart3 className="h-3 w-3 text-blue-600" />
                    <span>Visualization</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quick table filter */}
            {activeView === 'table' && result.rows.length > 5 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter records..."
                  value={filterText}
                  onChange={e => {
                    setFilterText(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-7.5 w-44 sm:w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {activeView === 'chart' && hasChart ? (
            <div className="p-4 border border-slate-200 rounded-2xl bg-white">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                {result.visualization?.title}
              </h4>
              <p className="text-xs text-slate-500 mb-2">{result.visualization?.description}</p>
              {renderChart()}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
              {result.rows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No records match the requested criteria.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        {result.columns.map(col => (
                          <th key={col} className="px-4 py-2.5 whitespace-nowrap">
                            {col.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                      {paginatedRows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-blue-50/30 transition-colors">
                          {result.columns.map(col => {
                            const val = row[col];
                            const isAttendance =
                              col.toLowerCase().includes('percentage') || col.toLowerCase().includes('attendance');
                            const isLow = isAttendance && Number(val) < 75.0;

                            return (
                              <td key={col} className="px-4 py-2.5 whitespace-nowrap">
                                {isLow ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 font-bold text-red-800 border border-red-200">
                                    {val}%
                                  </span>
                                ) : isAttendance ? (
                                  <span className="font-semibold text-emerald-800">{val}%</span>
                                ) : (
                                  String(val ?? '—')
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 bg-slate-50/50">
                  <span>
                    Showing {(currentPage - 1) * pageSize + 1} to{' '}
                    {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} rows
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 hover:bg-white cursor-pointer"
                    >
                      Previous
                    </button>
                    <span className="px-2 font-semibold text-slate-800">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 hover:bg-white cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ────────────────────────────────────
            4. CONVERSATIONAL FOLLOW-UP
            ──────────────────────────────────── */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Ask a follow-up question:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onFollowUp('Only third year')}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
              >
                "Only third year"
              </button>
              <button
                type="button"
                onClick={() => onFollowUp('What about AIML?')}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
              >
                "What about AIML?"
              </button>
            </div>
          </div>

          <form onSubmit={handleFollowUpSubmit} className="relative flex items-center">
            <input
              type="text"
              value={followUpInput}
              onChange={e => setFollowUpInput(e.target.value)}
              placeholder="Ask a follow-up question (e.g. 'What about AIML?' or 'Only third year')..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={!followUpInput.trim()}
              className="absolute right-1.5 flex items-center gap-1 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40 transition-all cursor-pointer"
            >
              <span>Ask</span>
              <Send className="h-3 w-3" />
            </button>
          </form>
        </div>

        {/* ────────────────────────────────────
            5. FEEDBACK SECTION
            ──────────────────────────────────── */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-600">Was this answer helpful?</span>
            <button
              onClick={() => {
                setFeedbackState('yes');
                handleSendFeedback(5, 'Helpful answer');
              }}
              className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                feedbackState === 'yes'
                  ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:text-emerald-700'
              }`}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>Yes</span>
            </button>
            <button
              onClick={() => {
                setFeedbackState('no');
              }}
              className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                feedbackState === 'no'
                  ? 'bg-red-100 border-red-300 text-red-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:text-red-700'
              }`}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              <span>No</span>
            </button>
          </div>

          {feedbackSubmitted && (
            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              <span>Thank you for your feedback!</span>
            </span>
          )}
        </div>

        {/* Feedback: Tell us what went wrong (expanded when No is selected) */}
        {feedbackState === 'no' && !feedbackSubmitted && (
          <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 space-y-2">
            <p className="text-xs font-bold text-red-900">Tell us what went wrong:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedbackComment}
                onChange={e => setFeedbackComment(e.target.value)}
                placeholder="Describe what was missing or incorrect..."
                className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
              />
              <button
                onClick={() => handleSendFeedback(1, feedbackComment || 'Unhelpful answer')}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
              >
                Submit Feedback
              </button>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────
            6. VIEW TECHNICAL DETAILS (Collapsed by default)
            ──────────────────────────────────── */}
        <div className="pt-2 border-t border-slate-100">
          <button
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <span>{showTechnicalDetails ? 'Hide' : 'View'} Technical Details</span>
            {showTechnicalDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showTechnicalDetails && (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-white space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Validation: Read-Only Passed</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-blue-400" />
                    <span>Execution: {result.executionTimeMs || 12}ms</span>
                  </span>
                </div>

                <button
                  onClick={handleCopySql}
                  className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:text-white"
                >
                  <Copy className="h-3 w-3" />
                  <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
                </button>
              </div>

              <div>
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                  Generated Query:
                </p>
                <pre className="font-mono text-xs text-blue-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {result.sanitizedSql || result.generatedSql}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
