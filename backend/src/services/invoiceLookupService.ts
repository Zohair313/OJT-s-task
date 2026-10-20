import { dbStore, isPgConnected, pgPool } from '../db/database.js';
import type { Invoice } from '../types/index.js';

/**
 * Invoice lookup service — single source of truth for resolving a full
 * invoice (header + items + payment + clinical names) from a scanned or
 * typed code.
 *
 * Accepted code forms:
 *  - exact invoice id (e.g. "inv-...")
 *  - exact invoice number, case-insensitive (e.g. "INV-20261020-1720")
 *  - partial numeric match: any run of >= 8 digits contained in the
 *    invoice number's digits (so "202610201720" or "1720" pasted with
 *    the date works — bare "1720" alone is too short to avoid false hits)
 *
 * Flow: cache first (fast path for hot invoices), then PostgreSQL with
 * a full hydrate (items, payment, patient/doctor names). Successful PG
 * reads are written back into the cache so the next scan is O(1).
 */
export async function findInvoiceByCode(rawCode: string): Promise<Invoice | null> {
  const code = (rawCode || '').trim();
  if (!code) return null;
  const cleanDigits = code.replace(/[^0-9]/g, '');

  // 1. Cache path
  const cached = Array.from(dbStore.invoices.values()).find(
    inv =>
      inv.id === code ||
      inv.invoiceNumber.toLowerCase() === code.toLowerCase() ||
      (cleanDigits.length >= 8 && inv.invoiceNumber.replace(/[^0-9]/g, '').includes(cleanDigits))
  );
  if (cached) return cached;

  if (!isPgConnected) return null;

  // 2. PostgreSQL path (cross-tenant: admins may look up any branch's slip)
  try {
    const invRes = await pgPool.query(
      `SELECT i.*, p.full_name AS patient_name, d.full_name AS doctor_name
       FROM invoices i
       LEFT JOIN patients p ON p.id = i.patient_id
       LEFT JOIN doctors d ON d.id = i.doctor_id
       WHERE i.id = $1
          OR LOWER(i.invoice_number) = LOWER($1)
          OR regexp_replace(i.invoice_number, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'
       ORDER BY i.created_at DESC LIMIT 1`,
      [code, cleanDigits.length >= 8 ? cleanDigits : 'NONE']
    );
    if (invRes.rows.length === 0) return null;
    const row = invRes.rows[0];

    const [itemsRes, payRes] = await Promise.all([
      pgPool.query(
        `SELECT ii.*, p.name AS product_name, b.batch_number, b.expiry_date
         FROM invoice_items ii
         LEFT JOIN products p ON ii.product_id = p.id
         LEFT JOIN batches b ON ii.batch_id = b.id
         WHERE ii.invoice_id = $1
         ORDER BY ii.created_at ASC`,
        [row.id]
      ),
      pgPool.query(
        `SELECT payment_method, tendered_amount, change_due, transaction_reference
         FROM payments
         WHERE invoice_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [row.id]
      )
    ]);

    const pay = payRes.rows[0];

    const invoice: Invoice = {
      id: row.id,
      tenantId: row.tenant_id,
      cashierId: row.cashier_id,
      drawerId: row.drawer_id,
      invoiceNumber: row.invoice_number,
      patientId: row.patient_id || undefined,
      patientName: row.patient_name || undefined,
      doctorLicense: row.doctor_id || undefined,
      doctorName: row.doctor_name || undefined,
      prescriptionNumber: row.prescription_number || undefined,
      subtotal: Number(row.subtotal),
      discountAmount: Number(row.discount_amount),
      taxAmount: Number(row.tax_amount),
      roundOff: Number(row.round_off),
      grandTotal: Number(row.grand_total),
      paymentMethod: (pay?.payment_method as Invoice['paymentMethod']) || 'CASH',
      tenderedAmount: pay ? Number(pay.tendered_amount) : Number(row.grand_total),
      changeDue: pay ? Number(pay.change_due) : 0,
      paymentReference: pay?.transaction_reference || undefined,
      status: row.status,
      items: itemsRes.rows.map((it: any) => ({
        id: it.id,
        invoiceId: it.invoice_id,
        productId: it.product_id,
        productName: it.product_name || 'Item',
        batchId: it.batch_id,
        batchNumber: it.batch_number || 'N/A',
        expiryDate: it.expiry_date || 'N/A',
        quantity: it.quantity,
        unitPrice: Number(it.unit_price),
        taxRate: Number(it.tax_rate),
        taxAmount: Number(it.tax_amount),
        discountAmount: Number(it.discount_amount),
        lineTotal: Number(it.line_total)
      })),
      createdAt: row.created_at
    };

    // Hydrate cache so subsequent scans are instant
    dbStore.invoices.set(invoice.id, invoice);
    return invoice;
  } catch (err) {
    console.warn('Invoice lookup (PG) warning:', err);
    return null;
  }
}
