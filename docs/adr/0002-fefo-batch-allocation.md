# ADR 0002: First-Expired, First-Out (FEFO) Batch Allocation Engine

## Status
Accepted

## Context
Hospital pharmacies and retail supermarkets carrying perishable goods suffer significant financial losses when inventory expires on shelves. Furthermore, in clinical pharmacy settings, dispensing expired pharmaceuticals to patients poses lethal health risks and severe legal liability.

In conventional systems, cashiers either manually inspect lot numbers (slow, error-prone) or the system performs generic FIFO (First-In, First-Out, sorting by receipt date instead of true chemical expiry date).

## Decision
We implement an **Automated FEFO (First-Expired, First-Out) Engine** directly into the barcode resolution and cart calculation pipeline.

### Rules of Operation:
1. **Earliest Expiry Priority:** When a product barcode or generic code is scanned, the database queries all active batches where `quantity > 0` and `expiry_date > CURRENT_DATE`, sorting ascending by `expiry_date ASC`.
2. **Expired Batch Quarantine:** Batches with `expiry_date <= CURRENT_DATE` are automatically flagged with `QUARANTINED` status and cannot be sold at the POS counter under any circumstance.
3. **Multi-Batch Automatic Split:**
   - If a customer requests 10 units, and the earliest expiring batch has only 4 units, the engine splits the line item:
     - 4 units allocated to `Batch #1` (Earliest Expiry)
     - 6 units allocated to `Batch #2` (Next Earliest Expiry)
   - Both allocations are represented in the cart and printed individually on the thermal receipt with their batch numbers and expiry dates.
4. **Near-Expiry Warning:** If a batch has `< 30 days` to expiration, a yellow warning banner appears on the cashier screen to notify the pharmacist.

## Consequences

### Positive
- Minimizes medication and perishable spoilage.
- Ensures total compliance with Ministry of Health and FDA pharmaceutical distribution regulations.
- Eliminates manual lot selection delays for the cashier.

### Negative / Trade-Offs
- Slightly more complex cart calculation and receipt printing because a single requested product can expand into multiple invoice lines.
