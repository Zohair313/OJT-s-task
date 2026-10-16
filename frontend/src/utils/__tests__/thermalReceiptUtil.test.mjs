import assert from 'node:assert';
import {
  formatCurrency,
  formatReceiptLine,
  truncateText,
  generateEscPosText
} from '../thermalReceiptUtil.ts';

console.log('--- 1. Testing formatCurrency ---');
assert.strictEqual(formatCurrency(12.5), '$12.50');
assert.strictEqual(formatCurrency(0), '$0.00');
assert.strictEqual(formatCurrency('19.99'), '$19.99');
assert.strictEqual(formatCurrency(null), '$0.00');
assert.strictEqual(formatCurrency(undefined), '$0.00');
assert.strictEqual(formatCurrency(NaN), '$0.00');
assert.strictEqual(formatCurrency(1234.56), '$1,234.56');
console.log('✅ formatCurrency tests passed!');

console.log('\n--- 2. Testing formatReceiptLine & truncateText ---');
assert.strictEqual(truncateText('Amoxicillin Trihydrate 500mg Extra Strength', 20), 'Amoxicillin Trihy...');
assert.strictEqual(truncateText('Short Text', 20), 'Short Text');

const line80 = formatReceiptLine('Subtotal:', '$150.00', 48);
assert.strictEqual(line80.length, 48);
assert.ok(line80.startsWith('Subtotal:'));
assert.ok(line80.endsWith('$150.00'));

const line58 = formatReceiptLine('GRAND TOTAL:', '$99.95', 32);
assert.strictEqual(line58.length, 32);
assert.ok(line58.startsWith('GRAND TOTAL:'));
assert.ok(line58.endsWith('$99.95'));
console.log('✅ formatReceiptLine & truncateText tests passed!');

console.log('\n--- 3. Testing generateEscPosText (80mm vs 58mm) ---');
const sampleInvoice = {
  invoiceNumber: 'INV-2026-9042',
  createdAt: '2026-10-16T10:00:00.000Z',
  cashierId: 'usr-cashier-01',
  patientId: 'MRN-884920',
  patientName: 'Jonathan Doe',
  doctorLicense: 'MD-LIC-44810',
  prescriptionNumber: 'RX-2026-9901',
  subtotal: 45.00,
  discountAmount: 5.00,
  taxAmount: 2.00,
  roundOff: 0.00,
  grandTotal: 42.00,
  paymentMethod: 'CASH',
  tenderedAmount: 50.00,
  changeDue: 8.00,
  items: [
    {
      id: 'item-1',
      productName: 'Paracetamol 500mg',
      batchNumber: 'LOT-992',
      expiryDate: '2027-05-01',
      quantity: 2,
      unitPrice: 15.00,
      taxAmount: 0.75,
      discountAmount: 0,
      lineTotal: 30.00
    },
    {
      id: 'item-2',
      productName: 'Vitamin C 1000mg',
      batchNumber: 'LOT-881',
      expiryDate: '2027-08-15',
      quantity: 1,
      unitPrice: 15.00,
      taxAmount: 0.75,
      discountAmount: 0,
      lineTotal: 15.00
    }
  ]
};

const pharmaStore = {
  name: 'St. Jude Memorial Hospital Pharmacy',
  taxIdentifier: 'TX-MED-44102',
  address: '500 Medical Center Blvd, Chicago, IL',
  phone: '+1-555-0244',
  isPharmacy: true
};

const retailStore = {
  name: 'Metro Supermarket Flagship',
  taxIdentifier: 'TX-RET-88210',
  address: '100 Broadway, New York, NY',
  phone: '+1-555-0199',
  isPharmacy: false
};

const escposPharma = generateEscPosText(sampleInvoice, pharmaStore, '58mm');
assert.ok(escposPharma.toUpperCase().includes('ST. JUDE MEMORIAL HOSPITAL'));
assert.ok(escposPharma.toUpperCase().includes('PHARMACY'));
assert.ok(escposPharma.includes('CLINICAL PRESCRIPTION DATA'));
assert.ok(escposPharma.includes('Jonathan Doe'));
assert.ok(escposPharma.includes('GRAND TOTAL:'));
assert.ok(escposPharma.includes('$42.00'));

const escposRetail = generateEscPosText(sampleInvoice, retailStore, '80mm');
assert.ok(escposRetail.toUpperCase().includes('METRO SUPERMARKET FLAGSHIP'));
assert.strictEqual(escposRetail.includes('CLINICAL PRESCRIPTION DATA:'), false); // Clinical hidden on retail
assert.ok(escposRetail.includes('GRAND TOTAL:'));
console.log('✅ generateEscPosText tests passed!');

console.log('\n🎉 ALL thermalReceiptUtil unit tests passed 100%!');
