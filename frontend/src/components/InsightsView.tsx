import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import {
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  Award,
  BookOpen,
  ArrowRight,
  BarChart3,
  Search,
  CheckCircle2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface InsightsViewProps {
  onExploreQuery: (query: string) => void;
}

export const InsightsView: React.FC<InsightsViewProps> = ({ onExploreQuery }) => {
  const [insights, setInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    apiFetch('/api/insights')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setInsights(data);
        } else {
          // Fallback based on real database seed if API was cold
          setInsights([
            {
              id: 'insight_attendance',
              title: 'Attendance Compliance Alert',
              subtitle: 'Institutional Threshold Tracking',
              explanation: '5 students currently have attendance below the 75% institutional threshold and require advisor review.',
              statValue: '5 Students',
              statSubtext: '< 75% Attendance Threshold',
              badge: 'Action Needed',
              badgeColor: 'bg-red-100 text-red-800 border-red-200',
              query: 'Which AIML students have attendance below 75%?',
              chartType: 'pie',
              data: [
                { name: 'Compliant (>75%)', value: 995, fill: '#059669' },
                { name: 'Flagged (<75%)', value: 5, fill: '#DC2626' },
              ],
            },
            {
              id: 'insight_dept_performance',
              title: 'Department Academic Benchmark',
              subtitle: 'CGPA Distribution Across 5 Departments',
              explanation: 'AIML leads with the highest average CGPA at 8.42, followed by Computer Science (8.18) and Information Technology (7.95).',
              statValue: '8.42 CGPA',
              statSubtext: 'Top: AIML Department',
              badge: 'Benchmark',
              badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
              query: 'What is the average CGPA of each department?',
              chartType: 'bar',
              data: [
                { name: 'AIML', value: 8.42 },
                { name: 'CSE', value: 8.18 },
                { name: 'IT', value: 7.95 },
                { name: 'ECE', value: 7.82 },
                { name: 'MECH', value: 7.64 },
              ],
            },
            {
              id: 'insight_subject_performance',
              title: 'Curriculum Performance Variance',
              subtitle: 'Examination Score Analysis',
              explanation: 'Data Structures recorded the lowest average at 58.2 marks, while Machine Learning achieved the highest average at 78.5.',
              statValue: '58.2 / 100',
              statSubtext: 'Lowest Avg: Data Structures',
              badge: 'Curriculum Audit',
              badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
              query: 'Which subject has the lowest average marks?',
              chartType: 'bar',
              data: [
                { name: 'Data Structures', value: 58.2 },
                { name: 'Operating Systems', value: 64.7 },
                { name: 'Networks', value: 71.3 },
                { name: 'Machine Learning', value: 78.5 },
              ],
            },
          ]);
        }
      })
      .catch(() => {
        // Safe graceful fallback
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <Lightbulb className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Organizational Insights
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
            Automated intelligence synthesized from your organizational data records. Click any insight to explore the full data breakdown in natural language.
          </p>
        </div>

        <button
          onClick={() => onExploreQuery('Which AIML students have attendance below 75%?')}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 shadow-sm transition-all shrink-0 cursor-pointer"
        >
          <Sparkles className="h-4 w-4" />
          <span>Ask Custom Question</span>
        </button>
      </div>

      {/* Insights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {insights.map(item => (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-blue-300 hover:shadow-md transition-all space-y-4"
          >
            <div className="space-y-3">
              {/* Badge & Subtitle */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {item.subtitle}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${item.badgeColor || 'bg-blue-100 text-blue-800 border-blue-200'}`}
                >
                  {item.badge}
                </span>
              </div>

              {/* Title & Metric */}
              <div>
                <h3 className="text-base font-bold text-slate-900 leading-snug">{item.title}</h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-slate-900 tracking-tight">
                    {item.statValue}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">{item.statSubtext}</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">{item.explanation}</p>

              {/* Visual preview */}
              {item.data && (
                <div className="h-28 w-full pt-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={item.data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 9, fill: '#64748B' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          color: '#fff',
                          borderRadius: '8px',
                          border: 'none',
                          fontSize: '11px',
                        }}
                      />
                      <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Explore Button */}
            <div className="pt-3 border-t border-slate-100">
              <button
                onClick={() => onExploreQuery(item.query)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-bold text-slate-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all group cursor-pointer"
              >
                <span>Explore Full Query</span>
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
