import React, { useState } from 'react';
import { HelpCircle, ArrowRight, Sparkles, Send } from 'lucide-react';

interface AmbiguityClarifierProps {
  question: string;
  suggestions?: string[];
  onSelectSuggestion: (suggestion: string) => void;
}

export const AmbiguityClarifier: React.FC<AmbiguityClarifierProps> = ({
  question,
  suggestions = [],
  onSelectSuggestion,
}) => {
  const [customValue, setCustomValue] = useState<string>('');

  const thresholdOptions = [
    { label: 'Below 75%', query: 'Show students with attendance below 75%' },
    { label: 'Below 70%', query: 'Show students with attendance below 70%' },
    { label: 'Below 65%', query: 'Show students with attendance below 65%' },
  ];

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customValue.trim()) return;
    const num = customValue.replace(/[^0-9.]/g, '');
    if (num) {
      onSelectSuggestion(`Show students with attendance below ${num}%`);
    } else {
      onSelectSuggestion(customValue.trim());
    }
  };

  return (
    <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-orange-50/30 p-6 shadow-xs space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
          <HelpCircle className="h-5 w-5" />
        </div>
        <div className="space-y-3 flex-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-200/60 px-2 py-0.5 rounded-full">
                Clarification Needed
              </span>
              <span className="text-xs text-amber-800 font-medium">To avoid assumptions, please specify:</span>
            </div>
            <h4 className="mt-1.5 text-base font-bold text-slate-900">
              {question || 'What attendance threshold should I use?'}
            </h4>
          </div>

          {/* Quick Threshold Options */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Select an option:
            </p>
            <div className="flex flex-wrap gap-2">
              {thresholdOptions.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => onSelectSuggestion(opt.query)}
                  className="flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:border-amber-500 hover:bg-amber-100/60 transition-all shadow-2xs cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                  <span>{opt.label}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                </button>
              ))}
            </div>
          </div>

          {/* Custom Value Input */}
          <div className="pt-2 border-t border-amber-200/60">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Or enter custom value:
            </p>
            <form onSubmit={handleCustomSubmit} className="flex max-w-sm gap-2">
              <input
                type="text"
                value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                placeholder="e.g. 60% or below 80%"
                className="flex-1 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-600"
              />
              <button
                type="submit"
                disabled={!customValue.trim()}
                className="flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40 transition-all cursor-pointer"
              >
                <span>Continue</span>
                <Send className="h-3 w-3" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
