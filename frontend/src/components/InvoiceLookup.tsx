import React, { useState } from 'react';
import { ThermalReceipt } from './ThermalReceipt';
import { formatCurrency } from '../utils/thermalReceiptUtil';
import type { ReceiptStore } from '../utils/thermalReceiptUtil';
import {
  Search,
  FileText,
  Printer,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
  ShoppingCart
} from 'lucide-react';

/**
 * Admin → Invoice Lookup section.
 *
 * Search accepts: slip/invoice number (INV-20261020-1720), any 4+ digit
 * partial sequence, cashier id, or patient/doctor name. EVERY matching
 * slip is listed (newest first); click a row to see exactly what was
 * bought on it — items, batch/expiry, tax, discount, payment details,
 * plus full thermal receipt preview.
 */

interface SearchSummary {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  tenantId: string;
  tenantName?: string;
  cashierId: string;
  patientName?: string;
  status: string;
  paymentMethod?: string;
  grandTotal: number;
  itemLines: number;
  totalUnits: number;
}

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

interface LookupInvoice {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  tenantId: string;
  drawerId: string;
  cashierId?: string;
  patientName?: string;
  doctorName?: string;
  doctorLicense?: string;
  prescriptionNumber?: string;
  status?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff?: number;
  grandTotal: number;
  paymentMethod: string;
  tenderedAmount: number;
  changeDue: number;
  paymentReference?: string;
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
  const [results, setResults] = useState<SearchSummary[] | null>(null);
  const [invoice, setInvoice] = useState<LookupInvoice | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [store, setStore] = useState<ReceiptStore | null>(null);
  const [showReceipt, setShowReceipt] = useState<boolean>(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults(null);
      setInvoice(null);
      setError('Slip number, partial digits, ya user/patient naam enter karein.');
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setInvoice(null);
    setShowReceipt(false);
    try {
      const res = await fetch(`/api/v1/invoices/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || `Search failed for '${q}'`);
        return;
      }
      const list: SearchSummary[] = data.results || [];
      if (list.length === 0) {
        setError(`'${q}' se koi invoice nahi mila. Slip number, 4+ digit sequence, ya cashier/patient naam try karein.`);
        return;
      }
      setResults(list);
      // Single exact match → open its full purchase detail directly
      if (list.length === 1) {
        await openDetail(list[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Search failed — backend reachable nahi hai.');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (summary: SearchSummary) => {
    setDetailLoading(true);
    setError(null);
    setShowReceipt(false);
    try {
      const res = await fetch(`/api/v1/invoices/lookup?id=${encodeURIComponent(summary.id)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || `Invoice ${summary.invoiceNumber} load nahi ho saka.`);
        return;
      }
      setInvoice(data.invoice);
      setStore(data.store || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load invoice detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const backToResults = () => {
    setInvoice(null);
    setShowReceipt(false);
    setError(null);
  };

  const reset = () => {
    setQuery('');
    setResults(null);
    setInvoice(null);
    setError(null);
    setShowReceipt(false);
  };

  const isExpired = (expiry?: string) => {
    if (!expiry || expiry === 'N/A') return false;
    const d = new Date(expiry);
    return !isNaN(d.getTime()) && d.getTime() < Date.now();
  };

  const now = invoice ? new Date(invoice.createdAt) : null;
  const totalUnits = invoice ? invoice.items.reduce((s, it) => s + it.quantity, 0) : 0;
  const listTotals = results
    ? {
        count: results.length,
        units: results.reduce((s, r) => s + r.totalUnits, 0),
        spend: results.reduce((s, r) => s + r.grandTotal, 0)
      }
    : null;

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
              Slip number (e.g. <span className="font-mono font-semibold">INV-20261020-1720</span>), koi bhi 4+ digit sequence, ya user/patient ka naam — us se jude **tamam** sales ki list aayegi.
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2.5 mt-5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="INV-20261020-1720 · 20261020 · cashier/patient naam"
              aria-label="Invoice number, partial digits, or user name"
              className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-emerald-500 rounded-lg text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 placeholder:font-normal focus:outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-5 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg transition shadow-xs disabled:opacity-60"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search</span>
          </button>
          {(results || invoice) && (
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
            <div className="font-bold">Koi data nahi mila</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {/* Search loading */}
      {loading && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 flex items-center justify-center gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
          Searching invoices…
        </div>
      )}

      {/* Detail loading */}
      {detailLoading && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 flex items-center justify-center gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
          Loading full slip…
        </div>
      )}

      {/* ============ RESULTS LIST ============ */}
      {results && !invoice && !loading && !detailLoading && (
        <>
          {/* Summary bar */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900 rounded-xl px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs shrink-0">
            <span className="font-bold text-emerald-800 dark:text-emerald-300">
              {listTotals?.count} invoice{listTotals?.count === 1 ? '' : 's'} found
            </span>
            <span className="text-emerald-700/80 dark:text-emerald-400/80 font-mono">
              {listTotals?.units} units total
            </span>
            <span className="text-emerald-700/80 dark:text-emerald-400/80 font-mono">
              Total spend: <b>{formatCurrency(listTotals?.spend ?? 0)}</b>
            </span>
            <span className="text-emerald-700/60 dark:text-emerald-400/60 ml-auto">
              Row dabayein → us slip ka pura kharidaari detail
            </span>
          </div>

          {/* Rows */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs shrink-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => openDetail(r)}
                  className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-slate-50/80 dark:hover:bg-slate-950/50 transition group"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:border-emerald-300 dark:group-hover:border-emerald-800 transition">
                    <ShoppingCart className="w-4 h-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {r.invoiceNumber}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                        {r.status}
                      </span>
                      {r.patientName && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-300">
                          Patient: {r.patientName}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                      <span className="font-mono">{r.tenantName || r.tenantId}</span>
                      <span className="font-mono">Cashier: {r.cashierId}</span>
                      <span className="font-mono">
                        {r.itemLines} lines · {r.totalUnits} units
                      </span>
                      {r.paymentMethod && (
                        <span className="font-semibold">{PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod}</span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-base font-extrabold text-slate-900 dark:text-slate-100">
                      {formatCurrency(r.grandTotal)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ============ SINGLE INVOICE DETAIL ============ */}
      {invoice && !detailLoading && (
        <>
          {/* Back to results */}
          {results && results.length > 1 && (
            <button
              onClick={backToResults}
              className="self-start flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 transition shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to results ({results.length} invoices)
            </button>
          )}

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

          {/* Items Table — exactly what was bought on this slip */}
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
      {!results && !invoice && !error && !loading && (
        <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl py-14 flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
          <FileText className="w-9 h-9" />
          <span className="text-xs font-semibold text-center px-6">
            Slip number ya user/patient naam dalye — us se jude tamam sales aur unke kharide hue items yahan milenge
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
