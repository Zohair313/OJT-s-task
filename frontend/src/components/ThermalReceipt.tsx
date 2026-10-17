import React, { useState } from 'react';
import { BarcodeSvg } from './BarcodeSvg';
import { QrCodeSvg } from './QrCodeSvg';
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
  CheckCircle2,
  Zap,
  QrCode
} from 'lucide-react';

interface ThermalReceiptProps {
  invoice: ReceiptInvoice;
  store: ReceiptStore;
  format?: '80mm' | '58mm';
  onTestScan?: (code: string) => void;
  onClose: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({
  invoice,
  store,
  format = '80mm',
  onTestScan,
  onClose
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'80mm' | '58mm'>(format);
  const [activeTab, setActiveTab] = useState<'preview' | 'escpos'>('preview');
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

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

  const handleCopyBarcode = () => {
    navigator.clipboard.writeText(invoice.invoiceNumber);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const invoiceTime = new Date(invoice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const invoiceDate = new Date(invoice.createdAt).toLocaleDateString();

  return (
    <div className="modal-overlay select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl text-slate-900 dark:text-slate-100 overflow-hidden">
        
        {/* 1. Modal Top Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Thermal Tax Invoice Receipt
                </h3>
                <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  #{invoice.invoiceNumber}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {store.name} • {selectedFormat.toUpperCase()} Emulation
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 80mm / 58mm Format Toggle */}
            <div className="flex bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1 gap-1">
              <button
                type="button"
                onClick={() => setSelectedFormat('80mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                  selectedFormat === '80mm'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setSelectedFormat('58mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                  selectedFormat === '58mm'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                58mm
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Mode Tabs & Action Toolbar */}
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'preview'
                  ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Paper Preview</span>
            </button>

            <button
              onClick={() => setActiveTab('escpos')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'escpos'
                  ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 rounded-lg transition shadow-xs"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy ESC/POS'}</span>
              </button>
            ) : null}

            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>

        {/* 3. Modal Body: Interactive Preview */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100/70 dark:bg-slate-950 flex justify-center items-start">
          {activeTab === 'escpos' ? (
            /* Raw Monospace ESC/POS Stream View */
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre shadow-xs">
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

              {/* Thermal Barcode (1D Code-128 + 2D QR Code for Dual Scanning) */}
              <div className="text-center pt-2">
                <div className="flex flex-col items-center gap-2">
                  {/* High-Contrast Crisp Code-128 Barcode */}
                  <BarcodeSvg
                    value={invoice.invoiceNumber}
                    width={is58mm ? 1.6 : 2}
                    height={52}
                    showText={true}
                  />

                  {/* 2D QR Code for instant phone camera scan */}
                  <div className="flex items-center justify-center gap-3 mt-1">
                    <QrCodeSvg value={invoice.invoiceNumber} size={is58mm ? 75 : 90} />
                    <div className="text-left text-[8px] text-gray-600 space-y-1">
                      <div className="font-bold flex items-center gap-1">
                        <QrCode className="w-3 h-3 text-emerald-600" />
                        <span>Instant QR Scan</span>
                      </div>
                      <div className="leading-tight text-gray-500">
                        Scan with any phone camera or 2D scanner
                      </div>
                      <div className="font-mono text-[7.5px] font-bold text-gray-900">
                        #{invoice.invoiceNumber}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-[7.5px] text-gray-500 mt-2 leading-tight">
                  Thank you for your visit! Goods once sold are returnable within 7 days with original receipt.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 4. Footer Dismissal Bar with 1-Click POS Scan Test */}
        <div className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-600 dark:text-slate-300 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Fiscal Receipt Ready</span>
            </div>

            {onTestScan && (
              <button
                onClick={() => {
                  onTestScan(invoice.invoiceNumber);
                  onClose();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg transition shadow-xs cursor-pointer"
                title="Simulate scanning this receipt barcode into the active POS Counter"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Simulate POS Scan</span>
              </button>
            )}

            <button
              onClick={handleCopyBarcode}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Copy invoice barcode value to clipboard"
            >
              {codeCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              <span>{codeCopied ? 'Copied' : invoice.invoiceNumber}</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition shadow-xs cursor-pointer"
          >
            Done (Close)
          </button>
        </div>
      </div>
    </div>
  );
};
