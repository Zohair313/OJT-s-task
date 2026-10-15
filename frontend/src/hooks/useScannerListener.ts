import { useEffect, useRef, useState } from 'react';
import { playScannerBeep } from '../utils/audio';

interface UseScannerListenerOptions {
  onScan: (barcode: string) => void;
  maxInterKeyDeltaMs?: number;
  minBarcodeLength?: number;
}

export function useScannerListener({
  onScan,
  maxInterKeyDeltaMs = 40,
  minBarcodeLength = 4
}: UseScannerListenerOptions) {
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>('');
  const [lastScanLatencyMs, setLastScanLatencyMs] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const scanStartTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Handle barcode suffix termination (Enter key)
      if (e.key === 'Enter') {
        const buffer = bufferRef.current.trim();
        if (buffer.length >= minBarcodeLength) {
          e.preventDefault();
          const latency = Math.round(now - scanStartTimeRef.current);
          setLastScanLatencyMs(latency);
          setLastScannedBarcode(buffer);
          setIsScanning(false);
          bufferRef.current = '';

          // Play confirmation beep and dispatch
          playScannerBeep(true);
          onScan(buffer);
        } else {
          bufferRef.current = '';
        }
        return;
      }

      // Check if keystroke is rapid enough to be a hardware scanner burst
      if (delta < maxInterKeyDeltaMs || bufferRef.current.length === 0) {
        if (bufferRef.current.length === 0) {
          scanStartTimeRef.current = now;
          setIsScanning(true);
        }
        if (e.key.length === 1) {
          bufferRef.current += e.key;
        }
      } else {
        // Slow keystroke: user is typing manually.
        // If they type into an input, let the browser handle it.
        bufferRef.current = e.key.length === 1 ? e.key : '';
        scanStartTimeRef.current = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScan, maxInterKeyDeltaMs, minBarcodeLength]);

  return {
    lastScannedBarcode,
    lastScanLatencyMs,
    isScanning
  };
}
