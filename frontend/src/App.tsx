import { useState, useEffect, useRef } from 'react';
import { useScannerListener } from './hooks/useScannerListener';
import { ThermalReceipt } from './components/ThermalReceipt';
import { ZReportModal } from './components/ZReportModal';
import { ConcurrencyTestModal } from './components/ConcurrencyTestModal';
import { ScannerSimulatorModal } from './components/ScannerSimulatorModal';
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
  // Domain Tenant Context
  const [tenantId, setTenantId] = useState<string>('t-pharma-002'); // Default to Hospital Pharmacy to show FEFO & Clinical features
  const [tenants, setTenants] = useState<any[]>([]);
  const isPharmacy = tenantId === 't-pharma-002';

  // Cashier Drawer Session
  const [activeDrawer, setActiveDrawer] = useState<any | null>(null);

  // Cart State
  const [cart, setCart] = useState<CartLineItem[]>([]);
  const [lastScanLatency, setLastScanLatency] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clinical Tagging State
  const [patientMrn, setPatientMrn] = useState<string>('MRN-884920');
  const [patientName, setPatientName] = useState<string>('Jonathan Doe');
  const [doctorLicense, setDoctorLicense] = useState<string>('MD-LIC-44810');
  const [prescriptionNumber, setPrescriptionNumber] = useState<string>('RX-2026-9901');
  const [showClinicalDrawer, setShowClinicalDrawer] = useState<boolean>(true);

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
          // Auto-open drawer if none active
          fetch('/api/v1/drawers/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify({ openingFloat: 150.00, terminalId: isPharmacy ? 'PHARMA-COUNTER-01' : 'POS-COUNTER-01' })
          })
            .then(res => res.json())
            .then(d => setActiveDrawer(d));
        } else {
          setActiveDrawer(drawer);
        }
      })
      .catch(() => {});
  }, [tenantId, isPharmacy]);

  // 2. Fallback Debounced Search (250ms)
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      fetch(`/api/v1/products?q=${encodeURIComponent(searchQuery)}&limit=8&tenantId=${tenantId}`)
        .then(res => res.json())
        .then(data => {
          setSearchResults(data.products || []);
        })
        .catch(() => {});
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, tenantId]);

  // 3. Scan-to-Cart Ingestion Logic (< 150ms Ingestion Latency)
  const handleBarcodeScanned = async (barcode: string) => {
    const start = performance.now();
    try {
      const res = await fetch(`/api/v1/scanner/lookup/${encodeURIComponent(barcode)}?tenantId=${tenantId}`);
      const data = await res.json();

      if (!res.ok || !data.product) {
        playScannerBeep(false);
        setStatusMessage({ text: `Barcode '${barcode}' not found!`, isError: true });
        return;
      }

      const product = data.product;

      // Resolve FEFO Allocation for this product
      const fefoRes = await fetch('/api/v1/fefo/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, requestedQuantity: 1 })
      });
      const fefoData = await fefoRes.json();

      if (!fefoData.allocations || fefoData.allocations.length === 0) {
        playScannerBeep(false);
        setStatusMessage({ text: `Product '${product.name}' is completely out of stock!`, isError: true });
        return;
      }

      const alloc = fefoData.allocations[0];

      // Add or increment in cart
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
      setStatusMessage({ text: `Added '${product.name}' via Scan (${latency}ms)`, isError: false });
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      playScannerBeep(false);
      setStatusMessage({ text: err.message, isError: true });
    }
  };

  // Attach Hardware Scanner Listener
  useScannerListener({
    onScan: handleBarcodeScanned
  });

  // Keyboard Shortcuts (F1, F2, F4, F9, F12, Ctrl+K)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setShowClinicalDrawer(prev => !prev);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setShowZReportModal(true);
      } else if (e.key === 'F12') {
        e.preventDefault();
        handleCheckoutSubmit();
      } else if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setShowSimulatorModal(true);
      } else if (e.key === 'Escape') {
        setShowSimulatorModal(false);
        setShowConcurrencyModal(false);
        setShowZReportModal(false);
        setShowShortcutsHelp(false);
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

  const tenderedNumeric = parseFloat(tenderedAmount) || (paymentMethod === 'CASH' ? 0 : cartGrandTotal);
  const changeDue = Math.max(0, tenderedNumeric - cartGrandTotal);

  // Cart Line Mutators
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

  // Submit Checkout (ACID Transaction Pipeline)
  const handleCheckoutSubmit = async () => {
    if (cart.length === 0) {
      setStatusMessage({ text: 'Cart is empty. Scan an item first!', isError: true });
      return;
    }
    if (!activeDrawer) {
      setStatusMessage({ text: 'No active drawer session found.', isError: true });
      return;
    }
    if (paymentMethod === 'CASH' && tenderedNumeric < cartGrandTotal) {
      setStatusMessage({ text: `Tender insufficient! Total due is $${cartGrandTotal.toFixed(2)}`, isError: true });
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

      // Success! Clear cart, set invoice for receipt printing
      setCart([]);
      setTenderedAmount('');
      setCompletedInvoice(invoice);
      setStatusMessage({ text: `Invoice #${invoice.invoiceNumber} Committed Atomically!`, isError: false });
    } catch (err: any) {
      playScannerBeep(false);
      setStatusMessage({ text: `Checkout Aborted: ${err.message}`, isError: true });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)' }}>
      {/* 1. TOP HEADER BAR */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontWeight: 900, fontSize: '18px', color: '#F8FAFC', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: 'var(--color-secondary)' }}>⚡</span> ENTERPRISE POS
          </div>

          {/* Tenant Switcher */}
          <select
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
              setCart([]);
            }}
            style={{ fontWeight: 600, fontSize: '13px', background: '#111B2E', borderColor: 'var(--color-border)' }}
          >
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.domainType === 'HOSPITAL_PHARMACY' ? '🏥 ' : '🛒 '} {t.name}
              </option>
            ))}
          </select>

          {/* Mode Pill */}
          <span className="badge" style={{
            background: isPharmacy ? 'rgba(34, 197, 94, 0.2)' : 'rgba(3, 105, 161, 0.2)',
            color: isPharmacy ? '#4ADE80' : '#38BDF8',
            border: `1px solid ${isPharmacy ? '#22C55E' : '#0369A1'}`
          }}>
            {isPharmacy ? 'FEFO PHARMACY MODE' : 'RETAIL MART MODE'}
          </span>
        </div>

        {/* Right Info & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Scanner Pulse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#111B2E', padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
            <div className="scanner-active-dot" />
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#4ADE80', fontFamily: 'var(--font-mono)' }}>
              SCANNER READY
            </span>
          </div>

          {/* Simulator Button */}
          <button
            onClick={() => setShowSimulatorModal(true)}
            style={{ background: 'var(--color-surface-elevated)', color: '#FCD34D', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}
          >
            ⚡ Scan Simulator (Ctrl+K)
          </button>

          {/* Concurrency Test */}
          <button
            onClick={() => setShowConcurrencyModal(true)}
            style={{ background: 'rgba(3, 105, 161, 0.3)', color: '#38BDF8', border: '1px solid #0369A1', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}
          >
            🧪 Race Test (Sprint 3)
          </button>

          {/* Z-Report Shift */}
          <button
            onClick={() => setShowZReportModal(true)}
            style={{ background: '#78350F', color: '#FDE68A', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}
          >
            📊 Z-Report (F9)
          </button>

          {/* Help */}
          <button
            onClick={() => setShowShortcutsHelp(true)}
            style={{ background: 'transparent', color: '#94A3B8', padding: '6px 8px', fontSize: '14px' }}
            title="Keyboard Shortcuts (F1)"
          >
            ❓
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER: SCANNER INPUT & DEBOUNCED SEARCH */}
      <div style={{
        background: '#131D31',
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        position: 'relative'
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="🔍 Scan Barcode with scanner or type Product Name / SKU to search (F2)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 36px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13.5px',
              color: '#F8FAFC'
            }}
          />
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
            ⚡
          </span>

          {/* Debounced Search Dropdown */}
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-secondary)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 50,
              marginTop: '4px',
              maxHeight: '320px',
              overflowY: 'auto'
            }}>
              {searchResults.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => handleBarcodeScanned(prod.barcode)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{prod.name}</div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      SKU: {prod.sku} | Barcode: {prod.barcode} {prod.genericName ? `| ${prod.genericName}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-secondary)', fontSize: '13px' }}>
                      Stock: {prod.totalStock}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748B' }}>Click or Scan to Add</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Latency & Feedback Status */}
        {lastScanLatency > 0 && (
          <div className="badge" style={{ background: '#111B2E', color: '#4ADE80', border: '1px solid #166534', padding: '6px 10px' }}>
            ⚡ Scan Latency: {lastScanLatency}ms (&lt; 150ms PASS)
          </div>
        )}

        {statusMessage && (
          <div style={{
            fontSize: '12.5px',
            fontWeight: 600,
            color: statusMessage.isError ? '#F87171' : '#4ADE80',
            background: statusMessage.isError ? 'rgba(220,38,38,0.15)' : 'rgba(34,197,94,0.15)',
            padding: '6px 12px',
            borderRadius: '4px',
            border: `1px solid ${statusMessage.isError ? '#DC2626' : '#22C55E'}`
          }}>
            {statusMessage.text}
          </div>
        )}
      </div>

      {/* 3. MAIN BODY: 65% CART / 35% COMMAND DECK */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT COLUMN: LIVE CART (65%) */}
        <div style={{ flex: '1 1 65%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', overflowY: 'auto' }}>
          <div style={{
            padding: '10px 16px',
            background: '#111B2E',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontWeight: 700, fontSize: '13px', color: '#94A3B8' }}>
              CURRENT CART: <span style={{ color: '#F8FAFC' }}>{totalItemCount} UNITS ({cart.length} LINE ITEMS)</span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                style={{ background: 'transparent', color: '#F87171', fontSize: '12px', fontWeight: 600 }}
              >
                Clear Cart (Esc)
              </button>
            )}
          </div>

          {/* Cart Table */}
          {cart.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', color: '#64748B' }}>
              <span style={{ fontSize: '48px', marginBottom: '12px' }}>🛒</span>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#94A3B8' }}>Cashier Cart is Empty</h4>
              <p style={{ fontSize: '13px', marginTop: '4px', textAlign: 'center', maxWidth: '380px' }}>
                Scan an item using your physical handheld barcode scanner, press <strong>Ctrl+K</strong> to trigger the virtual scanner, or click any sample below:
              </p>
              {/* Quick sample chips */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '16px' }}>
                <button
                  onClick={() => handleBarcodeScanned('8901000000101')}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-secondary)', color: '#4ADE80', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                >
                  🏥 Scan Amoxicillin (FEFO Split)
                </button>
                <button
                  onClick={() => handleBarcodeScanned('8901000000102')}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-warning)', color: '#FBBF24', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                >
                  ⚠️ Scan Paracetamol (Near Expiry)
                </button>
                <button
                  onClick={() => handleBarcodeScanned('8901000000001')}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-accent)', color: '#38BDF8', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                >
                  🥤 Scan Retail Beverage
                </button>
              </div>
            </div>
          ) : (
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th>Batch / Expiry (FEFO)</th>
                  <th style={{ textAlign: 'center' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Tax</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'center' }}>Act</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.cartId}>
                    <td>
                      <div style={{ fontWeight: 700, color: '#F8FAFC' }}>{item.productName}</div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
                        SKU: {item.sku} | Barcode: {item.barcode}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="badge badge-fefo">{item.batchNumber}</span>
                        {item.isNearExpiry && (
                          <span className="badge badge-warning">Near Expiry ({item.daysToExpiry}d)</span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                        Exp: {item.expiryDate}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#111B2E', padding: '2px', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                        <button
                          onClick={() => updateQuantity(item.cartId, item.quantity - 1)}
                          style={{ background: 'transparent', color: '#94A3B8', width: '24px', height: '24px', fontWeight: 700 }}
                        >
                          -
                        </button>
                        <span style={{ width: '28px', textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.cartId, item.quantity + 1)}
                          style={{ background: 'transparent', color: '#4ADE80', width: '24px', height: '24px', fontWeight: 700 }}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      ${item.unitPrice.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#94A3B8', fontSize: '12px' }}>
                      {item.taxRate}%
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-secondary)', fontFamily: 'var(--font-mono)' }}>
                      ${((item.quantity * item.unitPrice) * (1 + item.taxRate / 100)).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => removeCartItem(item.cartId)}
                        style={{ background: 'transparent', color: '#EF4444', fontSize: '16px', padding: '4px 6px' }}
                        title="Remove item"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT COLUMN: COMMAND DECK & TOTALS (35%) */}
        <div style={{ flex: '1 1 35%', background: '#111B2E', display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto' }}>
          {/* Totals Box */}
          <div style={{ background: 'var(--color-surface)', padding: '16px', borderRadius: '8px', border: '1px solid var(--color-border)', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ color: '#94A3B8' }}>Subtotal:</span>
              <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>${cartSubtotal.toFixed(2)}</span>
            </div>
            {cartDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#F87171' }}>
                <span>Discounts:</span>
                <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>-${cartDiscount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
              <span style={{ color: '#94A3B8' }}>Tax / VAT:</span>
              <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>${cartTax.toFixed(2)}</span>
            </div>
            <div style={{ borderTop: '2px solid var(--color-border)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '14px', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase' }}>Grand Total:</span>
              <span style={{ fontSize: '30px', fontWeight: 900, color: '#4ADE80', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                ${cartGrandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Clinical Patient & Doctor Tagging (Pharmacy Mode) */}
          {isPharmacy && (
            <div style={{ background: 'var(--color-surface)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(34, 197, 94, 0.4)', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#4ADE80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🏥 Clinical Prescription Link (F4)
                </span>
                <button
                  onClick={() => setShowClinicalDrawer(!showClinicalDrawer)}
                  style={{ background: 'transparent', color: '#94A3B8', fontSize: '11px' }}
                >
                  {showClinicalDrawer ? 'Hide' : 'Edit'}
                </button>
              </div>

              {showClinicalDrawer ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '2px' }}>Patient MRN</label>
                    <input
                      type="text"
                      value={patientMrn}
                      onChange={e => setPatientMrn(e.target.value)}
                      style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '2px' }}>Patient Name</label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '2px' }}>Doctor License</label>
                    <input
                      type="text"
                      value={doctorLicense}
                      onChange={e => setDoctorLicense(e.target.value)}
                      style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#94A3B8', display: 'block', marginBottom: '2px' }}>Rx Number</label>
                    <input
                      type="text"
                      value={prescriptionNumber}
                      onChange={e => setPrescriptionNumber(e.target.value)}
                      style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: '#CBD5E1' }}>
                  Patient: {patientName} ({patientMrn}) | Dr: {doctorLicense}
                </div>
              )}
            </div>
          )}

          {/* Payment Method Selector */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
              Payment Method
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {(['CASH', 'CREDIT_CARD', 'UPI_QR'] as const).map(method => (
                <button
                  key={method}
                  onClick={() => setPaymentMethod(method)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 700,
                    fontSize: '11.5px',
                    background: paymentMethod === method ? 'var(--color-accent)' : 'var(--color-surface)',
                    color: paymentMethod === method ? '#FFF' : '#94A3B8',
                    border: `1px solid ${paymentMethod === method ? '#38BDF8' : 'var(--color-border)'}`
                  }}
                >
                  {method === 'CASH' ? '💵 Cash' : method === 'CREDIT_CARD' ? '💳 Card' : '📱 UPI / QR'}
                </button>
              ))}
            </div>
          </div>

          {/* Cash Tender & Quick Buttons */}
          {paymentMethod === 'CASH' && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
                  Cash Tendered ($)
                </label>
                {changeDue > 0 && (
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#4ADE80' }}>
                    Change: ${changeDue.toFixed(2)}
                  </span>
                )}
              </div>
              <input
                type="number"
                placeholder={`e.g. ${Math.ceil(cartGrandTotal)}`}
                value={tenderedAmount}
                onChange={e => setTenderedAmount(e.target.value)}
                style={{ width: '100%', fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: '8px' }}
              />

              {/* Quick Bill Chips */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[20, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmount(amt.toString())}
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: '#CBD5E1', padding: '6px 0', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}
                  >
                    ${amt}
                  </button>
                ))}
                <button
                  onClick={() => setTenderedAmount(cartGrandTotal.toFixed(2))}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-secondary)', color: '#4ADE80', padding: '6px 0', borderRadius: '4px', fontSize: '11.5px', fontWeight: 700 }}
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Complete Checkout Button */}
          <button
            onClick={handleCheckoutSubmit}
            disabled={cart.length === 0}
            style={{
              marginTop: 'auto',
              width: '100%',
              background: cart.length > 0 ? 'var(--color-primary)' : '#334155',
              color: '#FFFFFF',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 900,
              fontSize: '15px',
              letterSpacing: '0.04em',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              boxShadow: cart.length > 0 ? '0 4px 14px rgba(21, 128, 61, 0.4)' : 'none'
            }}
          >
            <span>COMPLETE CHECKOUT (F12)</span>
            <span style={{ fontSize: '11px', fontWeight: 500, opacity: 0.85 }}>
              🖨️ Atomic ACID Commit & Thermal Print
            </span>
          </button>
        </div>
      </div>

      {/* 4. MODALS & OVERLAYS */}

      {/* A. Thermal Receipt Modal */}
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

      {/* B. Z-Report Cash Reconciliation Modal */}
      {showZReportModal && activeDrawer && (
        <ZReportModal
          drawer={activeDrawer}
          tenantId={tenantId}
          onClose={() => setShowZReportModal(false)}
          onZReportGenerated={(zReport) => {
            setShowZReportModal(false);
            setStatusMessage({ text: `Z-Report ${zReport.reportCode} Generated! Variance: $${zReport.cashVariance}`, isError: false });
          }}
        />
      )}

      {/* C. Concurrency Race Load Test Modal */}
      {showConcurrencyModal && (
        <ConcurrencyTestModal
          tenantId={tenantId}
          onClose={() => setShowConcurrencyModal(false)}
        />
      )}

      {/* D. Hardware Scanner Simulator Modal */}
      {showSimulatorModal && (
        <ScannerSimulatorModal
          onScanBarcode={handleBarcodeScanned}
          onClose={() => setShowSimulatorModal(false)}
        />
      )}

      {/* E. Keyboard Shortcuts Help Modal */}
      {showShortcutsHelp && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800 }}>⌨️ Cashier Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcutsHelp(false)} style={{ background: 'transparent', color: '#94A3B8', fontSize: '18px' }}>✕</button>
            </div>
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['F1', 'Toggle Keyboard Shortcut Help'],
                  ['F2', 'Focus Search / Barcode Input'],
                  ['F4', 'Toggle Clinical Prescription Tagging'],
                  ['F9', 'Open Cash Drop & Z-Report Modal'],
                  ['F12', 'Complete Checkout & Commit Transaction'],
                  ['Ctrl + K', 'Open Barcode Scanner Simulator'],
                  ['Esc', 'Clear Cart or Close Active Modal']
                ].map(([key, desc]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-secondary)' }}>{key}</td>
                    <td style={{ padding: '8px 0', color: '#CBD5E1' }}>{desc}</td>
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
