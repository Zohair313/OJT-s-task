import React, { useState } from 'react';

interface ZReportModalProps {
  drawer: {
    id: string;
    terminalIdentifier: string;
    openedAt: string;
    openingFloat: number;
    totalCashDrops: number;
    status: string;
  };
  tenantId: string;
  onClose: () => void;
  onZReportGenerated: (zReport: any) => void;
}

export const ZReportModal: React.FC<ZReportModalProps> = ({
  drawer,
  tenantId,
  onClose,
  onZReportGenerated
}) => {
  const [actualCash, setActualCash] = useState<string>('');
  const [cashDropAmount, setCashDropAmount] = useState<string>('');
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [discrepancyReason, setDiscrepancyReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [dropSuccess, setDropSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Perform Mid-Shift Cash Drop
  const handleCashDrop = async () => {
    if (!cashDropAmount || Number(cashDropAmount) <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/drawers/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ drawerId: drawer.id, amount: Number(cashDropAmount) })
      });
      if (!res.ok) throw new Error('Failed to record cash drop');
      setDropSuccess(`Successfully dropped $${Number(cashDropAmount).toFixed(2)} to vault.`);
      setCashDropAmount('');
      drawer.totalCashDrops += Number(cashDropAmount);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Close Register & Generate Z-Report
  const handleCloseShift = async () => {
    if (!actualCash) {
      setError('Please enter the physically counted cash.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/drawers/close-z-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({
          drawerId: drawer.id,
          actualCountedCash: Number(actualCash),
          supervisorPin,
          discrepancyReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to close register');
      onZReportGenerated(data.zReport);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
              📊 Cashier Shift Balancing & Z-Report
            </h3>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>
              Terminal: {drawer.terminalIdentifier} | Status: <span style={{ color: '#4ADE80', fontWeight: 700 }}>{drawer.status}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#94A3B8', fontSize: '20px' }}>✕</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(220, 38, 38, 0.2)', border: '1px solid #DC2626', color: '#FCA5A5', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px' }}>
            ⚠️ {error}
          </div>
        )}

        {dropSuccess && (
          <div style={{ background: 'rgba(34, 197, 94, 0.2)', border: '1px solid #22C55E', color: '#86EFAC', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px' }}>
            ✅ {dropSuccess}
          </div>
        )}

        {/* Shift Float Summary */}
        <div style={{ background: 'var(--color-bg)', padding: '14px', borderRadius: '8px', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
            <span style={{ color: '#94A3B8' }}>Opening Cash Float:</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>${drawer.openingFloat.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
            <span style={{ color: '#94A3B8' }}>Total Cash Drops to Safe:</span>
            <span style={{ fontWeight: 700, color: '#F87171', fontFamily: 'var(--font-mono)' }}>-${drawer.totalCashDrops.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748B' }}>
            <span>Opened At:</span>
            <span>{new Date(drawer.openedAt).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Section A: Mid-Shift Cash Drop */}
        <div style={{ marginBottom: '20px', borderBottom: '1px solid var(--color-border)', paddingBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
            Mid-Shift Cash Skim / Drop to Vault (F9)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="number"
              placeholder="Amount to drop ($)..."
              value={cashDropAmount}
              onChange={e => setCashDropAmount(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              onClick={handleCashDrop}
              disabled={loading}
              style={{ background: 'var(--color-accent)', color: '#FFF', padding: '8px 14px', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: '13px' }}
            >
              Record Drop
            </button>
          </div>
        </div>

        {/* Section B: End-of-Day Shift Close (Blind Count) */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#4ADE80', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
            Physical Cash Blind Count (Shift Closure)
          </label>
          <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '8px' }}>
            Enter the exact cash counted in the drawer. The system will compare it against the transaction ledger to calculate variance.
          </p>
          <input
            type="number"
            placeholder="Counted cash ($) e.g. 750.50"
            value={actualCash}
            onChange={e => setActualCash(e.target.value)}
            style={{ width: '100%', marginBottom: '10px', fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <input
              type="password"
              placeholder="Supervisor PIN (e.g. 9942)"
              value={supervisorPin}
              onChange={e => setSupervisorPin(e.target.value)}
            />
            <input
              type="text"
              placeholder="Audit note if variance..."
              value={discrepancyReason}
              onChange={e => setDiscrepancyReason(e.target.value)}
            />
          </div>

          <button
            onClick={handleCloseShift}
            disabled={loading}
            style={{
              width: '100%',
              background: '#DC2626',
              color: '#FFF',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 800,
              fontSize: '14px',
              letterSpacing: '0.03em'
            }}
          >
            {loading ? 'Balancing & Locking Drawer...' : '🔒 CLOSE REGISTER & GENERATE Z-REPORT'}
          </button>
        </div>
      </div>
    </div>
  );
};
