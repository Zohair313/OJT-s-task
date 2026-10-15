# ADR 0003: Scanner Keystroke Emulation Event Buffer

## Status
Accepted

## Context
Commercial handheld barcode scanners (Zebra, Honeywell, Datalogic) typically communicate via USB or Bluetooth in **HID (Human Interface Device) Keyboard Emulation Mode**. When a barcode is read, the scanner emits the encoded string as rapid hardware keystrokes followed by an `Enter` key (`\r` or `\n`).

Standard web applications rely on an active text input `<input type="text">` being permanently focused. However:
1. Cashiers frequently click other UI elements (e.g., clicking a discount button, selecting payment method, or clicking a customer profile), losing focus on the input box.
2. If focus is lost, scanned barcodes either trigger browser keyboard shortcuts, type into the wrong input, or are completely lost.
3. Human typing (e.g. typing a customer name) must not be accidentally interpreted as a barcode scan.

## Decision
We implement a **Global Window-Level Keystroke Timing Buffer**:

### Mechanism:
1. A global listener attaches to `window.addEventListener('keydown', ...)`.
2. Every keystroke timestamps its arrival time: `delta = current_timestamp - previous_timestamp`.
3. **Hardware Scanner vs. Human Typing Differentiation:**
   - Barcode scanners emit characters with an extremely rapid delta: typically `5ms` to `25ms` per character.
   - Humans rarely type consistently faster than `60ms` per character.
   - If `delta < 35ms`, the character is appended to the scanner buffer.
   - If `delta > 100ms`, the buffer clears automatically.
4. **Trigger Condition:** Upon receiving an `Enter` key:
   - If the accumulated buffer length is $\ge 4$ characters and average delta $\le 35ms$, the event is classified as a **Verified Barcode Scan**.
   - `event.preventDefault()` stops any unintended form submission.
   - The barcode string is immediately dispatched to the Cart Ingestion Engine.
   - The buffer is reset to empty.

## Consequences

### Positive
- Zero-lag cashier operation: The cashier can scan items regardless of where their mouse is or which modal is open.
- Eliminates the need for aggressive focus-stealing `input.focus()` intervals.
- Distinguishes human typing in search inputs from hardware scanner bursts.

### Negative / Trade-Offs
- Requires clean cleanup on component unmount to avoid memory leaks.
- Test suites must simulate rapid keystroke bursts with accurate millisecond delays.
