import React, { useState } from 'react';
import { BarcodeSvg } from './BarcodeSvg';

interface InvoiceItem {
  id: string;
  productName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
  discountAmount: number;
  lineTotal: number;
}

interface ThermalReceiptProps {
  invoice: {
    invoiceNumber: string;
    createdAt: string;
    cashierId?: string;
    patientId?: string;
    patientName?: string;
    doctorLicense?: string;
    prescriptionNumber?: string;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    roundOff: number;
    grandTotal: number;
    paymentMethod: string;
    tenderedAmount: number;
    changeDue: number;
    items: InvoiceItem[];
  };
  store: {
    name: string;
    taxIdentifier: string;
    address: string;
    phone: string;
    isPharmacy: boolean;
  };
  format: '80mm' | '58mm';
  onClose: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({
  invoice,
  store,
  format,
  onClose
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'80mm' | '58mm'>(format);
  const is58mm = selectedFormat === '58mm';

  const formatCurrency = (amount: number | string | undefined | null): string => {
    if (amount === undefined || amount === null) return '$0.00';
    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (isNaN(num) || !isFinite(num)) return '$0.00';
    if (Math.abs(num) > 10000000) {
      return '$' + (10000000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-overlay" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" style={{ maxWidth: '440px', width: '100%', padding: '16px', background: 'var(--bg-surface)', maxHeight: '92vh', overflowY: 'auto' }}>
        
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '18px' }}>🖨️</span>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Thermal Receipt ({selectedFormat.toUpperCase()})
            </h3>
          </div>
          
          {/* Format Toggle Pill */}
          <div style={{ display: 'flex', background: 'var(--bg-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xs)', padding: '2px', gap: '2px' }}>
            <button
              onClick={() => setSelectedFormat('80mm')}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '3px',
                background: selectedFormat === '80mm' ? 'var(--emerald-500)' : 'transparent',
                color: selectedFormat === '80mm' ? '#0B0F19' : 'var(--text-secondary)'
              }}
            >
              80mm
            </button>
            <button
              onClick={() => setSelectedFormat('58mm')}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '3px',
                background: selectedFormat === '58mm' ? 'var(--emerald-500)' : 'transparent',
                color: selectedFormat === '58mm' ? '#0B0F19' : 'var(--text-secondary)'
              }}
            >
              58mm
            </button>
          </div>

          <button
            onClick={onClose}
            style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '16px', padding: '4px' }}
          >
            ✕
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={handlePrint}
            style={{
              flex: 1,
              background: 'var(--emerald-500)',
              color: '#0B0F19',
              padding: '8px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>🖨️</span> Print Receipt
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)'
            }}
          >
            Close
          </button>
        </div>

        {/* Snug Authentic Thermal Paper Container */}
        <div
          id="printable-thermal-receipt"
          className={`thermal-paper ${is58mm ? 'thermal-paper-58mm' : 'thermal-paper-80mm'}`}
          style={{
            margin: '0 auto',
            borderRadius: '4px',
            padding: is58mm ? '12px 10px 14px 10px' : '14px 14px 16px 14px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
            background: '#FFFFFF',
            color: '#000000',
            width: is58mm ? '280px' : '350px',
            maxWidth: '100%',
            boxSizing: 'border-box'
          }}
        >
          {/* Store Header */}
          <div style={{ textAlign: 'center', marginBottom: '4px' }}>
            <div style={{ fontWeight: 800, fontSize: is58mm ? '12px' : '14px', lineHeight: 1.2 }}>{store.name}</div>
            <div style={{ fontSize: '8.5px', color: '#333', marginTop: '2px' }}>{store.address}</div>
            <div style={{ fontSize: '8.5px', color: '#333' }}>Tel: {store.phone}</div>
            <div style={{ fontSize: '8.5px', fontWeight: 600, marginTop: '1px' }}>
              TAX REG / NTN: {store.taxIdentifier}
            </div>
          </div>

          <div className="thermal-dashed" style={{ margin: '4px 0' }} />

          {/* Invoice Meta */}
          <div style={{ fontSize: '9px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Invoice: #{invoice.invoiceNumber}</span>
            <span>{new Date(invoice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style={{ fontSize: '8.5px', color: '#444' }}>
            Date: {new Date(invoice.createdAt).toLocaleDateString()} | Cashier: Sarah J.
          </div>

          {/* Clinical Hospital Block if Pharmacy */}
          {store.isPharmacy && (invoice.patientId || invoice.doctorLicense) && (
            <div style={{
              border: '1px solid #000',
              padding: '3px 4px',
              margin: '4px 0',
              fontSize: '8px',
              background: '#FAFAFA'
            }}>
              <div style={{ fontWeight: 700 }}>CLINICAL PRESCRIPTION DATA:</div>
              {invoice.patientName && <div>Patient: {invoice.patientName} (MRN: {invoice.patientId})</div>}
              {invoice.doctorLicense && <div>Physician: {invoice.doctorLicense}</div>}
              {invoice.prescriptionNumber && <div>Rx #: {invoice.prescriptionNumber}</div>}
            </div>
          )}

          <div className="thermal-dashed" style={{ margin: '4px 0' }} />

          {/* Line Items Table with Dedicated Column Widths & Spacing */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: is58mm ? '8.5px' : '9.5px', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #000' }}>
                <th style={{ textAlign: 'left', paddingBottom: '3px', width: '42%' }}>ITEM / BATCH</th>
                <th style={{ textAlign: 'center', paddingBottom: '3px', width: '11%' }}>QTY</th>
                <th style={{ textAlign: 'right', paddingBottom: '3px', width: '23%', paddingRight: '8px' }}>PRICE</th>
                <th style={{ textAlign: 'right', paddingBottom: '3px', width: '24%' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #CCC' }}>
                  <td style={{ padding: '3px 4px 3px 0', wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{item.productName}</div>
                    <div style={{ fontSize: '7.5px', color: '#555', marginTop: '1px' }}>
                      Lot: {item.batchNumber} | Exp: {item.expiryDate}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', padding: '3px 0', verticalAlign: 'top' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right', padding: '3px 8px 3px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {formatCurrency(item.unitPrice)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, padding: '3px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {formatCurrency(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="thermal-dashed" style={{ margin: '4px 0' }} />

          {/* Totals Summary */}
          <div style={{ fontSize: is58mm ? '9px' : '10px', lineHeight: 1.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal:</span>
              <span>{formatCurrency(invoice.subtotal)}</span>
            </div>
            {invoice.discountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#C00' }}>
                <span>Discount:</span>
                <span>-{formatCurrency(invoice.discountAmount)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Tax / VAT:</span>
              <span>{formatCurrency(invoice.taxAmount)}</span>
            </div>
            <div className="thermal-dashed" style={{ margin: '3px 0' }} />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 800,
              fontSize: is58mm ? '11.5px' : '13px',
              margin: '2px 0'
            }}>
              <span>GRAND TOTAL:</span>
              <span>{formatCurrency(invoice.grandTotal)}</span>
            </div>
            <div className="thermal-dashed" style={{ margin: '3px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5px' }}>
              <span>Payment ({invoice.paymentMethod}):</span>
              <span>{formatCurrency(invoice.tenderedAmount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5px', fontWeight: 600 }}>
              <span>Change Due:</span>
              <span>{formatCurrency(invoice.changeDue)}</span>
            </div>
          </div>

          <div className="thermal-dashed" style={{ margin: '4px 0' }} />

          {/* Footer Barcode */}
          <div style={{ textAlign: 'center', margin: '4px 0 2px 0' }}>
            <BarcodeSvg value={invoice.invoiceNumber.replace(/[^0-9]/g, '').slice(-12) || '890100000001'} width={is58mm ? 140 : 180} height={32} />
            <div style={{ fontSize: '7.5px', color: '#555', marginTop: '2px' }}>
              Thank you for your visit! Goods once sold are returnable within 7 days.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
