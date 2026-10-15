# Ubiquitous Domain Glossary
## Enterprise POS & Inventory Management SaaS (Retail Supermarkets & Hospital Pharmacies)

This glossary defines the authoritative domain language for engineers, mentors, and product stakeholders. All codebase entities, variables, database tables, and API contracts must strictly adhere to these canonical terms.

---

### Core Inventory & Product Terms

#### Tenant
An isolated business entity utilizing the SaaS platform (e.g., "Metro Supermarket Flagship" or "St. Jude Hospital Central Pharmacy"). Every transaction, SKU, batch, customer, and financial report belongs strictly to one tenant.

#### Product
A catalog master entity representing a distinct sellable item (e.g., "Paracetamol 500mg" or "Whole Milk 1L"). A product holds immutable catalog attributes (Brand, Category, Default Tax Rate, Reorder Point, Prescription Requirement) but does **not** store physical stock directly.

#### SKU (Stock Keeping Unit)
An internal alphanumeric code assigned by the tenant to uniquely identify a distinct product configuration. Unique within a tenant.

#### Barcode
An optical, machine-readable standard symbol (e.g., EAN-13, UPC-A, Code-128, DataMatrix) printed on the product packaging. Scanned by handheld barcode readers to rapidly look up a product. Unique within a tenant.

#### Batch (Lot)
A specific production shipment of a product received from a supplier, sharing a common `batch_number`, `manufacturing_date`, `expiry_date`, `cost_price`, and `selling_price`. In pharmaceutical billing, inventory is strictly segregated and tracked at the batch level.

#### Inventory Stock
The physical or available count of items linked to a specific `batch_id` and shelf/bin location.

#### Inbound Stock Intake (Purchase Inward)
The operational workflow where goods received from a vendor or manufacturer are verified against a supplier invoice, inspected for expiration dates, and added into inventory under specific batch allocations.

#### Reorder Point (ROP)
The minimum inventory threshold. When total available stock across all active batches drops at or below this level, an automated replenishment alert is triggered.

---

### POS & Checkout Engine Terms

#### POS Terminal (Counter)
A physical workstation staffed by a cashier, equipped with a computer screen, a keyboard/touchscreen, a barcode scanner, a receipt printer, and an automated cash drawer.

#### Scanner Keystroke Stream
A high-frequency series of keyboard events emitted by an HID barcode scanner. Characters are received with an inter-keystroke delta of `< 30ms`, terminated by a Carriage Return (`Enter`).

#### Scanner Buffer
An in-memory timing-sensitive accumulator that intercepts rapid keystrokes to differentiate automated barcode input from manual human typing.

#### Debounced Live Search
A fallback manual search field that delays query execution until 250 milliseconds have elapsed without any new keystroke, preventing redundant database queries while the cashier types.

#### Cart
An ephemeral, in-progress collection of line items assembled at the checkout counter before fiscal commitment.

#### Line Item
A single row in the shopping cart or invoice, detailing the `product_id`, allocated `batch_id`, unit price, applied discount, tax rate, quantity, and computed line total.

---

### Transactional & Concurrency Terms

#### ACID Transaction
A database transaction satisfying Atomicity, Consistency, Isolation, and Durability. Either all invoice items, stock deductions, and ledger entries are permanently committed, or all changes are rolled back.

#### Race Condition (Double-Spend)
A flaw where two concurrent POS counters attempt to deduct stock from the same batch simultaneously when only 1 unit remains, resulting in negative stock or duplicate sales if not locked.

#### Pessimistic Row-Level Lock (`SELECT ... FOR UPDATE`)
A database lock acquired on target rows within an active transaction. Competing transactions attempting to read or update the same locked row must wait until the holding transaction issues `COMMIT` or `ROLLBACK`.

#### Deadlock Prevention Sort Order
The algorithmic practice of sorting all requested `batch_id` keys in strictly ascending alphanumeric order prior to requesting locks, eliminating circular wait deadlocks between concurrent checkouts.

#### Rollback
The complete reversion of uncommitted database operations and cart state restoration triggered when a payment fails, inventory validation errors out, or an unhandled exception occurs.

---

### Hospital Pharmacy Domain Terms

#### FEFO (First-Expired, First-Out)
An inventory allocation rule mandating that the batch with the earliest upcoming expiration date is automatically selected for sale, regardless of when it arrived in the warehouse.

#### Multi-Batch Split
An automatic division of a single cart line item into multiple sub-allocations across two or more batches when the earliest expiring batch has insufficient quantity to fulfill the customer's request.

#### Medical Record Number (MRN)
A unique identifier assigned to a hospital patient. In hospital pharmacy billing, the MRN links the fiscal invoice to the patient's clinical chart.

#### Attending Physician (Doctor) Tagging
The recording of the prescribing doctor's name, department, and medical license number onto the pharmacy invoice for legal and insurance reconciliation.

#### Prescription Number (Rx Number)
The official reference code issued by a doctor on the physical or electronic prescription slip, mandatory for dispensing scheduled or prescription-only medications.

---

### Retail Mart & Financial Reconciliation Terms

#### Cash Drawer Session
A continuous period of cashier operation, initiated with an opening float and concluded with an end-of-shift register reconciliation.

#### Opening Float
The initial sum of small bills and coins placed in the cash drawer at the start of a shift to provide change to customers.

#### Cash Drop (Skim)
A periodic mid-shift removal of large sums of cash from the cashier drawer into a secure back-office safe, reducing risk of robbery.

#### Z-Report (Fiscal Day-End Closure)
The definitive, irreversible end-of-day register closure report summarizing total cash, card, and credit sales, total taxes collected, gross profit margins, cash drops, and cash over/short variance. Permanently closes the drawer session.

#### Cash Variance (Over / Short)
The mathematical difference between the physical cash counted by the cashier and the expected cash calculated by the system ledger:
$$\text{Variance} = \text{Counted Cash} - (\text{Opening Float} + \text{Cash Sales} - \text{Cash Drops} - \text{Cash Refunds})$$

#### Thermal Receipt (ESC/POS)
An inkless receipt printed on heat-sensitive paper using standard 80mm or 58mm roll dimensions via ESC/POS command sequences or CSS `@media print` rules.
