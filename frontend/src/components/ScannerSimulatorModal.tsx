import React, { useState } from 'react';
import { BarcodeSvg } from './BarcodeSvg';
import { Zap, X, Search, CheckCircle2 } from 'lucide-react';

interface ScannerSimulatorModalProps {
  onScanBarcode: (barcode: string) => void;
  onClose: () => void;
}

export const ScannerSimulatorModal: React.FC<ScannerSimulatorModalProps> = ({ onScanBarcode, onClose }) => {
  const [customBarcode, setCustomBarcode] = useState<string>('');

  // Verified active barcodes from live database
  const sampleItems = [
    { name: 'Amoxicillin 500mg (FEFO Batch Split Test)', barcode: '8901000000101', sku: 'SKU-MED-1001', type: 'Pharma', desc: 'Triggers multi-batch FEFO splitting (Batch 1 has only 8 units)' },
    { name: 'Paracetamol 650mg (Near Expiry Warning)', barcode: '8901000000102', sku: 'SKU-MED-1002', type: 'Pharma', desc: 'Triggers amber near-expiry indicator (Batch EXP: 2026-11)' },
    { name: 'Atorvastatin Calcium 20mg (Prescription Item)', barcode: '8901000000200', sku: 'SKU-MED-1010', type: 'Pharma', desc: 'Standard pharmacy prescription medication (Stock: 45)' },
    { name: 'Retail Soda / Beverage 500ml (Standard FMCG)', barcode: '8901000000001', sku: 'SKU-RET-1001', type: 'Retail', desc: '5% tax FMCG beverage item (Stock: 85)' },
    { name: 'Retail Potato Chips Sour Cream 150g', barcode: '8901000000502', sku: 'SKU-RET-1012', type: 'Retail', desc: '10% tax snack category item (Stock: 65)' },
    { name: 'Extra Virgin Olive Oil 500ml', barcode: '8901000000506', sku: 'SKU-RET-1016', type: 'Retail', desc: 'Pantry grocery item with batch allocation (Stock: 20)' },
  ];

  // Trigger instant barcode ingestion
  const simulateHardwareScan = (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) return;
    onScanBarcode(clean);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customBarcode.trim()) {
      simulateHardwareScan(customBarcode.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Hardware Barcode Scanner Simulator
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                  Ctrl + K
                </span>
              </h3>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Emulates instant hardware scanner buffer ingestion (<span className="font-mono text-emerald-600 dark:text-emerald-400">&lt;25ms</span>)
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {/* Direct Custom Barcode Input Box */}
          <form onSubmit={handleCustomSubmit} className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Direct Barcode or SKU Scanner Test
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Paste or type any barcode / SKU..."
                  value={customBarcode}
                  onChange={e => setCustomBarcode(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={!customBarcode.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition shadow-xs flex items-center gap-1.5 shrink-0"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Simulate Scan</span>
              </button>
            </div>
          </form>

          <div>
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Verified Database Barcodes (Click to Scan):</span>
            </div>

            <div className="flex flex-col gap-2">
              {sampleItems.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => simulateHardwareScan(item.barcode)}
                  className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 hover:border-emerald-300 dark:hover:border-emerald-700 transition shadow-xs group"
                >
                  <div className="pr-3 min-w-0">
                    <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 group-hover:text-emerald-800 dark:group-hover:text-emerald-300 transition truncate">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{item.desc}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">SKU: {item.sku}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="p-1 bg-white rounded border border-slate-200 shadow-xs hidden sm:block">
                      <BarcodeSvg value={item.barcode} width={110} height={30} showText={false} />
                    </div>
                    <div className="text-right min-w-[90px]">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md border mb-1 ${
                        item.type === 'Pharma'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      }`}>
                        {item.type}
                      </span>
                      <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                        {item.barcode}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
