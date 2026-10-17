import React, { useState } from 'react';

interface ConcurrencyTestModalProps {
  tenantId: string;
  onClose: () => void;
}

export const ConcurrencyTestModal: React.FC<ConcurrencyTestModalProps> = ({ tenantId, onClose }) => {
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/test/concurrency-race', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId }
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px', padding: '24px' }}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🧪</span>
              <span>ACID Concurrency & Row-Level Lock Benchmark</span>
            </h3>
            <div className="text-xs text-slate-500 mt-1">
              Sprint 3 Milestone Verification: 20 Simultaneous Checkout Threads vs 1 Stock Unit
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
          >
            ✕
          </button>
        </div>

        <div className="bg-sky-50 border border-sky-200 p-3.5 rounded-xl mb-4 text-xs text-sky-900 leading-relaxed shadow-xs">
          <div className="font-bold text-sky-950 mb-1 flex items-center gap-1.5">
            <span>ℹ️</span>
            <span>How this test verifies transaction safety:</span>
          </div>
          <p>
            20 POS terminals fire checkout requests for the same last remaining unit simultaneously using <code className="font-mono bg-sky-100 px-1.5 py-0.5 rounded text-sky-800">Promise.all()</code>.
            Using PostgreSQL's <code className="font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-800">SELECT ... FOR UPDATE</code> row lock, exactly 1 checkout MUST succeed and 19 MUST abort with conflict. Stock MUST remain exactly 0.
          </p>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg mb-3.5 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={runTest}
          disabled={running}
          className={`w-full py-3.5 px-4 rounded-xl font-bold text-xs tracking-wider flex items-center justify-center gap-2 mb-4 transition shadow-xs ${
            running
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white cursor-pointer'
          }`}
        >
          {running ? '⏳ Launching 20 Concurrent Threads & Acquiring Locks...' : '⚡ FIRE 20 CONCURRENT CHECKOUT THREADS'}
        </button>

        {result && (
          <div className="space-y-4">
            {/* Scorecard */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-center shadow-xs">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Initial Stock</div>
                <div className="text-xl font-extrabold font-mono text-slate-800 mt-1">{result.stockInitial}</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-center shadow-xs">
                <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Success (1)</div>
                <div className="text-xl font-extrabold font-mono text-emerald-700 mt-1">{result.successfulCheckouts}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-center shadow-xs">
                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Conflict (19)</div>
                <div className="text-xl font-extrabold font-mono text-amber-700 mt-1">{result.abortedWithConflict}</div>
              </div>
              <div className="bg-sky-50 border border-sky-200 p-3 rounded-xl text-center shadow-xs">
                <div className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">Final Stock</div>
                <div className="text-xl font-extrabold font-mono text-sky-700 mt-1">{result.stockFinal}</div>
              </div>
            </div>

            {/* Verdict */}
            <div className={`p-3.5 rounded-xl border text-center font-bold text-xs shadow-xs ${
              result.concurrencySafe
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border-rose-300 text-rose-800'
            }`}>
              {result.concurrencySafe ? '🏆 ' : '❌ '}
              {result.evaluationRubricGrade}
            </div>

            {/* Thread Log Preview */}
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono divide-y divide-slate-100 shadow-xs">
              {result.threadResults?.map((t: any) => (
                <div key={t.threadId} className="flex justify-between py-1 text-[11px]">
                  <span className={t.success ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                    [Thread #{t.threadId.toString().padStart(2, '0')}] {t.message}
                  </span>
                  <span className="text-slate-400">{t.durationMs}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
