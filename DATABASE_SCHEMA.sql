-- ============================================================================
-- Enterprise Multi-Tenant POS & Inventory Management SaaS
-- Production PostgreSQL DDL Schema & Seeder Script
-- Compatible with PostgreSQL 14, 15, 16+
-- ============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom Enumerated Types
CREATE TYPE tenant_domain_enum AS ENUM (
    'RETAIL_SUPERMARKET',
    'HOSPITAL_PHARMACY'
);

CREATE TYPE user_role_enum AS ENUM (
    'ADMIN',
    'STORE_MANAGER',
    'PHARMACIST',
    'CASHIER',
    'AUDITOR'
);

CREATE TYPE movement_type_enum AS ENUM (
    'PURCHASE_INWARD',
    'SALE_DEDUCTION',
    'SALE_RETURN',
    'AUDIT_ADJUSTMENT',
    'EXPIRED_QUARANTINE',
    'DAMAGE_DISPOSAL'
);

CREATE TYPE payment_method_enum AS ENUM (
    'CASH',
    'CREDIT_CARD',
    'DEBIT_CARD',
    'UPI_QR',
    'STORE_CREDIT',
    'INSURANCE_SPLIT'
);

CREATE TYPE invoice_status_enum AS ENUM (
    'COMPLETED',
    'VOIDED',
    'REFUNDED',
    'PENDING_PAYMENT'
);

CREATE TYPE drawer_status_enum AS ENUM (
    'OPEN',
    'CLOSED'
);

-- ============================================================================
-- 3. Core Database Tables
-- ============================================================================

-- 3.1 Tenants Table (Multi-Tenancy Discriminator)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- 3.2 Users Table (Cashiers, Pharmacists, Managers)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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

-- 3.3 Product Categories
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_category_name UNIQUE (tenant_id, name)
);

-- 3.4 Suppliers / Vendors
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    tax_number VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3.5 Products Table (Master Catalog)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    sku VARCHAR(100) NOT NULL,
    barcode VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),             -- Clinical pharmaceutical name
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

-- 3.6 Batches Table (Lot-level FEFO Tracking)
CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    batch_number VARCHAR(100) NOT NULL,
    manufacturing_date DATE,
    expiry_date DATE NOT NULL,
    cost_price NUMERIC(12, 2) NOT NULL CHECK (cost_price >= 0),
    selling_price NUMERIC(12, 2) NOT NULL CHECK (selling_price >= 0),
    mrp NUMERIC(12, 2) NOT NULL CHECK (mrp >= selling_price),
    is_quarantined BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_batch UNIQUE (product_id, batch_number)
);

-- 3.7 Inventory Stocks Table (Physical On-Hand Quantity per Batch)
CREATE TABLE inventory_stocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    shelf_location VARCHAR(100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_stock UNIQUE (batch_id),
    CONSTRAINT chk_qty_reserved CHECK (quantity >= reserved_quantity)
);

-- 3.8 Patients Table (Hospital Pharmacy Domain)
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mrn VARCHAR(100) NOT NULL,               -- Medical Record Number
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    gender VARCHAR(20),
    date_of_birth DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_patient_mrn UNIQUE (tenant_id, mrn)
);

-- 3.9 Doctors Table (Hospital Pharmacy Prescriptions)
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    license_number VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    specialization VARCHAR(150),
    phone VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_doctor_license UNIQUE (tenant_id, license_number)
);

-- 3.10 Cash Drawers Table (Shift Tracking)
CREATE TABLE cash_drawers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cashier_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    terminal_identifier VARCHAR(100) NOT NULL DEFAULT 'POS-COUNTER-01',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    opening_float NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
    total_cash_drops NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_cash_drops >= 0),
    closing_cash NUMERIC(12, 2) CHECK (closing_cash >= 0),
    status drawer_status_enum NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3.11 Invoices Table (Fiscal Sales Receipts)
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cashier_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    drawer_id UUID NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(100) NOT NULL,
    
    -- Hospital Clinical Fields (Optional in retail, required for pharmacy)
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
    prescription_number VARCHAR(100),
    
    -- Monetary Ledgers (Strict numeric 2-decimal precision)
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    round_off NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    
    status invoice_status_enum NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_invoice_number UNIQUE (tenant_id, invoice_number)
);

-- 3.12 Invoice Items Table (Batch-Specific Line Items)
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3.13 Payments Table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_method payment_method_enum NOT NULL DEFAULT 'CASH',
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    tendered_amount NUMERIC(12, 2) NOT NULL CHECK (tendered_amount >= amount),
    change_due NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (change_due >= 0),
    transaction_reference VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3.14 Stock Movements Table (Immutable Audit Ledger)
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    movement_type movement_type_enum NOT NULL,
    quantity_changed INT NOT NULL,           -- Negative for sales, positive for inwards
    quantity_after INT NOT NULL CHECK (quantity_after >= 0),
    reference_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3.15 Z-Reports Table (End-of-Day Fiscal Cashier Balancing)
CREATE TABLE z_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    drawer_id UUID NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
    report_code VARCHAR(100) NOT NULL,
    total_cash_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_card_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_upi_sales NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_tax_collected NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_discounts_given NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gross_margin NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    expected_cash_in_drawer NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    actual_counted_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cash_variance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,   -- Counted - Expected
    discrepancy_reason TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_drawer_z_report UNIQUE (drawer_id),
    CONSTRAINT uq_tenant_z_report_code UNIQUE (tenant_id, report_code)
);

-- ============================================================================
-- 4. High-Performance Indexes
-- ============================================================================
CREATE INDEX idx_products_tenant_barcode ON products (tenant_id, barcode);
CREATE INDEX idx_products_tenant_sku ON products (tenant_id, sku);
CREATE INDEX idx_products_tenant_name ON products USING gin (to_tsvector('english', name));

-- Fast FEFO query index: orders batches by product and earliest expiration date
CREATE INDEX idx_batches_product_expiry ON batches (product_id, expiry_date ASC) WHERE is_quarantined = FALSE;

CREATE INDEX idx_stocks_batch ON inventory_stocks (batch_id);
CREATE INDEX idx_invoices_tenant_created ON invoices (tenant_id, created_at DESC);
CREATE INDEX idx_stock_movements_batch ON stock_movements (batch_id, created_at DESC);

-- ============================================================================
-- 5. ACID Concurrency Demo: Pessimistic Locking Checkout Routine
-- ============================================================================
-- Note: When executing in application code (Node.js/Go/Python), wrap inside BEGIN / COMMIT:
/*
  BEGIN;
  
  -- 1. Lock targeted batches in strictly sorted order to eliminate deadlocks
  SELECT s.id, s.batch_id, s.quantity, b.selling_price, b.expiry_date
  FROM inventory_stocks s
  JOIN batches b ON s.batch_id = b.id
  WHERE s.batch_id IN ('b-001', 'b-005')
  ORDER BY s.batch_id ASC
  FOR UPDATE OF s;
  
  -- 2. Verify: If any s.quantity < requested_qty, issue ROLLBACK and abort.
  
  -- 3. Deduct stock atomically
  UPDATE inventory_stocks
  SET quantity = quantity - 2, updated_at = CURRENT_TIMESTAMP
  WHERE batch_id = 'b-001';

  -- 4. Insert Invoice and Invoice Items
  INSERT INTO invoices (tenant_id, cashier_id, drawer_id, invoice_number, subtotal, tax_amount, grand_total)
  VALUES ('...', '...', '...', 'INV-2026-0001', 25.00, 1.25, 26.25);
  
  -- 5. Record immutable Stock Audit Movement
  INSERT INTO stock_movements (tenant_id, batch_id, movement_type, quantity_changed, quantity_after)
  VALUES ('...', 'b-001', 'SALE_DEDUCTION', -2, 8);
  
  COMMIT;
*/

-- ============================================================================
-- 6. Comprehensive Seed Script (200+ Realistic Mock Items & Batches)
-- ============================================================================

DO $$
DECLARE
    v_retail_tenant_id UUID := gen_random_uuid();
    v_pharma_tenant_id UUID := gen_random_uuid();
    v_cashier_id UUID := gen_random_uuid();
    v_pharmacist_id UUID := gen_random_uuid();
    v_drawer_id UUID := gen_random_uuid();
    v_cat_beverages UUID := gen_random_uuid();
    v_cat_snacks UUID := gen_random_uuid();
    v_cat_dairy UUID := gen_random_uuid();
    v_cat_antibiotics UUID := gen_random_uuid();
    v_cat_analgesics UUID := gen_random_uuid();
    v_cat_cardiac UUID := gen_random_uuid();
    v_supp_unilever UUID := gen_random_uuid();
    v_supp_pfizer UUID := gen_random_uuid();
    v_prod_id UUID;
    v_batch_id UUID;
    v_barcode_num BIGINT := 8901000000001;
    v_sku_num INT := 1000;
    i INT;
BEGIN
    -- 6.1 Create Tenants
    INSERT INTO tenants (id, name, domain_type, tax_identifier, currency, phone, address)
    VALUES 
    (v_retail_tenant_id, 'Metro Supermarket Flagship', 'RETAIL_SUPERMARKET', 'TX-RET-99201', 'USD', '+1-555-0199', '100 Broadway, New York, NY'),
    (v_pharma_tenant_id, 'St. Jude Memorial Hospital Pharmacy', 'HOSPITAL_PHARMACY', 'TX-MED-44102', 'USD', '+1-555-0244', '500 Medical Center Blvd, Chicago, IL');

    -- 6.2 Create Users
    INSERT INTO users (id, tenant_id, username, email, password_hash, full_name, role)
    VALUES 
    (v_cashier_id, v_retail_tenant_id, 'cashier1', 'cashier1@metro.com', '$2b$12$eA...hash', 'Sarah Jenkins', 'CASHIER'),
    (v_pharmacist_id, v_pharma_tenant_id, 'dr_alex', 'alex.reed@stjude.org', '$2b$12$eA...hash', 'Dr. Alex Reed, PharmD', 'PHARMACIST');

    -- 6.3 Create Cash Drawer Session
    INSERT INTO cash_drawers (id, tenant_id, cashier_id, terminal_identifier, opening_float, status)
    VALUES (v_drawer_id, v_retail_tenant_id, v_cashier_id, 'POS-COUNTER-01', 150.00, 'OPEN');

    -- 6.4 Create Suppliers
    INSERT INTO suppliers (id, tenant_id, name, contact_person, phone, email)
    VALUES 
    (v_supp_unilever, v_retail_tenant_id, 'Unilever FMCG Distribution', 'Marcus Vance', '+1-800-555-011', 'orders@unilever.com'),
    (v_supp_pfizer, v_pharma_tenant_id, 'Pfizer Global Pharmaceuticals', 'Dr. Elena Rostova', '+1-800-555-022', 'supply@pfizer.com');

    -- 6.5 Create Categories
    INSERT INTO categories (id, tenant_id, name, description)
    VALUES 
    (v_cat_beverages, v_retail_tenant_id, 'Beverages & Soft Drinks', 'Cold beverages, juices, bottled water'),
    (v_cat_snacks, v_retail_tenant_id, 'Packaged Snacks & Confectionery', 'Chips, biscuits, chocolates'),
    (v_cat_dairy, v_retail_tenant_id, 'Dairy & Refrigerated', 'Milk, cheese, butter, yogurt'),
    (v_cat_antibiotics, v_pharma_tenant_id, 'Antibiotics & Antimicrobials', 'Prescription antibiotics'),
    (v_cat_analgesics, v_pharma_tenant_id, 'Analgesics & Antipyretics', 'Pain relief, fever medication'),
    (v_cat_cardiac, v_pharma_tenant_id, 'Cardiovascular & Hypertension', 'Heart disease management');

    -- 6.6 Seed 100 Retail Supermarket Products with Multi-Batches
    FOR i IN 1..100 LOOP
        v_prod_id := gen_random_uuid();
        INSERT INTO products (
            id, tenant_id, category_id, sku, barcode, name, generic_name, brand, 
            unit_of_measure, default_tax_rate, reorder_point, is_prescription_required
        ) VALUES (
            v_prod_id,
            v_retail_tenant_id,
            CASE (i % 3) WHEN 0 THEN v_cat_beverages WHEN 1 THEN v_cat_snacks ELSE v_cat_dairy END,
            'SKU-RET-' || (v_sku_num + i),
            v_barcode_num::VARCHAR,
            'Retail Product Item #' || i || ' (' || CASE (i % 3) WHEN 0 THEN 'Beverage' WHEN 1 THEN 'Snack' ELSE 'Dairy' END || ')',
            NULL,
            'National Brand ' || ((i % 5) + 1),
            'PCS',
            CASE (i % 3) WHEN 0 THEN 5.00 WHEN 1 THEN 10.00 ELSE 0.00 END,
            15,
            FALSE
        );

        -- Add Batch #1 (Nearer Expiry)
        v_batch_id := gen_random_uuid();
        INSERT INTO batches (
            id, tenant_id, product_id, supplier_id, batch_number, 
            manufacturing_date, expiry_date, cost_price, selling_price, mrp
        ) VALUES (
            v_batch_id,
            v_retail_tenant_id,
            v_prod_id,
            v_supp_unilever,
            'LOT-RET-26A-' || i,
            CURRENT_DATE - INTERVAL '60 days',
            CURRENT_DATE + INTERVAL '45 days',
            (5.00 + (i % 10))::NUMERIC(12,2),
            (8.50 + (i % 10))::NUMERIC(12,2),
            (10.00 + (i % 10))::NUMERIC(12,2)
        );

        INSERT INTO inventory_stocks (tenant_id, batch_id, quantity, reserved_quantity, shelf_location)
        VALUES (v_retail_tenant_id, v_batch_id, 25 + (i % 20), 0, 'Aisle ' || ((i % 10) + 1) || '-Shelf-A');

        -- Add Batch #2 (Later Expiry - for FEFO test verification)
        v_batch_id := gen_random_uuid();
        INSERT INTO batches (
            id, tenant_id, product_id, supplier_id, batch_number, 
            manufacturing_date, expiry_date, cost_price, selling_price, mrp
        ) VALUES (
            v_batch_id,
            v_retail_tenant_id,
            v_prod_id,
            v_supp_unilever,
            'LOT-RET-26B-' || i,
            CURRENT_DATE - INTERVAL '10 days',
            CURRENT_DATE + INTERVAL '180 days',
            (5.20 + (i % 10))::NUMERIC(12,2),
            (8.50 + (i % 10))::NUMERIC(12,2),
            (10.00 + (i % 10))::NUMERIC(12,2)
        );

        INSERT INTO inventory_stocks (tenant_id, batch_id, quantity, reserved_quantity, shelf_location)
        VALUES (v_retail_tenant_id, v_batch_id, 50, 0, 'Aisle ' || ((i % 10) + 1) || '-Shelf-B');

        v_barcode_num := v_barcode_num + 1;
    END LOOP;

    -- 6.7 Seed 100 Hospital Pharmacy Pharmaceutical Products with FEFO Multi-Batches
    FOR i IN 101..200 LOOP
        v_prod_id := gen_random_uuid();
        INSERT INTO products (
            id, tenant_id, category_id, sku, barcode, name, generic_name, brand, 
            unit_of_measure, default_tax_rate, reorder_point, is_prescription_required
        ) VALUES (
            v_prod_id,
            v_pharma_tenant_id,
            CASE (i % 3) WHEN 0 THEN v_cat_antibiotics WHEN 1 THEN v_cat_analgesics ELSE v_cat_cardiac END,
            'SKU-MED-' || (v_sku_num + i),
            v_barcode_num::VARCHAR,
            CASE (i % 3) 
                WHEN 0 THEN 'Amoxicillin Trihydrate ' || (250 + (i % 3)*250) || 'mg'
                WHEN 1 THEN 'Paracetamol Extra Strength ' || (500 + (i % 2)*150) || 'mg'
                ELSE 'Atorvastatin Calcium ' || (10 + (i % 4)*10) || 'mg'
            END,
            CASE (i % 3) 
                WHEN 0 THEN 'Amoxicillin USP'
                WHEN 1 THEN 'Acetaminophen BP'
                ELSE 'Atorvastatin'
            END,
            'PharmaCare Lot ' || i,
            'BOX',
            0.00,  -- Essential medicines are often tax exempt
            20,
            TRUE   -- Prescription mandatory
        );

        -- Batch #1: Earliest Expiry (e.g. Expires in 25 days - Near Expiry Alert)
        v_batch_id := gen_random_uuid();
        INSERT INTO batches (
            id, tenant_id, product_id, supplier_id, batch_number, 
            manufacturing_date, expiry_date, cost_price, selling_price, mrp
        ) VALUES (
            v_batch_id,
            v_pharma_tenant_id,
            v_prod_id,
            v_supp_pfizer,
            'RX-FEFO-BATCH-EARLY-' || i,
            CURRENT_DATE - INTERVAL '180 days',
            CURRENT_DATE + INTERVAL '25 days',
            (12.00 + (i % 15))::NUMERIC(12,2),
            (18.00 + (i % 15))::NUMERIC(12,2),
            (20.00 + (i % 15))::NUMERIC(12,2)
        );

        INSERT INTO inventory_stocks (tenant_id, batch_id, quantity, reserved_quantity, shelf_location)
        VALUES (v_pharma_tenant_id, v_batch_id, 8, 0, 'Vault-Bay-' || ((i % 8) + 1));

        -- Batch #2: Mid Expiry (Expires in 180 days)
        v_batch_id := gen_random_uuid();
        INSERT INTO batches (
            id, tenant_id, product_id, supplier_id, batch_number, 
            manufacturing_date, expiry_date, cost_price, selling_price, mrp
        ) VALUES (
            v_batch_id,
            v_pharma_tenant_id,
            v_prod_id,
            v_supp_pfizer,
            'RX-FEFO-BATCH-MID-' || i,
            CURRENT_DATE - INTERVAL '30 days',
            CURRENT_DATE + INTERVAL '180 days',
            (12.00 + (i % 15))::NUMERIC(12,2),
            (18.00 + (i % 15))::NUMERIC(12,2),
            (20.00 + (i % 15))::NUMERIC(12,2)
        );

        INSERT INTO inventory_stocks (tenant_id, batch_id, quantity, reserved_quantity, shelf_location)
        VALUES (v_pharma_tenant_id, v_batch_id, 45, 0, 'Vault-Bay-' || ((i % 8) + 1));

        v_barcode_num := v_barcode_num + 1;
    END LOOP;

    -- 6.8 Seed Hospital Clinical Master Records (Patients & Doctors)
    INSERT INTO patients (tenant_id, mrn, full_name, phone, gender, date_of_birth)
    VALUES 
    (v_pharma_tenant_id, 'MRN-2026-9041', 'Jonathan Doe', '+1-555-8821', 'MALE', '1982-04-12'),
    (v_pharma_tenant_id, 'MRN-2026-9042', 'Emily Clarke', '+1-555-3312', 'FEMALE', '1990-11-28');

    INSERT INTO doctors (tenant_id, license_number, full_name, specialization, phone)
    VALUES 
    (v_pharma_tenant_id, 'MD-LIC-44810', 'Dr. Robert Adams, MD', 'Internal Medicine & Cardiology', '+1-555-9001'),
    (v_pharma_tenant_id, 'MD-LIC-99321', 'Dr. Patricia Sterling, MD', 'Pediatric Pulmonology', '+1-555-9002');

    RAISE NOTICE 'SUCCESS: Successfully provisioned 2 Tenants, 2 Users, 6 Categories, 2 Suppliers, 200 Products, and 400 Batches with inventory stock!';
END $$;
