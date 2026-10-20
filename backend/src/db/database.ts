import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  Tenant, Product, Batch, InventoryStock, BatchWithStock,
  Invoice, InvoiceItem, CashDrawer, ZReport, StockMovement,
  Patient, Doctor, Supplier, Category
} from '../types/index.js';
import { runPgMigrations } from './schema.js';
import { seedPgIfEmpty } from './seedPg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// PostgreSQL Connection Pool (Neon Cloud or Native PostgreSQL)
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export let isPgConnected = false;

// ============================================================================
// POSTGRESQL-BACKED ACID STORE & CACHE
// Eliminates all hardcoded data. Fetches and persists directly in PostgreSQL.
// ============================================================================

export class PostgreSQLACIDStore {
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

  // Active Row Locks for In-Memory Concurrency Fallback
  private activeRowLocks: Map<string, Promise<void>> = new Map();
  private lockResolvers: Map<string, () => void> = new Map();

  constructor() {
    // Zero hardcoded mock data! Data is loaded directly from PostgreSQL on connection.
  }

  /**
   * Synchronize in-memory cache directly from live PostgreSQL database
   */
  public async loadFromPg(pool: Pool) {
    const client = await pool.connect();
    try {
      this.tenants.clear();
      this.categories.clear();
      this.suppliers.clear();
      this.products.clear();
      this.batches.clear();
      this.stocks.clear();
      this.cashDrawers.clear();
      this.invoices.clear();
      this.invoiceItems.clear();
      this.zReports.clear();
      this.patients.clear();
      this.doctors.clear();

      // 1. Tenants
      const tRes = await client.query('SELECT * FROM tenants WHERE is_active = TRUE');
      for (const r of tRes.rows) {
        this.tenants.set(r.id, {
          id: r.id,
          name: r.name,
          domainType: r.domain_type,
          taxIdentifier: r.tax_identifier,
          currency: r.currency,
          phone: r.phone,
          address: r.address,
          isActive: r.is_active,
          createdAt: r.created_at
        });
      }

      // 2. Categories
      const cRes = await client.query('SELECT * FROM categories');
      for (const r of cRes.rows) {
        this.categories.set(r.id, {
          id: r.id,
          tenantId: r.tenant_id,
          name: r.name,
          description: r.description
        });
      }

      // 3. Products
      const pRes = await client.query('SELECT * FROM products ORDER BY created_at DESC');
      for (const r of pRes.rows) {
        this.products.set(r.id, {
          id: r.id,
          tenantId: r.tenant_id,
          categoryId: r.category_id,
          sku: r.sku,
          barcode: r.barcode,
          name: r.name,
          genericName: r.generic_name,
          brand: r.brand,
          unitOfMeasure: r.unit_of_measure,
          defaultTaxRate: parseFloat(r.default_tax_rate) || 0,
          reorderPoint: parseInt(r.reorder_point, 10) || 0,
          isPrescriptionRequired: r.is_prescription_required,
          isActive: r.is_active,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        });
      }

      // 4. Batches
      const bRes = await client.query('SELECT * FROM batches WHERE is_quarantined = FALSE');
      for (const r of bRes.rows) {
        this.batches.set(r.id, {
          id: r.id,
          tenantId: r.tenant_id,
          productId: r.product_id,
          supplierId: r.supplier_id,
          batchNumber: r.batch_number,
          manufacturingDate: r.manufacturing_date,
          expiryDate: r.expiry_date ? new Date(r.expiry_date).toISOString().split('T')[0] : '',
          costPrice: parseFloat(r.cost_price) || 0,
          sellingPrice: parseFloat(r.selling_price) || 0,
          mrp: parseFloat(r.mrp) || 0,
          isQuarantined: r.is_quarantined,
          createdAt: r.created_at
        });
      }

      // 5. Stocks
      const sRes = await client.query('SELECT * FROM inventory_stocks');
      for (const r of sRes.rows) {
        this.stocks.set(r.batch_id, {
          id: r.id,
          tenantId: r.tenant_id,
          batchId: r.batch_id,
          quantity: parseInt(r.quantity, 10) || 0,
          reservedQuantity: parseInt(r.reserved_quantity, 10) || 0,
          shelfLocation: r.shelf_location,
          updatedAt: r.updated_at
        });
      }

      // 5b. Suppliers (previously never loaded — supplier lookups were always empty)
      const supRes = await client.query('SELECT * FROM suppliers');
      for (const r of supRes.rows) {
        this.suppliers.set(r.id, {
          id: r.id,
          tenantId: r.tenant_id,
          name: r.name,
          contactPerson: r.contact_person,
          phone: r.phone,
          email: r.email,
          address: r.address
        });
      }

      // 5c. Stock Movements (bounded audit trail: last 5000 to cap memory)
      const mvRes = await client.query(
        'SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 5000'
      );
      this.stockMovements = mvRes.rows.reverse().map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        batchId: r.batch_id,
        invoiceId: r.invoice_id,
        movementType: r.movement_type,
        quantityChanged: parseInt(r.quantity_changed, 10) || 0,
        quantityAfter: parseInt(r.quantity_after, 10) || 0,
        referenceNote: r.reference_note,
        createdAt: r.created_at
      }));

      // 6. Cash Drawers
      const dRes = await client.query('SELECT * FROM cash_drawers ORDER BY opened_at DESC');
      for (const r of dRes.rows) {
        this.cashDrawers.set(r.id, {
          id: r.id,
          tenantId: r.tenant_id,
          cashierId: r.cashier_id,
          terminalIdentifier: r.terminal_identifier,
          openedAt: r.opened_at,
          closedAt: r.closed_at,
          openingFloat: parseFloat(r.opening_float) || 0,
          totalCashDrops: parseFloat(r.total_cash_drops) || 0,
          closingCash: r.closing_cash ? parseFloat(r.closing_cash) : undefined,
          status: r.status
        });
      }

      // 7. Patients, Doctors & Sales History (invoices, payments, z-reports)
      // Rehydrated after restart — previously these maps were cleared but never
      // re-populated, wiping receipt lookups and Z-Reports on every restart.
      await this.loadSalesHistoryFromPg(client);

      console.log('\x1b[32m%s\x1b[0m', `✅ [POSTGRESQL] Loaded ${this.products.size} products, ${this.batches.size} batches, ${this.categories.size} categories, ${this.invoices.size} invoices from PostgreSQL database.`);
    } finally {
      client.release();
    }
  }

  /**
   * Reload sales history (invoices, invoice items, payments, z-reports) from PostgreSQL.
   * Previously these maps were cleared but never re-populated, so every server restart
   * wiped receipt lookups and Z-Report reconciliation.
   */
  private async loadSalesHistoryFromPg(client: { query: (text: string, params?: any[]) => Promise<any> }) {
    // Patients & Doctors (needed to hydrate invoice clinical fields)
    const patRes = await client.query('SELECT * FROM patients');
    for (const r of patRes.rows) {
      this.patients.set(r.id, {
        id: r.id,
        tenantId: r.tenant_id,
        mrn: r.mrn,
        fullName: r.full_name,
        phone: r.phone,
        gender: r.gender,
        dateOfBirth: r.date_of_birth
      });
    }

    const docRes = await client.query('SELECT * FROM doctors');
    for (const r of docRes.rows) {
      this.doctors.set(r.id, {
        id: r.id,
        tenantId: r.tenant_id,
        licenseNumber: r.license_number,
        fullName: r.full_name,
        specialization: r.specialization,
        phone: r.phone
      });
    }

    // Invoices + Invoice Items + Payments (bounded to recent 2000 invoices)
    const invRes = await client.query(
      'SELECT * FROM invoices ORDER BY created_at DESC LIMIT 2000'
    );
    const invIds = invRes.rows.map((r: any) => r.id);

    const itemsByInvoice = new Map<string, InvoiceItem[]>();
    const paymentsByInvoice = new Map<string, any>();
    if (invIds.length > 0) {
      const itRes = await client.query(
        'SELECT * FROM invoice_items WHERE invoice_id = ANY($1::varchar[]) ORDER BY created_at ASC',
        [invIds]
      );
      for (const r of itRes.rows) {
        const item: InvoiceItem = {
          id: r.id,
          invoiceId: r.invoice_id,
          productId: r.product_id,
          batchId: r.batch_id,
          productName: r.product_name ?? '',
          batchNumber: r.batch_number ?? '',
          expiryDate: r.expiry_date ? new Date(r.expiry_date).toISOString().split('T')[0] : '',
          quantity: parseInt(r.quantity, 10) || 0,
          unitPrice: parseFloat(r.unit_price) || 0,
          taxRate: parseFloat(r.tax_rate) || 0,
          taxAmount: parseFloat(r.tax_amount) || 0,
          discountAmount: parseFloat(r.discount_amount) || 0,
          lineTotal: parseFloat(r.line_total) || 0
        };
        const list = itemsByInvoice.get(r.invoice_id) || [];
        list.push(item);
        itemsByInvoice.set(r.invoice_id, list);
        this.invoiceItems.set(item.id, item);
      }

      const payRes = await client.query(
        'SELECT * FROM payments WHERE invoice_id = ANY($1::varchar[])',
        [invIds]
      );
      for (const r of payRes.rows) {
        paymentsByInvoice.set(r.invoice_id, {
          method: r.payment_method,
          tenderedAmount: parseFloat(r.tendered_amount) || 0,
          changeDue: parseFloat(r.change_due) || 0
        });
      }
    }

    for (const r of invRes.rows) {
      const pay = paymentsByInvoice.get(r.id);
      const pat = r.patient_id ? this.patients.get(r.patient_id) : undefined;
      const doc = r.doctor_id ? this.doctors.get(r.doctor_id) : undefined;
      this.invoices.set(r.id, {
        id: r.id,
        tenantId: r.tenant_id,
        cashierId: r.cashier_id,
        drawerId: r.drawer_id,
        invoiceNumber: r.invoice_number,
        patientId: pat?.mrn,
        patientName: pat?.fullName,
        doctorLicense: doc?.licenseNumber,
        prescriptionNumber: r.prescription_number,
        subtotal: parseFloat(r.subtotal) || 0,
        discountAmount: parseFloat(r.discount_amount) || 0,
        taxAmount: parseFloat(r.tax_amount) || 0,
        roundOff: parseFloat(r.round_off) || 0,
        grandTotal: parseFloat(r.grand_total) || 0,
        paymentMethod: pay?.method ?? r.payment_method ?? 'CASH',
        tenderedAmount: pay?.tenderedAmount,
        changeDue: pay?.changeDue,
        status: r.status,
        items: itemsByInvoice.get(r.id) || [],
        createdAt: r.created_at
      });
    }

    // Z-Reports (reloaded so drawer reconciliation survives restarts)
    const zRes = await client.query('SELECT * FROM z_reports ORDER BY generated_at DESC LIMIT 500');
    for (const r of zRes.rows) {
      this.zReports.set(r.id, {
        id: r.id,
        tenantId: r.tenant_id,
        drawerId: r.drawer_id,
        reportCode: r.report_code,
        totalCashSales: parseFloat(r.total_cash_sales) || 0,
        totalCardSales: parseFloat(r.total_card_sales) || 0,
        totalUpiSales: parseFloat(r.total_upi_sales) || 0,
        totalTaxCollected: parseFloat(r.total_tax_collected) || 0,
        totalDiscountsGiven: parseFloat(r.total_discounts_given) || 0,
        grossMargin: parseFloat(r.gross_margin) || 0,
        expectedCashInDrawer: parseFloat(r.expected_cash_in_drawer) || 0,
        actualCountedCash: parseFloat(r.actual_counted_cash) || 0,
        cashVariance: parseFloat(r.cash_variance) || 0,
        discrepancyReason: r.discrepancy_reason || undefined,
        generatedAt: r.generated_at
      });
    }
  }

  /**
   * Acquire Pessimistic Row Lock (SELECT ... FOR UPDATE equivalent)
   */
  public async acquireRowLocks(batchIds: string[]): Promise<() => void> {
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
}

export const dbStore = new PostgreSQLACIDStore();

// ============================================================================
// INITIALIZE POSTGRESQL CONNECTION & SCHEMA
// ============================================================================
export async function initializeDatabase() {
  try {
    const client = await pgPool.connect();
    isPgConnected = true;
    console.log('\x1b[32m%s\x1b[0m', '✅ [DATABASE] Successfully connected to PostgreSQL instance.');
    client.release();

    // 1. Run migrations to ensure all tables exist
    await runPgMigrations(pgPool);

    // 2. Seed initial data if database is fresh
    await seedPgIfEmpty(pgPool);

    // 3. Load active data from PostgreSQL into dbStore
    await dbStore.loadFromPg(pgPool);
  } catch (err: any) {
    isPgConnected = false;
    console.log('\x1b[31m%s\x1b[0m', `❌ [DATABASE] PostgreSQL connection failed: ${err.message}`);
  }
}

// Automatically trigger initialization.
// `dbReady` lets callers await full init (connect + migrate + seed + hydrate)
// instead of racing against it — the standalone concurrency test previously
// ran before `isPgConnected` flipped, silently skipping all PG writes.
export const dbReady = initializeDatabase();
