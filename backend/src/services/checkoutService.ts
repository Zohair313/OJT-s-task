import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../db/database.js';
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
      const tendered = (payment.tenderedAmount !== undefined && payment.tenderedAmount > 0)
        ? payment.tenderedAmount
        : grandTotal;
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

      return invoice;
    } finally {
      // Always release row locks
      releaseRowLocks();
    }
  }
}

export const checkoutService = new CheckoutService();
