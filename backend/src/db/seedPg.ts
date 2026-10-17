import { Pool } from 'pg';

export async function seedPgIfEmpty(pool: Pool) {
  const client = await pool.connect();
  try {
    const prodCountRes = await client.query('SELECT COUNT(*) as count FROM products');
    const count = parseInt(prodCountRes.rows[0].count, 10);
    if (count > 0) {
      console.log(`ℹ️ [SEED] Database already has ${count} products in PostgreSQL. Skipping seed.`);
      return;
    }

    console.log('🌱 [SEED] Database is empty. Seeding initial tenants, categories, products, batches, and active drawers into PostgreSQL...');
    await client.query('BEGIN');

    const retailTenantId = 't-retail-001';
    const pharmaTenantId = 't-pharma-002';

    // 1. Tenants
    await client.query(`
      INSERT INTO tenants (id, name, domain_type, tax_identifier, currency, phone, address, is_active)
      VALUES 
      ($1, 'Metro Supermarket Flagship', 'RETAIL_SUPERMARKET', 'TX-METRO-88210', 'USD', '+1-555-0199', '100 Broadway, New York, NY', TRUE),
      ($2, 'St. Jude Memorial Hospital Pharmacy', 'HOSPITAL_PHARMACY', 'TX-STJUDE-44102', 'USD', '+1-555-0244', '500 Medical Center Blvd, Chicago, IL', TRUE)
      ON CONFLICT (id) DO NOTHING;
    `, [retailTenantId, pharmaTenantId]);

    // 2. Categories
    const categories = [
      { id: 'cat-pharma-01', tenantId: pharmaTenantId, name: 'Prescription Drugs (Rx)', description: 'Controlled Rx formulations' },
      { id: 'cat-pharma-02', tenantId: pharmaTenantId, name: 'Over-the-Counter (OTC)', description: 'General OTC medicines' },
      { id: 'cat-pharma-03', tenantId: pharmaTenantId, name: 'Antibiotics & Anti-Infectives', description: 'Broad and narrow spectrum antibiotics' },
      { id: 'cat-pharma-04', tenantId: pharmaTenantId, name: 'Cardiovascular & Statins', description: 'Hypertension and lipid managers' },
      { id: 'cat-pharma-05', tenantId: pharmaTenantId, name: 'Pain Relief & Analgesics', description: 'Analgesics and antipyretics' },
      { id: 'cat-pharma-06', tenantId: pharmaTenantId, name: 'Vitamins & Supplements', description: 'Nutraceuticals and vitamins' },
      { id: 'cat-ret-01', tenantId: retailTenantId, name: 'Beverages & Drinks', description: 'Cold drinks and beverages' },
      { id: 'cat-ret-02', tenantId: retailTenantId, name: 'Snacks & Confectionery', description: 'Chips, cookies and snacks' },
      { id: 'cat-ret-03', tenantId: retailTenantId, name: 'Dairy & Refrigerated', description: 'Milk, cheese, butter and yogurt' },
      { id: 'cat-ret-04', tenantId: retailTenantId, name: 'Packaged Foods & Pantry', description: 'Staple groceries and grains' },
      { id: 'cat-ret-05', tenantId: retailTenantId, name: 'Personal Care & Hygiene', description: 'Soaps, hygiene and cosmetics' }
    ];

    for (const c of categories) {
      await client.query(`
        INSERT INTO categories (id, tenant_id, name, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING;
      `, [c.id, c.tenantId, c.name, c.description]);
    }

    // 3. Cash Drawers (Shift sessions)
    await client.query(`
      INSERT INTO cash_drawers (id, tenant_id, cashier_id, terminal_identifier, opening_float, total_cash_drops, status)
      VALUES 
      ('drw-retail-01', $1, 'usr-cashier-01', 'POS-COUNTER-01', 150.00, 0.00, 'OPEN'),
      ('drw-pharma-01', $2, 'usr-pharmacist-01', 'RX-COUNTER-01', 200.00, 0.00, 'OPEN')
      ON CONFLICT (id) DO NOTHING;
    `, [retailTenantId, pharmaTenantId]);

    // 4. Patients & Doctors
    await client.query(`
      INSERT INTO patients (id, tenant_id, mrn, full_name, phone, gender, date_of_birth)
      VALUES ('pat-01', $1, 'MRN-884920', 'Jonathan Doe', '+1-555-8821', 'MALE', '1985-06-15')
      ON CONFLICT (id) DO NOTHING;
    `, [pharmaTenantId]);

    await client.query(`
      INSERT INTO doctors (id, tenant_id, license_number, full_name, specialization, phone)
      VALUES ('doc-01', $1, 'MD-LIC-44810', 'Dr. Robert Adams, MD', 'Cardiology & Internal Medicine', '+1-555-9001')
      ON CONFLICT (id) DO NOTHING;
    `, [pharmaTenantId]);

    // Helper function to insert a product, batch, and inventory stock
    const insertProductWithBatch = async (
      prod: {
        id: string;
        tenantId: string;
        categoryId: string;
        sku: string;
        barcode: string;
        name: string;
        genericName?: string;
        brand: string;
        unitOfMeasure: string;
        taxRate: number;
        reorderPoint: number;
        rx: boolean;
      },
      batch: {
        id: string;
        number: string;
        expiryDays: number;
        costPrice: number;
        sellingPrice: number;
        stockQty: number;
        shelfLocation: string;
      }
    ) => {
      await client.query(`
        INSERT INTO products (
          id, tenant_id, category_id, sku, barcode, name, generic_name, brand, 
          unit_of_measure, default_tax_rate, reorder_point, is_prescription_required, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)
        ON CONFLICT (id) DO NOTHING;
      `, [
        prod.id, prod.tenantId, prod.categoryId, prod.sku, prod.barcode, prod.name,
        prod.genericName || null, prod.brand, prod.unitOfMeasure, prod.taxRate, prod.reorderPoint, prod.rx
      ]);

      await client.query(`
        INSERT INTO batches (
          id, tenant_id, product_id, batch_number, expiry_date, cost_price, selling_price, mrp
        ) VALUES ($1, $2, $3, $4, CURRENT_DATE + ($5 || ' days')::INTERVAL, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING;
      `, [
        batch.id, prod.tenantId, prod.id, batch.number, batch.expiryDays.toString(),
        batch.costPrice, batch.sellingPrice, batch.sellingPrice * 1.2
      ]);

      await client.query(`
        INSERT INTO inventory_stocks (
          id, tenant_id, batch_id, quantity, reserved_quantity, shelf_location
        ) VALUES ($1, $2, $3, $4, 0, $5)
        ON CONFLICT (id) DO NOTHING;
      `, [
        `stock-${batch.id}`, prod.tenantId, batch.id, batch.stockQty, batch.shelfLocation
      ]);
    };

    // 5. Seed Core Hero Products
    // Sample 1: Amoxicillin 500mg (FEFO)
    await insertProductWithBatch(
      {
        id: 'prod-pharma-101',
        tenantId: pharmaTenantId,
        categoryId: 'cat-pharma-03',
        sku: 'SKU-MED-1001',
        barcode: '8901000000101',
        name: 'Amoxicillin 500mg',
        genericName: 'Amoxicillin Trihydrate USP',
        brand: 'GlaxoSmithKline',
        unitOfMeasure: 'BOX',
        taxRate: 5.00,
        reorderPoint: 15,
        rx: true
      },
      {
        id: 'batch-amox-01',
        number: 'AMX-2026-A',
        expiryDays: 45,
        costPrice: 8.50,
        sellingPrice: 14.50,
        stockQty: 50,
        shelfLocation: 'Aisle-Rx-1'
      }
    );

    // Sample 2: Paracetamol 650mg
    await insertProductWithBatch(
      {
        id: 'prod-pharma-102',
        tenantId: pharmaTenantId,
        categoryId: 'cat-pharma-05',
        sku: 'SKU-MED-1002',
        barcode: '8901000000102',
        name: 'Paracetamol 650mg',
        genericName: 'Acetaminophen BP',
        brand: 'Panadol Extra',
        unitOfMeasure: 'BOX',
        taxRate: 0.00,
        reorderPoint: 20,
        rx: false
      },
      {
        id: 'batch-para-01',
        number: 'PAR-2026-B',
        expiryDays: 180,
        costPrice: 4.00,
        sellingPrice: 7.99,
        stockQty: 120,
        shelfLocation: 'Aisle-OTC-2'
      }
    );

    // Sample 3: Retail Soda 500ml (FMCG)
    await insertProductWithBatch(
      {
        id: 'prod-ret-001',
        tenantId: retailTenantId,
        categoryId: 'cat-ret-01',
        sku: 'SKU-RET-1001',
        barcode: '8901000000001',
        name: 'Retail Soda 500ml',
        brand: 'Coca-Cola Beverage',
        unitOfMeasure: 'CAN',
        taxRate: 5.00,
        reorderPoint: 24,
        rx: false
      },
      {
        id: 'batch-soda-01',
        number: 'SODA-2026-X',
        expiryDays: 300,
        costPrice: 1.10,
        sellingPrice: 2.25,
        stockQty: 85,
        shelfLocation: 'Cooler-Bay-3'
      }
    );

    // Seed 10 realistic pharmaceutical items
    const pharmaItems = [
      { name: 'Atorvastatin Calcium 20mg', generic: 'Atorvastatin', brand: 'Lipitor', cat: 'cat-pharma-04', price: 18.50, stock: 45, rx: true },
      { name: 'Metformin HCl 500mg', generic: 'Metformin', brand: 'Glucophage', cat: 'cat-pharma-01', price: 9.75, stock: 80, rx: true },
      { name: 'Azithromycin 250mg', generic: 'Azithromycin USP', brand: 'Zithromax', cat: 'cat-pharma-03', price: 22.00, stock: 35, rx: true },
      { name: 'Ibuprofen 400mg', generic: 'Ibuprofen BP', brand: 'Advil', cat: 'cat-pharma-05', price: 6.50, stock: 95, rx: false },
      { name: 'Omeprazole 20mg', generic: 'Omeprazole Delayed Release', brand: 'Prilosec', cat: 'cat-pharma-02', price: 12.00, stock: 60, rx: false },
      { name: 'Cetirizine 10mg', generic: 'Cetirizine Hydrochloride', brand: 'Zyrtec', cat: 'cat-pharma-02', price: 8.25, stock: 75, rx: false },
      { name: 'Vitamin D3 5000 IU', generic: 'Cholecalciferol', brand: 'NatureMade', cat: 'cat-pharma-06', price: 15.00, stock: 40, rx: false },
      { name: 'Vitamin C 1000mg Effervescent', generic: 'Ascorbic Acid', brand: 'Redoxon', cat: 'cat-pharma-06', price: 11.50, stock: 55, rx: false },
      { name: 'Amlodipine 5mg', generic: 'Amlodipine Besylate', brand: 'Norvasc', cat: 'cat-pharma-04', price: 14.00, stock: 65, rx: true },
      { name: 'Ciprofloxacin 500mg', generic: 'Ciprofloxacin USP', brand: 'Cipro', cat: 'cat-pharma-03', price: 19.50, stock: 25, rx: true }
    ];

    for (let i = 0; i < pharmaItems.length; i++) {
      const item = pharmaItems[i];
      await insertProductWithBatch(
        {
          id: `prod-pharma-seed-${i + 1}`,
          tenantId: pharmaTenantId,
          categoryId: item.cat,
          sku: `SKU-MED-${1010 + i}`,
          barcode: `8901000000${200 + i}`,
          name: item.name,
          genericName: item.generic,
          brand: item.brand,
          unitOfMeasure: 'BOX',
          taxRate: 0.00,
          reorderPoint: 15,
          rx: item.rx
        },
        {
          id: `batch-pharma-seed-${i + 1}`,
          number: `LOT-MED-26-${i + 1}`,
          expiryDays: 60 + (i * 25),
          costPrice: item.price * 0.6,
          sellingPrice: item.price,
          stockQty: item.stock,
          shelfLocation: `Pharma-Shelf-${(i % 5) + 1}`
        }
      );
    }

    // Seed 8 retail supermarket items
    const retailItems = [
      { name: 'Organic Almond Milk 1L', brand: 'Silk', cat: 'cat-ret-03', price: 3.99, stock: 40 },
      { name: 'Whole Wheat Bread 500g', brand: 'Wonder', cat: 'cat-ret-04', price: 2.75, stock: 30 },
      { name: 'Potato Chips Sour Cream 150g', brand: 'Lays', cat: 'cat-ret-02', price: 1.99, stock: 65 },
      { name: 'Sparkling Mineral Water 750ml', brand: 'San Pellegrino', cat: 'cat-ret-01', price: 2.49, stock: 50 },
      { name: 'Greek Yogurt Vanilla 500g', brand: 'Chobani', cat: 'cat-ret-03', price: 4.50, stock: 25 },
      { name: 'Dark Chocolate Bar 70% 100g', brand: 'Lindt', cat: 'cat-ret-02', price: 3.25, stock: 45 },
      { name: 'Extra Virgin Olive Oil 500ml', brand: 'Bertolli', cat: 'cat-ret-04', price: 8.99, stock: 20 },
      { name: 'Antibacterial Hand Soap 250ml', brand: 'Dettol', cat: 'cat-ret-05', price: 2.99, stock: 80 }
    ];

    for (let i = 0; i < retailItems.length; i++) {
      const item = retailItems[i];
      await insertProductWithBatch(
        {
          id: `prod-ret-seed-${i + 1}`,
          tenantId: retailTenantId,
          categoryId: item.cat,
          sku: `SKU-RET-${1010 + i}`,
          barcode: `8901000000${500 + i}`,
          name: item.name,
          brand: item.brand,
          unitOfMeasure: 'PCS',
          taxRate: 5.00,
          reorderPoint: 15,
          rx: false
        },
        {
          id: `batch-ret-seed-${i + 1}`,
          number: `LOT-RET-26-${i + 1}`,
          expiryDays: 120 + (i * 30),
          costPrice: item.price * 0.65,
          sellingPrice: item.price,
          stockQty: item.stock,
          shelfLocation: `Retail-Aisle-${(i % 4) + 1}`
        }
      );
    }

    // Special item for Concurrency Race Testing (Exact 1 unit remaining)
    await insertProductWithBatch(
      {
        id: 'prod-concurrency-race',
        tenantId: retailTenantId,
        categoryId: 'cat-ret-01',
        sku: 'SKU-RACE-CONCURRENCY',
        barcode: '9999999999999',
        name: 'High-Demand Limited Stock Item (Race Test)',
        brand: 'Concurrency Lab',
        unitOfMeasure: 'PCS',
        taxRate: 5.00,
        reorderPoint: 5,
        rx: false
      },
      {
        id: 'batch-race-001',
        number: 'LOT-RACE-FINAL-UNIT',
        expiryDays: 730,
        costPrice: 50.00,
        sellingPrice: 99.00,
        stockQty: 1, // EXACT 1 UNIT
        shelfLocation: 'Vault-Secure-01'
      }
    );

    await client.query('COMMIT');
    console.log('✅ [SEED] Initial seed successfully committed to PostgreSQL database.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [SEED] Failed to seed PostgreSQL database:', err);
    throw err;
  } finally {
    client.release();
  }
}
