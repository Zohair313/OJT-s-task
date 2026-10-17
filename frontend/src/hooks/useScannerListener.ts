import { useEffect, useRef } from 'react';
import { playScannerBeep } from '../utils/audio';

interface UseScannerListenerOptions {
  onScan: (barcode: string) => void;
  maxInterKeyDeltaMs?: number;
  minBarcodeLength?: number;
  enabled?: boolean;
}

export function useScannerListener({
  onScan,
  maxInterKeyDeltaMs = 160,
  minBarcodeLength = 3,
  enabled = true
}: UseScannerListenerOptions) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const bufferTimeoutRef = useRef<any>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e || typeof e.key !== 'string') return;

      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isSearchInput = target && (target.id === 'pos-search-input' || target.getAttribute('name') === 'pos-search');

      const now = performance.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Handle barcode suffix termination (Enter or Tab key)
      if (e.key === 'Enter' || e.key === 'Tab') {
        const buffer = bufferRef.current.trim();
        if (buffer.length >= minBarcodeLength) {
          e.preventDefault();
          e.stopPropagation();
          bufferRef.current = '';
          if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);

          // If barcode burst accidentally entered a non-search input, clean it
          if (isInput && !isSearchInput && target && 'value' in target) {
            const inputEl = target as HTMLInputElement;
            if (typeof inputEl.value === 'string' && inputEl.value.endsWith(buffer)) {
              inputEl.value = inputEl.value.slice(0, -buffer.length);
            }
          }

          // Trigger scan callback
          playScannerBeep(true);
          onScanRef.current(buffer);
          return;
        } else {
          bufferRef.current = '';
        }
        return;
      }

      // If user is manually typing slowly in a text input (e.g. searching, typing notes),
      // don't treat human keystrokes as hardware scanner burst
      if (isInput && !isSearchInput && delta > 120 && bufferRef.current.length === 0) {
        return;
      }

      // Check if keystroke is part of a rapid scanner burst
      if (delta < maxInterKeyDeltaMs || bufferRef.current.length === 0) {
        if (e.key && e.key.length === 1) {
          bufferRef.current += e.key;

          // Clear buffer after 300ms of inactivity
          if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
          bufferTimeoutRef.current = setTimeout(() => {
            bufferRef.current = '';
          }, 300);
        }
      } else {
        // Gap was too long outside input: reset buffer with this single character
        if (!isInput || isSearchInput) {
          bufferRef.current = (e.key && e.key.length === 1) ? e.key : '';
          if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
          bufferTimeoutRef.current = setTimeout(() => {
            bufferRef.current = '';
          }, 300);
        } else {
          bufferRef.current = '';
        }
      }
    };

    // Use capture phase to intercept scanner keystrokes cleanly
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
    };
  }, [enabled, maxInterKeyDeltaMs, minBarcodeLength]);
}
