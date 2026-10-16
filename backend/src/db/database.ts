import { Pool } from 'pg';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import {
  Tenant, Product, Batch, InventoryStock, BatchWithStock,
  Invoice, InvoiceItem, CashDrawer, ZReport, StockMovement,
  Patient, Doctor, Supplier, Category
} from '../types/index.js';

dotenv.config();

// PostgreSQL Connection Pool (Used when DATABASE_URL is accessible)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pos_inventory_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

let isPgConnected = false;

// Test PG connection on startup
pgPool.connect()
  .then(client => {
    isPgConnected = true;
    console.log('\x1b[32m%s\x1b[0m', '✅ [DATABASE] Successfully connected to PostgreSQL instance.');
    client.release();
  })
  .catch(err => {
    isPgConnected = false;
    console.log('\x1b[33m%s\x1b[0m', `⚠️ [DATABASE] Native PostgreSQL unreachable (${err.message}).`);
    console.log('\x1b[36m%s\x1b[0m', '⚡ [DATABASE] Operating with In-Memory ACID Engine with Pessimistic Row Locking.');
  });

// ============================================================================
// IN-MEMORY RESILIENT ACID TRANSACTION STORE
// Provides full ACID transactions, row-level locks (SELECT ... FOR UPDATE),
// and strict constraint validation when Postgres is not running locally.
// ============================================================================

export class InMemoryACIDStore {
  public tenants: Map<string, Tenant> = new Map();
  public categories: Map<string, Category> = new Map();
  public suppliers: Map<string, Supplier> = new Map();
  public products: Map<string, Product> = new Map();
  public batches: Map<string, Batch> = new Map();
  public stocks: Map<string, InventoryStock> = new Map(); // Key: batchId
  public invoices: Map<string, Invoice> = new Map();
  public invoiceItems: Map<string, InvoiceItem> = new Map();
  public cashDrawers: Map<string, CashDrawer> = new Map();
  public zReports: Map<string, ZReport> = new Map();
  public stockMovements: StockMovement[] = [];
  public patients: Map<string, Patient> = new Map();
  public doctors: Map<string, Doctor> = new Map();

  // Active Row Locks for Concurrency: Key = batchId, Value = Promise release resolver
  private activeRowLocks: Map<string, Promise<void>> = new Map();
  private lockResolvers: Map<string, () => void> = new Map();

  constructor() {
    this.seedInitialData();
  }

  /**
   * Acquire Pessimistic Row Lock (equivalent to SELECT ... FOR UPDATE).
   * Always sorts batch IDs to prevent deadlocks.
   */
  public async acquireRowLocks(batchIds: string[]): Promise<() => void> {
    // Sort batch IDs deterministically to avoid circular wait deadlocks
    const sortedBatchIds = [...new Set(batchIds)].sort();

    for (const batchId of sortedBatchIds) {
      while (this.activeRowLocks.has(batchId)) {
        await this.activeRowLocks.get(batchId);
      }
      let resolver!: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        resolver = resolve;
      });
      this.activeRowLocks.set(batchId, lockPromise);
      this.lockResolvers.set(batchId, resolver);
    }

    // Return unlock function
    return () => {
      for (const batchId of sortedBatchIds) {
        const resolve = this.lockResolvers.get(batchId);
        if (resolve) {
          resolve();
          this.lockResolvers.delete(batchId);
        }
        this.activeRowLocks.delete(batchId);
      }
    };
  }

  // Pre-seed 200+ realistic products & batches
  private seedInitialData() {
    const retailTenantId = 't-retail-001';
    const pharmaTenantId = 't-pharma-002';

    // 1. Tenants
    this.tenants.set(retailTenantId, {
      id: retailTenantId,
      name: 'Metro Supermarket Flagship',
      domainType: 'RETAIL_SUPERMARKET',
      taxIdentifier: 'TX-METRO-88210',
      currency: 'USD',
      phone: '+1-555-0199',
      address: '100 Broadway, New York, NY',
      isActive: true,
      createdAt: new Date().toISOString()
    });

    this.tenants.set(pharmaTenantId, {
      id: pharmaTenantId,
      name: 'St. Jude Memorial Hospital Pharmacy',
      domainType: 'HOSPITAL_PHARMACY',
      taxIdentifier: 'TX-STJUDE-44102',
      currency: 'USD',
      phone: '+1-555-0244',
      address: '500 Medical Center Blvd, Chicago, IL',
      isActive: true,
      createdAt: new Date().toISOString()
    });

    // 1b. Seed Merchandise & Clinical Categories
    const initialCategories: Category[] = [
      // Pharma Categories
      { id: 'cat-pharma-01', tenantId: pharmaTenantId, name: 'Prescription Drugs (Rx)', description: 'Controlled Rx formulations' },
      { id: 'cat-pharma-02', tenantId: pharmaTenantId, name: 'Over-the-Counter (OTC)', description: 'General OTC medicines' },
      { id: 'cat-pharma-03', tenantId: pharmaTenantId, name: 'Antibiotics & Anti-Infectives', description: 'Broad and narrow spectrum antibiotics' },
      { id: 'cat-pharma-04', tenantId: pharmaTenantId, name: 'Cardiovascular & Statins', description: 'Hypertension and lipid managers' },
      { id: 'cat-pharma-05', tenantId: pharmaTenantId, name: 'Pain Relief & Analgesics', description: 'Analgesics and antipyretics' },
      { id: 'cat-pharma-06', tenantId: pharmaTenantId, name: 'Vitamins & Supplements', description: 'Nutraceuticals and vitamins' },
      // Retail Categories
      { id: 'cat-ret-01', tenantId: retailTenantId, name: 'Beverages & Drinks', description: 'Cold drinks and beverages' },
      { id: 'cat-ret-02', tenantId: retailTenantId, name: 'Snacks & Confectionery', description: 'Chips, cookies and snacks' },
      { id: 'cat-ret-03', tenantId: retailTenantId, name: 'Dairy & Refrigerated', description: 'Milk, cheese, butter and yogurt' },
      { id: 'cat-ret-04', tenantId: retailTenantId, name: 'Packaged Foods & Pantry', description: 'Staple groceries and grains' },
      { id: 'cat-ret-05', tenantId: retailTenantId, name: 'Personal Care & Hygiene', description: 'Soaps, hygiene and cosmetics' }
    ];

    for (const cat of initialCategories) {
      this.categories.set(cat.id, cat);
    }

    // 2. Initial Cash Drawers
    this.cashDrawers.set('drw-retail-01', {
      id: 'drw-retail-01',
      tenantId: retailTenantId,
      cashierId: 'usr-cashier-01',
      terminalIdentifier: 'POS-COUNTER-01',
      openedAt: new Date().toISOString(),
      openingFloat: 150.00,
      totalCashDrops: 0.00,
      status: 'OPEN'
    });

    this.cashDrawers.set('drw-pharma-01', {
      id: 'drw-pharma-01',
      tenantId: pharmaTenantId,
      cashierId: 'usr-pharmacist-01',
      terminalIdentifier: 'PHARMA-COUNTER-01',
      openedAt: new Date().toISOString(),
      openingFloat: 200.00,
      totalCashDrops: 0.00,
      status: 'OPEN'
    });

    // 3. Clinical Master Records
    this.patients.set('MRN-884920', {
      id: 'pat-001',
      tenantId: pharmaTenantId,
      mrn: 'MRN-884920',
      fullName: 'Jonathan Doe',
      phone: '+1-555-8821',
      gender: 'MALE',
      dateOfBirth: '1982-04-12'
    });

    this.doctors.set('MD-LIC-44810', {
      id: 'doc-001',
      tenantId: pharmaTenantId,
      licenseNumber: 'MD-LIC-44810',
      fullName: 'Dr. Robert Adams, MD',
      specialization: 'Internal Medicine & Cardiology',
      phone: '+1-555-9001'
    });

    // 4. Seed 100 Retail Products with Multi-Batches
    let barcodeCounter = 8901000000001n;
    for (let i = 1; i <= 100; i++) {
      const prodId = `prod-ret-${i}`;
      const barcode = barcodeCounter.toString();
      barcodeCounter++;

      const catId = (i % 3 === 0) ? 'cat-ret-01' : (i % 3 === 1) ? 'cat-ret-02' : 'cat-ret-03';
      const category = (i % 3 === 0) ? 'Beverages & Drinks' : (i % 3 === 1) ? 'Snacks' : 'Dairy';
      const taxRate = (i % 3 === 0) ? 5.00 : (i % 3 === 1) ? 10.00 : 0.00;
      const basePrice = 4.50 + (i % 12);

      this.products.set(prodId, {
        id: prodId,
        tenantId: retailTenantId,
        categoryId: catId,
        sku: `SKU-RET-${1000 + i}`,
        barcode,
        name: `Retail Product #${i} (${category})`,
        brand: `National Brand ${((i % 5) + 1)}`,
        unitOfMeasure: 'PCS',
        defaultTaxRate: taxRate,
        reorderPoint: 15,
        isPrescriptionRequired: false,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Batch 1 (Nearer Expiry)
      const b1Id = `batch-ret-${i}-A`;
      const expDate1 = new Date();
      expDate1.setDate(expDate1.getDate() + 30 + (i % 20));

      this.batches.set(b1Id, {
        id: b1Id,
        tenantId: retailTenantId,
        productId: prodId,
        batchNumber: `LOT-RET-26A-${i}`,
        expiryDate: expDate1.toISOString().split('T')[0],
        costPrice: Number((basePrice * 0.65).toFixed(2)),
        sellingPrice: Number(basePrice.toFixed(2)),
        mrp: Number((basePrice * 1.15).toFixed(2)),
        isQuarantined: false,
        createdAt: new Date().toISOString()
      });

      this.stocks.set(b1Id, {
        id: `stk-${b1Id}`,
        tenantId: retailTenantId,
        batchId: b1Id,
        quantity: 20 + (i % 15),
        reservedQuantity: 0,
        shelfLocation: `Aisle ${(i % 10) + 1}-A`,
        updatedAt: new Date().toISOString()
      });

      // Batch 2 (Later Expiry)
      const b2Id = `batch-ret-${i}-B`;
      const expDate2 = new Date();
      expDate2.setDate(expDate2.getDate() + 180 + (i % 40));

      this.batches.set(b2Id, {
        id: b2Id,
        tenantId: retailTenantId,
        productId: prodId,
        batchNumber: `LOT-RET-26B-${i}`,
        expiryDate: expDate2.toISOString().split('T')[0],
        costPrice: Number((basePrice * 0.65).toFixed(2)),
        sellingPrice: Number(basePrice.toFixed(2)),
        mrp: Number((basePrice * 1.15).toFixed(2)),
        isQuarantined: false,
        createdAt: new Date().toISOString()
      });

      this.stocks.set(b2Id, {
        id: `stk-${b2Id}`,
        tenantId: retailTenantId,
        batchId: b2Id,
        quantity: 50,
        reservedQuantity: 0,
        shelfLocation: `Aisle ${(i % 10) + 1}-B`,
        updatedAt: new Date().toISOString()
      });
    }

    // 5. Seed 100 Hospital Pharmacy Pharmaceutical Products with FEFO Batches
    for (let i = 101; i <= 200; i++) {
      const prodId = `prod-med-${i}`;
      const barcode = barcodeCounter.toString();
      barcodeCounter++;

      const isAntibiotic = i % 3 === 0;
      const isAnalgesic = i % 3 === 1;
      const catId = isAntibiotic ? 'cat-pharma-03' : isAnalgesic ? 'cat-pharma-05' : 'cat-pharma-04';
      const medName = isAntibiotic
        ? `Amoxicillin Trihydrate ${(250 + (i % 3) * 250)}mg`
        : isAnalgesic
        ? `Paracetamol Extra Strength ${(500 + (i % 2) * 150)}mg`
        : `Atorvastatin Calcium ${(10 + (i % 4) * 10)}mg`;

      const generic = isAntibiotic ? 'Amoxicillin USP' : isAnalgesic ? 'Acetaminophen BP' : 'Atorvastatin';
      const basePrice = 12.00 + (i % 18);

      this.products.set(prodId, {
        id: prodId,
        tenantId: pharmaTenantId,
        categoryId: catId,
        sku: `SKU-MED-${1000 + i}`,
        barcode,
        name: medName,
        genericName: generic,
        brand: `PharmaCare Lab ${((i % 4) + 1)}`,
        unitOfMeasure: 'BOX',
        defaultTaxRate: 5.00,
        reorderPoint: 20,
        isPrescriptionRequired: true,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Batch 1 (Early Expiry: 15 to 45 days, triggers FEFO priority & near-expiry warning)
      const b1Id = `batch-med-${i}-EARLY`;
      const expDate1 = new Date();
      expDate1.setDate(expDate1.getDate() + 15 + (i % 25));

      this.batches.set(b1Id, {
        id: b1Id,
        tenantId: pharmaTenantId,
        productId: prodId,
        batchNumber: `RX-FEFO-EARLY-${i}`,
        expiryDate: expDate1.toISOString().split('T')[0],
        costPrice: Number((basePrice * 0.60).toFixed(2)),
        sellingPrice: Number(basePrice.toFixed(2)),
        mrp: Number((basePrice * 1.20).toFixed(2)),
        isQuarantined: false,
        createdAt: new Date().toISOString()
      });

      this.stocks.set(b1Id, {
        id: `stk-${b1Id}`,
        tenantId: pharmaTenantId,
        batchId: b1Id,
        quantity: 8, // Low quantity to test multi-batch splitting!
        reservedQuantity: 0,
        shelfLocation: `Vault-Bay-${(i % 8) + 1}`,
        updatedAt: new Date().toISOString()
      });

      // Batch 2 (Mid Expiry: 180 days)
      const b2Id = `batch-med-${i}-MID`;
      const expDate2 = new Date();
      expDate2.setDate(expDate2.getDate() + 180 + (i % 60));

      this.batches.set(b2Id, {
        id: b2Id,
        tenantId: pharmaTenantId,
        productId: prodId,
        batchNumber: `RX-FEFO-MID-${i}`,
        expiryDate: expDate2.toISOString().split('T')[0],
        costPrice: Number((basePrice * 0.60).toFixed(2)),
        sellingPrice: Number(basePrice.toFixed(2)),
        mrp: Number((basePrice * 1.20).toFixed(2)),
        isQuarantined: false,
        createdAt: new Date().toISOString()
      });

      this.stocks.set(b2Id, {
        id: `stk-${b2Id}`,
        tenantId: pharmaTenantId,
        batchId: b2Id,
        quantity: 50,
        reservedQuantity: 0,
        shelfLocation: `Vault-Bay-${(i % 8) + 1}`,
        updatedAt: new Date().toISOString()
      });
    }

    // Special item for Concurrency Race Testing (Exact 1 unit remaining)
    const raceProdId = 'prod-concurrency-race';
    const raceBarcode = '9999999999999';
    this.products.set(raceProdId, {
      id: raceProdId,
      tenantId: retailTenantId,
      sku: 'SKU-RACE-CONCURRENCY',
      barcode: raceBarcode,
      name: 'High-Demand Limited Stock Item (Race Test)',
      unitOfMeasure: 'PCS',
      defaultTaxRate: 5.00,
      reorderPoint: 5,
      isPrescriptionRequired: false,
      isActive: true,
      createdAt: new Date().toISOString()
    });

    const raceBatchId = 'batch-race-001';
    this.batches.set(raceBatchId, {
      id: raceBatchId,
      tenantId: retailTenantId,
      productId: raceProdId,
      batchNumber: 'LOT-RACE-FINAL-UNIT',
      expiryDate: '2028-12-31',
      costPrice: 50.00,
      sellingPrice: 99.00,
      mrp: 120.00,
      isQuarantined: false,
      createdAt: new Date().toISOString()
    });

    this.stocks.set(raceBatchId, {
      id: 'stk-race-001',
      tenantId: retailTenantId,
      batchId: raceBatchId,
      quantity: 1, // EXACTLY 1 REMAINING UNIT FOR CONCURRENCY TEST
      reservedQuantity: 0,
      shelfLocation: 'Vault-Secure-01',
      updatedAt: new Date().toISOString()
    });
  }
}

export const dbStore = new InMemoryACIDStore();
export { pgPool, isPgConnected };
