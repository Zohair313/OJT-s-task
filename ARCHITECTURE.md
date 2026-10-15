# System Architecture & Technical Specifications
## Enterprise Multi-Tenant POS & Inventory Management SaaS

[![Document Version](https://img.shields.io/badge/Architecture%20Spec-v1.0.0-blue.svg)](file:///e:/OJT's%20task/ARCHITECTURE.md)
[![Database](https://img.shields.io/badge/Engine-PostgreSQL%2015%2B-green.svg)](file:///e:/OJT's%20task/DATABASE_SCHEMA.sql)
[![Transaction Model](https://img.shields.io/badge/ACID-Pessimistic%20Row--Level%20Locking-red.svg)](file:///e:/OJT's%20task/ARCHITECTURE.md#5-concurrency-control--transaction-safety)

---

## 1. High-Level Architectural Overview

The system is designed as a **Modular Monolith** with strict Domain-Driven Design (DDD) boundaries. It is optimized for ultra-low latency cashier interactions (`< 150ms` scan-to-cart ingestion), high-concurrency atomic checkout pipelines, and domain specialization across Supermarket Retail and Hospital Pharmacy workflows.

### System Topology Diagram

```mermaid
graph TD
    subgraph ClientPeripherals ["Hardware & Cashier Terminals"]
        Scanner["Barcode Scanner (USB/HID Bluetooth)"]
        ThermalPrinter["Thermal Receipt Printer (80mm/58mm ESC/POS)"]
        CashDrawer["Cash Drawer (RJ11 Kick Trigger)"]
        CashierUI["Web POS Cashier Terminal (Vite/React/HTML5)"]
    end

    subgraph EdgeLayer ["Edge & Gateway Layer"]
        ReverseProxy["Reverse Proxy / NGINX / TLS 1.3"]
        AuthMiddleware["Tenant & Role-Based Auth (JWT)"]
    end

    subgraph CoreApplicationLayer ["Core Application Engine (Modular Monolith)"]
        CatalogModule["Product & Inbound Catalog Service"]
        FEFOEngine["FEFO Batch Allocation Engine"]
        ScannerIngestion["Scanner Event & Debounced Search Service"]
        CartEngine["Dynamic Cart & Fiscal Tax Engine"]
        CheckoutTransaction["Atomic Transaction & Invoicing Service"]
        ReconciliationModule["Cash Reconciliation & Z-Report Engine"]
        PharmacyClinical["Clinical Prescription & Doctor/Patient Module"]
    end

    subgraph DataPersistenceLayer ["Database & Cache Layer (ACID)"]
        Postgres[(PostgreSQL 15+ Relational Database)]
        RowLocks["Row-Level Locks (SELECT ... FOR UPDATE)"]
        AuditTrail[(Immutable Stock & Financial Ledger)]
    end

    Scanner -->|Raw HID Keystrokes < 30ms| CashierUI
    CashierUI -->|Silent Print Window / ESC-POS| ThermalPrinter
    CashierUI -->|Cash Drawer Kick Pulse| CashDrawer
    CashierUI -->|HTTPS / WSS JSON APIs| ReverseProxy

    ReverseProxy --> AuthMiddleware
    AuthMiddleware --> CatalogModule
    AuthMiddleware --> FEFOEngine
    AuthMiddleware --> ScannerIngestion
    AuthMiddleware --> CartEngine
    AuthMiddleware --> CheckoutTransaction
    AuthMiddleware --> ReconciliationModule
    AuthMiddleware --> PharmacyClinical

    CheckoutTransaction -->|Atomic BEGIN / COMMIT| Postgres
    CheckoutTransaction -->|Acquires Row Lock| RowLocks
    ReconciliationModule -->|Fiscal Summary| Postgres
    CatalogModule -->|Inbound Batch Inward| Postgres
    FEFOEngine -->|Sorted Expiry Queries| Postgres
    CheckoutTransaction -->|Append Only| AuditTrail
```

---

## 2. Multi-Tenant Architecture & Data Isolation

The application implements a **Shared Database, Tenant-Discriminator Column** architecture with **PostgreSQL Row-Level Security (RLS)** as an optional defense-in-depth enforcement:

1. **Tenant Identification:**
   - Every operational entity (`products`, `batches`, `inventory_stocks`, `invoices`, `categories`, `z_reports`) contains a mandatory `tenant_id (UUID)` foreign key.
   - All database indexes enforce tenant scope: e.g., `UNIQUE (tenant_id, barcode)` ensures Barcode `"8901234567890"` is unique within Tenant A without conflicting with Tenant B.
2. **Context Propagation:**
   - Requests provide tenant context via JWT claims (`x-tenant-id`).
   - The application context extracts the tenant and binds it to database transactions via session variables (`SET LOCAL app.current_tenant_id = '...'`).
3. **Domain Tenant Modes:**
   - `RETAIL_SUPERMARKET`: Standard cashier layout, promotions, loyalty points, multi-pack bundles, Z-report balancing.
   - `HOSPITAL_PHARMACY`: FEFO automatic batch selection, narcotic prescription control, Patient MRN and Doctor tagging, batch recall capabilities.

---

## 3. Domain-Driven Service Boundaries

```mermaid
classDiagram
    class ProductCatalogService {
        +createProduct(ProductDTO)
        +updateProduct(id, ProductDTO)
        +validateDuplicateBarcode(tenantId, barcode)
        +receiveInboundStock(PurchaseInwardDTO)
    }

    class FEFOBatchEngine {
        +resolveBatchesForProduct(productId, requiredQty)
        +getNearExpiryBatches(thresholdDays)
        +splitQuantityAcrossBatches(batches, requestedQty)
    }

    class POSCheckoutService {
        +beginCheckoutTransaction(CartDTO)
        +acquireInventoryLocks(batchIds)
        +deductStockAtomically(allocations)
        +generateInvoice(InvoiceDTO)
        +logStockMovements(movements)
        +commitOrRollback()
    }

    class CashReconciliationService {
        +openCashierSession(cashierId, openingFloat)
        +recordCashDrop(sessionId, amount)
        +generateZReport(sessionId)
        +calculateVariance(expectedCash, actualCash)
        +closeCashierSession(sessionId)
    }

    class ClinicalPrescriptionService {
        +linkPatient(invoiceId, patientMRN)
        +linkDoctor(invoiceId, doctorLicense)
        +recordPrescriptionNumber(invoiceId, rxNumber)
        +auditScheduledSubstances(batchId, patientId)
    }

    ProductCatalogService --> FEFOBatchEngine : Seeds / Restocks Batches
    FEFOBatchEngine --> POSCheckoutService : Supplies Batch Allocations
    POSCheckoutService --> CashReconciliationService : Feeds Transaction Totals
    POSCheckoutService --> ClinicalPrescriptionService : Associates Clinical Records
```

---

## 4. Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    TENANTS ||--o{ PRODUCTS : owns
    TENANTS ||--o{ CATEGORIES : owns
    TENANTS ||--o{ SUPPLIERS : owns
    TENANTS ||--o{ INVOICES : issues
    TENANTS ||--o{ Z_REPORTS : reconciles
    TENANTS ||--o{ CASH_DRAWERS : tracks

    CATEGORIES ||--o{ PRODUCTS : categorizes
    SUPPLIERS ||--o{ BATCHES : supplies

    PRODUCTS ||--o{ BATCHES : contains
    BATCHES ||--o{ INVENTORY_STOCKS : holds
    BATCHES ||--o{ STOCK_MOVEMENTS : logs

    INVOICES ||--o{ INVOICE_ITEMS : contains
    INVOICES ||--o{ PAYMENTS : settles
    INVOICES }o--|| PATIENTS : "billed to (pharmacy)"
    INVOICES }o--|| DOCTORS : "prescribed by (pharmacy)"
    INVOICES }o--|| CASH_DRAWERS : "rung in"

    INVOICE_ITEMS }o--|| BATCHES : "drawn from"
    INVOICE_ITEMS }o--|| PRODUCTS : references

    CASH_DRAWERS ||--o{ Z_REPORTS : "closed by"

    TENANTS {
        uuid id PK
        varchar name
        varchar domain_type "RETAIL_SUPERMARKET | HOSPITAL_PHARMACY"
        varchar tax_identifier
        jsonb settings
        timestamp created_at
    }

    PRODUCTS {
        uuid id PK
        uuid tenant_id FK
        uuid category_id FK
        varchar sku UK
        varchar barcode UK
        varchar name
        varchar generic_name
        decimal default_tax_rate
        int reorder_point
        boolean is_prescription_required
        timestamp created_at
    }

    BATCHES {
        uuid id PK
        uuid tenant_id FK
        uuid product_id FK
        uuid supplier_id FK
        varchar batch_number
        date manufacturing_date
        date expiry_date
        decimal cost_price
        decimal selling_price
        decimal mrp
        timestamp created_at
    }

    INVENTORY_STOCKS {
        uuid id PK
        uuid tenant_id FK
        uuid batch_id FK, UK
        int quantity
        int reserved_quantity
        varchar shelf_bin_location
        timestamp updated_at
    }

    INVOICES {
        uuid id PK
        uuid tenant_id FK
        uuid cashier_id FK
        uuid drawer_session_id FK
        varchar invoice_number UK
        uuid patient_id FK
        uuid doctor_id FK
        varchar prescription_number
        decimal subtotal
        decimal total_discount
        decimal total_tax
        decimal grand_total
        decimal round_off
        varchar payment_status
        timestamp created_at
    }

    INVOICE_ITEMS {
        uuid id PK
        uuid invoice_id FK
        uuid product_id FK
        uuid batch_id FK
        int quantity
        decimal unit_price
        decimal tax_rate
        decimal tax_amount
        decimal discount_amount
        decimal line_total
    }

    STOCK_MOVEMENTS {
        uuid id PK
        uuid tenant_id FK
        uuid batch_id FK
        uuid invoice_id FK
        varchar movement_type "PURCHASE_INWARD | SALE_DEDUCT | RETURN | AUDIT_ADJUST"
        int quantity_changed
        int quantity_after
        timestamp created_at
    }

    CASH_DRAWERS {
        uuid id PK
        uuid tenant_id FK
        uuid cashier_id FK
        timestamp opened_at
        timestamp closed_at
        decimal opening_float
        decimal closing_cash
        varchar status "OPEN | CLOSED"
    }

    Z_REPORTS {
        uuid id PK
        uuid tenant_id FK
        uuid drawer_session_id FK, UK
        varchar report_code UK
        decimal total_cash_sales
        decimal total_card_sales
        decimal total_upi_sales
        decimal total_tax_collected
        decimal total_discounts
        decimal expected_cash_in_drawer
        decimal actual_counted_cash
        decimal cash_variance
        timestamp generated_at
    }

    PATIENTS {
        uuid id PK
        uuid tenant_id FK
        varchar mrn UK
        varchar full_name
        varchar contact_number
        varchar gender
    }

    DOCTORS {
        uuid id PK
        uuid tenant_id FK
        varchar license_number UK
        varchar full_name
        varchar specialization
    }
```

---

## 5. Concurrency Control & Transaction Safety

### The "Double-Spend" Problem at the POS Counter
In a bustling supermarket or pharmacy, Counter #1 and Counter #2 may scan the **exact same last remaining unit** of product (Stock = 1) at the exact same millisecond.
- Without database-level isolation, both cashiers query `quantity = 1`.
- Both proceed to deduct 1 unit.
- Stock becomes `0` or negative `-1`, leading to stock shrinkage, inventory discrepancy, and legal compliance breaches (especially in pharmacy controlled substances).

### Pessimistic Row-Level Locking Architecture
The system avoids optimistic locking retry loops (which degrade cashier checkout speed) by implementing **Pessimistic Row-Level Locks (`SELECT ... FOR UPDATE`)**:

```mermaid
sequenceDiagram
    autonumber
    actor Cashier1 as Cashier 1 (Terminal A)
    actor Cashier2 as Cashier 2 (Terminal B)
    participant API as POS API Layer
    participant DB as PostgreSQL Transaction Engine

    Note over Cashier1,Cashier2: Both attempt to checkout the last 1 item of Batch #B-101 simultaneously

    Cashier1->>API: POST /api/checkout (Batch #B-101, Qty: 1)
    Cashier2->>API: POST /api/checkout (Batch #B-101, Qty: 1)

    API->>DB: BEGIN TRANSACTION (Tx 1)
    API->>DB: BEGIN TRANSACTION (Tx 2)

    API->>DB: Tx 1: SELECT quantity FROM inventory_stocks WHERE batch_id = 'B-101' FOR UPDATE;
    Note over DB: Tx 1 acquires Exclusive Row Lock on B-101

    API->>DB: Tx 2: SELECT quantity FROM inventory_stocks WHERE batch_id = 'B-101' FOR UPDATE;
    Note over DB: Tx 2 is BLOCKED and waits for Tx 1 to release lock

    DB-->>API: Tx 1 receives quantity = 1 (VALID)
    API->>DB: Tx 1: UPDATE inventory_stocks SET quantity = quantity - 1 WHERE batch_id = 'B-101';
    API->>DB: Tx 1: INSERT INTO invoices (...);
    API->>DB: Tx 1: INSERT INTO invoice_items (...);
    API->>DB: Tx 1: INSERT INTO stock_movements (...);
    API->>DB: Tx 1: COMMIT;
    Note over DB: Tx 1 commits. Row Lock on B-101 released!

    Note over DB: Tx 2 unblocks immediately and executes its SELECT
    DB-->>API: Tx 2 receives quantity = 0 (INSUFFICIENT)
    API->>DB: Tx 2: ROLLBACK;
    API-->>Cashier2: 409 Conflict: "Insufficient stock. Batch B-101 exhausted by another terminal."
    API-->>Cashier1: 200 OK: Invoice #INV-10045 Generated successfully
```

### Deadlock Prevention via Deterministic Sort Order
When a customer purchases multiple items spanning multiple batches (e.g., Batch X, Batch Y, Batch Z), concurrent transactions locking items in random order can result in database deadlocks.
- **Rule:** The checkout engine **MUST** sort all requested `batch_id` values in ascending lexicographical order prior to acquiring row locks:
```sql
-- Always locked in sorted order to guarantee zero deadlocks
SELECT batch_id, quantity 
FROM inventory_stocks 
WHERE batch_id IN ('batch-001', 'batch-004', 'batch-019') 
ORDER BY batch_id ASC 
FOR UPDATE;
```

---

## 6. First-Expired, First-Out (FEFO) Engine

In hospital pharmacies and perishable retail goods, selling near-expiry stock first is required to minimize wastage and comply with health regulations.

### FEFO Resolution Flowchart

```mermaid
flowchart TD
    ScanItem([Barcode Scanned: Product P]) --> FetchBatches[Query Active Batches for Product P with Quantity > 0]
    FetchBatches --> SortExpiry[Sort Batches ASCENDING by expiry_date]
    SortExpiry --> CheckExpiryDate{Is Earliest Batch Expired?}
    
    CheckExpiryDate -- Yes --> QuarantineBatch[Flag Batch as EXPIRED - Auto-Quarantine]
    QuarantineBatch --> NextBatch[Evaluate Next Earliest Batch]
    NextBatch --> CheckExpiryDate
    
    CheckExpiryDate -- No --> CheckCoverage{Does Earliest Batch have >= Requested Quantity?}
    
    CheckCoverage -- Yes --> SingleBatchAlloc[Allocate Full Quantity to this Batch]
    SingleBatchAlloc --> ReturnAllocation[Return Allocation Plan to Cart]
    
    CheckCoverage -- No --> SplitBatch[Multi-Batch Split: Take remaining quantity from this batch]
    SplitBatch --> DecrementNeeded[Remaining Qty = Requested Qty - Batch Qty]
    DecrementNeeded --> FetchNextBatch[Move to Next Expiring Batch]
    FetchNextBatch --> CheckCoverage
```

### Multi-Batch Split Scenario Example
- Customer requests **15 tablets** of *Amoxicillin 500mg*.
- Available Batches:
  - `Batch A-101` (Expires: **15-Nov-2026**): **6 tablets** in stock.
  - `Batch B-202` (Expires: **20-Jan-2027**): **20 tablets** in stock.
- **FEFO Engine Decision:**
  - Split Line Item into 2 allocations:
    - 6 tablets from `Batch A-101` (clearing old stock)
    - 9 tablets from `Batch B-202`
- Thermal receipt explicitly prints batch numbers and respective expiry dates per line item for patient safety and regulatory audit.

---

## 7. Hardware Scanner & Latency Optimization

### Latency Budget Breakdown (< 150ms Ingestion)

| Step | Operation | Target Latency | Optimization Technique |
| :---: | :--- | :---: | :--- |
| **1** | Scanner Keystroke Stream Buffer | `20ms` | Buffer characters with `< 30ms` delta; trigger upon `Enter`. |
| **2** | Barcode Lookup (Memory / Local DB) | `15ms` | B-tree index `UNIQUE (tenant_id, barcode)`; Redis hot cache. |
| **3** | Dynamic Cart State Calculation | `10ms` | Client-side immutable state update using integer cents math. |
| **4** | UI DOM Render & Audio Beep Feedback | `15ms` | Synthetic Web Audio API beep; CSS transform animations. |
| **Total** | **End-to-End Item Ingestion** | **~60ms** | **Well under the 150ms benchmark!** |

---

## 8. Financial Reconciliation & Z-Report Architecture

At the end of a cashier's shift, the system executes an automated cash balancing routine:
1. **Drawer Session Opening:** Cashier logs in, enters opening float (e.g., `$150.00`). Status is marked `OPEN`.
2. **Operational Sales Ingestion:** All cash, card, credit, and digital wallet transactions append to the session.
3. **Mid-Shift Cash Drops:** Cashiers drop surplus cash into a safe to minimize counter robbery risk.
4. **Register Closure (Z-Report Generation):**
   - System calculates:
     $$\text{Expected Cash} = \text{Opening Float} + \text{Total Cash Sales} - \text{Cash Drops} - \text{Cash Refunds}$$
   - Cashier enters physical cash count (blind count without seeing expected total).
   - System calculates variance:
     $$\text{Variance} = \text{Counted Cash} - \text{Expected Cash}$$
   - Any variance $> 0$ (Over) or $< 0$ (Short) is recorded with an audit reason.
   - The drawer session is permanently marked `CLOSED`. No further invoices can be attached to this session.

---

## 9. Thermal Print Subsystem (80mm & 58mm)

```mermaid
graph LR
    CheckoutSuccess[Checkout Completed 200 OK] --> PrintTrigger[Print Trigger Service]
    PrintTrigger --> FormatSelect{Printer Spec}
    FormatSelect -->|80mm Supermarket| Layout80[80mm ESC/POS / CSS Grid Template]
    FormatSelect -->|58mm Express/Pharmacy| Layout58[58mm ESC/POS / CSS Compact Template]
    Layout80 --> BrowserPrint[Silent Window Print: @media print]
    Layout58 --> BrowserPrint
    BrowserPrint --> ThermalHead[Thermal Print Head Emits Paper Receipt]
```

- **Zero External Plugin Dependency:** Uses standard `@media print` with CSS dimensions `@page { size: 80mm auto; margin: 0; }`.
- **High-Density Typography:** Monospace fonts (`Courier New`, `Consolas`, `Roboto Mono`) guarantee strict columnar alignment across currency and quantity fields.
- **ESC/POS Command Emulation:** Supports raw network printing over port 9100 with ESC/POS hex codes (`ESC @`, `GS V 1` for paper cut, `DLE DC4` for cash drawer kick).
