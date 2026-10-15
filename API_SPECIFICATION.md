# RESTful API Specification & OpenAPI Contracts
## Enterprise POS & Inventory Management SaaS

[![API Version](https://img.shields.io/badge/OpenAPI-3.0.3-green.svg)](file:///e:/OJT's%20task/API_SPECIFICATION.md)
[![Auth](https://img.shields.io/badge/Auth-Bearer%20JWT%20%2B%20x--tenant--id-blue.svg)](file:///e:/OJT's%20task/API_SPECIFICATION.md#1-authentication--headers)

---

## 1. Authentication & Common Headers

All HTTP requests require authentication and tenant context:

| Header | Type | Description |
| :--- | :--- | :--- |
| `Authorization` | `string` | `Bearer <JWT_TOKEN>` with claims: `sub`, `role`, `tenant_id` |
| `x-tenant-id` | `UUID` | Target tenant workspace identifier |
| `Content-Type` | `string` | `application/json` |

---

## 2. API Endpoints Summary

| Method | Endpoint | Description | Sprint |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/v1/products` | Create product with duplicate barcode guard | S1 |
| `GET` | `/api/v1/products` | Paginated product list with category & search filter | S1 |
| `POST` | `/api/v1/inventory/inward` | Inbound stock intake (Purchase Inward) with batches | S1 |
| `GET` | `/api/v1/scanner/lookup/:code` | High-speed barcode/SKU scan lookup (`< 50ms`) | S2 |
| `GET` | `/api/v1/products/search?q=` | 250ms debounced fuzzy fallback search | S2 |
| `POST` | `/api/v1/fefo/resolve` | Compute FEFO batch allocation for cart line item | S4 |
| `POST` | `/api/v1/checkout/commit` | **ACID atomic checkout with `SELECT ... FOR UPDATE`** | S3 |
| `POST` | `/api/v1/test/concurrency-race`| Automated 20-thread concurrency race load test | S3 |
| `GET` | `/api/v1/invoices/:id/receipt`| Get 80mm / 58mm formatted thermal receipt payload | S3 |
| `POST` | `/api/v1/drawers/open` | Open cashier shift with initial opening float | S4 |
| `POST` | `/api/v1/drawers/drop` | Perform mid-shift cash drop to safe | S4 |
| `POST` | `/api/v1/drawers/close-z-report`| Blind count submission & Z-Report generation | S4 |
| `GET` | `/api/v1/clinical/patients` | Search hospital patient by MRN | S4 |
| `GET` | `/api/v1/clinical/doctors` | Search prescribing physician by license | S4 |

---

## 3. Detailed Endpoint Contracts

### 3.1 Product Catalog & Duplicate Barcode Guard
#### `POST /api/v1/products`
Creates a master product. Strict validation ensures barcode and SKU are unique within the tenant.

**Request Payload:**
```json
{
  "sku": "SKU-MED-2041",
  "barcode": "8901234567890",
  "name": "Amoxicillin 500mg Capsules",
  "genericName": "Amoxicillin Trihydrate USP",
  "categoryId": "c9b7405e-f001-44ab-9c12-32115678abcd",
  "brand": "PharmaCare Labs",
  "unitOfMeasure": "BOX",
  "defaultTaxRate": 5.00,
  "reorderPoint": 20,
  "isPrescriptionRequired": true
}
```

**Response `201 Created`:**
```json
{
  "id": "e4a28f11-0021-4321-bb11-451299990001",
  "sku": "SKU-MED-2041",
  "barcode": "8901234567890",
  "name": "Amoxicillin 500mg Capsules",
  "createdAt": "2026-10-15T11:20:00.000Z"
}
```

**Response `409 Conflict` (Duplicate Barcode Detected):**
```json
{
  "error": "DUPLICATE_BARCODE",
  "message": "Barcode '8901234567890' is already registered to product 'Amoxicillin 250mg' (ID: e4a28...)",
  "statusCode": 409
}
```

---

### 3.2 Inbound Stock Intake (Purchase Inward)
#### `POST /api/v1/inventory/inward`
Receives physical shipment from supplier, creates batch lot, and assigns initial on-hand stock.

**Request Payload:**
```json
{
  "productId": "e4a28f11-0021-4321-bb11-451299990001",
  "supplierId": "s1111111-2222-3333-4444-555555555555",
  "batchNumber": "LOT-2026-AMX-01",
  "manufacturingDate": "2026-08-01",
  "expiryDate": "2027-08-01",
  "costPrice": 12.50,
  "sellingPrice": 18.00,
  "mrp": 20.00,
  "quantity": 100,
  "shelfLocation": "Vault-Bay-4",
  "supplierInvoiceRef": "SUPP-INV-8891"
}
```

**Response `201 Created`:**
```json
{
  "batchId": "b1111111-aaaa-bbbb-cccc-111111111111",
  "batchNumber": "LOT-2026-AMX-01",
  "quantityAdded": 100,
  "currentTotalStock": 100,
  "stockMovementId": "m9999999-1111-2222-3333-444444444444"
}
```

---

### 3.3 Zero-Lag Scanner Barcode Lookup
#### `GET /api/v1/scanner/lookup/:code`
Optimized query executed when scanner fires `Enter`. Resolves SKU, active batches, and recommended FEFO batch in `< 25ms`.

**Response `200 OK`:**
```json
{
  "productId": "e4a28f11-0021-4321-bb11-451299990001",
  "barcode": "8901234567890",
  "name": "Amoxicillin 500mg Capsules",
  "genericName": "Amoxicillin Trihydrate USP",
  "defaultTaxRate": 5.0,
  "isPrescriptionRequired": true,
  "totalAvailableStock": 48,
  "recommendedBatch": {
    "batchId": "b1111111-aaaa-bbbb-cccc-111111111111",
    "batchNumber": "LOT-2026-AMX-01",
    "expiryDate": "2026-11-20",
    "daysToExpiry": 36,
    "unitPrice": 18.00,
    "availableQuantity": 8,
    "isNearExpiry": true
  }
}
```

---

### 3.4 FEFO Batch Allocation Resolver
#### `POST /api/v1/fefo/resolve`
Resolves batch allocations when a cashier requests a quantity that may span across multiple lots.

**Request Payload:**
```json
{
  "productId": "e4a28f11-0021-4321-bb11-451299990001",
  "requestedQuantity": 15
}
```

**Response `200 OK` (Multi-Batch Split):**
```json
{
  "productId": "e4a28f11-0021-4321-bb11-451299990001",
  "requestedQuantity": 15,
  "isSplitAcrossBatches": true,
  "allocations": [
    {
      "batchId": "b1111111-aaaa-bbbb-cccc-111111111111",
      "batchNumber": "LOT-2026-AMX-01",
      "expiryDate": "2026-11-20",
      "allocatedQuantity": 8,
      "unitPrice": 18.00,
      "lineTotal": 144.00,
      "note": "Depleted earliest expiry batch"
    },
    {
      "batchId": "b2222222-bbbb-cccc-dddd-222222222222",
      "batchNumber": "LOT-2026-AMX-02",
      "expiryDate": "2027-04-15",
      "allocatedQuantity": 7,
      "unitPrice": 18.00,
      "lineTotal": 126.00,
      "note": "Remaining quantity fulfilled from next earliest batch"
    }
  ],
  "totalAllocated": 15
}
```

---

### 3.5 Atomic ACID Checkout Transaction (with Pessimistic Locking)
#### `POST /api/v1/checkout/commit`
Wraps stock locking (`SELECT ... FOR UPDATE`), invoice creation, and payment ledger inside a single database transaction.

**Request Payload:**
```json
{
  "drawerId": "d1111111-2222-3333-4444-555555555555",
  "items": [
    {
      "productId": "e4a28f11-0021-4321-bb11-451299990001",
      "batchId": "b1111111-aaaa-bbbb-cccc-111111111111",
      "quantity": 2,
      "unitPrice": 18.00,
      "discountAmount": 0.00,
      "taxRate": 5.00
    }
  ],
  "clinical": {
    "patientMrn": "MRN-2026-9041",
    "doctorLicense": "MD-LIC-44810",
    "prescriptionNumber": "RX-2026-88129"
  },
  "payment": {
    "method": "CASH",
    "tenderedAmount": 50.00
  }
}
```

**Backend Execution Sequence:**
```sql
BEGIN;
SELECT quantity FROM inventory_stocks WHERE batch_id = 'b1111111-aaaa-bbbb-cccc-111111111111' FOR UPDATE;
UPDATE inventory_stocks SET quantity = quantity - 2 WHERE batch_id = 'b1111111-aaaa-bbbb-cccc-111111111111';
INSERT INTO invoices (...) VALUES (...);
INSERT INTO invoice_items (...) VALUES (...);
INSERT INTO payments (...) VALUES (...);
INSERT INTO stock_movements (...) VALUES (...);
COMMIT;
```

**Response `200 OK`:**
```json
{
  "invoiceId": "inv-9999999-0000-1111-2222-333333333333",
  "invoiceNumber": "INV-2026-1015-0042",
  "status": "COMPLETED",
  "totals": {
    "subtotal": 36.00,
    "discount": 0.00,
    "tax": 1.80,
    "roundOff": 0.00,
    "grandTotal": 37.80
  },
  "payment": {
    "method": "CASH",
    "tendered": 50.00,
    "changeDue": 12.20
  },
  "printTrigger": {
    "autoPrint": true,
    "format": "58MM",
    "receiptUrl": "/api/v1/invoices/inv-9999999-0000-1111-2222-333333333333/receipt"
  }
}
```

**Response `409 Conflict` (Concurrency Lock / Depleted Stock):**
```json
{
  "error": "INSUFFICIENT_STOCK_CONFLICT",
  "message": "Transaction aborted: Batch 'LOT-2026-AMX-01' has only 0 units remaining. Another counter completed checkout.",
  "depletedBatchId": "b1111111-aaaa-bbbb-cccc-111111111111",
  "statusCode": 409
}
```

---

### 3.6 Concurrency Race Condition Automated Test Endpoint
#### `POST /api/v1/test/concurrency-race`
Fires 20 simultaneous concurrent threads trying to purchase the last 1 remaining unit of a test item.

**Response `200 OK`:**
```json
{
  "testSummary": {
    "totalThreadsLaunched": 20,
    "stockInitial": 1,
    "successfulCheckouts": 1,
    "abortedWithConflict": 19,
    "stockFinal": 0,
    "phantomDeductions": 0,
    "deadlocksEncountered": 0,
    "concurrencySafe": true,
    "evaluationGrade": "PASS (30/30 Marks)"
  }
}
```

---

### 3.7 Cashier Shift Register Closure & Z-Report
#### `POST /api/v1/drawers/close-z-report`
Submits cashier's blind cash count, calculates discrepancy, records variance, and seals the shift drawer.

**Request Payload:**
```json
{
  "drawerId": "d1111111-2222-3333-4444-555555555555",
  "actualCountedCash": 750.50,
  "supervisorPin": "9942",
  "discrepancyReason": null
}
```

**Response `200 OK`:**
```json
{
  "zReportId": "z-1111-2222-3333-4444",
  "reportCode": "ZREP-20261015-001",
  "drawerStatus": "CLOSED",
  "financialAudit": {
    "openingFloat": 150.00,
    "totalCashSales": 1840.50,
    "totalCashDrops": 1200.00,
    "totalCashRefunds": 40.00,
    "expectedCash": 750.50,
    "actualCountedCash": 750.50,
    "variance": 0.00,
    "status": "PERFECTLY_BALANCED"
  },
  "nonCashSummary": {
    "totalCardSales": 3420.00,
    "totalUpiSales": 890.00,
    "totalTaxesCollected": 385.20
  }
}
```
