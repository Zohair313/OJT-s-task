# OJT Sprint Plan & Daily Engineering Tasks (15-Oct to 25-Oct 2026)
### Enterprise POS & Inventory Management SaaS

[![Sprint Track](https://img.shields.io/badge/Track-Full--Stack%20%2F%20Systems%20Engineering-blue.svg)](file:///e:/OJT's%20task/docs/SPRINT_PLAN_AND_TASKS.md)
[![Period](https://img.shields.io/badge/Duration-15--10--2026%20to%2025--10--2026-green.svg)](file:///e:/OJT's%20task/docs/SPRINT_PLAN_AND_TASKS.md)

---

## 1. Curriculum Overview & Daily Calendar

| Day | Date | Sprint | Primary Engineering Focus | Deliverable Milestone |
| :---: | :---: | :---: | :--- | :--- |
| **Day 1** | 15-Oct-2026 | **Sprint 1** | Relational Database Schema & PostgreSQL Migrations | Core Tables, Constraints & Indexes |
| **Day 2** | 16-Oct-2026 | **Sprint 1** | Duplicate Barcode Guard & Product Catalog CRUD APIs | Unique Barcode Indexing & API Validation |
| **Day 3** | 17-Oct-2026 | **Sprint 1** | Inbound Stock Intake (Purchase Inward) & Seeding | Inward Pipeline & 200+ Seeded Items |
| **Day 4** | 18-Oct-2026 | **Sprint 2** | Hardware Scanner Event Buffer (`< 150ms` Ingestion) | Window Keystroke Buffer & Audio Beep |
| **Day 5** | 19-Oct-2026 | **Sprint 2** | Fallback Debounced Search (250ms) & Fuzzy Match | Search Input with GIN/Trigram Indexing |
| **Day 6** | 20-Oct-2026 | **Sprint 2** | Dynamic Cart State & Exact Currency Math Engine | Multi-tier Taxes & Line Discount Engine |
| **Day 7** | 21-Oct-2026 | **Sprint 3** | ACID Checkout Pipeline & `SELECT ... FOR UPDATE` Locks | Pessimistic Lock Transaction Boundary |
| **Day 8** | 22-Oct-2026 | **Sprint 3** | Concurrency Race Condition Automated Test Suite | 20-Thread Load Script Proving Zero Oversell |
| **Day 9** | 23-Oct-2026 | **Sprint 3** | 80mm & 58mm Thermal Receipt CSS Print Engine | Auto-Print ESC/POS Formatted Receipt |
| **Day 10** | 24-Oct-2026 | **Sprint 4** | Hospital FEFO Multi-Batch Split & Doctor/Patient Tag | Earliest Expiry Routing & Clinical Audit |
| **Day 11** | 25-Oct-2026 | **Sprint 4** | Retail Z-Report, Cash Drawer Balancing & Capstone Demo | End-of-Day Register Closure & Final Presentation |

---

## 2. Day-by-Day Task Breakdown

### Day 1 (15-Oct-2026): Relational Database Architecture
- **Task 1.1:** Setup PostgreSQL 15+ instance and configure `.env` database connection pooling.
- **Task 1.2:** Implement DDL migrations for `tenants`, `users`, `categories`, `suppliers`, `products`, `batches`, and `inventory_stocks`.
- **Task 1.3:** Configure non-negative check constraints (`quantity >= 0`, `cost_price >= 0`, `selling_price >= 0`).
- **DoD (Definition of Done):** Database spins up cleanly via Docker / local CLI; migration scripts run idempotently.

### Day 2 (16-Oct-2026): Duplicate Barcode Guard & Catalog APIs
- **Task 2.1:** Implement database-level compound unique index `CREATE UNIQUE INDEX uq_tenant_barcode ON products (tenant_id, barcode)`.
- **Task 2.2:** Build `POST /api/v1/products` with pre-flight check returning HTTP `409 Conflict` if barcode or SKU exists.
- **Task 2.3:** Write automated integration test verifying that inserting identical barcodes across different tenants succeeds, but fails within the same tenant.
- **DoD:** 100% test pass on barcode duplicate validation; OpenAPI docs updated.

### Day 3 (17-Oct-2026): Inbound Stock Intake & 200+ Item Seeder
- **Task 3.1:** Implement `POST /api/v1/inventory/inward` to receive goods from suppliers under specific batch lot numbers, cost prices, and expiration dates.
- **Task 3.2:** Automatically create corresponding `inventory_stocks` and `stock_movements` (Movement Type: `PURCHASE_INWARD`).
- **Task 3.3:** Run automated seeder script generating 100 Retail Supermarket SKUs and 100 Hospital Pharmaceutical SKUs with active multi-batches.
- **DoD:** `SELECT count(*) FROM products` returns $\ge 200$; all items have mapped batches and stock.

### Day 4 (18-Oct-2026): Scanner Event Buffer & Sub-150ms Ingestion
- **Task 4.1:** Implement global `window.addEventListener('keydown')` tracking inter-keystroke timestamp deltas.
- **Task 4.2:** Differentiate scanner bursts (`delta < 35ms`, length $\ge 4$, ending with `Enter`) from human typing.
- **Task 4.3:** Integrate Web Audio API synthetic 1400Hz confirmation beep.
- **Task 4.4:** Measure scan-to-cart latency in Chrome DevTools Performance panel, ensuring ingestion $\le 150ms$.
- **DoD:** Hardware barcode scanner or virtual scanner fires barcodes into the cart without requiring text field focus.

### Day 5 (19-Oct-2026): Fallback Debounced Search (250ms)
- **Task 5.1:** Build manual search input on the cashier screen for unreadable/damaged barcodes.
- **Task 5.2:** Add 250ms debouncing hook (`useDebounce`) to avoid excessive backend query thrashing.
- **Task 5.3:** Implement PostgreSQL trigram or GIN full-text index on `products(name, sku, barcode)`.
- **DoD:** Cashier types "amox" and sees instant suggestions within 250ms without UI stutter.

### Day 6 (20-Oct-2026): Real-Time Dynamic Cart & Exact Currency Math
- **Task 6.1:** Build client-side cart calculation engine handling quantity increment/decrement, item discounts, and tax rates.
- **Task 6.2:** Implement strict integer cents currency math to eliminate JavaScript floating-point errors (`0.1 + 0.2`).
- **Task 6.3:** Calculate invoice-level round-off to the nearest penny or unit.
- **DoD:** Cart accurately calculates subtotal, discounts, compound/flat VAT, and grand totals across 20+ line items.

### Day 7 (21-Oct-2026): ACID Atomic Transactions & Pessimistic Row Locking
- **Task 7.1:** Implement checkout endpoint `POST /api/v1/checkout/commit` wrapped in a single database transaction (`BEGIN ... COMMIT`).
- **Task 7.2:** Implement pessimistic row-level lock:
  ```sql
  SELECT id, quantity FROM inventory_stocks WHERE batch_id IN (...) ORDER BY batch_id ASC FOR UPDATE;
  ```
- **Task 7.3:** Verify that if any stock is insufficient or payment fails, an automatic `ROLLBACK` executes and restores client cart state.
- **DoD:** Checkout pipeline commits all records (Invoice, LineItems, Payments, Stock Movements) or none at all.

### Day 8 (22-Oct-2026): Automated Concurrency Race Condition Test Suite
- **Task 8.1:** Write test script `test/concurrency-race.ts` using `Promise.all()` to simulate 20 POS counters checking out the final 1 unit of stock simultaneously.
- **Task 8.2:** Assert that exactly 1 request returns HTTP `200 OK` and 19 requests return HTTP `409 Conflict`.
- **Task 8.3:** Assert that final stock count in the database is exactly `0` (never `-1` or phantom inventory).
- **DoD:** Mentor verifies automated concurrency test output showing 100% safety under load.

### Day 9 (23-Oct-2026): 80mm & 58mm Thermal Print Receipt Engine
- **Task 9.1:** Construct 80mm supermarket thermal receipt template with store header, tax ID, line items, and receipt barcode.
- **Task 9.2:** Construct 58mm hospital pharmacy express receipt template with batch number, expiry date, patient MRN, and doctor name.
- **Task 9.3:** Implement CSS `@media print` with `@page { size: 80mm auto; margin: 0; }` for seamless browser print triggers.
- **DoD:** Completing a sale automatically triggers the print preview window formatted to the exact paper roll width.

### Day 10 (24-Oct-2026): Hospital Pharmacy FEFO Engine & Clinical Tagging
- **Task 10.1:** Implement First-Expired, First-Out (FEFO) batch resolution algorithm: queries batches where `expiry_date > CURRENT_DATE`, ordered by `expiry_date ASC`.
- **Task 10.2:** Implement multi-batch splitting: automatically split a line item into two lots when the earliest batch has insufficient stock.
- **Task 10.3:** Implement clinical tagging fields (Patient MRN, Doctor Medical License, Prescription Number) on the cashier checkout deck.
- **Task 10.4:** Display yellow badge for near-expiry batches (`< 30 days`) and block sales of expired batches.
- **DoD:** Pharmacist scans item, system auto-allocates earliest batch, and prints batch/expiry details on receipt.

### Day 11 (25-Oct-2026): Retail Z-Report, Shift Reconciliation & Final Capstone
- **Task 11.1:** Implement cashier shift management: Opening Float recording, mid-shift Cash Drops, and drawer session locking.
- **Task 11.2:** Build End-of-Day Z-Report generator: calculate expected cash, accept cashier's physical blind count, and compute variance.
- **Task 11.3:** Generate printable Z-Report summary detailing total cash, card, taxes collected, and gross margin.
- **Task 11.4:** Conduct Final Capstone Demo & Mentor Technical Evaluation.
- **DoD:** Live walkthrough covering all 4 Sprint deliverables, passing the 100-point mentor evaluation matrix.

---

## 3. Mentor Evaluation Scorecard

| Assessment Domain | Max Marks | Passing Score | Trainee Score | Mentor Verification Signature |
| :--- | :---: | :---: | :---: | :--- |
| **1. Concurrency & Transaction Safety** | 30 | 25 | `___ / 30` | Automated 20-thread race test passed |
| **2. Scanner Latency & Cashier UX** | 25 | 20 | `___ / 25` | Chrome Profiler confirms `< 150ms` scan |
| **3. Domain Logic (FEFO & Z-Report)** | 25 | 20 | `___ / 25` | Earliest lot selected; cash balances |
| **4. Code Quality & OpenAPI Documentation** | 20 | 16 | `___ / 20` | Layered architecture, clean Git commits |
| **Total** | **100** | **81** | `___ / 100` | **Status: [ PASS / DISTINCTION ]** |
