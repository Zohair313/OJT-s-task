import React from 'react';
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
  const is58mm = format === '58mm';

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
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '440px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🖨️</span>
            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>
              Thermal Receipt Preview ({format.toUpperCase()})
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: '#94A3B8', fontSize: '18px', padding: '4px' }}
          >
            ✕
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={handlePrint}
            style={{
              flex: 1,
              background: 'var(--color-primary)',
              color: '#FFF',
              padding: '10px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>🖨️</span> PRINT RECEIPT (window.print)
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'var(--color-surface-elevated)',
              color: '#F8FAFC',
              padding: '10px 16px',
              borderRadius: 'var(--radius-md)'
            }}
          >
            Close
          </button>
        </div>

        {/* Printable Thermal Container */}
        <div
          id="printable-thermal-receipt"
          className={`thermal-paper ${is58mm ? 'thermal-paper-58mm' : 'thermal-paper-80mm'}`}
          style={{ margin: '0 auto', borderRadius: '4px' }}
        >
          {/* Store Header */}
          <div style={{ textAlign: 'center', marginBottom: '6px' }}>
            <div style={{ fontWeight: 800, fontSize: is58mm ? '13px' : '15px' }}>{store.name}</div>
            <div style={{ fontSize: '9px', color: '#333' }}>{store.address}</div>
            <div style={{ fontSize: '9px', color: '#333' }}>Tel: {store.phone}</div>
            <div style={{ fontSize: '9px', fontWeight: 600, marginTop: '2px' }}>
              TAX REG / NTN: {store.taxIdentifier}
            </div>
          </div>

          <div className="thermal-dashed" />

          {/* Invoice Meta */}
          <div style={{ fontSize: '9.5px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Invoice: #{invoice.invoiceNumber}</span>
            <span>{new Date(invoice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style={{ fontSize: '9px', color: '#444' }}>
            Date: {new Date(invoice.createdAt).toLocaleDateString()} | Cashier: Sarah J.
          </div>

          {/* Clinical Hospital Block if Pharmacy */}
          {store.isPharmacy && (invoice.patientId || invoice.doctorLicense) && (
            <div style={{
              border: '1px solid #000',
              padding: '4px',
              margin: '6px 0',
              fontSize: '8.5px',
              background: '#FAFAFA'
            }}>
              <div style={{ fontWeight: 700 }}>CLINICAL PRESCRIPTION DATA:</div>
              {invoice.patientName && <div>Patient: {invoice.patientName} (MRN: {invoice.patientId})</div>}
              {invoice.doctorLicense && <div>Physician: {invoice.doctorLicense}</div>}
              {invoice.prescriptionNumber && <div>Rx #: {invoice.prescriptionNumber}</div>}
            </div>
          )}

          <div className="thermal-dashed" />

          {/* Line Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: is58mm ? '9px' : '10.5px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #000' }}>
                <th style={{ textAlign: 'left', paddingBottom: '2px' }}>ITEM / BATCH</th>
                <th style={{ textAlign: 'center', paddingBottom: '2px' }}>QTY</th>
                <th style={{ textAlign: 'right', paddingBottom: '2px' }}>PRICE</th>
                <th style={{ textAlign: 'right', paddingBottom: '2px' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #CCC' }}>
                  <td style={{ padding: '3px 0' }}>
                    <div style={{ fontWeight: 600 }}>{item.productName}</div>
                    <div style={{ fontSize: '8px', color: '#555' }}>
                      Lot: {item.batchNumber} | Exp: {item.expiryDate}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', padding: '3px 0' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0' }}>{formatCurrency(item.unitPrice)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, padding: '3px 0' }}>
                    {formatCurrency(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="thermal-dashed" />

          {/* Totals Summary */}
          <div style={{ fontSize: is58mm ? '9.5px' : '10.5px', lineHeight: 1.4 }}>
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
            <div className="thermal-dashed" />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 800,
              fontSize: is58mm ? '12px' : '14px',
              margin: '4px 0'
            }}>
              <span>GRAND TOTAL:</span>
              <span>{formatCurrency(invoice.grandTotal)}</span>
            </div>
            <div className="thermal-dashed" />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
              <span>Payment ({invoice.paymentMethod}):</span>
              <span>{formatCurrency(invoice.tenderedAmount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 600 }}>
              <span>Change Due:</span>
              <span>{formatCurrency(invoice.changeDue)}</span>
            </div>
          </div>

          <div className="thermal-dashed" />

          {/* Footer Barcode Representation */}
          <div style={{ textAlign: 'center', margin: '8px 0 4px 0' }}>
            <BarcodeSvg value={invoice.invoiceNumber.replace(/[^0-9]/g, '').slice(-12) || '890100000001'} width={is58mm ? 160 : 200} height={38} />
            <div style={{ fontSize: '8px', color: '#555', marginTop: '4px' }}>
              Thank you for your visit! Goods once sold are returnable within 7 days.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
