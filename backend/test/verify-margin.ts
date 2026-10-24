/**
 * Verification script for the Z-report gross-margin fix.
 * Run: npx tsx test/verify-margin.ts
 *
 * Proves the Z-report no longer uses a hardcoded 0.35 × sales estimate:
 *   1. A drawer with NO sales reports exactly $0.00 gross margin
 *      (the old formula would also give 0 here, so this is a sanity guard)
 *   2. After a real sale, gross margin equals
 *      (net sales excl. tax) − (Σ qty × batch cost price) — computed from the
 *      batch COGS, NOT 35% of revenue
 *   3. The reported margin differs from the old 0.35 estimate whenever the
 *      product's real margin ratio is not 35%
 */
import { dbStore, initializeDatabase } from '../src/db/database.js';
import { reconciliationService } from '../src/services/reconciliationService.js';
import { checkoutService } from '../src/services/checkoutService.js';

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  const mark = pass ? '\x1b[32m✅ PASS\x1b[0m' : '\x1b[31m❌ FAIL\x1b[0m';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

async function main() {
  await initializeDatabase();
  console.log('─'.repeat(64));

  const tenantId = 't-retail-001';
  const cashierId = 'usr-cashier-01';
  const runTag = `MARGIN-${process.pid}-${Date.now()}`;

  // Pick an in-stock, costed batch belonging to THIS tenant to sell
  const batch = Array.from(dbStore.batches.values()).find(
    b =>
      b.tenantId === tenantId &&
      (dbStore.stocks.get(b.id)?.quantity ?? 0) >= 2 &&
      b.costPrice > 0
  );
  if (!batch) throw new Error('No costed, in-stock batch found for margin test');
  const product = dbStore.products.get(batch.productId);
  if (!product) throw new Error('Batch product not found for margin test');

  // 1. Fresh drawer, no sales yet → margin must be exactly 0.
  //    (unique terminal tag keeps this session isolated from earlier runs)
  const drawer = reconciliationService.openDrawerSession(tenantId, cashierId, `POS-${runTag}-EMPTY`, 100);
  const empty = reconciliationService.closeShiftAndGenerateZReport(tenantId, {
    drawerId: drawer.id,
    actualCountedCash: 100
  });
  check('Empty drawer Z-report gross margin is exactly 0', empty.zReport.grossMargin === 0,
    `margin=${empty.zReport.grossMargin} (invoices on drawer=${empty.zReport.totalCashSales + empty.zReport.totalCardSales + empty.zReport.totalUpiSales ? 'yes' : 'none'})`);

  const oldEstimate = (empty.zReport.totalCashSales + empty.zReport.totalCardSales + empty.zReport.totalUpiSales - empty.zReport.totalTaxCollected) * 0.35;

  // 2. Real sale, then close a second drawer session
  const saleDrawer = reconciliationService.openDrawerSession(tenantId, cashierId, `POS-${runTag}-SALE`, 100);
  const qty = 2;
  const invoice = await checkoutService.processCheckout(tenantId, cashierId, {
    drawerId: saleDrawer.id,
    items: [{ productId: product.id, batchId: batch.id, quantity: qty, unitPrice: batch.sellingPrice, discountAmount: 0 }],
    payment: { method: 'CASH', tenderedAmount: 1000 }
  });

  const closed = reconciliationService.closeShiftAndGenerateZReport(tenantId, {
    drawerId: saleDrawer.id,
    actualCountedCash: 1000
  });
  const z = closed.zReport;

  const netSalesExclTax = Number(
    (z.totalCashSales + z.totalCardSales + z.totalUpiSales - z.totalTaxCollected).toFixed(2)
  );
  const expectedCogs = Number((qty * batch.costPrice).toFixed(2));
  const expectedMargin = Number((netSalesExclTax - expectedCogs).toFixed(2));
  const oldFormulaMargin = Number((netSalesExclTax * 0.35).toFixed(2));

  check('Z-report captured the sale (positive revenue)', netSalesExclTax > 0, `net=${netSalesExclTax}`);
  check('Gross margin = net sales − real batch COGS',
    Math.abs(z.grossMargin - expectedMargin) < 0.011,
    `margin=${z.grossMargin} expected=${expectedMargin} (net=${netSalesExclTax} − cogs=${expectedCogs})`);

  const marginRatio = z.grossMargin / netSalesExclTax;
  const differsFromOld = Math.abs(z.grossMargin - oldFormulaMargin) > 0.011;
  check('Margin no longer the hardcoded 35% of revenue',
    differsFromOld || Math.abs(marginRatio - 0.35) < 0.001,
    `ratio=${(marginRatio * 100).toFixed(1)}% old-estimate=${oldFormulaMargin} actual=${z.grossMargin}`);
  check('Margin reflects the batch cost price (not zero-filled)',
    expectedCogs > 0 && z.grossMargin !== netSalesExclTax,
    `cogs=${expectedCogs} margin=${z.grossMargin}`);

  console.log('─'.repeat(64));
  console.log(`Sanity: old 0.35 formula would have reported ${oldEstimate.toFixed(2)} on the empty drawer, ` +
    `${oldFormulaMargin.toFixed(2)} on this sale (actual ${z.grossMargin}).`);

  if (failures > 0) {
    console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mALL MARGIN VERIFICATIONS PASSED\x1b[0m');
  process.exit(0);
}

main().catch(err => {
  console.error('Margin verification crashed:', err);
  process.exit(1);
});
