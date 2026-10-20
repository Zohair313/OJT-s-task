import { dbStore, isPgConnected, pgPool } from '../db/database.js';
import type { Invoice, PaymentMethod } from '../types/index.js';

/**
 * Invoice lookup service — single source of truth for resolving invoices
 * from scanned or typed codes.
 *
 * Three operations:
 *  - searchInvoices(q)   → list of matching invoice summaries (slip number,
 *                          >=4-digit partial, cashier id, patient/doctor name)
 *  - findInvoiceById(id) → exact invoice by primary key (list click-through)
 *  - findInvoiceByCode() → fuzzy single resolution (scanner / manual entry):
 *                          exact id, exact number, or >=8-digit partial
 *
 * Cache first (hot path), then PostgreSQL with a full hydrate (items,
 * payment, patient/doctor names). Successful PG reads hydrate the cache.
 */

export interface InvoiceSearchSummary {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  tenantId: string;
  tenantName?: string;
  cashierId: string;
  patientName?: string;
  status: string;
  paymentMethod?: string;
  grandTotal: number;
  itemLines: number;
  totalUnits: number;
}

/** Shared PG hydrate: run `whereSql` against invoices (+ clinical joins),
 *  then attach items + payment. Returns null when nothing matches. */
async function loadInvoiceFromPg(whereSql: string, params: unknown[]): Promise<Invoice | null> {
  const invRes = await pgPool.query(
    `SELECT i.*, p.full_name AS patient_name, d.full_name AS doctor_name
     FROM invoices i
     LEFT JOIN patients p ON p.id = i.patient_id
     LEFT JOIN doctors d ON d.id = i.doctor_id
     WHERE ${whereSql}
     ORDER BY i.created_at DESC LIMIT 1`,
    params
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
    paymentMethod: (pay?.payment_method as PaymentMethod) || 'CASH',
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

  dbStore.invoices.set(invoice.id, invoice);
  return invoice;
}

/** Exact invoice by primary key (used by admin list click-through). */
export async function findInvoiceById(rawId: string): Promise<Invoice | null> {
  const id = (rawId || '').trim();
  if (!id) return null;
  const cached = dbStore.invoices.get(id);
  if (cached) return cached;
  if (!isPgConnected) return null;
  try {
    return await loadInvoiceFromPg('i.id = $1', [id]);
  } catch (err) {
    console.warn('Invoice lookup by id (PG) warning:', err);
    return null;
  }
}

/**
 * Fuzzy single-invoice resolution from a scanned/typed code:
 * exact id, exact invoice number (case-insensitive), or a >=8-digit
 * partial run contained in the invoice number's digits.
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
    const digitsParam = cleanDigits.length >= 8 ? cleanDigits : 'NONE';
    return await loadInvoiceFromPg(
      `i.id = $1
        OR LOWER(i.invoice_number) = LOWER($1)
        OR regexp_replace(i.invoice_number, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'`,
      [code, digitsParam]
    );
  } catch (err) {
    console.warn('Invoice lookup (PG) warning:', err);
    return null;
  }
}

/**
 * Search invoices by slip number / partial digits / cashier id /
 * patient or doctor name. Returns newest-first summaries (LIMIT 20)
 * so the admin sees EVERY matching slip, not just the latest one.
 */
export async function searchInvoices(rawQuery: string, limit = 20): Promise<InvoiceSearchSummary[]> {
  const q = (rawQuery || '').trim();
  if (!q) return [];
  const digits = q.replace(/[^0-9]/g, '');
  const qLike = `%${q.toLowerCase()}%`;

  if (isPgConnected) {
    try {
      const params: unknown[] = [q, qLike];
      let where = `(i.id = $1 OR LOWER(i.invoice_number) = LOWER($1)`;
      if (digits.length >= 4) {
        params.push(`%${digits}%`);
        where += ` OR regexp_replace(i.invoice_number, '[^0-9]', '', 'g') LIKE $${params.length}`;
      }
      params.push(limit);
      const limitParam = `$${params.length}`;
      where += ` OR LOWER(i.cashier_id) LIKE $2
            OR LOWER(COALESCE(p.full_name, '')) LIKE $2
            OR LOWER(COALESCE(d.full_name, '')) LIKE $2)`;

      const res = await pgPool.query(
        `SELECT i.id, i.invoice_number, i.created_at, i.grand_total, i.status,
                i.tenant_id, i.cashier_id,
                COALESCE(p.full_name, '') AS patient_name,
                COALESCE(t.name, '') AS tenant_name,
                COALESCE(pm.method, 'CASH') AS payment_method,
                COALESCE(il.item_lines, 0) AS item_lines,
                COALESCE(il.total_units, 0) AS total_units
         FROM invoices i
         LEFT JOIN patients p ON p.id = i.patient_id
         LEFT JOIN doctors d ON d.id = i.doctor_id
         LEFT JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN LATERAL (
           SELECT payment_method AS method FROM payments
           WHERE invoice_id = i.id ORDER BY created_at ASC LIMIT 1
         ) pm ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS item_lines, COALESCE(SUM(quantity), 0) AS total_units
           FROM invoice_items WHERE invoice_id = i.id
         ) il ON TRUE
         WHERE ${where}
         ORDER BY i.created_at DESC
         LIMIT ${limitParam}`,
        params
      );

      return res.rows.map((row: any) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        createdAt: row.created_at,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name || undefined,
        cashierId: row.cashier_id,
        patientName: row.patient_name || undefined,
        status: row.status,
        paymentMethod: row.payment_method,
        grandTotal: Number(row.grand_total),
        itemLines: parseInt(row.item_lines, 10) || 0,
        totalUnits: parseInt(row.total_units, 10) || 0
      }));
    } catch (err) {
      console.warn('Invoice search (PG) warning:', err);
      return [];
    }
  }

  // Cache-only fallback (no PG): same matching spirit, summaries only
  const ql = q.toLowerCase();
  return Array.from(dbStore.invoices.values())
    .filter(
      inv =>
        inv.id === q ||
        inv.invoiceNumber.toLowerCase() === ql ||
        (digits.length >= 4 && inv.invoiceNumber.replace(/[^0-9]/g, '').includes(digits)) ||
        inv.cashierId.toLowerCase().includes(ql) ||
        (inv.patientName || '').toLowerCase().includes(ql)
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      createdAt: inv.createdAt,
      tenantId: inv.tenantId,
      cashierId: inv.cashierId,
      patientName: inv.patientName,
      status: inv.status,
      paymentMethod: inv.paymentMethod as string,
      grandTotal: inv.grandTotal,
      itemLines: inv.items.length,
      totalUnits: inv.items.reduce((s, it) => s + it.quantity, 0)
    }));
}
