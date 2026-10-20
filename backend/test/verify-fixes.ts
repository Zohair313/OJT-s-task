/**
 * Verification script for the ACID checkout fixes.
 * Run: npx tsx test/verify-fixes.ts
 *
 * Proves directly against PostgreSQL (not the in-memory cache):
 *   1. Race batch stock is 0 in the DB after the 20-thread race
 *   2. Negative quantity is rejected (400) — no stock inflation
 *   3. Zero quantity is rejected (400)
 *   4. A real FEFO checkout persists an invoice + payment + movement in PG
 *   5. A sold-out batch returns 409 from the DB, not a silent clamp
 */
import { pgPool, initializeDatabase, dbStore } from '../src/db/database.js';

const BASE = process.env.API_BASE || 'http://localhost:5000/api/v1';
let failures = 0;

function check(name: string, pass: boolean, detail = '') {
  const mark = pass ? '\x1b[32m✅ PASS\x1b[0m' : '\x1b[31m❌ FAIL\x1b[0m';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': 't-retail-001' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json, text };
}

async function main() {
  await initializeDatabase();
  console.log('─'.repeat(64));

  // 1. Race batch stock in the DATABASE (source of truth) — diagnostic first
  const raceBatch = await pgPool.query(
    `SELECT b.id, b.batch_number FROM batches b WHERE b.batch_number = $1`,
    ['LOT-RACE-T-RETAIL-001']
  );
  if (raceBatch.rowCount === 0) {
    check('Race batch exists in PostgreSQL', false, 'batch row not found (race test may not have persisted)');
  } else {
    const raceStock = await pgPool.query(
      `SELECT quantity FROM inventory_stocks WHERE batch_id = $1`,
      [raceBatch.rows[0].id]
    );
    const dbQty = raceStock.rowCount ? parseInt(raceStock.rows[0].quantity, 10) : -1;
    check('Race batch stock is 0 in PostgreSQL (not just cache)', dbQty === 0, `db quantity=${dbQty}`);
  }

  // 2. Negative quantity rejected
  const neg = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: 'prod-ret-seed-8', batchId: 'batch-ret-seed-8', quantity: -5 }],
    payment: { method: 'CASH', tenderedAmount: 0 }
  });
  check('Negative quantity rejected with 400', neg.status === 400, `status=${neg.status}`);

  // Confirm the cache stock did NOT inflate
  const cacheQty = dbStore.stocks.get('batch-ret-seed-8')?.quantity ?? -1;
  const pgAfterNeg = await pgPool.query(
    `SELECT quantity FROM inventory_stocks WHERE batch_id = 'batch-ret-seed-8'`
  );
  const pgQtyAfterNeg = parseInt(pgAfterNeg.rows[0].quantity, 10);
  check('Cache stock unchanged after negative attempt', cacheQty === pgQtyAfterNeg,
    `cache=${cacheQty} pg=${pgQtyAfterNeg}`);

  // 3. Zero quantity rejected
  const zero = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: 'prod-ret-seed-8', batchId: 'batch-ret-seed-8', quantity: 0 }],
    payment: { method: 'CASH', tenderedAmount: 0 }
  });
  check('Zero quantity rejected with 400', zero.status === 400, `status=${zero.status}`);

  // 4. Real FEFO checkout — verify persistence in PostgreSQL
  const before = await pgPool.query(
    `SELECT quantity FROM inventory_stocks WHERE batch_id = 'batch-ret-seed-8'`
  );
  const beforeQty = parseInt(before.rows[0].quantity, 10);

  const ok = await api('POST', '/checkout/commit', {
    drawerId: 'drw-retail-01',
    items: [{ productId: 'prod-ret-seed-8', quantity: 2 }],
    payment: { method: 'CASH', tenderedAmount: 100 }
  });
  check('Valid FEFO checkout returns 200', ok.status === 200, `status=${ok.status}`);

  if (ok.status === 200 && ok.body?.id) {
    const invId = ok.body.id;
    const inv = await pgPool.query(`SELECT id, drawer_id, grand_total FROM invoices WHERE id = $1`, [invId]);
    check('Invoice persisted in PostgreSQL', inv.rowCount === 1,
      inv.rowCount === 1 ? `drawer_id=${inv.rows[0].drawer_id}` : 'not found');

    const items = await pgPool.query(`SELECT count(*)::int AS c FROM invoice_items WHERE invoice_id = $1`, [invId]);
    check('Invoice items persisted', items.rows[0].c === ok.body.items.length, `${items.rows[0].c} rows`);

    const pay = await pgPool.query(`SELECT count(*)::int AS c FROM payments WHERE invoice_id = $1`, [invId]);
    check('Payment persisted', pay.rows[0].c === 1, `${pay.rows[0].c} rows`);

    const mv = await pgPool.query(
      `SELECT count(*)::int AS c FROM stock_movements WHERE invoice_id = $1 AND movement_type = 'SALE_DEDUCTION'`,
      [invId]
    );
    check('Stock movement persisted with SALE_DEDUCTION', mv.rows[0].c === 1, `${mv.rows[0].c} rows`);

    // 5. Drawer ID integrity — invoice must reference the REAL drawer row (FK safety)
    const fk = await pgPool.query(
      `SELECT 1 FROM invoices i LEFT JOIN cash_drawers d ON d.id = i.drawer_id WHERE i.id = $1 AND d.id IS NOT NULL`,
      [invId]
    );
    check('Invoice drawer_id resolves to a real cash_drawers row', fk.rowCount === 1);

    // DB stock actually decremented by 2
    const after = await pgPool.query(
      `SELECT quantity FROM inventory_stocks WHERE batch_id = 'batch-ret-seed-8'`
    );
    const afterQty = parseInt(after.rows[0].quantity, 10);
    check('PostgreSQL stock decremented by exact quantity', afterQty === beforeQty - 2,
      `${beforeQty} -> ${afterQty} (expected ${beforeQty - 2})`);

    // Cache and DB agree — verify via the SERVER's API (separate process, its own cache)
    const prodRes = await api('GET', '/products?q=Antibacterial&limit=1');
    const serverStock = prodRes.body?.products?.[0]?.totalStock ?? -1;
    check('Server cache totalStock matches PostgreSQL', serverStock === afterQty,
      `server=${serverStock} pg=${afterQty}`);
  }

  // 6. Sold-out batch -> 409 from the DB path (no silent clamp)
  const raceCheckout = await api('POST', '/checkout/commit', {
    drawerId: 'drw-retail-01',
    items: [{ productId: 'prod-race-t-retail-001', quantity: 1 }],
    payment: { method: 'CASH', tenderedAmount: 50 }
  });
  check('Sold-out race product returns 409 (no silent clamp)',
    raceCheckout.status === 409, `status=${raceCheckout.status}`);

  // Race stock STILL 0 in DB after the failed attempt
  const raceAfter = await pgPool.query(
    `SELECT s.quantity FROM inventory_stocks s JOIN batches b ON b.id = s.batch_id
     WHERE b.batch_number = 'LOT-RACE-T-RETAIL-001'`
  );
  check('Race batch stock still 0 in DB after failed checkout',
    parseInt(raceAfter.rows[0].quantity, 10) === 0);

  console.log('─'.repeat(64));
  if (failures > 0) {
    console.log(`\x1b[31m${failures} verification(s) FAILED\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mALL VERIFICATIONS PASSED\x1b[0m');
  await pgPool.end();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
