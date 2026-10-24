import { v4 as uuidv4 } from 'uuid';
import { dbStore, pgPool, isPgConnected } from '../db/database.js';
import { CashDrawer, ZReport, CloseDrawerDTO } from '../types/index.js';

/** Open (self-healing) drawer query in PostgreSQL, used only for diagnostics. */

export class ReconciliationService {
  /**
   * Open a new Cashier Shift Drawer session
   */
  public openDrawerSession(tenantId: string, cashierId: string, terminalId: string, openingFloat: number): CashDrawer {
    // Check if cashier already has an open drawer
    const existingOpen = Array.from(dbStore.cashDrawers.values()).find(
      d => d.tenantId === tenantId && d.cashierId === cashierId && d.status === 'OPEN'
    );
    if (existingOpen) {
      return existingOpen;
    }

    const drawer: CashDrawer = {
      id: uuidv4(),
      tenantId,
      cashierId,
      terminalIdentifier: terminalId || 'POS-COUNTER-01',
      openedAt: new Date().toISOString(),
      openingFloat,
      totalCashDrops: 0.00,
      status: 'OPEN'
    };

    dbStore.cashDrawers.set(drawer.id, drawer);

    if (isPgConnected) {
      pgPool.query(`
        INSERT INTO cash_drawers (
          id, tenant_id, cashier_id, terminal_identifier, opened_at, opening_float, total_cash_drops, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [
        drawer.id, drawer.tenantId, drawer.cashierId, drawer.terminalIdentifier,
        drawer.openedAt, drawer.openingFloat, drawer.totalCashDrops, drawer.status
      ]).catch(err => console.error('❌ [POSTGRESQL] Error inserting cash drawer:', err));
    }

    return drawer;
  }

  /**
   * Record mid-shift Cash Drop to the store safe
   */
  public recordCashDrop(drawerId: string, amount: number): CashDrawer {
    const drawer = dbStore.cashDrawers.get(drawerId);
    if (!drawer || drawer.status !== 'OPEN') {
      throw { status: 400, message: 'Drawer session is not open' };
    }

    drawer.totalCashDrops += amount;

    if (isPgConnected) {
      pgPool.query(`
        UPDATE cash_drawers SET total_cash_drops = $1 WHERE id = $2
      `, [drawer.totalCashDrops, drawer.id]).catch(err => console.error('❌ [POSTGRESQL] Error updating cash drop:', err));
    }

    return drawer;
  }

  /**
   * Close Cashier Shift & Generate Fiscal Z-Report
   */
  public closeShiftAndGenerateZReport(tenantId: string, dto: CloseDrawerDTO): { drawer: CashDrawer; zReport: ZReport } {
    const drawer = dbStore.cashDrawers.get(dto.drawerId);
    if (!drawer) {
      throw { status: 404, message: 'Drawer session not found' };
    }
    if (drawer.status === 'CLOSED') {
      const existingZ = Array.from(dbStore.zReports.values()).find(z => z.drawerId === dto.drawerId);
      if (existingZ) {
        return { drawer, zReport: existingZ };
      }
      throw { status: 400, message: 'Drawer session is already closed and reconciled' };
    }

    const effectiveTenantId = drawer.tenantId;

    // Ingest all invoices belonging to this drawer session
    const invoicesOnDrawer = Array.from(dbStore.invoices.values()).filter(
      inv => inv.drawerId === dto.drawerId && inv.status === 'COMPLETED'
    );
    const invoices = invoicesOnDrawer;
    if (process.env.DEBUG_MARGIN) {
      console.log('[DEBUG_MARGIN] drawerId=', dto.drawerId, 'invoicesOnDrawer=', invoices.length,
        'openDrawers=', Array.from(dbStore.cashDrawers.values()).filter(d => d.status === 'OPEN').map(d => d.id));
    }
    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalUpiSales = 0;
    let totalTaxCollected = 0;
    let totalDiscountsGiven = 0;

    for (const inv of invoices) {
      if (inv.paymentMethod === 'CASH') {
        totalCashSales += inv.grandTotal;
      } else if (inv.paymentMethod === 'CREDIT_CARD' || inv.paymentMethod === 'DEBIT_CARD') {
        totalCardSales += inv.grandTotal;
      } else {
        totalUpiSales += inv.grandTotal;
      }
      totalTaxCollected += inv.taxAmount;
      totalDiscountsGiven += inv.discountAmount;
    }

    // Formula: Expected Cash = Opening Float + Cash Sales - Cash Drops
    const expectedCashInDrawer = Number((drawer.openingFloat + totalCashSales - drawer.totalCashDrops).toFixed(2));
    const actualCountedCash = Number(dto.actualCountedCash.toFixed(2));
    const cashVariance = Number((actualCountedCash - expectedCashInDrawer).toFixed(2));

    // Gross Margin = Net Sales (excl. VAT) − COGS.
    // COGS is summed from the ACTUAL batch cost prices (batches.cost_price =
    // what we paid the supplier per unit), never a guessed percentage of sales.
    let cogsTotal = 0;
    for (const inv of invoices) {
      for (const item of inv.items) {
        const batch = dbStore.batches.get(item.batchId);
        if (batch) {
          cogsTotal += item.quantity * batch.costPrice;
        } else {
          console.warn(`⚠️  [Z-REPORT] Batch '${item.batchId}' missing from cache — COGS for '${item.productName}' counted as $0.00`);
        }
      }
    }
    const netSalesExclTax = Number((totalCashSales + totalCardSales + totalUpiSales - totalTaxCollected).toFixed(2));
    const grossMargin = Number((netSalesExclTax - cogsTotal).toFixed(2));

    const reportCode = `ZREP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const zReport: ZReport = {
      id: uuidv4(),
      tenantId,
      drawerId: drawer.id,
      reportCode,
      totalCashSales: Number(totalCashSales.toFixed(2)),
      totalCardSales: Number(totalCardSales.toFixed(2)),
      totalUpiSales: Number(totalUpiSales.toFixed(2)),
      totalTaxCollected: Number(totalTaxCollected.toFixed(2)),
      totalDiscountsGiven: Number(totalDiscountsGiven.toFixed(2)),
      grossMargin: Number(grossMargin),
      expectedCashInDrawer,
      actualCountedCash,
      cashVariance,
      discrepancyReason: dto.discrepancyReason,
      generatedAt: new Date().toISOString()
    };

    // Close and seal drawer
    drawer.status = 'CLOSED';
    drawer.closedAt = new Date().toISOString();
    drawer.closingCash = actualCountedCash;

    dbStore.zReports.set(zReport.id, zReport);

    if (isPgConnected) {
      pgPool.query(`
        UPDATE cash_drawers SET status = 'CLOSED', closed_at = $1, closing_cash = $2 WHERE id = $3
      `, [drawer.closedAt, drawer.closingCash, drawer.id]).catch(err => console.error('❌ [POSTGRESQL] Error closing cash drawer:', err));

      pgPool.query(`
        INSERT INTO z_reports (
          id, tenant_id, drawer_id, report_code, total_cash_sales, total_card_sales,
          total_upi_sales, total_tax_collected, total_discounts_given, gross_margin,
          expected_cash_in_drawer, actual_counted_cash, cash_variance, discrepancy_reason, generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (drawer_id) DO UPDATE SET
          actual_counted_cash = EXCLUDED.actual_counted_cash,
          cash_variance = EXCLUDED.cash_variance,
          discrepancy_reason = EXCLUDED.discrepancy_reason
      `, [
        zReport.id, zReport.tenantId, zReport.drawerId, zReport.reportCode,
        zReport.totalCashSales, zReport.totalCardSales, zReport.totalUpiSales,
        zReport.totalTaxCollected, zReport.totalDiscountsGiven, zReport.grossMargin,
        zReport.expectedCashInDrawer, zReport.actualCountedCash, zReport.cashVariance,
        zReport.discrepancyReason || null, zReport.generatedAt
      ]).catch(err => console.error('❌ [POSTGRESQL] Error persisting Z-Report:', err));
    }

    return { drawer, zReport };
  }
}

export const reconciliationService = new ReconciliationService();
