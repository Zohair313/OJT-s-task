import React, { useState } from 'react';
import { BarcodeSvg } from './BarcodeSvg';
import {
  formatCurrency,
  generateEscPosText
} from '../utils/thermalReceiptUtil';
import type {
  ReceiptInvoice,
  ReceiptStore
} from '../utils/thermalReceiptUtil';
import {
  Printer,
  X,
  FileText,
  Copy,
  Check,
  CheckCircle2
} from 'lucide-react';

interface ThermalReceiptProps {
  invoice: ReceiptInvoice;
  store: ReceiptStore;
  format?: '80mm' | '58mm';
  onClose: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({
  invoice,
  store,
  format = '80mm',
  onClose
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'80mm' | '58mm'>(format);
  const [activeTab, setActiveTab] = useState<'preview' | 'escpos'>('preview');
  const [copied, setCopied] = useState(false);

  const is58mm = selectedFormat === '58mm';

  // Inject dynamic @page size into document during print
  const handlePrint = () => {
    const styleId = 'dynamic-thermal-print-page-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `@page { size: ${selectedFormat} auto; margin: 0mm; }`;

    window.print();
  };

  const handleCopyEscPos = () => {
    const text = generateEscPosText(invoice, store, selectedFormat);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const invoiceTime = new Date(invoice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const invoiceDate = new Date(invoice.createdAt).toLocaleDateString();

  return (
    <div className="modal-overlay select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl text-slate-100 overflow-hidden">
        
        {/* 1. Modal Top Bar */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950/80 border border-emerald-900/60 flex items-center justify-center text-emerald-400">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100">
                  Thermal Tax Invoice Receipt
                </h3>
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/50 text-[10px] font-mono font-bold text-emerald-400">
                  #{invoice.invoiceNumber}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {store.name} • {selectedFormat.toUpperCase()} Emulation
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 80mm / 58mm Format Toggle */}
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
              <button
                type="button"
                onClick={() => setSelectedFormat('80mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                  selectedFormat === '80mm'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setSelectedFormat('58mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                  selectedFormat === '58mm'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                58mm
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Mode Tabs & Action Toolbar */}
        <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'preview'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Paper Preview</span>
            </button>

            <button
              onClick={() => setActiveTab('escpos')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'escpos'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Raw ESC/POS</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'escpos' ? (
              <button
                onClick={handleCopyEscPos}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 rounded-lg transition shadow-sm"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy ESC/POS'}</span>
              </button>
            ) : null}

            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>

        {/* 3. Modal Body: Interactive Preview */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950 flex justify-center items-start">
          {activeTab === 'escpos' ? (
            /* Raw Monospace ESC/POS Stream View */
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-emerald-300 overflow-x-auto whitespace-pre selection:bg-emerald-500 selection:text-black">
              {generateEscPosText(invoice, store, selectedFormat)}
            </div>
          ) : (
            /* Authentic Thermal Paper Container */
            <div
              id="printable-thermal-receipt"
              className={`thermal-paper ${is58mm ? 'thermal-paper-58mm' : 'thermal-paper-80mm'} rounded`}
            >
              {/* Store Header */}
              <div className="text-center">
                <div className="font-extrabold text-[13px] tracking-tight">{store.name.toUpperCase()}</div>
                <div className="text-[9px] text-gray-700 mt-0.5">{store.address}</div>
                <div className="text-[9px] text-gray-700">Tel: {store.phone}</div>
                <div className="text-[9px] font-bold text-gray-900 mt-1">
                  TAX REG / NTN: {store.taxIdentifier}
                </div>
              </div>

              <div className="thermal-dashed" />

              {/* Invoice Meta */}
              <div className="flex justify-between text-[9.5px] font-semibold">
                <span>INVOICE #{invoice.invoiceNumber}</span>
                <span>{invoiceTime}</span>
              </div>
              <div className="flex justify-between text-[8.5px] text-gray-600 mt-0.5">
                <span>DATE: {invoiceDate}</span>
                <span>CASHIER: {invoice.cashierId || 'REG-01'}</span>
              </div>

              {/* Clinical Hospital Block if Pharmacy */}
              {store.isPharmacy && (invoice.patientId || invoice.doctorLicense || invoice.prescriptionNumber) && (
                <div className="border border-black p-2 my-2 bg-gray-50 text-[8.5px] rounded-sm">
                  <div className="font-bold border-b border-black/40 pb-0.5 mb-1 flex items-center justify-between">
                    <span>CLINICAL PRESCRIPTION RECORD</span>
                    <span className="text-[7.5px] font-normal uppercase">Rx VALIDATED</span>
                  </div>
                  {invoice.patientName && (
                    <div><b>Patient:</b> {invoice.patientName} (MRN: {invoice.patientId || 'N/A'})</div>
                  )}
                  {invoice.doctorLicense && (
                    <div><b>Doctor Lic:</b> {invoice.doctorLicense}</div>
                  )}
                  {invoice.prescriptionNumber && (
                    <div><b>Prescription #:</b> {invoice.prescriptionNumber}</div>
                  )}
                </div>
              )}

              <div className="thermal-dashed" />

              {/* Line Items Table */}
              <table className="w-full text-left border-collapse text-[9.5px]">
                <thead>
                  <tr className="border-b border-black text-[9px] uppercase tracking-wider">
                    <th className="pb-1 text-left w-[46%]">Item / Batch</th>
                    <th className="pb-1 text-center w-[12%]">Qty</th>
                    <th className="pb-1 text-right w-[20%]">Price</th>
                    <th className="pb-1 text-right w-[22%]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-300">
                  {invoice.items.map((item, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="py-1 pr-1">
                        <div className="font-semibold leading-tight">{item.productName}</div>
                        {item.batchNumber && (
                          <div className="text-[7.5px] text-gray-600 mt-0.5">
                            Lot: {item.batchNumber} | Exp: {item.expiryDate || 'N/A'}
                          </div>
                        )}
                      </td>
                      <td className="py-1 text-center">{item.quantity}</td>
                      <td className="py-1 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-1 text-right font-bold">{formatCurrency(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="thermal-dashed" />

              {/* Financial Totals Summary */}
              <div className="text-[9.5px] space-y-1">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(invoice.subtotal)}</span>
                </div>
                {invoice.discountAmount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Discounts:</span>
                    <span>-{formatCurrency(invoice.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Tax / VAT:</span>
                  <span>{formatCurrency(invoice.taxAmount)}</span>
                </div>

                <div className="thermal-double-dashed my-1.5" />

                <div className="flex justify-between text-[13px] font-extrabold tracking-tight">
                  <span>GRAND TOTAL:</span>
                  <span>{formatCurrency(invoice.grandTotal)}</span>
                </div>

                <div className="thermal-double-dashed my-1.5" />

                <div className="flex justify-between text-[8.5px]">
                  <span>Payment ({invoice.paymentMethod}):</span>
                  <span>{formatCurrency(invoice.tenderedAmount)}</span>
                </div>
                <div className="flex justify-between text-[8.5px] font-bold">
                  <span>Change Due:</span>
                  <span>{formatCurrency(invoice.changeDue)}</span>
                </div>
              </div>

              <div className="thermal-dashed" />

              {/* Thermal Barcode & Legal Disclaimer */}
              <div className="text-center pt-1">
                <BarcodeSvg
                  value={invoice.invoiceNumber.replace(/[^0-9]/g, '').slice(-12) || '890100000001'}
                  width={is58mm ? 150 : 200}
                  height={32}
                />
                <div className="text-[8px] text-gray-600 font-bold mt-1">
                  INV: #{invoice.invoiceNumber}
                </div>
                <div className="text-[7.5px] text-gray-500 mt-0.5 leading-tight">
                  Thank you for your visit! Goods once sold are returnable within 7 days with original receipt.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 4. Footer Dismissal Bar */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>Fiscal Receipt Generated Successfully</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition"
          >
            Done (Close)
          </button>
        </div>
      </div>
    </div>
  );
};
