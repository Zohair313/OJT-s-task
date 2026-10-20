/** Diagnostic: why doesn't the race-test batch exist in PostgreSQL? */
import { pgPool, initializeDatabase, isPgConnected } from '../src/db/database.js';

async function main() {
  await initializeDatabase();
  console.log('isPgConnected =', isPgConnected);

  const prod = await pgPool.query(`SELECT id FROM products WHERE id = 'prod-race-t-retail-001'`);
  console.log('race product rows =', prod.rowCount);

  // Try each setup statement individually to surface the real error
  try {
    const r = await pgPool.query(`
      INSERT INTO products (id, tenant_id, sku, barcode, name, unit_of_measure, default_tax_rate, reorder_point, is_prescription_required, is_active, created_at)
      VALUES ('prod-race-t-retail-001', 't-retail-001', 'SKU-RACE-T-RETAIL-001', '9999999999999-t-retail-001', 'Race Item', 'PCS', 5.00, 5, false, true, NOW())
      ON CONFLICT (id) DO UPDATE SET is_active = true
      RETURNING id
    `);
    console.log('product upsert OK =', r.rows[0].id);
  } catch (e: any) { console.log('PRODUCT ERROR:', e.message, '| code =', e.code); }

  try {
    const r = await pgPool.query(`
      INSERT INTO batches (id, tenant_id, product_id, batch_number, expiry_date, cost_price, selling_price, mrp, is_quarantined, created_at)
      VALUES ('batch-race-t-retail-001', 't-retail-001', 'prod-race-t-retail-001', 'LOT-RACE-T-RETAIL-001', '2028-12-31', 50.00, 99.00, 120.00, false, NOW())
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `);
    console.log('batch insert rowCount =', r.rowCount);
  } catch (e: any) { console.log('BATCH ERROR:', e.message, '| code =', e.code); }

  try {
    const r = await pgPool.query(`
      INSERT INTO inventory_stocks (id, tenant_id, batch_id, quantity, reserved_quantity, shelf_location, updated_at)
      VALUES ('stk-race-t-retail-001', 't-retail-001', 'batch-race-t-retail-001', 1, 0, 'Vault-Secure-01', NOW())
      ON CONFLICT (batch_id) DO UPDATE SET quantity = 1, updated_at = NOW()
      RETURNING id, quantity
    `);
    console.log('stock upsert OK =', JSON.stringify(r.rows[0]));
  } catch (e: any) { console.log('STOCK ERROR:', e.message, '| code =', e.code); }

  await pgPool.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
