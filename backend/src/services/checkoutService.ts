import { v4 as uuidv4 } from 'uuid';
import { dbStore, pgPool, isPgConnected } from '../db/database.js';
import { fefoService } from './fefoService.js';
import { reconciliationService } from './reconciliationService.js';
import { CheckoutRequestDTO, Invoice, InvoiceItem, PaymentMethod } from '../types/index.js';

/**
 * Sync in-memory cache stocks with locked DB quantities.
 * Used when the DB-level FOR UPDATE check finds stock the cache believed was
 * available (stale cache from another process/instance). Keeps the cache
 * truthful without requiring a server restart.
 */
function syncCacheFromLockedQty(lockedQty: Map<string, number>): void {
  for (const [batchId, dbQty] of lockedQty) {
    const cached = dbStore.stocks.get(batchId);
    if (cached && cached.quantity !== dbQty) {
      console.warn(`⚠️  [CACHE-SYNC] Batch '${batchId}' cache=${cached.quantity} but DB=${dbQty}. Syncing.`);
      cached.quantity = dbQty;
      cached.updatedAt = new Date().toISOString();
    }
  }
}

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

    // 0. Strict line-item validation (guards against negative-quantity stock inflation)
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw {
          status: 400,
          code: 'INVALID_QUANTITY',
          message: `Invalid quantity '${item.quantity}' for product '${item.productId}'. Quantity must be a positive whole number.`
        };
      }
      if (item.discountAmount !== undefined && (!isFinite(item.discountAmount) || item.discountAmount < 0)) {
        throw { status: 400, message: `Invalid discount amount for product '${item.productId}'.` };
      }
      if (item.unitPrice !== undefined && (!isFinite(item.unitPrice) || item.unitPrice < 0)) {
        throw { status: 400, message: `Invalid unit price for product '${item.productId}'.` };
      }
    }

    // 1. Verify Cash Drawer is Active with automatic self-healing fallback
    let drawer = drawerId ? dbStore.cashDrawers.get(drawerId) : undefined;
    if (!drawer || drawer.status !== 'OPEN') {
      const activeOpen = Array.from(dbStore.cashDrawers.values()).find(
        d => d.tenantId === tenantId && d.status === 'OPEN'
      );
      if (activeOpen) {
        drawer = activeOpen;
      } else {
        drawer = reconciliationService.openDrawerSession(tenantId, cashierId, 'POS-COUNTER-01', 150.00);
      }
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
      let product = dbStore.products.get(item.productId);
      if (!product) {
        // Cross-branch fallback
        product = Array.from(dbStore.products.values()).find(p => p.id === item.productId);
      }
      if (!product) {
        throw { status: 404, message: `Product ${item.productId} not found in catalog` };
      }

      if (item.batchId) {
        // Specific batch requested
        const batch = dbStore.batches.get(item.batchId);
        if (!batch) {
          throw { status: 404, message: `Batch ${item.batchId} not found` };
        }

        // SECURITY (#16): batch.sellingPrice is the source of truth. A tampered
        // payload with a different unitPrice is rejected (409) so the POS
        // refreshes the displayed price instead of silently charging an
        // untrusted one.
        const serverPrice = batch.sellingPrice;
        if (item.unitPrice !== undefined && Math.abs(item.unitPrice - serverPrice) > 0.005) {
          throw {
            status: 409,
            code: 'PRICE_CHANGED',
            message: `Price changed for '${product.name}': display had $${Number(item.unitPrice).toFixed(2)}, current price is $${serverPrice.toFixed(2)}. Cart updated — please re-check the total and submit again.`,
            items: [{ productId: product.id, batchId: batch.id, unitPrice: serverPrice }]
          };
        }

        // SECURITY: per-line discount is capped at the line's gross value so a
        // tampered payload can never drive the invoice total negative.
        const lineGrossCents = Math.round(item.quantity * serverPrice * 100);
        const discountCents = Math.min(Math.round((item.discountAmount || 0) * 100), lineGrossCents);

        resolvedLines.push({
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: item.quantity,
          unitPrice: serverPrice,
          taxRate: product.defaultTaxRate,
          discountAmount: Number((discountCents / 100).toFixed(2))
        });
      } else {
        // FEFO Auto-allocation (unit prices always come from the batches here;
        // any client-sent unitPrice is ignored on this path)
        const fefo = fefoService.resolveAllocations(product.id, item.quantity);
        if (fefo.unfulfilledQuantity > 0) {
          throw {
            status: 409,
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for '${product.name}'. Requested: ${item.quantity}, Available: ${fefo.totalAllocated}`
          };
        }

        // Split the line discount across allocation lines proportionally to
        // their gross value (integer cents, remainder to the final line) so a
        // multi-batch FEFO split can never multiply the discount.
        const allocGrossCents = fefo.allocations.map(a =>
          Math.round(a.allocatedQuantity * a.unitPrice * 100)
        );
        const totalGrossCents = allocGrossCents.reduce((s, c) => s + c, 0);
        const discountCents = Math.min(
          Math.round((item.discountAmount || 0) * 100),
          totalGrossCents
        );
        let discountRemaining = discountCents;

        fefo.allocations.forEach((alloc, idx) => {
          const isLast = idx === fefo.allocations.length - 1;
          const shareCents = isLast
            ? discountRemaining
            : totalGrossCents > 0
              ? Math.min(Math.round((discountCents * allocGrossCents[idx]) / totalGrossCents), discountRemaining)
              : 0;
          discountRemaining -= shareCents;

          resolvedLines.push({
            productId: product.id,
            productName: product.name,
            batchId: alloc.batchId,
            batchNumber: alloc.batchNumber,
            expiryDate: alloc.expiryDate,
            quantity: alloc.allocatedQuantity,
            unitPrice: alloc.unitPrice,
            taxRate: product.defaultTaxRate,
            discountAmount: Number((shareCents / 100).toFixed(2))
          });
        });
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

      // DESIGN.md §4: Raw in integer cents; Grand Total = nearest whole dollar;
      // Round Off = Grand − Raw (e.g. raw $103.95 → grand $104.00, round-off +$0.05)
      const rawGrandTotalCents = subtotalCents - totalDiscountCents + totalTaxCents;
      const grandTotalCents = Math.round(rawGrandTotalCents / 100) * 100;
      const roundOffCents = grandTotalCents - rawGrandTotalCents;

      const subtotal = Number((subtotalCents / 100).toFixed(2));
      const discountAmount = Number((totalDiscountCents / 100).toFixed(2));
      const taxAmount = Number((totalTaxCents / 100).toFixed(2));
      const grandTotal = Number((grandTotalCents / 100).toFixed(2));
      const roundOff = Number((roundOffCents / 100).toFixed(2));

      // SECURITY: payments.amount has CHECK (amount > 0) in the schema, so a
      // zero-total invoice can never be persisted. Reject it here (before the
      // transaction) with a clear 400 instead of letting it surface as a 503.
      // This also means an oversized discount can never yield a free sale —
      // per-line discounts are already capped at the line gross above, so the
      // total can only reach 0 when discounts cover the whole cart.
      if (grandTotalCents < 100) {
        throw {
          status: 400,
          code: 'TOTAL_TOO_LOW',
          message: rawGrandTotalCents <= 0
            ? 'Discount covers the entire sale — the invoice total must be at least $1.00. Reduce the discount.'
            : `Sale total $${(rawGrandTotalCents / 100).toFixed(2)} rounds to $0.00 — the minimum billable invoice is $1.00.`
        };
      }

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

      // 6. Assemble Invoice (cache commit is DEFERRED until the DB transaction succeeds)
      const invoiceNumberPrefix = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
      const invoice: Invoice = {
        id: invoiceId,
        tenantId,
        cashierId,
        drawerId: drawer.id,
        invoiceNumber: '',
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

      // 7. PERSIST TO POSTGRESQL FIRST — source of truth, real ACID transaction.
      // Row-level locks (SELECT ... FOR UPDATE) are taken HERE so the guarantee
      // holds even with multiple Node instances pointing at the same database.
      let invoiceNumber = '';
      let retryCount = 0;
      const MAX_INVOICE_RETRIES = 3;

      if (isPgConnected) {
        const client = await pgPool.connect();
        try {
          let committed = false;
          while (!committed) {
            invoiceNumber = `${invoiceNumberPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;
            await client.query('BEGIN');

            try {
              // --- PESSIMISTIC ROW-LEVEL LOCKING (sorted order = deadlock-free) ---
              const sortedBatchIds = [...new Set(resolvedLines.map(l => l.batchId))].sort();
              const lockRes = await client.query(
                `SELECT batch_id, quantity
                 FROM inventory_stocks
                 WHERE batch_id = ANY($1::varchar[])
                 ORDER BY batch_id
                 FOR UPDATE`,
                [sortedBatchIds]
              );

              // Re-verify stock invariants against the LOCKED database rows
              const lockedQty = new Map<string, number>(
                lockRes.rows.map((r: any) => [r.batch_id, parseInt(r.quantity, 10)])
              );
              for (const line of resolvedLines) {
                const dbQty = lockedQty.get(line.batchId) ?? 0;
                if (dbQty < line.quantity) {
                  syncCacheFromLockedQty(lockedQty);
                  throw {
                    status: 409,
                    code: 'CONCURRENCY_STOCK_DEPLETED',
                    message: `Checkout aborted: Batch '${line.batchNumber}' has only ${dbQty} units remaining in the database. Another counter checked out concurrently.`
                  };
                }
              }

              // Ensure drawer exists in cash_drawers if not present
              const drawerCheck = await client.query('SELECT 1 FROM cash_drawers WHERE id = $1', [drawer.id]);
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
                invoice.id, invoice.tenantId, invoice.cashierId, invoice.drawerId, invoiceNumber,
                matchedPatientId, matchedDoctorId, invoice.prescriptionNumber || null,
                invoice.subtotal, invoice.discountAmount, invoice.taxAmount, invoice.roundOff,
                invoice.grandTotal, invoice.status, invoice.createdAt
              ]);

              // Insert Invoice Items, decrement stock under the held lock, audit movement
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

                // Guarded decrement: fails loudly on oversell instead of clamping to 0.
                // Row is already locked by FOR UPDATE, so this cannot race.
                const upd = await client.query(`
                  UPDATE inventory_stocks
                  SET quantity = quantity - $1, updated_at = NOW()
                  WHERE batch_id = $2 AND quantity >= $1
                  RETURNING quantity
                `, [item.quantity, item.batchId]);

                if (upd.rowCount === 0) {
                  // Transaction will roll back, so lockedQty still reflects DB truth
                  syncCacheFromLockedQty(lockedQty);
                  throw {
                    status: 409,
                    code: 'CONCURRENCY_STOCK_DEPLETED',
                    message: `Checkout aborted: Batch '${item.batchNumber}' went out of stock in the database mid-transaction.`
                  };
                }
                const dbQuantityAfter = parseInt(upd.rows[0].quantity, 10);

                await client.query(`
                  INSERT INTO stock_movements (
                    id, tenant_id, batch_id, invoice_id, movement_type,
                    quantity_changed, quantity_after, reference_note, created_at
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                  uuidv4(), tenantId, item.batchId, invoiceId, 'SALE_DEDUCTION',
                  -item.quantity, dbQuantityAfter, `POS Sale to Invoice #${invoiceNumber}`,
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
                `POS-TXN-${invoiceNumber}`, invoice.createdAt
              ]);

              await client.query('COMMIT');
              committed = true;
            } catch (pgErr: any) {
              await client.query('ROLLBACK').catch(() => {});
              // Unique invoice_number collision -> regenerate and retry the whole transaction
              if (pgErr?.code === '23505' && pgErr?.constraint === 'uq_tenant_invoice_number' && retryCount < MAX_INVOICE_RETRIES) {
                retryCount++;
                continue;
              }
              throw pgErr;
            }
          }
          invoice.invoiceNumber = invoiceNumber;
        } catch (pgErr: any) {
          // NEVER return 200 for an unpersisted sale — propagate a real failure
          console.error('❌ [POSTGRESQL] Checkout transaction failed and was rolled back:', pgErr);
          if (pgErr?.status) throw pgErr; // domain error (e.g. 409 stock depleted)
          throw {
            status: 503,
            code: 'DB_TRANSACTION_FAILED',
            message: 'Checkout could not be persisted to the database and was fully rolled back. No sale was recorded.'
          };
        } finally {
          client.release();
        }
      } else {
        // Fallback mode (DB offline): in-memory ACID engine only.
        // Locks are already held here, so the mutex guarantees single-process safety.
        invoiceNumber = `${invoiceNumberPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;
        invoice.invoiceNumber = invoiceNumber;
      }

      // 8. DATABASE COMMITTED — now mirror into the in-memory cache (single writer under lock)
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
          referenceNote: `POS Sale to Invoice #${invoiceNumber}`,
          createdAt: new Date().toISOString()
        });
      }

      dbStore.invoices.set(invoiceId, invoice);
      invoiceItems.forEach(item => dbStore.invoiceItems.set(item.id, item));

      return invoice;
    } finally {
      // Always release row locks
      releaseRowLocks();
    }
  }
}

export const checkoutService = new CheckoutService();
