import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  X,
  Play,
  CheckCircle2,
  AlertOctagon,
  ArrowRight,
  Terminal,
  Loader2,
} from 'lucide-react';
import { User } from '../types/index.js';
import { apiFetch } from '../lib/apiClient.js';

interface SecurityDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onRunTestQuery: (query: string) => void;
}

const SECURITY_TEST_CASES = [
  {
    title: 'Direct DDL Destruction',
    input: 'DROP TABLE students',
    expected: 'Blocked',
    description: 'Attempts to drop the core student table. The validation layer halts execution immediately.',
    isMalicious: true,
  },
  {
    title: 'Mass Data Deletion',
    input: 'DELETE all students',
    expected: 'Blocked',
    description: 'Attempts an unauthorized DML deletion statement.',
    isMalicious: true,
  },
  {
    title: 'Unauthorized Record Mutation',
    input: 'UPDATE students SET cgpa = 10.0',
    expected: 'Blocked',
    description: 'Attempts to mutate grades; non-SELECT statements are forbidden.',
    isMalicious: true,
  },
  {
    title: 'Stacked Multiple Statements Injection',
    input: 'SELECT * FROM students; DROP TABLE marks;',
    expected: 'Blocked',
    description: 'Attempts statement chaining via semicolon delimiter injection.',
    isMalicious: true,
  },
  {
    title: 'SQL Comment Injection Attack',
    input: "SELECT * FROM students WHERE 1=1 -- ' or '1'='1",
    expected: 'Blocked',
    description: 'Attempts to inject comment sequences to bypass authentication or filter clauses.',
    isMalicious: true,
  },
  {
    title: 'Authorized Natural Language Query',
    input: 'Show students with attendance below 75%',
    expected: 'Allowed & Executed',
    description: 'Legitimate organizational read query. Passes AST verification and returns attendance data.',
    isMalicious: false,
  },
];

export const SecurityDemoModal: React.FC<SecurityDemoModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onRunTestQuery,
}) => {
  const [runningTest, setRunningTest] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);

  if (!isOpen) return null;

  const handleExecuteTest = async (testCase: (typeof SECURITY_TEST_CASES)[0]) => {
    setRunningTest(testCase.input);
    setTestResult(null);

    try {
      const res = await apiFetch('/api/query/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ query: testCase.input }),
      });
      const data = await res.json();
      setTestResult({
        testCase,
        data,
      });
    } catch (err: any) {
      setTestResult({
        testCase,
        error: err.message,
      });
    } finally {
      setRunningTest(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                SQL Security &amp; Injection Defense Sandbox
              </h3>
              <p className="text-xs text-slate-500">
                Test the Arc AI read-only AST parser and injection firewall against malicious payloads.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live Test Execution Result Preview */}
        {testResult && (
          <div
            className={`rounded-xl border p-4 space-y-2 transition-all ${
              testResult.data?.status === 'blocked'
                ? 'border-red-200 bg-red-50/70'
                : 'border-emerald-200 bg-emerald-50/70'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                {testResult.data?.status === 'blocked' ? (
                  <>
                    <AlertOctagon className="h-4 w-4 text-red-600" />
                    <span className="text-red-900">Intercepted: Query Blocked</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-900">Passed: Legitimate Query Executed</span>
                  </>
                )}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Status: {testResult.data?.status}
              </span>
            </div>

            <p className="text-xs text-slate-800 font-medium">
              {testResult.data?.naturalLanguageAnswer}
            </p>

            {testResult.data?.blockedReason && (
              <p className="text-xs font-mono text-red-700 bg-white/70 p-2 rounded border border-red-200">
                Firewall Rule: {testResult.data?.blockedReason}
              </p>
            )}

            <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Security rule test succeeded</span>
              <button
                onClick={() => {
                  onRunTestQuery(testResult.testCase.input);
                  onClose();
                }}
                className="text-blue-600 font-semibold hover:underline"
              >
                Inspect in Main Workspace &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Test Cases List */}
        <div className="space-y-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Interactive Security Scenarios
          </span>

          <div className="space-y-2">
            {SECURITY_TEST_CASES.map((tc, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-all bg-slate-50/30"
              >
                <div className="space-y-0.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900">{tc.title}</span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                        tc.isMalicious
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      Expected: {tc.expected}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-blue-700">"{tc.input}"</div>
                  <p className="text-[11px] text-slate-500">{tc.description}</p>
                </div>

                <button
                  disabled={runningTest !== null}
                  onClick={() => handleExecuteTest(tc)}
                  className={`flex items-center gap-1.5 shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-xs transition-all ${
                    tc.isMalicious
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {runningTest === tc.input ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  )}
                  <span>Test Fire</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
