# Product Specification: Enterprise POS & Inventory Management SaaS
### Dual-Domain: Retail Marts & Hospital Pharmacy Billing

[![Standard](https://img.shields.io/badge/Standard-Matt%20Pocock%20to--spec-blue.svg)](file:///e:/OJT's%20task/SPECIFICATION.md)
[![Status](https://img.shields.io/badge/Status-Approved%20for%20OJT-green.svg)](file:///e:/OJT's%20task/SPECIFICATION.md)

---

## 1. Problem Statement

Retail supermarket checkouts and hospital pharmacy counters operate under intense customer pressure where every second of transaction delay directly impacts revenue, customer satisfaction, and in medical contexts, patient health. 

Existing open-source or entry-level POS systems suffer from four critical architectural failures:
1. **Concurrency Failures (Double-Spend):** When multiple cashier terminals simultaneously sell the last remaining unit of an item, non-locking databases allow both checkouts to succeed, resulting in negative inventory, physical stock stockouts, and inventory shrinkage.
2. **Scanner Inefficiency:** Web-based POS interfaces frequently lose focus, dropping barcode scanner inputs or failing to handle high-frequency USB/HID scanner keystrokes, forcing cashiers to manually click inputs and retype codes.
3. **Regulatory Non-Compliance in Healthcare:** Standard POS systems lack First-Expired, First-Out (FEFO) batch tracking, causing hospitals to dispense expired medications or face massive financial write-offs when near-expiry drugs remain unsold behind newer shipments. Furthermore, they lack doctor licensing and patient medical record linkages required for controlled substances.
4. **Financial Reconciliation Discrepancies:** Cash registers lack immutable session locks, cash drops, and automated Z-Report auditing, leading to untraceable cash shortages and cashier theft at shift changeover.

---

## 2. Solution

The Enterprise POS & Inventory Management SaaS is a multi-tenant, high-throughput cloud and on-premise system built to solve these exact industrial problems:
- **Pessimistic Row-Level Locking:** Uses PostgreSQL `SELECT ... FOR UPDATE` with deterministic batch sorting to guarantee zero phantom inventory deductions across concurrent checkouts.
- **Zero-Lag Hardware Scanner Buffer:** Captures rapid HID keystroke bursts (`< 30ms` inter-key delta) with window-level event listeners, ingesting items into the cart in `< 150ms` regardless of DOM focus.
- **Automated FEFO Engine:** Automatically selects and allocates the earliest expiring valid batch upon scanning a product, splitting quantities across lots when an order spans multiple batches.
- **Clinical Pharmacy Tagging:** Directly binds Patient MRN, patient demographics, attending doctor license number, and prescription ID to the fiscal invoice.
- **Fiscal Thermal Printing & Z-Report Ledger:** Generates 80mm and 58mm ESC/POS compatible receipts via CSS `@media print` and enforces blind-count shift balancing with mathematical variance tracking.

---

## 3. User Stories

### A. Catalog, Inbound Stock & Batch Management
1. **As an Inventory Manager**, I want to create products with unique SKUs and barcodes, so that items can be uniquely cataloged without collision.
2. **As an Inventory Manager**, I want the system to reject duplicate barcodes at the API and database levels, so that cashiers never scan a barcode that maps ambiguously to multiple products.
3. **As a Warehouse Clerk**, I want to record Purchase Inward shipments with specific batch numbers, manufacturing dates, expiry dates, and supplier costs, so that stock is tracked down to the physical production lot.
4. **As an Inventory Auditor**, I want to view an immutable log of all stock movements (inwards, sales, returns, adjustments), so that any inventory discrepancy can be traced to a specific timestamp and user.
5. **As a Store Manager**, I want to configure Reorder Points (ROP) per SKU, so that I receive automated low-stock dashboard notifications before shelves run empty.

### B. Barcode Scanner & POS Checkout Experience
6. **As a Cashier**, I want to scan items with a USB or Bluetooth handheld barcode scanner without having to manually click into a search box, so that my checkout workflow is uninterrupted.
7. **As a Cashier**, I want scanned items to appear in my cart in under 150ms with an audio feedback beep, so that I can rapidly move goods from the conveyor belt to shopping bags.
8. **As a Cashier**, I want to search for products manually using a 250ms debounced search bar when a barcode is torn or unreadable, so that checkout never halts.
9. **As a Cashier**, I want the cart to dynamically compute line subtotals, item-level discounts, tiered taxes, and grand totals with exact penny precision, so that billing is completely accurate.
10. **As a Cashier**, I want to adjust quantities, remove line items, or apply promo codes using keyboard shortcuts, so that I don't need to switch between keyboard and mouse.
11. **As a Cashier**, I want a quick visual indicator showing whether an item is in stock, near expiry, or out of stock before scanning, so that I don't attempt to sell unavailable goods.

### C. ACID Transactions & Concurrency Safety
12. **As a Systems Engineer**, I want the checkout pipeline to execute inside an atomic database transaction (`BEGIN ... COMMIT`), so that an invoice is never created if inventory deduction fails.
13. **As a Store Owner**, I want the database to lock inventory rows (`SELECT ... FOR UPDATE`) during checkout, so that two counters cannot sell the last remaining unit to two different customers.
14. **As a Database Administrator**, I want the system to lock batch records in ascending order of `batch_id`, so that concurrent checkouts never trigger circular wait deadlocks.
15. **As a Cashier**, I want any failed transaction (e.g., payment decline or stock exhaustion) to immediately roll back the database and restore my cart state, so that I can resolve the issue with the customer.

### D. Thermal Receipt Printing
16. **As a Cashier**, I want a receipt to automatically trigger for printing immediately upon successful checkout, so that I can hand the paper slip to the customer without extra clicks.
17. **As a Retail Customer**, I want an 80mm thermal receipt detailing store name, tax registration number, itemized lines, discounts, taxes, and cashier name, so that I have valid proof of purchase.
18. **As a Pharmacy Customer**, I want a 58mm compact thermal receipt listing medicine names, lot/batch numbers, expiry dates, and doctor details, so that I can verify medication safety.
19. **As a Store Technician**, I want receipts to format perfectly via standard browser `@media print` without installing third-party desktop background drivers, so that terminal setup takes less than 5 minutes.

### E. Hospital Pharmacy & FEFO Domain Logic
20. **As a Hospital Pharmacist**, I want the system to automatically pick the earliest expiring batch when I scan a medicine, so that our pharmacy complies with FEFO regulations and minimizes drug expiration wastage.
21. **As a Hospital Pharmacist**, I want the system to split a line item across two batches if the earliest batch has insufficient stock, so that the patient receives their full prescription without manual math.
22. **As a Hospital Pharmacist**, I want the system to strictly block the sale of any expired batch, displaying a high-priority red warning, so that patients are protected from harmful drugs.
23. **As a Hospital Pharmacist**, I want to tag the patient's Medical Record Number (MRN) and patient name to the invoice, so that billing syncs with hospital electronic health records.
24. **As a Pharmacy Auditor**, I want to record the prescribing physician's name and medical license number on every prescription drug invoice, so that narcotic and scheduled drug regulations are met.

### F. Shift Management & Z-Report Reconciliation
25. **As a Cashier**, I want to log in and enter an opening cash float at the start of my shift, so that my drawer begins with an audited starting balance.
26. **As a Store Supervisor**, I want to perform mid-shift cash drops from the counter into the store vault, so that excessive cash is not exposed on the sales floor.
27. **As a Cashier**, I want to enter my physical cash count at the end of my shift without seeing the system's expected total, so that cash counting is completely unbiased.
28. **As a Store Accountant**, I want the system to generate an immutable Z-Report summarizing total cash sales, card sales, tax collected, and cash over/short variance, so that the financial day is balanced.
29. **As a Store Owner**, I want the cash drawer session to lock permanently once the Z-Report is generated, so that previous shift records cannot be tampered with.

### G. Multi-Tenancy & Platform Administration
30. **As a SaaS Administrator**, I want each tenant to have strict data isolation by `tenant_id`, so that one supermarket or hospital can never access another tenant's sales or patient records.
31. **As a Mentor/Evaluator**, I want an automated concurrency test script that simulates 20 simultaneous checkout threads competing for 1 unit of stock, so that I can verify that transaction safety passes 100%.

---

## 4. Implementation Decisions

1. **Architecture Style:** Modular Monolith with clean boundary interfaces between Catalog, Inbound Inventory, FEFO Allocation, POS Cart, Fiscal Invoicing, and Cash Reconciliation modules.
2. **Database Engine:** PostgreSQL 15+ utilizing B-tree unique indexes `(tenant_id, barcode)`, foreign key constraints with `ON DELETE RESTRICT` on audit tables, and explicit pessimistic locking.
3. **Monetary Precision:** All currency math is computed in integer cents or via strict decimal precision (avoiding JavaScript IEEE 754 floating-point errors).
4. **Scanner Buffer:** Implemented via a zero-dependency window event listener measuring keystroke arrival deltas (`< 35ms` for scanner vs `> 60ms` for human typing).
5. **Print Engine:** CSS `@media print` with custom `@page` width rules (80mm and 58mm) and high-density monospace fonts.
6. **FEFO Split Reducer:** Cart items maintain an array of allocated lots `[{ batchId, batchNumber, expiryDate, qty, price }]` rather than a flat item structure.

---

## 5. Testing Decisions

1. **What Makes a Good Test:** Tests must evaluate observable external behavior, transaction boundaries, and data invariants rather than private internal method mechanics.
2. **Concurrency Race Suite (`test/concurrency.spec.ts`):**
   - Setup: Seed a test product with exactly 1 unit in stock across all batches.
   - Execution: Launch 20 concurrent HTTP checkout requests simultaneously using `Promise.all()`.
   - Assertion: Exactly 1 checkout returns HTTP `200 OK`; exactly 19 checkouts return HTTP `409 Conflict`; final database stock count is exactly `0` (never negative).
3. **Scanner Keystroke Benchmark (`test/scanner.spec.ts`):**
   - Synthetic keystroke emission simulating 13 barcode characters with 15ms delays followed by `Enter`.
   - Verify cart ingestion latency is under 150ms.
4. **FEFO Expiry Order Test (`test/fefo.spec.ts`):**
   - Seed 3 batches for Product A: Batch 1 (expires in 10 days, qty: 5), Batch 2 (expires in 40 days, qty: 10), Batch 3 (expires yesterday, qty: 2).
   - Attempt to purchase 7 units.
   - Assert: Batch 3 is ignored (expired). Line item splits into 5 units from Batch 1 and 2 units from Batch 2.
5. **Z-Report Mathematical Balance Test (`test/reconciliation.spec.ts`):**
   - Opening float: $100. Cash sales: $240. Card sales: $150. Cash drop: $100.
   - Assert expected cash in drawer = $240 ($100 + $240 - $100).
   - If cashier counts $235, assert `variance = -5.00` (Shortage).

---

## 6. Out of Scope

- Offline-first IndexedDB background synchronization across days (assumes stable local network or cloud connectivity during checkout).
- Direct EMV chip & PIN credit card terminal serial protocol drivers (mock credit card gateway integration provided).
- Multi-currency currency conversion during a single checkout session (all transactions in tenant's base currency).
- Warehouse robotic conveyor automation protocols.

---

## 7. Further Notes

- **OJT Trainee Guidance:** Focus on understanding *why* the database locks rows and *how* the browser intercepts hardware scanner inputs.
- **Reference Repository:** Matt Pocock's skills framework and UI-UX Pro Max design intelligence are utilized to establish the project's quality standard.
