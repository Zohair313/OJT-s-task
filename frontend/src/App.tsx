import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Building2,
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
import { AdminPanel } from './components/AdminPanel';
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
    const start = performance.now();
    try {
      const res = await fetch(`/api/v1/scanner/lookup/${encodeURIComponent(barcode)}?tenantId=${tenantId}`);
      const data = await res.json();

      if (!res.ok || !data.product) {
        playScannerBeep(false);
        showNotification(`No item found for barcode '${barcode}'`, 'error');
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

      const latency = Math.round(performance.now() - start);
      setLastScanLatency(latency);
      showNotification(`Added ${product.name} (${latency}ms)`, 'success');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      playScannerBeep(false);
      showNotification(err.message, 'error');
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
  const tenderedNumeric = (!isNaN(parsedTender) && isFinite(parsedTender) && parsedTender > 0) 
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
    if (!activeDrawer) {
      showNotification('No active drawer session found.', 'error');
      return;
    }

    try {
      const payload = {
        drawerId: activeDrawer.id,
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
        throw new Error(invoice.message || 'Checkout failed');
      }

      setCart([]);
      setTenderedAmount('');
      setCompletedInvoice(invoice);
      showNotification(`Invoice #${invoice.invoiceNumber} committed successfully.`, 'success');
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
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* 1. TOP NAVBAR (Single-line clean bar, generous spacing) */}
      <header className="h-16 border-b border-slate-800 bg-slate-900 px-6 flex items-center justify-between shrink-0 z-20">
        {/* Left: Brand, Nav Switcher, Branch Selector, Subtle Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-sm">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-slate-100">PulsePOS</span>
          </div>

          {/* Navigation Tabs: POS vs Admin */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 gap-1">
            <button
              onClick={() => navigateTo('pos')}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-slate-800 text-white shadow-sm transition"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-emerald-400" />
              <span>POS Counter</span>
            </button>
            <button
              onClick={() => navigateTo('admin')}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200 transition"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Product Admin</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Clean Branch Selector */}
          <div className="relative flex items-center">
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setCart([]);
              }}
              className="appearance-none bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 pr-8 text-xs font-medium text-slate-200 hover:border-slate-700 cursor-pointer focus:outline-none focus:border-emerald-500 transition"
            >
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Subtle Status Pills */}
          <div className="flex items-center gap-2.5 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-800 bg-slate-950 text-slate-300 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Scanner Ready</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-900/40 bg-emerald-950/30 text-emerald-400 font-medium">
              <Pill className="w-3.5 h-3.5" />
              <span>{isPharmacy ? 'FEFO Pharmacy' : 'Retail Mart'}</span>
            </div>
            {lastScanLatency > 0 && (
              <span className="font-mono text-slate-500 text-xs">• {lastScanLatency}ms</span>
            )}
          </div>
        </div>

        {/* Right: Quick Action Links with Clean Ghost Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSimulatorModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Simulator</span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-950 border border-slate-700 rounded text-slate-400">⌘K</kbd>
          </button>

          <button
            onClick={() => setShowConcurrencyModal(true)}
            className="px-3 py-2 text-xs font-medium border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition"
          >
            Race Test
          </button>

          <button
            onClick={() => setShowZReportModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition"
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Z-Report (F9)</span>
          </button>

          <button
            onClick={() => setShowShortcutsHelp(true)}
            className="p-2 border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition"
            title="Shortcuts Reference (F1)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. PROMINENT WIDE SEARCH BAR */}
      <div className="px-6 py-3.5 bg-slate-950 border-b border-slate-800 flex justify-center shrink-0">
        <div className="relative w-full max-w-4xl">
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

          <input
            ref={searchInputRef}
            type="text"
            placeholder="Scan barcode with handheld reader or search product by name, SKU, generic..."
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
            className="w-full h-12 pl-12 pr-16 bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none transition shadow-sm"
          />

          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center">
            <kbd className="px-2 py-1 text-xs font-mono font-semibold bg-slate-800 border border-slate-700 rounded-md text-slate-400">
              F2
            </kbd>
          </div>

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-14 left-0 right-0 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-slate-800 max-h-72 overflow-y-auto">
              {searchResults.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => handleBarcodeScanned(prod.barcode)}
                  className="px-5 py-3 flex items-center justify-between hover:bg-slate-850 cursor-pointer transition"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {prod.name}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      SKU: {prod.sku} • Barcode: {prod.barcode} {prod.genericName ? `• ${prod.genericName}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex px-2.5 py-1 text-xs font-mono font-semibold rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-900/60">
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
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANE: CART AREA */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden border-r border-slate-800">
          {/* Cart Header */}
          <div className="h-12 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Active Cart</span>
              <span className="px-2.5 py-0.5 text-xs rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-medium">
                {totalItemCount} items ({cart.length} lines)
              </span>
            </div>

            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 font-semibold px-2.5 py-1 rounded-md hover:bg-rose-950/30 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Cart (Esc)</span>
              </button>
            )}
          </div>

          {/* Cart Content: Empty State vs Table */}
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 shadow-sm text-slate-500">
                <ShoppingCart className="w-7 h-7" />
              </div>

              <div className="text-base font-bold text-slate-200 mb-1.5">
                Cart is Empty
              </div>
              <p className="text-xs text-slate-400 text-center max-w-sm leading-relaxed mb-6">
                Scan a barcode using your handheld scanner, press <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-800 border border-slate-700 rounded text-slate-300">⌘K</kbd> to simulate, or click a sample item:
              </p>

              <div className="flex gap-2.5 flex-wrap justify-center">
                <button
                  onClick={() => handleBarcodeScanned('8901000000101')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 hover:border-emerald-500/50 hover:bg-slate-850 hover:text-white text-slate-300 transition shadow-sm"
                >
                  <Pill className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Amoxicillin 500mg (FEFO)</span>
                </button>

                <button
                  onClick={() => handleBarcodeScanned('8901000000102')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 hover:border-emerald-500/50 hover:bg-slate-850 hover:text-white text-slate-300 transition shadow-sm"
                >
                  <Pill className="w-3.5 h-3.5 text-blue-400" />
                  <span>Paracetamol 650mg</span>
                </button>

                <button
                  onClick={() => handleBarcodeScanned('8901000000001')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 hover:border-emerald-500/50 hover:bg-slate-850 hover:text-white text-slate-300 transition shadow-sm"
                >
                  <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                  <span>Retail Soda (FMCG)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-900 text-slate-400 uppercase tracking-wider font-semibold sticky top-0 border-b border-slate-800 z-10">
                  <tr>
                    <th className="py-3 px-5">Item Description</th>
                    <th className="py-3 px-5">Batch / Expiry</th>
                    <th className="py-3 px-5 text-center">Qty</th>
                    <th className="py-3 px-5 text-right">Unit Price</th>
                    <th className="py-3 px-5 text-right">Line Total</th>
                    <th className="py-3 px-5 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {cart.map((item) => (
                    <tr key={item.cartId} className="hover:bg-slate-900/50 transition">
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-100 text-sm">{item.productName}</div>
                        <div className="text-xs text-slate-400 font-mono mt-1">
                          SKU: {item.sku} • {item.barcode}
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-900/60 font-mono text-xs font-medium">
                            {item.batchNumber}
                          </span>
                          {item.isNearExpiry && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-950/60 text-amber-400 border border-amber-900/60 text-xs flex items-center gap-1 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {item.daysToExpiry}d left
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Exp: {item.expiryDate}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-center">
                        <div className="inline-flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.cartId, item.quantity - 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="min-w-8 text-center font-mono font-bold text-slate-100 text-xs">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.cartId, item.quantity + 1)}
                            className="w-6 h-6 flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 rounded-md transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-slate-300 font-medium">
                        ${item.unitPrice.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono font-bold text-slate-100">
                        ${((item.quantity * item.unitPrice) * (1 + item.taxRate / 100)).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-5 text-center">
                        <button
                          onClick={() => removeCartItem(item.cartId)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-md hover:bg-slate-800 transition"
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
                ? 'bg-rose-950/50 border-rose-900/70 text-rose-300'
                : 'bg-emerald-950/50 border-emerald-900/70 text-emerald-300'
            }`}>
              <span>{statusNotification.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{statusNotification.text}</span>
            </div>
          )}
        </div>

        {/* RIGHT PANE: CHECKOUT COMMAND DECK (Clean, Spacious, Slate Borders) */}
        <div className="w-[400px] lg:w-[440px] xl:w-[460px] bg-slate-900 flex flex-col p-5 gap-4 overflow-y-auto shrink-0 border-l border-slate-800">
          {/* Top Section: Payment Summary Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-2.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span className="font-medium">Subtotal</span>
              <span className="font-mono text-slate-200 font-semibold">${cartSubtotal.toFixed(2)}</span>
            </div>

            {cartDiscount > 0 && (
              <div className="flex justify-between text-xs text-rose-400">
                <span className="font-medium">Discounts</span>
                <span className="font-mono font-semibold">-${cartDiscount.toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between text-xs text-slate-400">
              <span className="font-medium">Tax / VAT (5%)</span>
              <span className="font-mono text-slate-200 font-semibold">${cartTax.toFixed(2)}</span>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-between items-baseline">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Grand Total</span>
              <span className="text-3xl font-extrabold font-mono text-emerald-400 tracking-tight">
                ${cartGrandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Middle Section: Collapsible Clinical Prescription Form (Hospital Pharmacy Mode) */}
          {isPharmacy && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setIsClinicalOpen(!isClinicalOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">Prescription Details</span>
                  <kbd className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-slate-800 border border-slate-700 rounded text-slate-400">
                    F4
                  </kbd>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isClinicalOpen ? 'rotate-180' : ''}`} />
              </button>

              {isClinicalOpen && (
                <div className="p-4 pt-1 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1.5">Patient MRN</label>
                    <input
                      type="text"
                      value={patientMrn}
                      onChange={e => setPatientMrn(e.target.value)}
                      className="w-full h-10 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1.5">Patient Name</label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      className="w-full h-10 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1.5">Doctor License</label>
                    <input
                      type="text"
                      value={doctorLicense}
                      onChange={e => setDoctorLicense(e.target.value)}
                      className="w-full h-10 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1.5">Rx Number</label>
                    <input
                      type="text"
                      value={prescriptionNumber}
                      onChange={e => setPrescriptionNumber(e.target.value)}
                      className="w-full h-10 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Methods: Clean Segmented Control with Lucide Icons */}
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1.5 border border-slate-800 rounded-xl">
              <button
                onClick={() => setPaymentMethod('CASH')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'CASH'
                    ? 'bg-slate-800 text-white shadow-md border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-400" />
                <span>Cash</span>
              </button>
              <button
                onClick={() => setPaymentMethod('CREDIT_CARD')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'CREDIT_CARD'
                    ? 'bg-slate-800 text-white shadow-md border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <CreditCard className="w-4 h-4 text-blue-400" />
                <span>Card</span>
              </button>
              <button
                onClick={() => setPaymentMethod('UPI_QR')}
                className={`h-11 flex items-center justify-center gap-2 text-xs font-semibold rounded-lg transition ${
                  paymentMethod === 'UPI_QR'
                    ? 'bg-slate-800 text-white shadow-md border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <QrCode className="w-4 h-4 text-amber-400" />
                <span>UPI / QR</span>
              </button>
            </div>
          </div>

          {/* Cash Tendered & Quick Bills */}
          {paymentMethod === 'CASH' && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Cash Tendered</span>
                {changeDue > 0 && isFinite(changeDue) && changeDue <= 100000 && (
                  <span className="text-emerald-400 font-mono text-xs normal-case font-bold">
                    Change: ${changeDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              <input
                type="number"
                min="0"
                max="100000"
                step="any"
                autoComplete="off"
                placeholder={`$${cartGrandTotal.toFixed(2)} (Exact)`}
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
                className="w-full h-11 bg-slate-900 border border-slate-800 rounded-lg px-3.5 py-2 text-base font-bold font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />

              <div className="grid grid-cols-4 gap-2">
                {[20, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmount(amt.toString())}
                    className="h-9 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 rounded-lg transition"
                  >
                    ${amt}
                  </button>
                ))}
                <button
                  onClick={() => setTenderedAmount(cartGrandTotal.toFixed(2))}
                  className="h-9 text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 hover:border-emerald-700 hover:bg-emerald-950/60 rounded-lg transition"
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Bottom Action: Full-width Primary Checkout Button with Emerald Fill */}
          <button
            onClick={handleCheckoutSubmit}
            disabled={cart.length === 0}
            className={`w-full h-13 py-3.5 px-5 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 mt-auto transition shadow-lg ${
              cart.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white cursor-pointer shadow-emerald-950/50'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <span className="tracking-wide">Complete Checkout</span>
            <kbd className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${
              cart.length > 0
                ? 'bg-emerald-700/80 border border-emerald-500/50 text-white'
                : 'bg-slate-700/60 border border-slate-600/40 text-slate-400'
            }`}>
              F12
            </kbd>
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

      {showShortcutsHelp && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcutsHelp(false)} style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '16px' }}>✕</button>
            </div>
            <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['F1', 'Shortcut Reference'],
                  ['F2', 'Focus Product Search'],
                  ['F4', 'Toggle Prescription Drawer'],
                  ['F9', 'Cash Drawer / Z-Report'],
                  ['F12', 'Complete Checkout Transaction'],
                  ['⌘K / Ctrl+K', 'Barcode Scanner Simulator'],
                  ['Esc', 'Clear Cart or Dismiss Dialog']
                ].map(([key, desc]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--emerald-500)' }}>{key}</td>
                    <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>{desc}</td>
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
