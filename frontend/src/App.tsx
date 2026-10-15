import { useState, useEffect, useRef } from 'react';
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      {/* 1. CLEAN TOP NAVBAR */}
      <header style={{
        height: '56px',
        padding: '0 20px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        zIndex: 20
      }}>
        {/* Left: Brand & Branch Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, #10B981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
            }}>
              <span style={{ fontSize: '15px', color: '#FFFFFF', fontWeight: 800 }}>+</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              PulsePOS
            </span>
          </div>

          {/* Navigation Pill: POS vs Admin */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px',
            gap: '2px'
          }}>
            <button
              onClick={() => navigateTo('pos')}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-surface-elevated)',
                color: '#FFF',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <span>🛒</span> POS Counter
            </button>
            <button
              onClick={() => navigateTo('admin')}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: 'var(--radius-xs)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <span>⚙️</span> Product Admin
            </button>
          </div>

          <div style={{ height: '18px', width: '1px', background: 'var(--border-default)' }} />

          {/* Clean Branch Selector */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setCart([]);
              }}
              style={{
                appearance: 'none',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 28px 5px 10px',
                fontSize: '12.5px',
                fontWeight: 500,
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: '10px', pointerEvents: 'none', fontSize: '10px', color: 'var(--text-muted)' }}>
              ▼
            </span>
          </div>

          {/* Subtle Status Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="pill pill-neutral">
              <span className="status-dot-active" />
              <span>Scanner Ready</span>
            </div>
            <div className={`pill ${isPharmacy ? 'pill-emerald' : 'pill-blue'}`}>
              <span>{isPharmacy ? 'FEFO Pharmacy' : 'Retail Mart'}</span>
            </div>
            {lastScanLatency > 0 && (
              <div className="pill pill-neutral" style={{ fontFamily: 'var(--font-mono)' }}>
                <span>{lastScanLatency}ms</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Unified Ghost Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowSimulatorModal(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
          >
            <span>⚡ Simulator</span>
            <kbd style={{ fontSize: '10px', background: 'var(--bg-app)', padding: '1px 4px', borderRadius: '3px', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>⌘K</kbd>
          </button>

          <button
            onClick={() => setShowConcurrencyModal(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 500
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
          >
            Race Test
          </button>

          <button
            onClick={() => setShowZReportModal(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 500
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
          >
            Z-Report (F9)
          </button>

          <button
            onClick={() => setShowShortcutsHelp(true)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px'
            }}
            title="Keyboard Shortcuts (F1)"
          >
            ?
          </button>
        </div>
      </header>

      {/* 2. PROMINENT MODERN SEARCH BAR */}
      <div style={{
        padding: '12px 20px',
        background: 'var(--bg-app)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '980px' }}>
          <span style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '14px',
            color: 'var(--text-muted)',
            pointerEvents: 'none'
          }}>
            🔍
          </span>

          <input
            ref={searchInputRef}
            type="text"
            placeholder="Scan barcode with hardware reader or search by product name, SKU, or generic formula..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              height: '42px',
              padding: '0 80px 0 40px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13.5px',
              color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-sm)'
            }}
          />

          <span style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <kbd style={{ fontSize: '10px', background: 'var(--bg-app)', padding: '2px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              F2
            </kbd>
          </span>

          {/* Search Results Dropdown */}
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '48px',
              left: 0,
              right: 0,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 100,
              overflow: 'hidden'
            }}>
              {searchResults.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => handleBarcodeScanned(prod.barcode)}
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'background 120ms ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                      {prod.name}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      SKU: {prod.sku} • Barcode: {prod.barcode} {prod.genericName ? `• ${prod.genericName}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="pill pill-emerald" style={{ fontFamily: 'var(--font-mono)' }}>
                      Stock: {prod.totalStock}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. MAIN WORKSPACE (2-COLUMN SPLIT) */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT PANE: CART AREA */}
        <div style={{ flex: '1 1 65%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-app)' }}>
          {/* Cart Header */}
          <div style={{
            padding: '12px 20px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Active Cart
              </span>
              <span className="pill pill-neutral">
                {totalItemCount} items ({cart.length} lines)
              </span>
            </div>

            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                style={{
                  background: 'transparent',
                  color: 'var(--rose-500)',
                  fontSize: '12px',
                  fontWeight: 500,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-xs)'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--rose-bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Clear Cart (Esc)
              </button>
            )}
          </div>

          {/* Cart Content: Empty State vs Table */}
          {cart.length === 0 ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px'
            }}>
              {/* Modern Minimal Vector Illustration */}
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
              </div>

              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Cart is Empty
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '340px', lineHeight: 1.5, marginBottom: '20px' }}>
                Scan a barcode using your handheld scanner, press <strong>⌘K</strong> to simulate a scan, or test with common items:
              </p>

              {/* Refined Minimalist Test Chips */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  onClick={() => handleBarcodeScanned('8901000000101')}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--emerald-500)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  Amoxicillin 500mg (FEFO)
                </button>

                <button
                  onClick={() => handleBarcodeScanned('8901000000102')}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--amber-500)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  Paracetamol 650mg (Near Expiry)
                </button>

                <button
                  onClick={() => handleBarcodeScanned('8901000000001')}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--blue-500)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  Retail Soda (FMCG)
                </button>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>Batch & Expiry</th>
                    <th style={{ textAlign: 'center' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Unit Price</th>
                    <th style={{ textAlign: 'right' }}>Line Total</th>
                    <th style={{ textAlign: 'center', width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr key={item.cartId}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.productName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                          SKU: {item.sku} • {item.barcode}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="pill pill-emerald" style={{ fontFamily: 'var(--font-mono)' }}>
                            {item.batchNumber}
                          </span>
                          {item.isNearExpiry && (
                            <span className="pill pill-amber">
                              Expiring in {item.daysToExpiry}d
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                          Exp: {item.expiryDate}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="stepper-pill">
                          <button
                            className="stepper-btn"
                            onClick={() => updateQuantity(item.cartId, item.quantity - 1)}
                          >
                            -
                          </button>
                          <span className="stepper-val">{item.quantity}</span>
                          <button
                            className="stepper-btn"
                            onClick={() => updateQuantity(item.cartId, item.quantity + 1)}
                            style={{ color: 'var(--emerald-500)' }}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        ${item.unitPrice.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        ${((item.quantity * item.unitPrice) * (1 + item.taxRate / 100)).toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => removeCartItem(item.cartId)}
                          style={{
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            fontSize: '14px',
                            padding: '4px'
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--rose-500)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Status Toast Notification */}
          {statusNotification && (
            <div style={{
              padding: '8px 16px',
              background: statusNotification.type === 'error' ? 'var(--rose-bg)' : 'var(--emerald-bg)',
              borderTop: `1px solid ${statusNotification.type === 'error' ? 'var(--rose-border)' : 'var(--emerald-border)'}`,
              color: statusNotification.type === 'error' ? '#FB7185' : '#34D399',
              fontSize: '12.5px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>{statusNotification.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{statusNotification.text}</span>
            </div>
          )}
        </div>

        {/* RIGHT PANE: CHECKOUT COMMAND DECK (35%) */}
        <div style={{
          flex: '1 1 35%',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          overflowY: 'auto',
          gap: '16px'
        }}>
          {/* Summary Card */}
          <div style={{
            background: 'var(--bg-app)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>${cartSubtotal.toFixed(2)}</span>
            </div>

            {cartDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--rose-500)', marginBottom: '8px' }}>
                <span>Discounts</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>-${cartDiscount.toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              <span>Tax / VAT (5%)</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>${cartTax.toFixed(2)}</span>
            </div>

            <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '12px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Total Due
              </span>
              <span style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                ${cartGrandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Clinical Prescription Link Accordion (Hospital Pharmacy Mode) */}
          {isPharmacy && (
            <div style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden'
            }}>
              <div
                onClick={() => setIsClinicalOpen(!isClinicalOpen)}
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Prescription Link
                  </span>
                  <span className="pill pill-emerald" style={{ fontSize: '10px' }}>F4</span>
                </div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', transform: isClinicalOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                  ▼
                </span>
              </div>

              {isClinicalOpen && (
                <div style={{ padding: '0 14px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Patient MRN</label>
                    <input
                      type="text"
                      value={patientMrn}
                      onChange={e => setPatientMrn(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Patient Name</label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Doctor License</label>
                    <input
                      type="text"
                      value={doctorLicense}
                      onChange={e => setDoctorLicense(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Rx Number</label>
                    <input
                      type="text"
                      value={prescriptionNumber}
                      onChange={e => setPrescriptionNumber(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Method Segmented Control */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>
              Payment Method
            </label>
            <div className="segmented-control">
              <button
                className={`segmented-control-item ${paymentMethod === 'CASH' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('CASH')}
              >
                💵 Cash
              </button>
              <button
                className={`segmented-control-item ${paymentMethod === 'CREDIT_CARD' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('CREDIT_CARD')}
              >
                💳 Card
              </button>
              <button
                className={`segmented-control-item ${paymentMethod === 'UPI_QR' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('UPI_QR')}
              >
                📱 UPI / QR
              </button>
            </div>
          </div>

          {/* Cash Tendered & Quick Bills */}
          {paymentMethod === 'CASH' && (
            <div style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>CASH TENDERED</span>
                {changeDue > 0 && isFinite(changeDue) && changeDue <= 100000 && (
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--emerald-500)', fontFamily: 'var(--font-mono)' }}>
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
                style={{
                  width: '100%',
                  fontSize: '16px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  marginBottom: '10px'
                }}
              />

              {/* Clean Quick Chips */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[20, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmount(amt.toString())}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)',
                      padding: '5px 0',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '11.5px',
                      fontWeight: 600
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
                  >
                    ${amt}
                  </button>
                ))}
                <button
                  onClick={() => setTenderedAmount(cartGrandTotal.toFixed(2))}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--emerald-border)',
                    color: 'var(--emerald-500)',
                    padding: '5px 0',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '11.5px',
                    fontWeight: 600
                  }}
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Large Primary Action Button */}
          <button
            onClick={handleCheckoutSubmit}
            disabled={cart.length === 0}
            style={{
              marginTop: 'auto',
              width: '100%',
              background: cart.length > 0 ? 'var(--emerald-600)' : 'var(--bg-surface-elevated)',
              color: cart.length > 0 ? '#FFFFFF' : 'var(--text-muted)',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              fontSize: '14px',
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: cart.length > 0 ? 'var(--shadow-glow)' : 'none',
              cursor: cart.length > 0 ? 'pointer' : 'not-allowed'
            }}
            onMouseEnter={e => {
              if (cart.length > 0) e.currentTarget.style.background = 'var(--emerald-500)';
            }}
            onMouseLeave={e => {
              if (cart.length > 0) e.currentTarget.style.background = 'var(--emerald-600)';
            }}
          >
            <span>COMPLETE CHECKOUT</span>
            <kbd style={{
              background: 'rgba(0, 0, 0, 0.25)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)'
            }}>
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
