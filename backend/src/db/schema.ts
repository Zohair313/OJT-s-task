import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export async function runPgMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    console.log('🔄 [MIGRATION] Ensuring extensions, enums, and tables exist in PostgreSQL...');
    await client.query('BEGIN');

    // 1. Extensions
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    // 2. Custom Enumerated Types
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_domain_enum') THEN
          CREATE TYPE tenant_domain_enum AS ENUM ('RETAIL_SUPERMARKET', 'HOSPITAL_PHARMACY');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
          CREATE TYPE user_role_enum AS ENUM ('ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'CASHIER', 'AUDITOR');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'movement_type_enum') THEN
          CREATE TYPE movement_type_enum AS ENUM ('PURCHASE_INWARD', 'SALE_DEDUCTION', 'SALE_RETURN', 'AUDIT_ADJUSTMENT', 'EXPIRED_QUARANTINE', 'DAMAGE_DISPOSAL');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_enum') THEN
          CREATE TYPE payment_method_enum AS ENUM ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI_QR', 'STORE_CREDIT', 'INSURANCE_SPLIT');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum') THEN
          CREATE TYPE invoice_status_enum AS ENUM ('COMPLETED', 'VOIDED', 'REFUNDED', 'PENDING_PAYMENT');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'drawer_status_enum') THEN
          CREATE TYPE drawer_status_enum AS ENUM ('OPEN', 'CLOSED');
        END IF;
      END $$;
    `);

    // 3. Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        domain_type tenant_domain_enum NOT NULL DEFAULT 'RETAIL_SUPERMARKET',
        tax_identifier VARCHAR(100),
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        phone VARCHAR(50),
        address TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role user_role_enum NOT NULL DEFAULT 'CASHIER',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_username UNIQUE (tenant_id, username),
        CONSTRAINT uq_tenant_email UNIQUE (tenant_id, email)
      );

      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_category_name UNIQUE (tenant_id, name)
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(150),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        category_id VARCHAR(100) REFERENCES categories(id) ON DELETE SET NULL,
        sku VARCHAR(100) NOT NULL,
        barcode VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        generic_name VARCHAR(255),
        brand VARCHAR(150),
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'PCS',
        default_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (default_tax_rate >= 0),
        reorder_point INT NOT NULL DEFAULT 10 CHECK (reorder_point >= 0),
        is_prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_sku UNIQUE (tenant_id, sku),
        CONSTRAINT uq_tenant_barcode UNIQUE (tenant_id, barcode)
      );

      CREATE TABLE IF NOT EXISTS batches (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        product_id VARCHAR(100) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        supplier_id VARCHAR(100) REFERENCES suppliers(id) ON DELETE SET NULL,
        batch_number VARCHAR(100) NOT NULL,
        manufacturing_date DATE,
        expiry_date DATE NOT NULL,
        cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
        selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (selling_price >= 0),
        mrp NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (mrp >= 0),
        is_quarantined BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_product_batch UNIQUE (product_id, batch_number)
      );

      CREATE TABLE IF NOT EXISTS inventory_stocks (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        batch_id VARCHAR(100) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
        shelf_location VARCHAR(100),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_batch_stock UNIQUE (batch_id)
      );

      CREATE TABLE IF NOT EXISTS patients (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        mrn VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        gender VARCHAR(20),
        date_of_birth DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_patient_mrn UNIQUE (tenant_id, mrn)
      );

      CREATE TABLE IF NOT EXISTS doctors (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        license_number VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        specialization VARCHAR(150),
        phone VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_doctor_license UNIQUE (tenant_id, license_number)
      );

      CREATE TABLE IF NOT EXISTS cash_drawers (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cashier_id VARCHAR(100) NOT NULL,
        terminal_identifier VARCHAR(100) NOT NULL DEFAULT 'POS-COUNTER-01',
        opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        opening_float NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
        total_cash_drops NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_cash_drops >= 0),
        closing_cash NUMERIC(12, 2),
        status drawer_status_enum NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cashier_id VARCHAR(100) NOT NULL,
        drawer_id VARCHAR(100) NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
        invoice_number VARCHAR(100) NOT NULL,
        patient_id VARCHAR(100) REFERENCES patients(id) ON DELETE SET NULL,
        doctor_id VARCHAR(100) REFERENCES doctors(id) ON DELETE SET NULL,
        prescription_number VARCHAR(100),
        subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        round_off NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
        grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        status invoice_status_enum NOT NULL DEFAULT 'COMPLETED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tenant_invoice_number UNIQUE (tenant_id, invoice_number)
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id VARCHAR(100) PRIMARY KEY,
        invoice_id VARCHAR(100) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        product_id VARCHAR(100) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        batch_id VARCHAR(100) NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
        tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
        tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(100) PRIMARY KEY,
        invoice_id VARCHAR(100) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        payment_method payment_method_enum NOT NULL DEFAULT 'CASH',
        amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
        tendered_amount NUMERIC(12, 2) NOT NULL CHECK (tendered_amount >= amount),
        change_due NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (change_due >= 0),
        transaction_reference VARCHAR(150),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        batch_id VARCHAR(100) NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
        invoice_id VARCHAR(100) REFERENCES invoices(id) ON DELETE SET NULL,
        user_id VARCHAR(100),
        movement_type movement_type_enum NOT NULL,
        quantity_changed INT NOT NULL,
        quantity_after INT NOT NULL CHECK (quantity_after >= 0),
        reference_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS z_reports (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        drawer_id VARCHAR(100) NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
        report_code VARCHAR(100) NOT NULL,
        total_cash_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_card_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_upi_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_tax_collected NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_discounts_given NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        gross_margin NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        expected_cash_in_drawer NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        actual_counted_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        cash_variance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        discrepancy_reason TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_drawer_z_report UNIQUE (drawer_id),
        CONSTRAINT uq_tenant_z_report_code UNIQUE (tenant_id, report_code)
      );
    `);

    // 4. Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode ON products (tenant_id, barcode);
      CREATE INDEX IF NOT EXISTS idx_products_tenant_sku ON products (tenant_id, sku);
      CREATE INDEX IF NOT EXISTS idx_batches_product_expiry ON batches (product_id, expiry_date ASC) WHERE is_quarantined = FALSE;
      CREATE INDEX IF NOT EXISTS idx_stocks_batch ON inventory_stocks (batch_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON invoices (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements (batch_id, created_at DESC);
    `);

    await client.query('COMMIT');
    console.log('✅ [MIGRATION] PostgreSQL schema verified and up to date.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [MIGRATION] Failed to apply PostgreSQL migrations:', err);
    throw err;
  } finally {
    client.release();
  }
}
