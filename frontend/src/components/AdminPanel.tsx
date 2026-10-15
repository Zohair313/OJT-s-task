import React, { useState, useEffect } from 'react';
import { BarcodeSvg } from './BarcodeSvg';

interface Product {
  id: string;
  tenantId: string;
  sku: string;
  barcode: string;
  name: string;
  genericName?: string;
  brand?: string;
  categoryId?: string;
  categoryName?: string;
  unitOfMeasure: string;
  defaultTaxRate: number;
  reorderPoint: number;
  isPrescriptionRequired: boolean;
  isActive: boolean;
  totalStock?: number;
  batches?: any[];
  createdAt: string;
}

interface Category {
  id: string;
  tenantId: string;
  name: string;
  code: string;
}

interface AdminPanelProps {
  tenantId: string;
  onTenantChange: (tenantId: string) => void;
  onBackToPos: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  tenantId,
  onTenantChange,
  onBackToPos
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'IN_STOCK'>('ALL');
  
  // Modals
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isDbHelpOpen, setIsDbHelpOpen] = useState<boolean>(false);
  const [dbHealthStatus, setDbHealthStatus] = useState<string>('Checking database mode...');
  
  // Edit Form State (includes live Physical Stock adjustment)
  const [editForm, setEditForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    genericName: '',
    brand: '',
    categoryId: '',
    unitOfMeasure: 'PCS',
    defaultTaxRate: 5.0,
    sellingPrice: 0.0,
    stock: 0,
    reorderPoint: 10,
    isPrescriptionRequired: false,
    isActive: true
  });
  
  // Add Form State
  const [addForm, setAddForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    genericName: '',
    brand: '',
    categoryId: '',
    unitOfMeasure: 'PCS',
    defaultTaxRate: 5.0,
    initialPrice: 15.0,
    initialStock: 50,
    reorderPoint: 10,
    isPrescriptionRequired: false
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Check Database Engine Health
  const checkDbHealth = async () => {
    try {
      const res = await fetch('/api/v1/health');
      if (res.ok) {
        const data = await res.json();
        setDbHealthStatus(data.database || 'Online');
      }
    } catch {
      setDbHealthStatus('In-Memory ACID Engine (Active)');
    }
  };

  // Load Categories & Products
  const loadData = async () => {
    setLoading(true);
    try {
      const [catRes, prodRes] = await Promise.all([
        fetch('/api/v1/categories'),
        fetch(`/api/v1/products?tenantId=${tenantId}&limit=300&includeInactive=true`)
      ]);

      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData);
      }

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProducts(prodData.products || []);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
      showToast('Error connecting to backend services', 'error');
    } finally {
      setLoading(false);
      checkDbHealth();
    }
  };

  useEffect(() => {
    loadData();
  }, [tenantId]);

  // Open Edit Modal with selected product
  const handleOpenEdit = (p: Product) => {
    setFormError(null);
    setEditingProduct(p);
    
    const activePrice = p.batches && p.batches.length > 0 
      ? p.batches[0].sellingPrice 
      : 10.0;

    setEditForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      genericName: p.genericName || '',
      brand: p.brand || '',
      categoryId: p.categoryId || (categories.length > 0 ? categories[0].id : ''),
      unitOfMeasure: p.unitOfMeasure || 'PCS',
      defaultTaxRate: p.defaultTaxRate,
      sellingPrice: activePrice,
      stock: p.totalStock ?? 0,
      reorderPoint: p.reorderPoint || 10,
      isPrescriptionRequired: !!p.isPrescriptionRequired,
      isActive: p.isActive
    });
  };

  // Submit Product Update (including live Stock Adjustment)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    if (!editForm.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    if (!editForm.sku.trim()) {
      setFormError('SKU identifier is required.');
      return;
    }
    if (!editForm.barcode.trim()) {
      setFormError('Barcode is required.');
      return;
    }
    if (editForm.sellingPrice <= 0) {
      setFormError('Selling price must be greater than $0.00.');
      return;
    }
    if (editForm.stock < 0) {
      setFormError('Stock cannot be negative.');
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch(`/api/v1/products/${editingProduct.id}?tenantId=${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || 'Failed to update product');
        setSaving(false);
        return;
      }

      showToast(`Product '${data.name}' and stock updated!`, 'success');
      setEditingProduct(null);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Network error while updating product');
    } finally {
      setSaving(false);
    }
  };

  // Submit Add Product
  const handleSaveAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    if (!addForm.sku.trim()) {
      setFormError('SKU identifier is required.');
      return;
    }
    if (!addForm.barcode.trim()) {
      setFormError('Barcode is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch(`/api/v1/products?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addForm,
          categoryId: addForm.categoryId || (categories.length > 0 ? categories[0].id : undefined)
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || 'Failed to create product');
        setSaving(false);
        return;
      }

      showToast(`New product '${data.name}' created with ${addForm.initialStock} units in stock!`, 'success');
      setIsAddModalOpen(false);
      setAddForm({
        name: '',
        sku: '',
        barcode: '',
        genericName: '',
        brand: '',
        categoryId: '',
        unitOfMeasure: 'PCS',
        defaultTaxRate: 5.0,
        initialPrice: 15.0,
        initialStock: 50,
        reorderPoint: 10,
        isPrescriptionRequired: false
      });
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Network error while creating product');
    } finally {
      setSaving(false);
    }
  };

  // Toggle Product Active / Inactive
  const handleToggleActive = async (p: Product) => {
    try {
      const res = await fetch(`/api/v1/products/${p.id}?tenantId=${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !p.isActive })
      });

      if (res.ok) {
        showToast(`Product '${p.name}' ${!p.isActive ? 'activated' : 'deactivated'}.`, 'success');
        loadData();
      } else {
        showToast('Failed to update status', 'error');
      }
    } catch (err) {
      showToast('Error toggling status', 'error');
    }
  };

  // Filter products by search, category, and stock
  const filteredProducts = products.filter(p => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.name.toLowerCase().includes(q);
      const matchSku = p.sku.toLowerCase().includes(q);
      const matchBarcode = p.barcode.toLowerCase().includes(q);
      const matchBrand = p.brand ? p.brand.toLowerCase().includes(q) : false;
      const matchGeneric = p.genericName ? p.genericName.toLowerCase().includes(q) : false;
      if (!matchName && !matchSku && !matchBarcode && !matchBrand && !matchGeneric) {
        return false;
      }
    }

    if (selectedCategory !== 'ALL' && p.categoryId !== selectedCategory) {
      return false;
    }

    const stock = p.totalStock ?? 0;
    const rop = p.reorderPoint ?? 10;
    if (stockFilter === 'LOW_STOCK' && (stock > rop || stock === 0)) return false;
    if (stockFilter === 'OUT_OF_STOCK' && stock > 0) return false;
    if (stockFilter === 'IN_STOCK' && stock <= 0) return false;

    return true;
  });

  const totalCount = products.length;
  const lowStockCount = products.filter(p => (p.totalStock ?? 0) <= (p.reorderPoint ?? 10) && (p.totalStock ?? 0) > 0).length;
  const outOfStockCount = products.filter(p => (p.totalStock ?? 0) === 0).length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      
      {/* Toast Alert */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 9999,
          background: toast.type === 'success' ? 'var(--emerald-600)' : 'var(--rose-500)',
          color: '#FFF',
          padding: '10px 18px',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          fontWeight: 600,
          animation: 'slideIn 200ms ease-out'
        }}>
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span>{toast.text}</span>
        </div>
      )}

      {/* Top Navigation Header */}
      <header style={{
        height: '56px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
              onClick={onBackToPos}
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
              <span>🛒</span> POS Counter
            </button>
            <button
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: 'var(--radius-xs)',
                background: 'var(--emerald-500)',
                color: '#0B0F19',
                border: '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <span>⚙️</span> Product Admin
            </button>
          </div>
          
          <div style={{ height: '20px', width: '1px', background: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '13.5px', fontWeight: 700, letterSpacing: '-0.01em' }}>
                Enterprise Product Management
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                /admin
              </span>
            </div>
          </div>
        </div>

        {/* Database mode, branch selector & actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          
          {/* Database Info Pill */}
          <button
            onClick={() => setIsDbHelpOpen(true)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Click to view Database Credentials and connection guide"
          >
            <span style={{ color: 'var(--emerald-500)' }}>🗄️</span>
            <span>DB Credentials</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>BRANCH:</span>
            <select
              value={tenantId}
              onChange={e => onTenantChange(e.target.value)}
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              <option value="t-retail-001">Metro Supermarket Flagship</option>
              <option value="t-pharma-002">City Hospital Outpatient Pharmacy</option>
              <option value="all">🌐 All Branches (Consolidated)</option>
            </select>
          </div>

          <button
            onClick={() => {
              setFormError(null);
              setIsAddModalOpen(true);
            }}
            style={{
              background: 'var(--emerald-500)',
              color: '#0B0F19',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span>+</span> Add Product
          </button>

          <button
            onClick={loadData}
            title="Refresh Catalog Data"
            style={{
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px'
            }}
          >
            🔄
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 24px', gap: '14px' }}>
        
        {/* Metric Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', flexShrink: 0 }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Total Products
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {totalCount}
              </div>
            </div>
            <span style={{ fontSize: '24px', opacity: 0.8 }}>📦</span>
          </div>

          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Low Stock (≤ ROP)
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', color: lowStockCount > 0 ? '#FBBF24' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {lowStockCount}
              </div>
            </div>
            <span style={{ fontSize: '24px', opacity: 0.8 }}>⚠️</span>
          </div>

          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Out of Stock
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', color: outOfStockCount > 0 ? '#FB7185' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {outOfStockCount}
              </div>
            </div>
            <span style={{ fontSize: '24px', opacity: 0.8 }}>🚫</span>
          </div>

          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Categories
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {categories.length}
              </div>
            </div>
            <span style={{ fontSize: '24px', opacity: 0.8 }}>🏷️</span>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0
        }}>
          {/* Live Search Input */}
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '14px' }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search product by name, SKU, barcode, generic formulation, or brand..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '36px',
                paddingRight: '12px',
                height: '36px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '12.5px'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  padding: '4px'
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Dropdown Filter */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            style={{
              height: '36px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              padding: '0 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 500
            }}
          >
            <option value="ALL">All Categories ({categories.length})</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Stock Filter Pills */}
          <div style={{ display: 'flex', background: 'var(--bg-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: '2px', gap: '2px' }}>
            {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setStockFilter(filter)}
                style={{
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-xs)',
                  background: stockFilter === filter ? 'var(--bg-surface-elevated)' : 'transparent',
                  color: stockFilter === filter ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: stockFilter === filter ? '1px solid var(--border-subtle)' : '1px solid transparent'
                }}
              >
                {filter === 'ALL' && 'All'}
                {filter === 'IN_STOCK' && 'In Stock'}
                {filter === 'LOW_STOCK' && 'Low Stock'}
                {filter === 'OUT_OF_STOCK' && 'Depleted'}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        <div style={{
          flex: 1,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
              <span>⏳</span> Loading product catalog...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <span style={{ fontSize: '32px' }}>🔍</span>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>No products match your search or filter</div>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setStockFilter('ALL');
                }}
                style={{
                  marginTop: '8px',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px'
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>Product Details</th>
                    <th style={{ width: '18%' }}>SKU & Barcode</th>
                    <th style={{ width: '12%' }}>Category</th>
                    <th style={{ width: '10%', textAlign: 'right' }}>Selling Price</th>
                    <th style={{ width: '8%', textAlign: 'center' }}>Tax %</th>
                    <th style={{ width: '10%', textAlign: 'center' }}>Stock Level</th>
                    <th style={{ width: '6%', textAlign: 'center' }}>Status</th>
                    <th style={{ width: '8%', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const stock = p.totalStock ?? 0;
                    const rop = p.reorderPoint ?? 10;
                    const isLow = stock <= rop && stock > 0;
                    const isOut = stock === 0;

                    const displayPrice = p.batches && p.batches.length > 0 
                      ? p.batches[0].sellingPrice 
                      : 0.0;

                    return (
                      <tr key={p.id}>
                        {/* Name & Generic */}
                        <td>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                              {p.name}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                              {p.genericName && (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  {p.genericName}
                                </span>
                              )}
                              {p.brand && (
                                <span style={{ fontSize: '10px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-secondary)' }}>
                                  {p.brand}
                                </span>
                              )}
                              {p.isPrescriptionRequired && (
                                <span style={{ fontSize: '9.5px', background: 'var(--rose-bg)', border: '1px solid var(--rose-border)', color: '#FB7185', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>
                                  Rx ONLY
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* SKU & Barcode */}
                        <td>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            <div style={{ color: 'var(--text-secondary)' }}>SKU: {p.sku}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                              <span>BAR: {p.barcode}</span>
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td>
                          <span style={{
                            fontSize: '11px',
                            background: 'var(--bg-surface-elevated)',
                            color: 'var(--text-secondary)',
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid var(--border-subtle)'
                          }}>
                            {p.categoryName || 'General'}
                          </span>
                        </td>

                        {/* Selling Price */}
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13.5px', color: 'var(--emerald-500)' }}>
                          ${displayPrice.toFixed(2)}
                        </td>

                        {/* Tax Rate */}
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {p.defaultTaxRate}%
                        </td>

                        {/* Stock Level */}
                        <td style={{ textAlign: 'center' }}>
                          <span className={`pill ${isOut ? 'pill-rose' : isLow ? 'pill-amber' : 'pill-emerald'}`} style={{ fontSize: '11px', padding: '3px 8px' }}>
                            {stock} {p.unitOfMeasure}
                          </span>
                          {isLow && (
                            <div style={{ fontSize: '9.5px', color: '#FBBF24', marginTop: '2px' }}>
                              Below ROP ({rop})
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-xs)',
                            background: p.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.2)',
                            color: p.isActive ? 'var(--emerald-500)' : 'var(--text-muted)',
                            border: p.isActive ? '1px solid var(--emerald-border)' : '1px solid var(--border-subtle)'
                          }}>
                            {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <button
                              onClick={() => handleOpenEdit(p)}
                              title="Edit Details, Stock & Price"
                              style={{
                                background: 'var(--bg-surface-elevated)',
                                border: '1px solid var(--border-default)',
                                color: 'var(--text-primary)',
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '12px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--emerald-500)'}
                              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
                            >
                              <span>✏️</span> Edit
                            </button>
                            
                            <button
                              onClick={() => handleToggleActive(p)}
                              title={p.isActive ? 'Deactivate Product' : 'Activate Product'}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--border-subtle)',
                                color: p.isActive ? 'var(--rose-500)' : 'var(--emerald-500)',
                                padding: '4px 6px',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '11px'
                              }}
                            >
                              {p.isActive ? '⏹️' : '▶️'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer Bar */}
          <div style={{
            height: '40px',
            background: 'var(--bg-surface-elevated)',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            flexShrink: 0
          }}>
            <div>
              Showing {filteredProducts.length} of {totalCount} total catalog items
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Database Engine: <b style={{ color: 'var(--emerald-500)' }}>{dbHealthStatus}</b></span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EDIT PRODUCT MODAL (WITH DIRECT STOCK ADJUSTMENT) */}
      {/* ========================================================================= */}
      {editingProduct && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="modal-content" style={{ maxWidth: '640px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Edit Product Catalog & Stock
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{editingProduct.id.slice(0, 13)}...</span> | Branch: {editingProduct.tenantId}
                </div>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '18px', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div style={{
                background: 'var(--rose-bg)',
                border: '1px solid var(--rose-border)',
                color: '#FB7185',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                
                {/* Product Name */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    PRODUCT NAME *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontWeight: 600
                    }}
                  />
                </div>

                {/* SKU */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    SKU IDENTIFIER *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.sku}
                    onChange={e => setEditForm({ ...editForm, sku: e.target.value.toUpperCase() })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    BARCODE (UPC / EAN) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.barcode}
                    onChange={e => setEditForm({ ...editForm, barcode: e.target.value.trim() })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                {/* Live SVG Barcode Preview */}
                <div style={{
                  gridColumn: 'span 2',
                  background: '#FFF',
                  padding: '8px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #CCC'
                }}>
                  <BarcodeSvg value={editForm.barcode || '000000000000'} width={220} height={36} />
                  <span style={{ color: '#555', fontSize: '10px', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                    Visual Barcode Preview: {editForm.barcode}
                  </span>
                </div>

                {/* Selling Price */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--emerald-500)', marginBottom: '5px' }}>
                    SELLING PRICE ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="10000"
                    required
                    value={editForm.sellingPrice}
                    onChange={e => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--emerald-border)',
                      color: 'var(--emerald-500)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '14px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                    ⚡ Updates POS checkout selling price instantly.
                  </span>
                </div>

                {/* Physical Stock Adjustment (Directly editable, no hardcoding) */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    PHYSICAL INVENTORY STOCK (UNITS) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    required
                    value={editForm.stock}
                    onChange={e => setEditForm({ ...editForm, stock: parseInt(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '14px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                    ⚡ Directly adjust on-hand stock (audited in movement log).
                  </span>
                </div>

                {/* Tax Rate */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    TAX RATE (%) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    required
                    value={editForm.defaultTaxRate}
                    onChange={e => setEditForm({ ...editForm, defaultTaxRate: parseFloat(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                {/* Reorder Point */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    REORDER POINT (ROP)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={editForm.reorderPoint}
                    onChange={e => setEditForm({ ...editForm, reorderPoint: parseInt(e.target.value) || 10 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                {/* Generic Name */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    GENERIC / FORMULATION
                  </label>
                  <input
                    type="text"
                    value={editForm.genericName}
                    placeholder="e.g. Paracetamol 500mg"
                    onChange={e => setEditForm({ ...editForm, genericName: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  />
                </div>

                {/* Brand */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    BRAND / MANUFACTURER
                  </label>
                  <input
                    type="text"
                    value={editForm.brand}
                    placeholder="e.g. GSK, Metro Quality"
                    onChange={e => setEditForm({ ...editForm, brand: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  />
                </div>

                {/* Category */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    CATEGORY
                  </label>
                  <select
                    value={editForm.categoryId}
                    onChange={e => setEditForm({ ...editForm, categoryId: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Unit of measure */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    UNIT OF MEASURE
                  </label>
                  <select
                    value={editForm.unitOfMeasure}
                    onChange={e => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  >
                    {['PCS', 'PACK', 'BOTTLE', 'BOX', 'VIAL', 'STRIP'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                {/* Toggles */}
                <div style={{
                  gridColumn: 'span 2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.isPrescriptionRequired}
                      onChange={e => setEditForm({ ...editForm, isPrescriptionRequired: e.target.checked })}
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.isActive}
                      onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })}
                    />
                    <span>Active in POS Catalog</span>
                  </label>
                </div>

              </div>

              {/* Form Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: 'var(--emerald-500)',
                    color: '#0B0F19',
                    padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {saving ? 'Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD PRODUCT MODAL */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="modal-content" style={{ maxWidth: '640px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Add New Product to Catalog
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Register product item with automatic initial batch inventory
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '18px', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div style={{
                background: 'var(--rose-bg)',
                border: '1px solid var(--rose-border)',
                color: '#FB7185',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAdd}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    PRODUCT NAME *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Organic Almond Milk 1L"
                    value={addForm.name}
                    onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontWeight: 600
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    SKU IDENTIFIER *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. RET-MILK-01"
                    value={addForm.sku}
                    onChange={e => setAddForm({ ...addForm, sku: e.target.value.toUpperCase() })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      BARCODE *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const randomBarcode = '890' + Math.floor(100000000 + Math.random() * 900000000);
                        setAddForm({ ...addForm, barcode: randomBarcode });
                      }}
                      style={{ background: 'transparent', color: 'var(--emerald-500)', fontSize: '10.5px', fontWeight: 600 }}
                    >
                      🎲 Generate
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 890100000099"
                    value={addForm.barcode}
                    onChange={e => setAddForm({ ...addForm, barcode: e.target.value.trim() })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--emerald-500)', marginBottom: '5px' }}>
                    INITIAL SELLING PRICE ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="10000"
                    required
                    value={addForm.initialPrice}
                    onChange={e => setAddForm({ ...addForm, initialPrice: parseFloat(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--emerald-border)',
                      color: 'var(--emerald-500)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    INITIAL INVENTORY STOCK (UNITS)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    required
                    value={addForm.initialStock}
                    onChange={e => setAddForm({ ...addForm, initialStock: parseInt(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    CATEGORY
                  </label>
                  <select
                    value={addForm.categoryId}
                    onChange={e => setAddForm({ ...addForm, categoryId: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    TAX RATE (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={addForm.defaultTaxRate}
                    onChange={e => setAddForm({ ...addForm, defaultTaxRate: parseFloat(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div style={{
                  gridColumn: 'span 2',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={addForm.isPrescriptionRequired}
                      onChange={e => setAddForm({ ...addForm, isPrescriptionRequired: e.target.checked })}
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>
                </div>

              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: 'var(--emerald-500)',
                    color: '#0B0F19',
                    padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: 700
                  }}
                >
                  {saving ? 'Creating...' : '+ Create Product'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DATABASE CONFIGURATION HELP MODAL */}
      {/* ========================================================================= */}
      {isDbHelpOpen && (
        <div className="modal-overlay" style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="modal-content" style={{ maxWidth: '560px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🗄️</span>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  PostgreSQL Database Credentials
                </h3>
              </div>
              <button
                onClick={() => setIsDbHelpOpen(false)}
                style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <p style={{ marginBottom: '12px' }}>
                Aap database credentials <code style={{ color: 'var(--emerald-500)', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>backend/.env</code> file me add kar sakte hain:
              </p>

              <div style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: '#FFF',
                marginBottom: '14px',
                overflowX: 'auto'
              }}>
                <div style={{ color: 'var(--text-muted)' }}># backend/.env</div>
                <div>DATABASE_URL=postgresql://postgres:password@localhost:5432/pos_inventory_db</div>
                <div>PORT=5000</div>
                <div>NODE_ENV=development</div>
              </div>

              <div style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                fontSize: '12px'
              }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  ⚡ High-Availability In-Memory ACID Engine:
                </div>
                <div>
                  Agar native PostgreSQL offline ya band ho, toh system bina kisi rukawat ke In-Memory ACID Engine with Pessimistic Row Locking par run karta hai (100% thread safe, 20-thread concurrency pass).
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setIsDbHelpOpen(false)}
                style={{
                  background: 'var(--emerald-500)',
                  color: '#0B0F19',
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 700,
                  fontSize: '12.5px'
                }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
