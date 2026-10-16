/**
 * Thermal Receipt Utility & ESC/POS Generator
 * Provides formatting, line alignment, column wrapping, and raw text generation
 * for 80mm (48 columns) and 58mm (32 columns) thermal receipt printers.
 */

export interface ReceiptItem {
  id: string;
  productName: string;
  batchNumber?: string;
  expiryDate?: string;
  quantity: number;
  unitPrice: number;
  taxAmount?: number;
  discountAmount?: number;
  lineTotal: number;
}

export interface ReceiptInvoice {
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
  roundOff?: number;
  grandTotal: number;
  paymentMethod: string;
  tenderedAmount: number;
  changeDue: number;
  items: ReceiptItem[];
}

export interface ReceiptStore {
  name: string;
  taxIdentifier: string;
  address: string;
  phone: string;
  isPharmacy: boolean;
}

/**
 * Format any currency number or string safely to $X.XX with commas
 */
export function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null) return '$0.00';
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(num) || !isFinite(num)) return '$0.00';
  const bounded = Math.abs(num) > 10000000 ? 10000000 : num;
  return '$' + bounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Truncate text with ellipsis if it exceeds maxLength
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format a two-column line (left text and right text) padded to exact maxChars
 */
export function formatReceiptLine(left: string, right: string, maxChars: number = 48): string {
  const leftLen = left.length;
  const rightLen = right.length;
  if (leftLen + rightLen >= maxChars) {
    const allowedLeft = Math.max(1, maxChars - rightLen - 1);
    const truncatedLeft = truncateText(left, allowedLeft);
    const spacePadding = Math.max(1, maxChars - truncatedLeft.length - rightLen);
    return truncatedLeft + ' '.repeat(spacePadding) + right;
  }
  const spacePadding = maxChars - leftLen - rightLen;
  return left + ' '.repeat(spacePadding) + right;
}

/**
 * Center a single line of text within maxChars
 */
export function centerText(text: string, maxChars: number = 48): string {
  if (!text) return '';
  if (text.length <= maxChars) {
    const totalSpaces = maxChars - text.length;
    const leftSpaces = Math.floor(totalSpaces / 2);
    const rightSpaces = totalSpaces - leftSpaces;
    return ' '.repeat(leftSpaces) + text + ' '.repeat(rightSpaces);
  }
  // Wrap into multiple centered lines
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(centerText(current, maxChars));
      current = word;
    }
  }
  if (current) lines.push(centerText(current, maxChars));
  return lines.join('\n');
}

/**
 * Generate raw monospace ESC/POS formatted receipt text
 */
export function generateEscPosText(
  invoice: ReceiptInvoice,
  store: ReceiptStore,
  format: '80mm' | '58mm' = '80mm'
): string {
  const maxCols = format === '58mm' ? 32 : 48;
  const divider = '-'.repeat(maxCols);
  const dblDivider = '='.repeat(maxCols);
  const lines: string[] = [];

  // 1. Store Header
  lines.push(centerText(store.name.toUpperCase(), maxCols));
  lines.push(centerText(store.address, maxCols));
  lines.push(centerText(`Tel: ${store.phone}`, maxCols));
  lines.push(centerText(`TAX/NTN: ${store.taxIdentifier}`, maxCols));
  lines.push(divider);

  // 2. Invoice Meta
  const dateStr = new Date(invoice.createdAt).toLocaleDateString();
  const timeStr = new Date(invoice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  lines.push(formatReceiptLine(`INVOICE: #${invoice.invoiceNumber}`, timeStr, maxCols));
  lines.push(formatReceiptLine(`DATE: ${dateStr}`, `CASHIER: ${invoice.cashierId || 'REG-01'}`, maxCols));

  // 3. Clinical Data (Only for Pharmacy)
  if (store.isPharmacy && (invoice.patientId || invoice.doctorLicense || invoice.prescriptionNumber)) {
    lines.push(divider);
    lines.push(centerText('*** CLINICAL PRESCRIPTION DATA ***', maxCols));
    if (invoice.patientName) {
      lines.push(truncateText(`Patient: ${invoice.patientName} (MRN: ${invoice.patientId || 'N/A'})`, maxCols));
    }
    if (invoice.doctorLicense) {
      lines.push(truncateText(`Doctor License: ${invoice.doctorLicense}`, maxCols));
    }
    if (invoice.prescriptionNumber) {
      lines.push(truncateText(`Rx Number: ${invoice.prescriptionNumber}`, maxCols));
    }
  }

  lines.push(divider);

  // 4. Line Items Table Header
  if (format === '58mm') {
    lines.push('ITEM               QTY    TOTAL');
  } else {
    lines.push('ITEM / BATCH DESCRIPTION    QTY   PRICE    TOTAL');
  }
  lines.push(divider);

  // 5. Line Items Rows
  for (const item of invoice.items) {
    const itemTotalStr = formatCurrency(item.lineTotal);
    const itemPriceStr = formatCurrency(item.unitPrice);
    const qtyStr = String(item.quantity);

    if (format === '58mm') {
      // 32-col format
      lines.push(truncateText(item.productName, maxCols));
      if (item.batchNumber) {
        lines.push(truncateText(` Lot: ${item.batchNumber} Exp: ${item.expiryDate || 'N/A'}`, maxCols));
      }
      lines.push(formatReceiptLine(`  ${qtyStr} x ${itemPriceStr}`, itemTotalStr, maxCols));
    } else {
      // 48-col format
      const leftPart = truncateText(item.productName, 26);
      const rightPart = `${qtyStr.padStart(3)} ${itemPriceStr.padStart(8)} ${itemTotalStr.padStart(8)}`;
      lines.push(formatReceiptLine(leftPart, rightPart, maxCols));
      if (item.batchNumber) {
        lines.push(truncateText(`  Lot: ${item.batchNumber} | Exp: ${item.expiryDate || 'N/A'}`, maxCols));
      }
    }
  }

  lines.push(divider);

  // 6. Totals & Payment Summary
  lines.push(formatReceiptLine('SUBTOTAL:', formatCurrency(invoice.subtotal), maxCols));
  if (invoice.discountAmount > 0) {
    lines.push(formatReceiptLine('DISCOUNT:', `-${formatCurrency(invoice.discountAmount)}`, maxCols));
  }
  lines.push(formatReceiptLine('TAX / VAT:', formatCurrency(invoice.taxAmount), maxCols));
  lines.push(dblDivider);
  lines.push(formatReceiptLine('GRAND TOTAL:', formatCurrency(invoice.grandTotal), maxCols));
  lines.push(dblDivider);
  lines.push(formatReceiptLine(`PAYMENT (${invoice.paymentMethod}):`, formatCurrency(invoice.tenderedAmount), maxCols));
  lines.push(formatReceiptLine('CHANGE DUE:', formatCurrency(invoice.changeDue), maxCols));
  lines.push(divider);

  // 7. Footer Barcode & Thank You
  lines.push(centerText(`BARCODE: *${invoice.invoiceNumber.replace(/[^0-9]/g, '').slice(-12) || '890100000001'}*`, maxCols));
  lines.push(centerText('Thank you for your visit!', maxCols));
  lines.push(centerText('Exchange / Returns within 7 days', maxCols));

  return lines.join('\n');
}
