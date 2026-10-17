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
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>📊</span>
              <span>Cashier Shift Balancing & Z-Report</span>
            </h3>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
              <span>Terminal: <b>{drawer.terminalIdentifier}</b></span>
              <span>•</span>
              <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">
                {drawer.status}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 px-3.5 py-2.5 rounded-lg mb-3.5 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {dropSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 px-3.5 py-2.5 rounded-lg mb-3.5 text-xs font-semibold flex items-center gap-2">
            <span>✅</span>
            <span>{dropSuccess}</span>
          </div>
        )}

        {/* Shift Float Summary */}
        <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-4 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Opening Cash Float:</span>
            <span className="font-bold font-mono text-slate-900 dark:text-slate-100">${drawer.openingFloat.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Total Cash Drops to Safe:</span>
            <span className="font-bold font-mono text-rose-600 dark:text-rose-400">-${drawer.totalCashDrops.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-[11px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
            <span>Opened At:</span>
            <span>{new Date(drawer.openedAt).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Section A: Mid-Shift Cash Drop */}
        <div className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-700 space-y-2">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Mid-Shift Cash Skim / Drop to Vault (F9)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount to drop ($)..."
              value={cashDropAmount}
              onChange={e => setCashDropAmount(e.target.value)}
              className="flex-1 h-10 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-emerald-500 transition shadow-xs"
            />
            <button
              onClick={handleCashDrop}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-xs transition shadow-xs disabled:opacity-50"
            >
              Record Drop
            </button>
          </div>
        </div>

        {/* Section B: End-of-Day Shift Close (Blind Count) */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider block mb-1">
              Physical Cash Blind Count (Shift Closure)
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              Enter the exact cash counted in the drawer. The system will compare it against the transaction ledger to calculate variance.
            </p>
          </div>

          <input
            type="number"
            placeholder="Counted cash ($) e.g. 750.50"
            value={actualCash}
            onChange={e => setActualCash(e.target.value)}
            className="w-full h-11 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 text-base font-bold font-mono text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-emerald-500 transition shadow-xs"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="Supervisor PIN (e.g. 9942)"
              value={supervisorPin}
              onChange={e => setSupervisorPin(e.target.value)}
              className="h-10 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-emerald-500 transition shadow-xs"
            />
            <input
              type="text"
              placeholder="Audit note if variance..."
              value={discrepancyReason}
              onChange={e => setDiscrepancyReason(e.target.value)}
              className="h-10 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-emerald-500 transition shadow-xs"
            />
          </div>

          <button
            onClick={handleCloseShift}
            disabled={loading}
            className="w-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white py-3 px-4 rounded-xl font-bold text-xs tracking-wider transition shadow-xs disabled:opacity-50"
          >
            {loading ? 'Balancing & Locking Drawer...' : '🔒 CLOSE REGISTER & GENERATE Z-REPORT'}
          </button>
        </div>
      </div>
    </div>
  );
};
