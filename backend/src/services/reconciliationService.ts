import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../db/database.js';
import { CashDrawer, ZReport, CloseDrawerDTO } from '../types/index.js';

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
    const invoices = Array.from(dbStore.invoices.values()).filter(
      inv => inv.drawerId === dto.drawerId && inv.status === 'COMPLETED'
    );

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

    // Calculate gross margin estimate (Sales - Cost)
    const grossMargin = Number((totalCashSales + totalCardSales + totalUpiSales - totalTaxCollected) * 0.35).toFixed(2);

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

    return { drawer, zReport };
  }
}

export const reconciliationService = new ReconciliationService();
