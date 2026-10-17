import React from 'react';
import { BarcodeSvg } from './BarcodeSvg';

interface ScannerSimulatorModalProps {
  onScanBarcode: (barcode: string) => void;
  onClose: () => void;
}

export const ScannerSimulatorModal: React.FC<ScannerSimulatorModalProps> = ({ onScanBarcode, onClose }) => {
  // Pre-configured test barcodes
  const sampleItems = [
    { name: 'Amoxicillin 500mg (FEFO Batch Split Test)', barcode: '8901000000101', type: 'Pharma', desc: 'Triggers multi-batch FEFO splitting (Batch 1 has only 8 units)' },
    { name: 'Paracetamol 650mg (Near Expiry Warning)', barcode: '8901000000102', type: 'Pharma', desc: 'Triggers amber near-expiry indicator' },
    { name: 'Atorvastatin 20mg (Standard Pharmacy Lot)', barcode: '8901000000103', type: 'Pharma', desc: 'Prescription required drug' },
    { name: 'Retail Soda / Beverage (Standard FMCG)', barcode: '8901000000001', type: 'Retail', desc: '5% tax FMCG beverage item' },
    { name: 'Retail Potato Chips (Snack Item)', barcode: '8901000000002', type: 'Retail', desc: '10% tax snack category' },
    { name: 'High-Demand 1-Stock Race Item', barcode: '9999999999999', type: 'Test', desc: 'Item used for 20-thread concurrency race testing' },
  ];

  // Trigger instant barcode ingestion
  const simulateHardwareScan = (barcode: string) => {
    onScanBarcode(barcode);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', padding: '24px' }}>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚡</span>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Hardware Barcode Scanner Simulator
              </h3>
              <div className="text-xs text-slate-500">
                Emulates 15ms USB/HID keyboard keystroke bursts terminating with Enter (Ctrl + K)
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-600 mb-4 leading-relaxed">
          Click any sample barcode below. The virtual engine will fire synthetic <code className="font-mono bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 font-semibold">keydown</code> events with a 15ms inter-keystroke delta directly into the global window listener, verifying zero-lag ingestion without input focus.
        </p>

        <div className="flex flex-col gap-2.5">
          {sampleItems.map((item, idx) => (
            <div
              key={idx}
              onClick={() => simulateHardwareScan(item.barcode)}
              className="flex justify-between items-center p-3.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-emerald-50/50 hover:border-emerald-300 transition shadow-xs group"
            >
              <div>
                <div className="font-bold text-sm text-slate-900 group-hover:text-emerald-900 transition">
                  {item.name}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <BarcodeSvg value={item.barcode} width={120} height={32} showText={false} />
                <div className="text-right min-w-[85px]">
                  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md border mb-1 ${
                    item.type === 'Pharma'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : item.type === 'Retail'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    {item.type}
                  </span>
                  <div className="font-mono text-xs font-bold text-slate-700">
                    {item.barcode}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
