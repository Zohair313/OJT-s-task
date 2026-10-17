import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Building2,
  Camera,
  ChevronDown,
  CreditCard,
  FileText,
  HelpCircle,
  Minus,
  Pill,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import { useScannerListener } from './hooks/useScannerListener';
import { ThermalReceipt } from './components/ThermalReceipt';
import { ZReportModal } from './components/ZReportModal';
import { ConcurrencyTestModal } from './components/ConcurrencyTestModal';
import { ScannerSimulatorModal } from './components/ScannerSimulatorModal';
import { CameraScannerModal } from './components/CameraScannerModal';
import { AdminPanel } from './components/AdminPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { playScannerBeep } from './utils/audio';

interface CartLineItem {
  cartId: string;
  productId: string;
  productName: string;
  genericName?: string;
  sku: string;
  barcode: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  isNearExpiry: boolean;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountAmount: number;
  isSplit: boolean;
  maxAvailable: number;
}

export function App() {
  // Navigation View ('pos' | 'admin')
  const [currentView, setCurrentView] = useState<'pos' | 'admin'>(() => {
    return window.location.pathname.startsWith('/admin') ? 'admin' : 'pos';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(window.location.pathname.startsWith('/admin') ? 'admin' : 'pos');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (view: 'pos' | 'admin') => {
    setCurrentView(view);
    const targetPath = view === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  };

  // Domain Tenant Context
  const [tenantId, setTenantId] = useState<string>('t-pharma-002');
  const [tenants, setTenants] = useState<any[]>([]);
  const isPharmacy = tenantId === 't-pharma-002';

  // Cashier Drawer Session
  const [activeDrawer, setActiveDrawer] = useState<any | null>(null);

  // Cart State
  const [cart, setCart] = useState<CartLineItem[]>([]);
  const [lastScanLatency, setLastScanLatency] = useState<number>(0);
  const [statusNotification, setStatusNotification] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clinical Tagging State (Collapsible Accordion)
  const [isClinicalOpen, setIsClinicalOpen] = useState<boolean>(true);
  const [patientMrn, setPatientMrn] = useState<string>('MRN-884920');
  const [patientName, setPatientName] = useState<string>('Jonathan Doe');
  const [doctorLicense, setDoctorLicense] = useState<string>('MD-LIC-44810');
  const [prescriptionNumber, setPrescriptionNumber] = useState<string>('RX-2026-9901');

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CREDIT_CARD' | 'UPI_QR'>('CASH');
  const [tenderedAmount, setTenderedAmount] = useState<string>('');

  // Modals
  const [completedInvoice, setCompletedInvoice] = useState<any | null>(null);
  const [showZReportModal, setShowZReportModal] = useState<boolean>(false);
  const [showConcurrencyModal, setShowConcurrencyModal] = useState<boolean>(false);
  const [showSimulatorModal, setShowSimulatorModal] = useState<boolean>(false);
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState<boolean>(false);

  // 1. Fetch Tenants & Active Drawer on Mount / Tenant Change
  useEffect(() => {
    fetch('/api/v1/tenants')
      .then(res => res.json())
      .then(data => setTenants(data))
      .catch(() => {});

    fetch(`/api/v1/drawers/active?tenantId=${tenantId}`)
      .then(res => res.json())
      .then(drawer => {
        if (!drawer) {
          fetch('/api/v1/drawers/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify({
              openingFloat: 150.00,
              terminalId: isPharmacy ? 'PHARMA-COUNTER-01' : 'POS-COUNTER-01'
            })
          })
            .then(res => res.json())
            .then(d => setActiveDrawer(d));
        } else {
          setActiveDrawer(drawer);
        }
      })
      .catch(() => {});
  }, [tenantId, isPharmacy]);

  // 2. Debounced Live Search (250ms)
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      fetch(`/api/v1/products?q=${encodeURIComponent(searchQuery)}&limit=8&tenantId=${tenantId}`)
        .then(res => res.json())
        .then(data => setSearchResults(data.products || []))
        .catch(() => {});
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, tenantId]);

  // 3. Scan-to-Cart Ingestion Logic (< 150ms Ingestion)
  const handleBarcodeScanned = async (barcode: string) => {
    const cleanBarcode = (barcode || '').trim();
    if (!cleanBarcode) return;

    const start = performance.now();
    try {
      const res = await fetch(`/api/v1/scanner/lookup/${encodeURIComponent(cleanBarcode)}?tenantId=${tenantId}`);
      const data = await res.json();

      if (!res.ok) {
        playScannerBeep(false);
        showNotification(data?.message || `No item found for barcode '${cleanBarcode}'`, 'error');
        return;
      }

      // If scanned barcode is an invoice receipt, immediately display the receipt
      if (data.type === 'INVOICE' && data.invoice) {
        playScannerBeep(true);
        setCompletedInvoice(data.invoice);
        const latency = Math.round(performance.now() - start);
        setLastScanLatency(latency);
        showNotification(`Loaded Receipt #${data.invoice.invoiceNumber} (${latency}ms)`, 'success');
        setSearchQuery('');
        setSearchResults([]);
        return;
      }

      if (!data.product) {
        playScannerBeep(false);
        showNotification(`No item found for barcode '${cleanBarcode}'`, 'error');
        return;
      }

      const product = data.product;

      // Auto-align tenant if cross-branch item was scanned
      if (product.tenantId && product.tenantId !== tenantId) {
        setTenantId(product.tenantId);
      }

      // Resolve FEFO Allocation for this product
      const fefoRes = await fetch('/api/v1/fefo/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, requestedQuantity: 1 })
      });
      const fefoData = await fefoRes.json();

      if (!fefoData.allocations || fefoData.allocations.length === 0) {
        playScannerBeep(false);
        showNotification(`'${product.name}' is out of stock!`, 'error');
        return;
      }

      const alloc = fefoData.allocations[0];

      // Add to Cart
      setCart(prev => {
        const existingIdx = prev.findIndex(item => item.batchId === alloc.batchId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx].quantity += 1;
          return updated;
        } else {
          const newLine: CartLineItem = {
            cartId: `${product.id}-${alloc.batchId}-${Date.now()}`,
            productId: product.id,
            productName: product.name,
            genericName: product.genericName,
            sku: product.sku,
            barcode: product.barcode,
            batchId: alloc.batchId,
            batchNumber: alloc.batchNumber,
            expiryDate: alloc.expiryDate,
            daysToExpiry: alloc.daysToExpiry,
            isNearExpiry: alloc.isNearExpiry,
            quantity: 1,
            unitPrice: alloc.unitPrice,
            taxRate: product.defaultTaxRate,
            discountAmount: 0,
            isSplit: false,
            maxAvailable: alloc.allocatedQuantity
          };
          return [...prev, newLine];
        }
      });

      // Play successful scanner audio confirmation
      playScannerBeep(true);

      const latency = Math.round(performance.now() - start);
      setLastScanLatency(latency);
      showNotification(`Added ${product.name} (${latency}ms)`, 'success');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      playScannerBeep(false);
      showNotification(err?.message || 'Barcode scan failed', 'error');
    }
  };

  const showNotification = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusNotification({ text, type });
    setTimeout(() => {
      setStatusNotification(null);
    }, 3500);
  };

  // Hardware Scanner Listener (Active only on POS Counter)
  useScannerListener({
    onScan: handleBarcodeScanned,
    enabled: currentView === 'pos'
  });

  // Global Keyboard Shortcuts (F1, F2, F4, F9, F12, Ctrl+K, Esc)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (currentView !== 'pos') return;
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        setShowCameraModal(prev => !prev);
      } else if (e.key === 'F4') {
        e.preventDefault();
        setIsClinicalOpen(prev => !prev);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setShowZReportModal(true);
      } else if (e.key === 'F12') {
        e.preventDefault();
        handleCheckoutSubmit();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowSimulatorModal(true);
      } else if (e.key === 'Escape') {
        setShowSimulatorModal(false);
        setShowCameraModal(false);
        setShowConcurrencyModal(false);
        setShowZReportModal(false);
        setShowShortcutsHelp(false);
        setSearchResults([]);
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [cart, tenderedAmount, paymentMethod, activeDrawer]);

  // Cart Calculations (Precise Integer Cents)
  const cartSubtotal = cart.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const cartDiscount = cart.reduce((sum, item) => sum + item.discountAmount, 0);
  const cartTax = cart.reduce((sum, item) => {
    const taxable = Math.max(0, (item.quantity * item.unitPrice) - item.discountAmount);
    return sum + (taxable * item.taxRate) / 100;
  }, 0);
  const cartGrandTotal = Math.max(0, cartSubtotal - cartDiscount + cartTax);
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const parsedTender = parseFloat(tenderedAmount);
  const isTenderEntered = tenderedAmount.trim().length > 0 && !isNaN(parsedTender);
  const isInsufficientCash = paymentMethod === 'CASH' && isTenderEntered && parsedTender < cartGrandTotal;
  const tenderedNumeric = isTenderEntered 
    ? Math.min(parsedTender, 100000) 
    : cartGrandTotal;
  const changeDue = Math.max(0, tenderedNumeric - cartGrandTotal);

  const updateQuantity = (cartId: string, newQty: number) => {
    if (newQty <= 0) {
      setCart(prev => prev.filter(item => item.cartId !== cartId));
    } else {
      setCart(prev => prev.map(item => item.cartId === cartId ? { ...item, quantity: newQty } : item));
    }
  };

  const removeCartItem = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  // Submit Checkout (ACID Pipeline)
  const handleCheckoutSubmit = async () => {
    if (cart.length === 0) {
      showNotification('Cart is empty. Scan an item first.', 'error');
      return;
    }
    if (isInsufficientCash) {
      playScannerBeep(false);
      showNotification(`Insufficient cash tender: Received $${parsedTender.toFixed(2)}, total due is $${cartGrandTotal.toFixed(2)}. Please collect the remaining $${(cartGrandTotal - parsedTender).toFixed(2)} or click 'Exact'.`, 'error');
      return;
    }

    try {
      const payload = {
        drawerId: activeDrawer?.id || '',
        items: cart.map(item => ({
          productId: item.productId,
          batchId: item.batchId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount
        })),
        clinical: isPharmacy ? {
          patientMrn,
          patientName,
          doctorLicense,
          prescriptionNumber
        } : undefined,
        payment: {
          method: paymentMethod,
          tenderedAmount: tenderedNumeric
        }
      };

      const res = await fetch('/api/v1/checkout/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(payload)
      });

      const invoice = await res.json();
      if (!res.ok) {
        throw new Error(invoice.message || invoice.error || 'Checkout failed');
      }

      setCart([]);
      setTenderedAmount('');
      setCompletedInvoice(invoice);
      showNotification(`Invoice #${invoice.invoiceNumber} committed successfully.`, 'success');

      // Refresh active drawer data after sale
      fetch(`/api/v1/drawers/active?tenantId=${tenantId}`)
        .then(r => r.json())
        .then(d => { if (d) setActiveDrawer(d); })
        .catch(() => {});
    } catch (err: any) {
      playScannerBeep(false);
      showNotification(`Checkout Aborted: ${err.message}`, 'error');
    }
  };

  if (currentView === 'admin') {
    return (
      <AdminPanel
        tenantId={tenantId}
        onTenantChange={setTenantId}
        onBackToPos={() => navigateTo('pos')}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none transition-colors duration-200">
      {/* 1. TOP NAVBAR (Single-line clean bar, generous spacing) */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0 z-20 shadow-xs transition-colors duration-200">
        {/* Left: Brand, Nav Switcher, Branch Selector, Subtle Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-xs">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white">PulsePOS</span>
          </div>

          {/* Navigation Tabs: POS vs Admin */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-1 gap-1">
            <button
              onClick={() => navigateTo('pos')}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700 transition"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>POS Counter</span>
            </button>
            <button
              onClick={() => navigateTo('admin')}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition"
            >
              <Building2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Product Admin</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Clean Branch Selector */}
          <div className="relative flex items-center">
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setCart([]);
              }}
              className="appearance-none bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3.5 py-2 pr-8 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer focus:outline-none focus:border-emerald-500 transition shadow-xs"
            >
              {tenants.map(t => (
                <option key={t.id} value={t.id} className="dark:bg-slate-900 dark:text-slate-200">
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Subtle Status Pills */}
          <div className="flex items-center gap-2.5 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Scanner Ready</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 font-medium">
              <Pill className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isPharmacy ? 'FEFO Pharmacy' : 'Retail Mart'}</span>
            </div>
            {lastScanLatency > 0 && (
              <span className="font-mono text-slate-400 dark:text-slate-500 text-xs">• {lastScanLatency}ms</span>
            )}
          </div>
        </div>

        {/* Right: Quick Action Links with Clean Ghost Buttons & Theme Toggle */}
        <div className="flex items-center gap-2.5">
          {/* Theme Switcher Toggle (Light / Dark) */}
          <ThemeToggle />

          <button
            onClick={() => setShowCameraModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/30 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 hover:border-emerald-300 dark:hover:border-emerald-700 text-emerald-700 dark:text-emerald-300 rounded-lg transition shadow-xs"
            title="Scan barcode with device camera / webcam (F3)"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Camera</span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded text-emerald-700 dark:text-emerald-300">F3</kbd>
          </button>

          <button
            onClick={() => setShowSimulatorModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition shadow-xs"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Simulator</span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-400">⌘K</kbd>
          </button>

          <button
            onClick={() => setShowConcurrencyModal(true)}
            className="px-3 py-2 text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition shadow-xs"
          >
            Race Test
          </button>

          <button
            onClick={() => setShowZReportModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition shadow-xs"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Z-Report (F9)</span>
          </button>

          <button
            onClick={() => setShowShortcutsHelp(true)}
            className="p-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-lg transition shadow-xs"
            title="Shortcuts Reference (F1)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. PROMINENT WIDE SEARCH BAR */}
      <div className="px-6 py-3.5 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex justify-center shrink-0 shadow-xs transition-colors duration-200">
        <div className="relative w-full max-w-5xl">
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

          <input
            ref={searchInputRef}
            id="pos-search-input"
            name="pos-search"
            type="text"
            placeholder="Scan barcode with handheld reader, click Camera (F3), or search product by name, SKU..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const q = (e.currentTarget.value || searchQuery).trim();
                if (q.length > 0) {
                  const exactMatch = searchResults.find(
                    r => r.barcode === q || r.sku.toLowerCase() === q.toLowerCase()
                  );
                  if (exactMatch) {
                    handleBarcodeScanned(exactMatch.barcode || exactMatch.sku);
                  } else if (searchResults.length > 0 && isNaN(Number(q))) {
                    handleBarcodeScanned(searchResults[0].barcode || searchResults[0].sku || q);
                  } else {
                    handleBarcodeScanned(q);
                  }
                  setSearchQuery('');
                  setSearchResults([]);
                }
              }
            }}
            className="w-full h-12 pl-12 pr-36 bg-slate-50/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-500 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none transition shadow-xs"
          />

          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1"
                title="Clear Search"
              >
                ✕
              </button>
            )}
            <button
              onClick={() => setShowCameraModal(true)}
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-md transition shadow-xs cursor-pointer"
              title="Open Webcam / Camera Scanner (F3)"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Camera</span>
            </button>
            <kbd className="px-2 py-1 text-xs font-mono font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-500 dark:text-slate-400 shadow-xs">
              F2
            </kbd>
          </div>

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-14 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
              {searchResults.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => handleBarcodeScanned(prod.barcode)}
                  className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer transition"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {prod.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                      <span className="font-mono">SKU: {prod.sku}</span>
                      <span>•</span>
                      <span className="font-mono">BAR: {prod.barcode}</span>
                      {prod.genericName && (
                        <>
                          <span>•</span>
                          <span className="italic text-slate-600 dark:text-slate-300">{prod.genericName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60">
                      Stock: {prod.totalStock}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. MAIN WORKSPACE (2-COLUMN SPLIT) */}
      <div className="flex flex-1 overflow-hidden w-full max-w-[2200px] mx-auto">
        {/* LEFT PANE: CART AREA */}
        <div className="flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-hidden border-r border-slate-200 dark:border-slate-800 transition-colors duration-200">
          {/* Cart Header */}
          <div className="h-12 px-6 bg-slate-50/70 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Active Cart</span>
              <span className="px-2.5 py-0.5 text-xs rounded-full bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono font-semibold shadow-xs">
                {totalItemCount} items ({cart.length} lines)
              </span>
            </div>

            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-semibold px-2.5 py-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Cart (Esc)</span>
              </button>
            )}
          </div>

          {/* Cart Content: Empty State vs Table */}
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-950">
              <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center mb-5 shadow-xs text-slate-400 dark:text-slate-500">
                <ShoppingCart className="w-9 h-9" />
              </div>

              <div className="text-lg font-bold text-slate-900 dark:text-slate-200 mb-2">
                Your Counter Cart is Empty
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md leading-relaxed mb-6">
                Scan barcode with handheld reader, open{' '}
                <button
                  onClick={() => setShowCameraModal(true)}
                  className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 inline" /> Camera (F3)
                </button>
                , press{' '}
                <kbd className="px-1.5 py-0.5 text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300">
                  ⌘K
                </kbd>{' '}
                to simulate, or click a quick-add item:
              </p>

              <div className="flex gap-3 flex-wrap justify-center max-w-xl">
                {isPharmacy ? (
                  <>
                    <button
                      onClick={() => handleBarcodeScanned('8901000000101')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-slate-850 hover:text-emerald-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <Pill className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Amoxicillin 500mg (FEFO)</span>
                    </button>

                    <button
                      onClick={() => handleBarcodeScanned('8901000000102')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-slate-850 hover:text-blue-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <Pill className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Paracetamol 650mg</span>
                    </button>

                    <button
                      onClick={() => handleBarcodeScanned('8901000000203')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-500 hover:bg-amber-50/50 dark:hover:bg-slate-850 hover:text-amber-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <Pill className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Ibuprofen 400mg</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleBarcodeScanned('8901000000001')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-500 hover:bg-amber-50/50 dark:hover:bg-slate-850 hover:text-amber-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <ShoppingCart className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Retail Soda 500ml</span>
                    </button>

                    <button
                      onClick={() => handleBarcodeScanned('8901000000500')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-slate-850 hover:text-emerald-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <ShoppingCart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Organic Almond Milk 1L</span>
                    </button>

                    <button
                      onClick={() => handleBarcodeScanned('8901000000501')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-slate-850 hover:text-blue-900 dark:hover:text-white text-slate-700 dark:text-slate-300 transition shadow-xs"
                    >
                      <ShoppingCart className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Whole Wheat Bread 500g</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold sticky top-0 border-b border-slate-200 dark:border-slate-800 z-10">
                  <tr>
                    <th className="py-3.5 px-6">Item Description</th>
                    <th className="py-3.5 px-5">Batch / Expiry</th>
                    <th className="py-3.5 px-5 text-center">Quantity</th>
                    <th className="py-3.5 px-5 text-right">Unit Price</th>
                    <th className="py-3.5 px-6 text-right">Line Total</th>
                    <th className="py-3.5 px-4 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {cart.map((item) => (
                    <tr key={item.cartId} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug">{item.productName}</div>
                        <div className="text-xs text-slate-400 font-mono mt-1">
                          SKU: {item.sku} • {item.barcode}
                        </div>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-mono text-xs font-medium">
                            {item.batchNumber}
                          </span>
                          {item.isNearExpiry && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 text-xs flex items-center gap-1 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                              {item.daysToExpiry}d left
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Exp: {item.expiryDate}
                        </div>
                      </td>
                      <td className="py-4 px-5 text-center">
                        <div className="inline-flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.cartId, item.quantity - 1)}
                            className="w-7 h-7 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-800 rounded-md transition shadow-xs"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="min-w-10 text-center font-mono font-bold text-slate-900 dark:text-slate-100 text-xs">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.cartId, item.quantity + 1)}
                            className="w-7 h-7 flex items-center justify-center text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:bg-white dark:hover:bg-slate-800 rounded-md transition shadow-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-right font-mono text-slate-600 dark:text-slate-300 font-medium">
                        ${item.unitPrice.toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                        ${((item.quantity * item.unitPrice) * (1 + item.taxRate / 100)).toFixed(2)}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => removeCartItem(item.cartId)}
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-md hover:bg-rose-50 dark:hover:bg-slate-800 transition"
                          title="Remove item"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Toast Notification */}
          {statusNotification && (
            <div className={`px-5 py-2.5 border-t text-xs font-semibold flex items-center gap-2.5 ${
              statusNotification.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900/70 text-rose-800 dark:text-rose-300'
                : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900/70 text-emerald-800 dark:text-emerald-300'
            }`}>
              <span>{statusNotification.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{statusNotification.text}</span>
            </div>
          )}
        </div>

        {/* RIGHT PANE: CHECKOUT COMMAND DECK (Clean, Spacious, Balanced) */}
        <div className="w-[420px] lg:w-[460px] xl:w-[490px] 2xl:w-[520px] bg-slate-50/70 dark:bg-slate-900/95 flex flex-col p-6 gap-5 overflow-y-auto shrink-0 border-l border-slate-200 dark:border-slate-800 transition-colors duration-200">
          {/* Top Section: Payment Summary Hero Card */}
          <div className="bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Due</span>
              <div className="text-right">
                <span className="text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 tracking-tight">
                  ${cartGrandTotal.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-xs">
              <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                <span className="font-medium">Subtotal</span>
                <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">${cartSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                <span className="font-medium">Tax / VAT (5%)</span>
                <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">${cartTax.toFixed(2)}</span>
              </div>
              {cartDiscount > 0 && (
                <div className="col-span-2 flex justify-between items-center text-rose-600 dark:text-rose-400">
                  <span className="font-medium">Discounts</span>
                  <span className="font-mono font-semibold">-${cartDiscount.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Middle Section: Collapsible Clinical Prescription Details */}
          {isPharmacy && (
            <div className="bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden transition shadow-xs">
              <button
                type="button"
                onClick={() => setIsClinicalOpen(!isClinicalOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-900/60 transition"
              >
                <div className="flex items-center gap-2">
                  <Pill className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Prescription Clinical Data</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-400">
                    F4
                  </kbd>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isClinicalOpen ? 'rotate-180' : ''}`} />
              </button>

              {isClinicalOpen && (
                <div className="p-4 pt-1 grid grid-cols-2 gap-3 text-xs border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/30">
                  <div>
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold block mb-1">Patient MRN</label>
                    <input
                      type="text"
                      value={patientMrn}
                      onChange={e => setPatientMrn(e.target.value)}
                      className="w-full h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold block mb-1">Patient Name</label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      className="w-full h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 transition shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold block mb-1">Doctor License</label>
                    <input
                      type="text"
                      value={doctorLicense}
                      onChange={e => setDoctorLicense(e.target.value)}
                      className="w-full h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold block mb-1">Rx Number</label>
                    <input
                      type="text"
                      value={prescriptionNumber}
                      onChange={e => setPrescriptionNumber(e.target.value)}
                      className="w-full h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition shadow-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Methods: Clean Segmented Control */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2 bg-slate-200/60 dark:bg-slate-950/80 p-1.5 border border-slate-200 dark:border-slate-800 rounded-xl">
              <button
                onClick={() => setPaymentMethod('CASH')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'CASH'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-900/60'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Cash</span>
              </button>
              <button
                onClick={() => setPaymentMethod('CREDIT_CARD')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'CREDIT_CARD'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-900/60'
                }`}
              >
                <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Card</span>
              </button>
              <button
                onClick={() => setPaymentMethod('UPI_QR')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'UPI_QR'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-900/60'
                }`}
              >
                <QrCode className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>UPI / QR</span>
              </button>
            </div>
          </div>

          {/* Cash Tendered & Quick Bills */}
          {paymentMethod === 'CASH' && (
            <div className={`bg-white dark:bg-slate-950/80 border rounded-xl p-4 space-y-3 transition shadow-xs ${
              isInsufficientCash ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10' : 'border-slate-200 dark:border-slate-800'
            }`}>
              <div className="flex justify-between items-center text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                <span>Cash Tendered</span>
                {changeDue > 0 && isFinite(changeDue) && changeDue <= 100000 && !isInsufficientCash && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono text-xs normal-case font-bold">
                    Change Due: ${changeDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                {isInsufficientCash && (
                  <span className="text-rose-600 dark:text-rose-400 font-mono text-xs normal-case font-bold animate-pulse">
                    Short by: ${(cartGrandTotal - parsedTender).toFixed(2)}
                  </span>
                )}
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold font-mono">$</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  autoComplete="off"
                  placeholder={`${cartGrandTotal.toFixed(2)} (Exact)`}
                  value={tenderedAmount}
                  onChange={e => {
                    const val = e.target.value;
                    if (val.length <= 8 && !/[eE\-]/.test(val)) {
                      setTenderedAmount(val);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '-' || e.key === '+') {
                      e.preventDefault();
                    }
                  }}
                  className={`w-full h-11 pl-8 pr-4 bg-slate-50 dark:bg-slate-900 border rounded-lg text-base font-bold font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none transition ${
                    isInsufficientCash
                      ? 'border-rose-400 dark:border-rose-500/80 focus:border-rose-500 text-rose-800 dark:text-rose-200'
                      : 'border-slate-200 dark:border-slate-800 focus:border-emerald-500'
                  }`}
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[20, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmount(amt.toString())}
                    className="h-9 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-lg transition"
                  >
                    ${amt}
                  </button>
                ))}
                <button
                  onClick={() => setTenderedAmount(cartGrandTotal.toFixed(2))}
                  className="h-9 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/60 rounded-lg transition"
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Bottom Action: Full-width Primary Checkout Button with Emerald Fill */}
          <button
            onClick={handleCheckoutSubmit}
            disabled={cart.length === 0 || isInsufficientCash}
            className={`w-full h-14 py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-between mt-auto transition shadow-sm ${
              cart.length > 0 && !isInsufficientCash
                ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white cursor-pointer shadow-emerald-600/20'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700/50'
            }`}
          >
            <span className="tracking-wide">
              {isInsufficientCash
                ? `Insufficient Tender ($${parsedTender.toFixed(2)} / $${cartGrandTotal.toFixed(2)})`
                : 'Complete Checkout'}
            </span>
            <div className="flex items-center gap-2">
              {cart.length > 0 && (
                <span className="font-mono text-emerald-100 dark:text-emerald-200 font-semibold text-xs">
                  ${cartGrandTotal.toFixed(2)}
                </span>
              )}
              <kbd className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${
                cart.length > 0
                  ? 'bg-emerald-700 dark:bg-emerald-700/80 text-white border border-emerald-500/50'
                  : 'bg-slate-300 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-600/40'
              }`}>
                F12
              </kbd>
            </div>
          </button>
        </div>
      </div>

      {/* 4. MODALS & PREVIEWS */}
      {completedInvoice && (
        <ThermalReceipt
          invoice={completedInvoice}
          store={{
            name: isPharmacy ? 'St. Jude Memorial Hospital Pharmacy' : 'Metro Supermarket Flagship',
            taxIdentifier: isPharmacy ? 'TX-MED-44102' : 'TX-RET-99201',
            address: isPharmacy ? '500 Medical Center Blvd, Chicago, IL' : '100 Broadway, New York, NY',
            phone: isPharmacy ? '+1-555-0244' : '+1-555-0199',
            isPharmacy
          }}
          format={isPharmacy ? '58mm' : '80mm'}
          onClose={() => setCompletedInvoice(null)}
        />
      )}

      {showZReportModal && activeDrawer && (
        <ZReportModal
          drawer={activeDrawer}
          tenantId={tenantId}
          onClose={() => setShowZReportModal(false)}
          onZReportGenerated={(zReport) => {
            setShowZReportModal(false);
            showNotification(`Z-Report ${zReport.reportCode} generated. Variance: $${zReport.cashVariance}`, 'success');
          }}
        />
      )}

      {showConcurrencyModal && (
        <ConcurrencyTestModal
          tenantId={tenantId}
          onClose={() => setShowConcurrencyModal(false)}
        />
      )}

      {showSimulatorModal && (
        <ScannerSimulatorModal
          onScanBarcode={handleBarcodeScanned}
          onClose={() => setShowSimulatorModal(false)}
        />
      )}

      {showCameraModal && (
        <CameraScannerModal
          onScanBarcode={handleBarcodeScanned}
          onClose={() => setShowCameraModal(false)}
        />
      )}

      {showShortcutsHelp && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px', padding: '24px' }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Keyboard Shortcuts</h3>
              <button
                onClick={() => setShowShortcutsHelp(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-base"
              >
                ✕
              </button>
            </div>
            <table className="w-full text-xs border-collapse">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[
                  ['F1', 'Shortcut Reference'],
                  ['F2', 'Focus Product Search'],
                  ['F3', 'Camera Barcode Scanner'],
                  ['F4', 'Toggle Prescription Drawer'],
                  ['F9', 'Cash Drawer / Z-Report'],
                  ['F12', 'Complete Checkout Transaction'],
                  ['⌘K / Ctrl+K', 'Barcode Scanner Simulator'],
                  ['Esc', 'Clear Cart or Dismiss Dialog']
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="py-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">{key}</td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-300">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
