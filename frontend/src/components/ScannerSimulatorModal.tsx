import React from 'react';

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

  // Simulates rapid keystrokes arriving every 15ms
  const simulateHardwareScan = (barcode: string) => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < barcode.length) {
        const char = barcode[index];
        window.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        index++;
      } else {
        clearInterval(interval);
        // Terminate with Enter key
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        onScanBarcode(barcode);
        onClose();
      }
    }, 15);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '580px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>⚡</span>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
                Hardware Barcode Scanner Simulator
              </h3>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Emulates 15ms USB/HID keyboard keystroke bursts terminating with Enter (Ctrl + K)
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#94A3B8', fontSize: '20px' }}>✕</button>
        </div>

        <p style={{ fontSize: '13px', color: '#CBD5E1', marginBottom: '16px', lineHeight: 1.4 }}>
          Click any sample barcode below. The virtual engine will fire synthetic <code style={{ color: '#FBBF24' }}>keydown</code> events with a 15ms inter-keystroke delta directly into the global window listener, verifying zero-lag ingestion without input focus.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sampleItems.map((item, idx) => (
            <div
              key={idx}
              onClick={() => simulateHardwareScan(item.barcode)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 150ms ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-secondary)';
                e.currentTarget.style.background = 'var(--color-surface-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.background = 'var(--color-bg)';
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#F8FAFC' }}>{item.name}</div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{item.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="badge" style={{ background: item.type === 'Pharma' ? 'rgba(34,197,94,0.2)' : 'rgba(3,105,161,0.2)', color: item.type === 'Pharma' ? '#4ADE80' : '#38BDF8', marginBottom: '4px' }}>
                  {item.type}
                </span>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: '#FCD34D' }}>
                  {item.barcode}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
