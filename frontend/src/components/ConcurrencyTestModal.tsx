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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
              🧪 ACID Concurrency & Row-Level Lock Benchmark
            </h3>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>
              Sprint 3 Milestone Verification: 20 Simultaneous Checkout Threads vs 1 Stock Unit
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#94A3B8', fontSize: '20px' }}>✕</button>
        </div>

        <div style={{ background: 'rgba(3, 105, 161, 0.15)', border: '1px solid #0369A1', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
          <div style={{ fontWeight: 700, color: '#38BDF8', marginBottom: '4px' }}>How this test verifies transaction safety:</div>
          <p style={{ color: '#E2E8F0', lineHeight: 1.4 }}>
            20 POS terminals fire checkout requests for the same last remaining unit simultaneously using <code style={{ color: '#FCD34D' }}>Promise.all()</code>.
            Using PostgreSQL's <code style={{ color: '#4ADE80' }}>SELECT ... FOR UPDATE</code> row lock, exactly 1 checkout MUST succeed and 19 MUST abort with conflict. Stock MUST remain exactly 0.
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(220, 38, 38, 0.2)', border: '1px solid #DC2626', color: '#FCA5A5', padding: '10px', borderRadius: '6px', marginBottom: '12px' }}>
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={runTest}
          disabled={running}
          style={{
            width: '100%',
            background: running ? '#64748B' : 'var(--color-primary)',
            color: '#FFF',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 800,
            fontSize: '14px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          {running ? '⏳ Launching 20 Concurrent Threads & Acquiring Locks...' : '⚡ FIRE 20 CONCURRENT CHECKOUT THREADS'}
        </button>

        {result && (
          <div>
            {/* Scorecard */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ background: 'var(--color-bg)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>INITIAL STOCK</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>{result.stockInitial}</div>
              </div>
              <div style={{ background: 'var(--color-bg)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(34, 197, 94, 0.4)' }}>
                <div style={{ fontSize: '11px', color: '#4ADE80' }}>SUCCESS (1)</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#4ADE80' }}>{result.successfulCheckouts}</div>
              </div>
              <div style={{ background: 'var(--color-bg)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                <div style={{ fontSize: '11px', color: '#FBBF24' }}>CONFLICT (19)</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#FBBF24' }}>{result.abortedWithConflict}</div>
              </div>
              <div style={{ background: 'var(--color-bg)', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>FINAL STOCK</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#38BDF8' }}>{result.stockFinal}</div>
              </div>
            </div>

            {/* Verdict */}
            <div style={{
              background: result.concurrencySafe ? 'rgba(34, 197, 94, 0.2)' : 'rgba(220, 38, 38, 0.2)',
              border: `1px solid ${result.concurrencySafe ? '#22C55E' : '#DC2626'}`,
              color: result.concurrencySafe ? '#86EFAC' : '#FCA5A5',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              textAlign: 'center',
              fontWeight: 700
            }}>
              {result.concurrencySafe ? '🏆 ' : '❌ '}
              {result.evaluationRubricGrade}
            </div>

            {/* Thread Log Preview */}
            <div style={{ maxHeight: '160px', overflowY: 'auto', background: 'var(--color-bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              {result.threadResults?.map((t: any) => (
                <div key={t.threadId} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1E293B', color: t.success ? '#4ADE80' : '#94A3B8' }}>
                  <span>[Thread #{t.threadId.toString().padStart(2, '0')}] {t.message}</span>
                  <span style={{ color: '#64748B' }}>{t.durationMs}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
