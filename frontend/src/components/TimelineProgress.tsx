import React from 'react';
import {
  CheckCircle2,
  Loader2,
  AlertOctagon,
  Sparkles,
  ShieldCheck,
  Search,
  Database,
  Code2,
  BarChart3,
  Clock,
} from 'lucide-react';
import { PipelineStep } from '../types/index.js';

interface TimelineProgressProps {
  steps: PipelineStep[];
  currentStepIndex: number;
  isLoading: boolean;
  executionTimeMs?: number;
}

export const TimelineProgress: React.FC<TimelineProgressProps> = ({
  steps,
  currentStepIndex,
  isLoading,
  executionTimeMs,
}) => {
  const isBlocked = steps.some(s => s.status === 'blocked');
  const isFailed = steps.some(s => s.status === 'failed');

  // The 6 clean human-friendly steps specified in Requirement #8:
  // 1. Understanding question
  // 2. Finding relevant data
  // 3. Generating query
  // 4. Validating query
  // 5. Retrieving results
  // 6. Preparing insights
  const userSteps = [
    {
      name: 'Understanding question',
      desc: 'Parsing natural language criteria and intent',
      isCompleted: !isLoading || currentStepIndex >= 1,
      isInProgress: isLoading && currentStepIndex === 0,
      icon: Search,
    },
    {
      name: 'Finding relevant data',
      desc: 'Identifying organizational data categories',
      isCompleted: !isLoading ? !isBlocked && !isFailed : currentStepIndex >= 2,
      isInProgress: isLoading && (currentStepIndex === 1 || currentStepIndex === 2),
      icon: Database,
    },
    {
      name: 'Generating query',
      desc: 'Formulating structured data lookup',
      isCompleted: !isLoading ? !isBlocked && !isFailed : currentStepIndex >= 4,
      isInProgress: isLoading && currentStepIndex === 3,
      icon: Code2,
    },
    {
      name: 'Validating query',
      desc: 'Verifying data security and access authorization',
      isCompleted: !isLoading ? !isBlocked && !isFailed : currentStepIndex >= 5,
      isInProgress: isLoading && currentStepIndex === 4,
      isBlocked: isBlocked,
      icon: ShieldCheck,
    },
    {
      name: 'Retrieving results',
      desc: 'Extracting verified database records',
      isCompleted: !isLoading && !isBlocked && !isFailed,
      isInProgress: isLoading && currentStepIndex === 5,
      isFailed: isFailed,
      icon: CheckCircle2,
    },
    {
      name: 'Preparing insights',
      desc: 'Synthesizing plain-English answer and charts',
      isCompleted: !isLoading && !isBlocked && !isFailed,
      isInProgress: isLoading && currentStepIndex >= 6,
      icon: BarChart3,
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isBlocked ? (
              <AlertOctagon className="h-4 w-4 text-white" />
            ) : (
              <Sparkles className="h-4 w-4 text-white" />
            )}
          </div>
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
            {isLoading ? 'Processing Question...' : 'Query Processed'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium">
          {isLoading ? (
            <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Analyzing organizational records...</span>
            </span>
          ) : isBlocked ? (
            <span className="text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200">
              Query Restricted
            </span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Completed {executionTimeMs ? `(${executionTimeMs}ms)` : ''}</span>
            </span>
          )}
        </div>
      </div>

      {/* 6 Step Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
        {userSteps.map((step, idx) => {
          let bg = 'bg-slate-50 border-slate-200 text-slate-500';
          let badge = 'bg-slate-200 text-slate-600';

          if (step.isBlocked) {
            bg = 'bg-red-50 border-red-200 text-red-900';
            badge = 'bg-red-600 text-white';
          } else if (step.isInProgress) {
            bg = 'bg-blue-50 border-blue-300 text-blue-900 ring-2 ring-blue-500/20';
            badge = 'bg-blue-600 text-white animate-pulse';
          } else if (step.isCompleted) {
            bg = 'bg-emerald-50/50 border-emerald-200 text-emerald-950';
            badge = 'bg-emerald-600 text-white';
          }

          return (
            <div key={idx} className={`rounded-xl border p-2.5 flex flex-col justify-between space-y-1.5 transition-all ${bg}`}>
              <div className="flex items-center justify-between">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${badge}`}>
                  {step.isBlocked ? '✕' : step.isInProgress ? <Loader2 className="h-3 w-3 animate-spin" /> : step.isCompleted ? '✓' : idx + 1}
                </span>
                <span className="text-[9px] font-mono opacity-50">Step 0{idx + 1}</span>
              </div>
              <p className="text-[11px] font-bold leading-tight">
                {step.name}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
