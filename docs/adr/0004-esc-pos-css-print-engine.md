# ADR 0004: Pure CSS Media-Print Architecture for ESC/POS Thermal Receipts

## Status
Accepted

## Context
Standard enterprise POS systems need to print receipts on 80mm or 58mm thermal rolls. Traditional solutions require installing native desktop bridges (e.g., QZ Tray, Electron native drivers, or Java applets) to send raw ESC/POS binary codes over USB/COM ports. However, native bridge agents introduce installation hurdles, cross-platform OS dependency issues, and security warnings.

## Decision
We implement a **Dual-Mode Thermal Receipt Engine**:
1. **Primary Browser-Native Mode (Pure CSS Print):**
   - High-precision CSS `@media print` with explicit `@page { size: 80mm auto; margin: 0; }` or `@page { size: 58mm auto; margin: 0; }`.
   - Monospace typography (`Courier New`, `Consolas`, `Roboto Mono`) with tabular alignment, dotted dividers, barcode SVGs, and QR codes.
   - Cashier checkout triggers an invisible iframe print (`window.print()`) for instant, zero-plugin thermal printing.
2. **Secondary Network / Raw Bridge Mode (ESC/POS Binary):**
   - Provides an optional backend raw socket client (`net.Socket`) for network receipt printers listening on port 9100.
   - Generates raw ESC/POS byte streams:
     - `ESC @` (Initialize printer)
     - `GS ! \x00` (Standard font size)
     - `GS ! \x11` (Double width/height title)
     - `GS V 1` (Paper cut command)
     - `DLE DC4 \x01 \x01 \x01` (Cash drawer kick pulse)

## Consequences

### Positive
- Works instantly in any modern web browser without installing third-party helper apps.
- Exact styling fidelity: preview looks identical to the printed thermal paper.
- Full support for both 80mm (Supermarket standard) and 58mm (Express/Pharmacy standard).

### Negative / Trade-Offs
- Browser print dialog requires user to select "Save as PDF" or check "Silent Printing" flag in Chromium kiosk mode (`--kiosk --kiosk-printing`) for completely silent instant cutting.
