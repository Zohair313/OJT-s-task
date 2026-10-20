import React, { useState } from 'react';
import { ThermalReceipt } from './ThermalReceipt';
import { formatCurrency } from '../utils/thermalReceiptUtil';
import type { ReceiptInvoice, ReceiptStore } from '../utils/thermalReceiptUtil';
import {
  Search,
  FileText,
  Printer,
  CreditCard,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

/**
 * Admin → Invoice Lookup section.
 * Paste a slip / invoice number (e.g. INV-20261020-1720) — or any 8+ digit
 * sequence contained in it — and view everything bought on that slip:
 * items, batch/expiry, tax, discounts, payment details + full receipt preview.
 */

interface LookupItem {
  id: string;
  productName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  lineTotal: number;
}

interface LookupInvoice extends Omit<ReceiptInvoice, 'items'> {
  id: string;
  tenantId: string;
  drawerId: string;
  cashierId?: string;
  status?: string;
  paymentReference?: string;
  doctorName?: string;
  items: LookupItem[];
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CREDIT_CARD: 'Credit Card',
  UPI_QR: 'UPI / QR'
};

const FALLBACK_STORE: ReceiptStore = {
  name: 'Store',
  taxIdentifier: '—',
  address: '—',
  phone: '—',
  isPharmacy: false
};

export const InvoiceLookup: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<LookupInvoice | null>(null);
  const [store, setStore] = useState<ReceiptStore | null>(null);
  const [showReceipt, setShowReceipt] = useState<boolean>(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setInvoice(null);
      setError('Slip / invoice number enter karein.');
      return;
    }
    setLoading(true);
    setError(null);
    setInvoice(null);
    setShowReceipt(false);
    try {
      const res = await fetch(`/api/v1/invoices/lookup?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || `No invoice found for '${q}'`);
        return;
      }
      setInvoice(data.invoice);
      setStore(data.store || null);
    } catch (err: any) {
      setError(err?.message || 'Lookup failed — backend reachable nahi hai.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setQuery('');
    setInvoice(null);
    setError(null);
    setShowReceipt(false);
  };

  const isExpired = (expiry?: string) => {
    if (!expiry || expiry === 'N/A') return false;
    const d = new Date(expiry);
    return !isNaN(d.getTime()) && d.getTime() < Date.now();
  };

  const totalUnits = invoice ? invoice.items.reduce((s, it) => s + it.quantity, 0) : 0;
  const now = invoice ? new Date(invoice.createdAt) : null;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-5 min-h-0 pr-1">
      {/* Search Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Invoice / Slip Lookup</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Slip number dalye (e.g. <span className="font-mono font-semibold">INV-20261020-1720</span>) — ya koi bhi 8+ digit sequence jo invoice number me ho — pura kharida hua saman aa jayega.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2.5 mt-5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="INV-20261020-1720"
              aria-label="Invoice or slip number"
              className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-5 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg transition shadow-xs disabled:opacity-60"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search Slip</span>
          </button>
          {invoice && (
            <button
              type="button"
              onClick={reset}
              className="h-11 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition"
            >
              New Search
            </button>
          )}
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 rounded-xl px-5 py-4 flex items-start gap-3 text-xs text-rose-800 dark:text-rose-300 shrink-0">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div>
            <div className="font-bold">Slip nahi mili</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 flex items-center justify-center gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
          Fetching invoice from database…
        </div>
      )}

      {/* Result */}
      {invoice && !loading && (
        <>
          {/* Slip Header */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs shrink-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-lg font-extrabold text-slate-900 dark:text-slate-100">
                    {invoice.invoiceNumber}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                    invoice.status === 'COMPLETED'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    {invoice.status || 'COMPLETED'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>{now ? now.toLocaleString() : '—'}</span>
                  <span className="font-mono">{store?.name || invoice.tenantId}</span>
                  <span className="font-mono">Cashier: {invoice.cashierId || '—'}</span>
                  <span className="font-mono">Drawer: {invoice.drawerId || '—'}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider">Grand Total</div>
                  <div className="font-mono text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(invoice.grandTotal)}
                  </div>
                </div>
                <button
                  onClick={() => setShowReceipt(true)}
                  className="h-10 px-4 flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                >
                  <Printer className="w-4 h-4" />
                  Full Receipt
                </button>
              </div>
            </div>

            {/* Payment + Clinical meta strip */}
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <CreditCard className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                {PAYMENT_LABELS[invoice.paymentMethod] || invoice.paymentMethod}
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  · Tendered {formatCurrency(invoice.tenderedAmount)} · Change {formatCurrency(invoice.changeDue)}
                </span>
              </span>
              {invoice.paymentReference && (
                <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300">
                  Ref: {invoice.paymentReference}
                </span>
              )}
              {invoice.patientName && (
                <span className="px-2.5 py-1 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 text-xs font-semibold text-sky-800 dark:text-sky-300">
                  Patient: {invoice.patientName}
                </span>
              )}
              {(invoice.doctorName || invoice.doctorLicense) && (
                <span className="px-2.5 py-1 rounded-md bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-900 text-xs font-semibold text-violet-800 dark:text-violet-300">
                  Doctor: {invoice.doctorName || invoice.doctorLicense}
                </span>
              )}
              {invoice.prescriptionNumber && (
                <span className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Rx: {invoice.prescriptionNumber}
                </span>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs shrink-0">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Items Purchased
              </span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {invoice.items.length} lines · {totalUnits} units
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-6 w-8">#</th>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Batch / Expiry</th>
                    <th className="py-3 px-4 text-center">Qty</th>
                    <th className="py-3 px-4 text-right">Unit Price</th>
                    <th className="py-3 px-4 text-right">Tax</th>
                    <th className="py-3 px-6 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {invoice.items.map((it, idx) => (
                    <tr key={it.id || idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40 transition">
                      <td className="py-3 px-6 font-mono text-slate-400 dark:text-slate-500">{idx + 1}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{it.productName}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {it.batchNumber}
                        </span>
                        <span className={`ml-2 font-mono text-[11px] ${isExpired(it.expiryDate) ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                          {it.expiryDate}{isExpired(it.expiryDate) ? ' · EXPIRED' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                        {it.quantity}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatCurrency(it.unitPrice)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                        {it.taxRate}%{it.taxAmount > 0 && <span className="block text-[10px] opacity-70">({formatCurrency(it.taxAmount)})</span>}
                      </td>
                      <td className="py-3 px-6 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(it.lineTotal)}
                        {it.discountAmount > 0 && (
                          <span className="block text-[10px] font-semibold text-rose-600 dark:text-rose-400 font-normal">
                            -{formatCurrency(it.discountAmount)} disc
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs self-end w-full max-w-sm shrink-0">
            <div className="text-xs space-y-2.5">
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span className="font-medium">Subtotal</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span className="font-medium">Tax / VAT</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(invoice.taxAmount)}</span>
              </div>
              {invoice.discountAmount > 0 && (
                <div className="flex justify-between text-rose-600 dark:text-rose-400">
                  <span className="font-medium">Discount</span>
                  <span className="font-mono font-semibold">-{formatCurrency(invoice.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span className="font-medium">Round Off</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {invoice.roundOff !== undefined && invoice.roundOff !== 0
                    ? `${invoice.roundOff >= 0 ? '+' : '-'}${formatCurrency(Math.abs(invoice.roundOff))}`
                    : formatCurrency(invoice.roundOff ?? 0)}
                </span>
              </div>
              <div className="flex justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800">
                <span className="font-bold text-slate-900 dark:text-slate-100">Grand Total</span>
                <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400 text-sm">
                  {formatCurrency(invoice.grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state (before first search) */}
      {!invoice && !error && !loading && (
        <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl py-14 flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
          <FileText className="w-9 h-9" />
          <span className="text-xs font-semibold">
            Upar slip number dalye taake us sale ka pura breakdown yahan dikhe
          </span>
        </div>
      )}

      {/* Full Thermal Receipt Preview */}
      {showReceipt && invoice && (
        <ThermalReceipt
          invoice={invoice}
          store={store ?? FALLBACK_STORE}
          format={(store ?? FALLBACK_STORE).isPharmacy ? '58mm' : '80mm'}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
};
