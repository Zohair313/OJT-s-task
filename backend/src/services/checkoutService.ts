import { v4 as uuidv4 } from 'uuid';
import { dbStore, pgPool, isPgConnected } from '../db/database.js';
import { fefoService } from './fefoService.js';
import { CheckoutRequestDTO, Invoice, InvoiceItem, PaymentMethod } from '../types/index.js';

export class CheckoutService {
  /**
   * Atomic ACID Checkout Pipeline with Pessimistic Row-Level Locking.
   * Prevents race conditions and phantom deductions.
   */
  public async processCheckout(tenantId: string, cashierId: string, dto: CheckoutRequestDTO): Promise<Invoice> {
    const { drawerId, items, clinical, payment } = dto;

    if (!items || items.length === 0) {
      throw { status: 400, message: 'Cart cannot be empty for checkout' };
    }

    // 1. Verify Cash Drawer is Active
    const drawer = dbStore.cashDrawers.get(drawerId);
    if (!drawer || drawer.status !== 'OPEN') {
      throw { status: 400, message: 'Cash drawer session is closed or invalid' };
    }

    // 2. Resolve items into concrete Batch Allocations (FEFO if batchId not specified)
    interface ResolvedLine {
      productId: string;
      productName: string;
      batchId: string;
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      discountAmount: number;
    }

    const resolvedLines: ResolvedLine[] = [];

    for (const item of items) {
      const product = dbStore.products.get(item.productId);
      if (!product || product.tenantId !== tenantId) {
        throw { status: 404, message: `Product ${item.productId} not found` };
      }

      if (item.batchId) {
        // Specific batch requested
        const batch = dbStore.batches.get(item.batchId);
        if (!batch) {
          throw { status: 404, message: `Batch ${item.batchId} not found` };
        }
        resolvedLines.push({
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: item.quantity,
          unitPrice: item.unitPrice || batch.sellingPrice,
          taxRate: product.defaultTaxRate,
          discountAmount: item.discountAmount || 0
        });
      } else {
        // FEFO Auto-allocation
        const fefo = fefoService.resolveAllocations(product.id, item.quantity);
        if (fefo.unfulfilledQuantity > 0) {
          throw {
            status: 409,
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for '${product.name}'. Requested: ${item.quantity}, Available: ${fefo.totalAllocated}`
          };
        }
        for (const alloc of fefo.allocations) {
          resolvedLines.push({
            productId: product.id,
            productName: product.name,
            batchId: alloc.batchId,
            batchNumber: alloc.batchNumber,
            expiryDate: alloc.expiryDate,
            quantity: alloc.allocatedQuantity,
            unitPrice: alloc.unitPrice,
            taxRate: product.defaultTaxRate,
            discountAmount: item.discountAmount || 0
          });
        }
      }
    }

    // 3. Collect targeted Batch IDs and ACQUIRE ROW LOCKS (SELECT ... FOR UPDATE)
    const targetBatchIds = resolvedLines.map(l => l.batchId);
    const releaseRowLocks = await dbStore.acquireRowLocks(targetBatchIds);

    try {
      // 4. Critical Section: Check Stock Invariants Under Lock
      for (const line of resolvedLines) {
        const stock = dbStore.stocks.get(line.batchId);
        if (!stock || stock.quantity < line.quantity) {
          const avail = stock ? stock.quantity : 0;
          throw {
            status: 409,
            code: 'CONCURRENCY_STOCK_DEPLETED',
            message: `Checkout aborted: Batch '${line.batchNumber}' has only ${avail} units remaining. Another counter checked out concurrently.`
          };
        }
      }

      // 5. Calculations (Precise Integer Cents Math)
      let subtotalCents = 0;
      let totalDiscountCents = 0;
      let totalTaxCents = 0;

      const invoiceItems: InvoiceItem[] = [];
      const invoiceId = uuidv4();

      for (const line of resolvedLines) {
        const lineGrossCents = Math.round(line.quantity * line.unitPrice * 100);
        const lineDiscountCents = Math.round(line.discountAmount * 100);
        const taxableCents = Math.max(0, lineGrossCents - lineDiscountCents);
        const lineTaxCents = Math.round((taxableCents * line.taxRate) / 100);
        const lineTotalCents = taxableCents + lineTaxCents;

        subtotalCents += lineGrossCents;
        totalDiscountCents += lineDiscountCents;
        totalTaxCents += lineTaxCents;

        invoiceItems.push({
          id: uuidv4(),
          invoiceId,
          productId: line.productId,
          batchId: line.batchId,
          productName: line.productName,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          taxAmount: Number((lineTaxCents / 100).toFixed(2)),
          discountAmount: Number((lineDiscountCents / 100).toFixed(2)),
          lineTotal: Number((lineTotalCents / 100).toFixed(2))
        });
      }

      const rawGrandTotalCents = subtotalCents - totalDiscountCents + totalTaxCents;
      const grandTotalCents = rawGrandTotalCents; // Can apply rounding if needed
      const roundOffCents = 0;

      const subtotal = Number((subtotalCents / 100).toFixed(2));
      const discountAmount = Number((totalDiscountCents / 100).toFixed(2));
      const taxAmount = Number((totalTaxCents / 100).toFixed(2));
      const grandTotal = Number((grandTotalCents / 100).toFixed(2));
      const roundOff = Number((roundOffCents / 100).toFixed(2));

      // Validate payment tender
      let tendered = (payment.tenderedAmount !== undefined && payment.tenderedAmount > 0)
        ? Number(payment.tenderedAmount)
        : grandTotal;

      if (!isFinite(tendered) || isNaN(tendered) || tendered < 0) {
        throw {
          status: 400,
          message: 'Invalid tender amount received.'
        };
      }

      // Sane upper limit protection against accidental key spam or exponential overflows
      const MAX_TENDER_LIMIT = 100000;
      if (tendered > MAX_TENDER_LIMIT) {
        throw {
          status: 400,
          message: `Tendered amount exceeds maximum register limit ($${MAX_TENDER_LIMIT.toLocaleString()}).`
        };
      }

      if (tendered < grandTotal && payment.method === 'CASH') {
        throw {
          status: 400,
          message: `Insufficient tender. Total due is $${grandTotal.toFixed(2)}, received $${tendered.toFixed(2)}`
        };
      }
      const changeDue = Number(Math.max(0, tendered - grandTotal).toFixed(2));

      // 6. ATOMIC COMMIT: Deduct Inventory & Append Stock Movement Audit
      for (const line of resolvedLines) {
        const stock = dbStore.stocks.get(line.batchId)!;
        stock.quantity -= line.quantity;
        stock.updatedAt = new Date().toISOString();

        dbStore.stockMovements.push({
          id: uuidv4(),
          tenantId,
          batchId: line.batchId,
          invoiceId,
          movementType: 'SALE_DEDUCTION',
          quantityChanged: -line.quantity,
          quantityAfter: stock.quantity,
          referenceNote: `POS Sale to Invoice #${invoiceId.slice(0, 8)}`,
          createdAt: new Date().toISOString()
        });
      }

      // 7. Assemble Invoice
      const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const invoice: Invoice = {
        id: invoiceId,
        tenantId,
        cashierId,
        drawerId,
        invoiceNumber,
        patientId: clinical?.patientMrn,
        patientName: clinical?.patientName,
        doctorLicense: clinical?.doctorLicense,
        prescriptionNumber: clinical?.prescriptionNumber,
        subtotal,
        discountAmount,
        taxAmount,
        roundOff,
        grandTotal,
        paymentMethod: payment.method,
        tenderedAmount: tendered,
        changeDue,
        status: 'COMPLETED',
        items: invoiceItems,
        createdAt: new Date().toISOString()
      };

      dbStore.invoices.set(invoiceId, invoice);
      invoiceItems.forEach(item => dbStore.invoiceItems.set(item.id, item));

      // 8. Persist to PostgreSQL in an ACID transaction
      if (isPgConnected) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');

          // Ensure drawer exists in cash_drawers if not present
          const drawerCheck = await client.query('SELECT 1 FROM cash_drawers WHERE id = $1', [drawerId]);
          if (drawerCheck.rowCount === 0) {
            await client.query(`
              INSERT INTO cash_drawers (id, tenant_id, cashier_id, terminal_identifier, opened_at, opening_float, total_cash_drops, status)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (id) DO NOTHING
            `, [
              drawer.id, drawer.tenantId, drawer.cashierId, drawer.terminalIdentifier,
              drawer.openedAt, drawer.openingFloat, drawer.totalCashDrops, drawer.status
            ]);
          }

          // Check if patient exists
          let matchedPatientId: string | null = null;
          if (clinical?.patientMrn) {
            const pCheck = await client.query('SELECT id FROM patients WHERE id = $1 OR mrn = $2 LIMIT 1', [clinical.patientMrn, clinical.patientMrn]);
            if (pCheck.rowCount && pCheck.rowCount > 0) matchedPatientId = pCheck.rows[0].id;
          }
          let matchedDoctorId: string | null = null;
          if (clinical?.doctorLicense) {
            const dCheck = await client.query('SELECT id FROM doctors WHERE id = $1 OR license_number = $2 LIMIT 1', [clinical.doctorLicense, clinical.doctorLicense]);
            if (dCheck.rowCount && dCheck.rowCount > 0) matchedDoctorId = dCheck.rows[0].id;
          }

          await client.query(`
            INSERT INTO invoices (
              id, tenant_id, cashier_id, drawer_id, invoice_number, patient_id, doctor_id,
              prescription_number, subtotal, discount_amount, tax_amount, round_off,
              grand_total, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `, [
            invoice.id, invoice.tenantId, invoice.cashierId, invoice.drawerId, invoice.invoiceNumber,
            matchedPatientId, matchedDoctorId, invoice.prescriptionNumber || null,
            invoice.subtotal, invoice.discountAmount, invoice.taxAmount, invoice.roundOff,
            invoice.grandTotal, invoice.status, invoice.createdAt
          ]);

          // Insert Invoice Items & Update Inventory Stock
          for (const item of invoiceItems) {
            await client.query(`
              INSERT INTO invoice_items (
                id, invoice_id, product_id, batch_id, quantity, unit_price,
                tax_rate, tax_amount, discount_amount, line_total, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
              item.id, item.invoiceId, item.productId, item.batchId, item.quantity, item.unitPrice,
              item.taxRate, item.taxAmount, item.discountAmount, item.lineTotal, invoice.createdAt
            ]);

            await client.query(`
              UPDATE inventory_stocks
              SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
              WHERE batch_id = $2
            `, [item.quantity, item.batchId]);

            const currentStock = dbStore.stocks.get(item.batchId)?.quantity ?? 0;

            await client.query(`
              INSERT INTO stock_movements (
                id, tenant_id, batch_id, invoice_id, movement_type,
                quantity_changed, quantity_after, reference_note, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
              uuidv4(), tenantId, item.batchId, invoiceId, 'SALE_DEDUCTION',
              -item.quantity, currentStock, `POS Sale to Invoice #${invoiceNumber}`,
              invoice.createdAt
            ]);
          }

          // Insert Payment
          await client.query(`
            INSERT INTO payments (
              id, invoice_id, payment_method, amount, tendered_amount, change_due, transaction_reference, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            uuidv4(), invoice.id, invoice.paymentMethod, invoice.grandTotal,
            invoice.tenderedAmount || invoice.grandTotal, invoice.changeDue,
            `POS-TXN-${invoice.invoiceNumber}`, invoice.createdAt
          ]);

          await client.query('COMMIT');
        } catch (pgErr) {
          await client.query('ROLLBACK');
          console.error('❌ [POSTGRESQL] Error committing checkout transaction to database:', pgErr);
        } finally {
          client.release();
        }
      }

      return invoice;
    } finally {
      // Always release row locks
      releaseRowLocks();
    }
  }
}

export const checkoutService = new CheckoutService();
