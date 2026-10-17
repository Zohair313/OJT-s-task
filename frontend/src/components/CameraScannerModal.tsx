import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, RefreshCw, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { playScannerBeep } from '../utils/audio';

interface CameraScannerModalProps {
  onScanBarcode: (barcode: string) => void;
  onClose: () => void;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({ onScanBarcode, onClose }) => {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerId = 'camera-barcode-reader';

  // Fast-test samples
  const quickSamples = [
    { name: 'Amoxicillin 500mg', code: '8901000000101' },
    { name: 'Paracetamol 650mg', code: '8901000000102' },
    { name: 'Atorvastatin 20mg', code: '8901000000200' },
    { name: 'Retail Soda 500ml', code: '8901000000001' },
    { name: 'Potato Chips 150g', code: '8901000000502' },
  ];

  useEffect(() => {
    let isMounted = true;
    let html5QrCode: Html5Qrcode | null = null;

    const startScanner = async () => {
      try {
        setCameraError(null);
        html5QrCode = new Html5Qrcode(readerId);
        scannerRef.current = html5QrCode;

        const config = {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.333333,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
          ]
        };

        await html5QrCode.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            if (!isMounted) return;
            setDetectedCode(decodedText);
            playScannerBeep(true);
            
            // Stop camera and dispatch
            if (scannerRef.current?.isScanning) {
              scannerRef.current.stop().catch(() => {}).finally(() => {
                onScanBarcode(decodedText);
                onClose();
              });
            } else {
              onScanBarcode(decodedText);
              onClose();
            }
          },
          () => {
            // Frame search callback - ignore frame misses
          }
        );

        if (isMounted) setIsScanning(true);
      } catch (err: any) {
        if (!isMounted) return;
        console.warn('Camera scanner initialization notice:', err);
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Please allow camera access or use the manual barcode tester below.'
            : 'Could not access camera device. Please ensure a webcam or camera is connected, or enter the barcode manually.'
        );
        setIsScanning(false);
      }
    };

    const timer = setTimeout(() => {
      startScanner();
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(() => {}).finally(() => {
            scannerRef.current?.clear();
          });
        } else {
          scannerRef.current.clear();
        }
      }
    };
  }, [onClose, onScanBarcode]);

  const handleManualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) return;
    onScanBarcode(clean);
    onClose();
  };

  const handleQuickSample = (code: string) => {
    onScanBarcode(code);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Camera Barcode Scanner
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  Live
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aim your device camera or webcam at any product barcode
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative bg-slate-950 flex flex-col items-center justify-center min-h-[280px] overflow-hidden">
          {/* HTML5 QR/Barcode video container */}
          <div id={readerId} className="w-full max-w-[420px] overflow-hidden rounded-lg" />

          {/* Animated Laser Overlay when active */}
          {isScanning && !cameraError && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-72 h-44 border-2 border-emerald-500/80 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                {/* Laser beam */}
                <div className="absolute left-0 right-0 h-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse top-1/2 -translate-y-1/2" />
                {/* Corner reticles */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-400 rounded-tl" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-400 rounded-tr" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-400 rounded-bl" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-400 rounded-br" />
              </div>
            </div>
          )}

          {/* Detection Confirmation Overlay */}
          {detectedCode && (
            <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-xs flex flex-col items-center justify-center text-white z-20">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-bounce mb-2" />
              <div className="text-lg font-bold">Barcode Detected!</div>
              <div className="font-mono text-emerald-300 text-sm mt-1">{detectedCode}</div>
            </div>
          )}

          {/* Error / Fallback View */}
          {cameraError && (
            <div className="p-6 text-center text-slate-300 max-w-sm flex flex-col items-center">
              <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
              <h4 className="font-semibold text-sm text-white mb-1">Webcam Not Available</h4>
              <p className="text-xs text-slate-400 mb-4">{cameraError}</p>
            </div>
          )}
        </div>

        {/* Direct Barcode Entry & Quick-Test Barcodes */}
        <div className="p-5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Or enter barcode directly (e.g. 8901000000101)..."
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              className="flex-1 px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-xs transition"
            >
              Scan Barcode
            </button>
          </form>

          <div>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>1-Click Test Barcodes:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickSamples.map((sample) => (
                <button
                  key={sample.code}
                  type="button"
                  onClick={() => handleQuickSample(sample.code)}
                  className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 rounded-lg transition font-mono flex items-center gap-1.5"
                >
                  <span className="font-sans font-medium">{sample.name}:</span>
                  <span className="font-bold text-[11px]">{sample.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
