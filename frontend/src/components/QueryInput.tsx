import React, { useState, useEffect } from 'react';
import {
  Search,
  Sparkles,
  ArrowRight,
  Loader2,
  X,
  MessageSquareText,
} from 'lucide-react';

interface QueryInputProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  activeQuery: string;
}

export const USER_SUGGESTED_QUESTIONS = [
  'How many students are there in each department?',
  'Which AIML students have attendance below 75%?',
  'What is the average CGPA by department?',
  'Which subject has the lowest average marks?',
  'Show students with attendance below 75%.',
  'Compare average marks across departments.',
];

export const QueryInput: React.FC<QueryInputProps> = ({
  onSearch,
  isLoading,
  activeQuery,
}) => {
  const [inputText, setInputText] = useState<string>(activeQuery || '');

  useEffect(() => {
    if (activeQuery) {
      setInputText(activeQuery);
    }
  }, [activeQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSearch(inputText.trim());
  };

  const handleSelectSuggested = (q: string) => {
    setInputText(q);
    onSearch(q);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs space-y-6">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
            Ask Data
          </span>
        </div>

        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Ask a question about your data...
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Get instant answers from your organizational records using plain English. No SQL required.
        </p>
      </div>

      {/* Query Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative flex items-center rounded-2xl border-2 border-blue-500/40 bg-slate-50/50 p-2 focus-within:border-blue-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-600/10 transition-all shadow-xs">
          <div className="pl-3 text-blue-600 shrink-0">
            <Search className="h-5 w-5" />
          </div>

          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            disabled={isLoading}
            placeholder="Which third-year AIML students have attendance below 75%?"
            className="w-full bg-transparent px-3 py-3 text-sm sm:text-base text-slate-900 placeholder-slate-400 focus:outline-none disabled:opacity-50 font-medium"
          />

          {inputText && !isLoading && (
            <button
              type="button"
              onClick={() => setInputText('')}
              className="mr-2 rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-600/20 transition-all cursor-pointer shrink-0"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <span>Ask Data</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Try asking Section */}
      <div className="pt-2 border-t border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Try asking:
          </span>
          <span className="text-xs text-slate-400">Click to autofill &amp; execute</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {USER_SUGGESTED_QUESTIONS.map((q, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectSuggested(q)}
              className="flex items-center justify-between rounded-xl border border-slate-200/90 bg-white p-3 text-left text-xs font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-900 transition-all shadow-2xs group cursor-pointer"
            >
              <span className="line-clamp-1 pr-2">"{q}"</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
