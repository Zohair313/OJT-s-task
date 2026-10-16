# Thermal Receipt Printing Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, enterprise-grade Thermal Receipt Printing subsystem supporting both 80mm (Supermarket Retail) and 58mm (Hospital Pharmacy) paper widths, authentic ESC/POS monospace layout, dynamic print CSS, barcode rendering, clinical prescription blocks, and full unit test coverage.

**Architecture:** A standalone React modal component (`ThermalReceipt.tsx`) styled with clean Tailwind CSS and Lucide icons, backed by a pure utility module (`thermalReceiptUtil.ts`) that handles currency formatting, line item truncation, column alignment, dynamic `@page` print dimensions, and ESC/POS raw command generation.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Lucide React, Node test runner.

**Spec:** [ARCHITECTURE.md](file:///e:/OJT's%20task/ARCHITECTURE.md#9-thermal-print-subsystem-80mm--58mm)

## Global Constraints

- Zero external thermal printer binary drivers required for browser print (pure CSS `@media print` with strict pixel/mm precision).
- Monospace font stack (`'JetBrains Mono', 'Courier New', monospace`) for character-grid columnar alignment.
- Support both 80mm (48 characters/line) and 58mm (32 characters/line) receipt formats.
- Clean human-like code adhering to existing project design guidelines.

## Review Focus

1. **Large Number & Infinity Protection:** Subtotal or price exceeding millions or NaN should format safely without breaking the receipt layout.
2. **Long Product Name Wrapping:** Product titles exceeding column width must wrap neatly without overlapping adjacent price or quantity columns.
3. **58mm vs 80mm Dynamic Page Sizing:** In print mode, `@page` size must match the selected format (`58mm auto` vs `80mm auto`).
4. **Clinical Prescription Privacy:** In non-pharmacy mode, patient MRN and physician license fields must not render on retail supermarket receipts.
5. **Thermal Print Header Visibility:** Browser print styles must hide modal overlays, backdrop, and navbar buttons, ensuring ONLY the white paper receipt prints.

---

### Task 1: Thermal Receipt Utility & Formatting Logic

**Files:**
- Create: `frontend/src/utils/thermalReceiptUtil.ts`
- Test: `frontend/src/utils/__tests__/thermalReceiptUtil.test.mjs`

- [ ] **Step 1.1: Write the tests** for `thermalReceiptUtil.ts` covering:
  - `formatCurrency(val)`: Handles valid amounts, NaN, null, and large values safely.
  - `formatReceiptLine(left, right, maxChars)`: Columnar alignment with dot leaders or space padding.
  - `generateEscPosText(invoice, store, format)`: Raw text representation for ESC/POS receipt printers.
- [ ] **Step 1.2: Implement `thermalReceiptUtil.ts`** with pure formatting functions and column wrapping.
- [ ] **Step 1.3: Run test suite** to confirm 100% pass.
- [ ] **Step 1.4: Commit** `feat: add thermal receipt formatting utilities and tests`.

---

### Task 2: Dynamic Thermal Print CSS & Page Sizing

**Files:**
- Modify: `frontend/src/index.css:64-112`

- [ ] **Step 2.1: Add dynamic `@media print` rules** supporting both `.print-format-58mm` (`@page { size: 58mm auto; margin: 0; }`) and `.print-format-80mm` (`@page { size: 80mm auto; margin: 0; }`).
- [ ] **Step 2.2: Add thermal paper styling tokens** (monospaced dashed dividers, high-contrast thermal text rendering).
- [ ] **Step 2.3: Build frontend** (`npm --prefix frontend run build`) to ensure 0 CSS/Vite errors.
- [ ] **Step 2.4: Commit** `style: add 80mm and 58mm dynamic thermal print styles`.

---

### Task 3: Redesign `ThermalReceipt.tsx` Component

**Files:**
- Modify: `frontend/src/components/ThermalReceipt.tsx`

- [ ] **Step 3.1: Modernize Modal Shell** with Tailwind dark mode, Lucide icons (`Printer`, `X`, `FileText`, `CheckCircle2`), and clean pill switches.
- [ ] **Step 3.2: Implement 80mm vs 58mm live switcher** that adjusts receipt container width and injects proper print class.
- [ ] **Step 3.3: Implement Raw ESC/POS Text View tab** allowing cashier to copy or preview raw serial output.
- [ ] **Step 3.4: Integrate BarcodeSvg & Clinical Rx data** with crisp typography.
- [ ] **Step 3.5: Build frontend** (`npm --prefix frontend run build`) to confirm 0 compilation errors.
- [ ] **Step 3.6: Commit** `feat: modernize ThermalReceipt component with 80mm/58mm switching and ESC/POS preview`.

---

### Task 4: End-to-End Verification & POS Integration

**Files:**
- Modify: `frontend/src/App.tsx:905-925`

- [ ] **Step 4.1: Verify checkout flow** triggers the enhanced `ThermalReceipt` modal upon successful sale.
- [ ] **Step 4.2: Run end-to-end node verification script** verifying checkout and invoice payload structure.
- [ ] **Step 4.3: Final test & build verification** across frontend and backend.
- [ ] **Step 4.4: Commit and push** to `origin/main`.
