# ADR 0001: Pessimistic Row-Level Locking for Inventory Deduction

## Status
Accepted

## Context
In a multi-terminal retail supermarket or high-volume hospital pharmacy, multiple cashier counters often process high-velocity sales concurrently. When inventory for a high-demand or emergency drug is depleted to the last remaining units (e.g., Quantity = 1), two cashiers may scan and submit checkout for the same item at the exact same instant.

If unmanaged, standard non-locking database transactions read `quantity = 1` concurrently, both decrement by 1, and write back `quantity = 0` (or `-1` if constraint is missing), causing:
1. Inventory phantom sales (selling physical goods that do not exist).
2. Stock shrinkage and audit failure.
3. Severe regulatory infractions (e.g. selling controlled medicines without actual stock).

We evaluated two architectural approaches:
1. **Optimistic Concurrency Control (OCC):** Using a `version` column (`WHERE version = 3`). If a conflict occurs, abort and trigger an application-level retry loop.
2. **Pessimistic Concurrency Control (PCC):** Using PostgreSQL's explicit row-level locks via `SELECT ... FOR UPDATE` within a transactional boundary (`BEGIN ... COMMIT`).

## Decision
We choose **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`)**.

### Detailed Implementation Rules:
1. At checkout execution, the transaction starts: `BEGIN TRANSACTION`.
2. All requested `batch_id` values are sorted alphabetically ascending before querying to ensure deterministic lock acquisition order and eliminate deadlock cycles:
   ```sql
   SELECT id, batch_id, quantity 
   FROM inventory_stocks 
   WHERE batch_id IN ($1, $2, ...) 
   ORDER BY batch_id ASC 
   FOR UPDATE;
   ```
3. The engine verifies `quantity >= requested_quantity`.
4. If valid, the stock is decremented immediately, invoice and ledger items are inserted, and the transaction is committed: `COMMIT`.
5. If stock is insufficient, the transaction issues `ROLLBACK` and responds with HTTP `409 Conflict` specifying the exact depleted batch.

## Consequences

### Positive
- **Guaranteed Consistency:** Mathematically prevents race conditions and eliminates double-spending of stock.
- **Predictable POS Behavior:** Unlike OCC, which can cause erratic multi-retry latency spikes or silent failures during peak rush hours, PCC queues incoming transactions for a few milliseconds, ensuring the first checkout succeeds cleanly and subsequent ones fail gracefully with an immediate "Item Out of Stock" message.
- **ACID Integrity:** Combines seamlessly with PostgreSQL transaction rollbacks.

### Negative / Trade-Offs
- Slightly increased lock contention if multiple counters sell the exact same SKU simultaneously (contention duration is negligible, `< 15ms`, because POS checkout write transactions execute in sub-30ms).
- Requires developers to strictly sort `batch_id` values before locking to avoid database deadlocks.
