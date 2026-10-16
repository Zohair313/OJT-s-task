import React, { useState, useEffect } from 'react';
import { BarcodeSvg } from './BarcodeSvg';
import {
  Package,
  AlertTriangle,
  Ban,
  Tag,
  Search,
  Plus,
  RefreshCw,
  Edit2,
  Power,
  Trash2,
  Database,
  Building2,
  ShoppingCart,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';

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
  
  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Modals
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isDbHelpOpen, setIsDbHelpOpen] = useState<boolean>(false);
  const [dbHealthStatus, setDbHealthStatus] = useState<string>('Checking database mode...');
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  
  // Edit Form State
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
    setCurrentPage(1);
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

  // Submit Product Update
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

  // Permanently Delete Product
  const confirmDeleteProduct = async (p: Product) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/products/${p.id}?tenantId=${tenantId}&hard=true`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Product '${p.name}' deleted successfully from catalog!`, 'success');
        setProductToDelete(null);
        if (editingProduct?.id === p.id) {
          setEditingProduct(null);
        }
        loadData();
      } else {
        showToast(data.message || 'Failed to delete product', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Network error while deleting product', 'error');
    } finally {
      setDeleting(false);
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

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-5 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold border animate-in fade-in slide-in-from-top-3 ${
          toast.type === 'success'
            ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
            : 'bg-rose-950/90 border-rose-800 text-rose-200'
        }`}>
          <span>{toast.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{toast.text}</span>
        </div>
      )}

      {/* 1. TOP NAVBAR */}
      <header className="h-16 border-b border-slate-800 bg-slate-900 px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-sm">
              <Building2 className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-slate-100">PulsePOS</span>
          </div>

          {/* Navigation Switcher */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 gap-1">
            <button
              onClick={onBackToPos}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200 transition"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-slate-400" />
              <span>POS Counter</span>
            </button>
            <button
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-slate-800 text-white shadow-sm transition"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Product Admin</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Page Title */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-200">Catalog Management</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[11px]">/admin</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Database Info */}
          <button
            onClick={() => setIsDbHelpOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-800 bg-slate-950 hover:bg-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition"
            title="Database Connection & Credentials"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>DB Credentials</span>
          </button>

          {/* Branch Selector */}
          <div className="relative flex items-center">
            <select
              value={tenantId}
              onChange={e => onTenantChange(e.target.value)}
              className="appearance-none bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 pr-8 text-xs font-medium text-slate-200 hover:border-slate-700 cursor-pointer focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="t-retail-001">Metro Supermarket Flagship</option>
              <option value="t-pharma-002">City Hospital Outpatient Pharmacy</option>
              <option value="all">🌐 All Branches (Consolidated)</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Add Product Button */}
          <button
            onClick={() => {
              setFormError(null);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>

          {/* Refresh Data */}
          <button
            onClick={loadData}
            title="Refresh Catalog Data"
            className="p-2 border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">
        
        {/* KPI Metric Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Total Products
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
                {totalCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Active SKU catalog</div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400">
              <Package className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Low Stock (≤ ROP)
              </div>
              <div className={`text-2xl font-bold font-mono mt-1 ${lowStockCount > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
                {lowStockCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Needs reorder replenishment</div>
            </div>
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${
              lowStockCount > 0 
                ? 'bg-amber-950/40 border-amber-900/60 text-amber-400' 
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Out of Stock
              </div>
              <div className={`text-2xl font-bold font-mono mt-1 ${outOfStockCount > 0 ? 'text-rose-400' : 'text-slate-100'}`}>
                {outOfStockCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Zero inventory units remaining</div>
            </div>
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${
              outOfStockCount > 0 
                ? 'bg-rose-950/40 border-rose-900/60 text-rose-400' 
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <Ban className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Categories
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
                {categories.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Active merchandise classes</div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-blue-400">
              <Tag className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Filter & Live Search Toolbar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-sm">
          {/* Live Search Input */}
          <div className="relative flex-1 min-w-[320px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search product by name, SKU, barcode, generic formulation, or brand..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-10 pl-10 pr-9 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none transition shadow-sm"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs p-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Dropdown Filter */}
          <div className="relative flex items-center">
            <select
              value={selectedCategory}
              onChange={e => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="appearance-none h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 pr-8 text-xs font-medium text-slate-200 hover:border-slate-700 cursor-pointer focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="ALL">All Categories ({categories.length})</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Stock Filter Pills */}
          <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-1 gap-1">
            {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => {
                  setStockFilter(filter);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                  stockFilter === filter
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {filter === 'ALL' && 'All'}
                {filter === 'IN_STOCK' && 'In Stock'}
                {filter === 'LOW_STOCK' && 'Low Stock'}
                {filter === 'OUT_OF_STOCK' && 'Depleted'}
              </button>
            ))}
          </div>
        </div>

        {/* 3. FULL-WIDTH ENTERPRISE DATA TABLE */}
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
              <span className="text-xs font-medium">Loading enterprise product catalog...</span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center mb-3 text-slate-500">
                <Search className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-slate-200 mb-1">No products match your search or filters</div>
              <p className="text-xs text-slate-400 max-w-sm mb-4">
                Try searching with a different SKU, barcode, generic name, or clear your active filters.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setStockFilter('ALL');
                  setCurrentPage(1);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="py-3.5 px-6" style={{ width: '30%' }}>Product Information</th>
                    <th className="py-3.5 px-5" style={{ width: '18%' }}>SKU & Barcode</th>
                    <th className="py-3.5 px-5" style={{ width: '13%' }}>Category</th>
                    <th className="py-3.5 px-5 text-right" style={{ width: '11%' }}>Unit Price</th>
                    <th className="py-3.5 px-4 text-center" style={{ width: '6%' }}>Tax %</th>
                    <th className="py-3.5 px-5 text-center" style={{ width: '11%' }}>Stock Level</th>
                    <th className="py-3.5 px-4 text-center" style={{ width: '6%' }}>Status</th>
                    <th className="py-3.5 px-5 text-center" style={{ width: '9%' }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {paginatedProducts.map(p => {
                    const stock = p.totalStock ?? 0;
                    const rop = p.reorderPoint ?? 10;
                    const isLow = stock <= rop && stock > 0;
                    const isOut = stock === 0;

                    const displayPrice = p.batches && p.batches.length > 0 
                      ? p.batches[0].sellingPrice 
                      : 0.0;

                    return (
                      <tr key={p.id} className="hover:bg-slate-850/60 transition group">
                        {/* 1. Product Details */}
                        <td className="py-4 px-6">
                          <div className="font-semibold text-slate-100 text-sm tracking-tight group-hover:text-white transition">
                            {p.name}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-1.5">
                            {p.genericName && (
                              <span className="text-xs text-slate-400 italic">
                                {p.genericName}
                              </span>
                            )}
                            {p.brand && (
                              <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-medium">
                                {p.brand}
                              </span>
                            )}
                            {p.isPrescriptionRequired && (
                              <span className="text-[10px] bg-rose-950/60 border border-rose-900/60 text-rose-400 px-2 py-0.5 rounded font-bold tracking-wider">
                                Rx ONLY
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2. SKU & Barcode */}
                        <td className="py-4 px-5">
                          <div className="font-mono text-xs text-slate-200 font-medium">
                            <span className="text-slate-500 mr-1.5">SKU:</span>
                            <span>{p.sku}</span>
                          </div>
                          <div className="font-mono text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                            <span className="text-slate-500">BAR:</span>
                            <span>{p.barcode}</span>
                          </div>
                        </td>

                        {/* 3. Category */}
                        <td className="py-4 px-5">
                          <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800/80 border border-slate-700/80 text-slate-300">
                            {p.categoryName || 'General'}
                          </span>
                        </td>

                        {/* 4. Selling Price */}
                        <td className="py-4 px-5 text-right font-mono text-sm font-bold text-emerald-400">
                          ${displayPrice.toFixed(2)}
                        </td>

                        {/* 5. Tax Rate */}
                        <td className="py-4 px-4 text-center font-mono text-xs text-slate-400">
                          {p.defaultTaxRate}%
                        </td>

                        {/* 6. Stock Level */}
                        <td className="py-4 px-5 text-center">
                          <span className={`inline-flex px-3 py-1 rounded-md text-xs font-mono font-semibold border ${
                            isOut
                              ? 'bg-rose-950/50 text-rose-400 border-rose-900/60'
                              : isLow
                              ? 'bg-amber-950/50 text-amber-400 border-amber-900/60'
                              : 'bg-emerald-950/50 text-emerald-400 border-emerald-900/60'
                          }`}>
                            {stock} {p.unitOfMeasure}
                          </span>
                          {isLow && (
                            <div className="text-[10px] text-amber-400 font-medium mt-1">
                              Low (ROP {rop})
                            </div>
                          )}
                          {isOut && (
                            <div className="text-[10px] text-rose-400 font-medium mt-1">
                              Out of Stock
                            </div>
                          )}
                        </td>

                        {/* 7. Status */}
                        <td className="py-4 px-4 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider border ${
                            p.isActive
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>

                        {/* 8. Actions */}
                        <td className="py-4 px-5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(p)}
                              title="Edit Details, Stock & Price"
                              className="h-8 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 hover:border-emerald-500/50 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Edit</span>
                            </button>
                            
                            <button
                              onClick={() => handleToggleActive(p)}
                              title={p.isActive ? 'Deactivate Product' : 'Activate Product'}
                              className={`h-8 w-8 rounded-lg border flex items-center justify-center transition shadow-sm ${
                                p.isActive
                                  ? 'border-slate-800 bg-slate-900 text-slate-400 hover:text-amber-400 hover:border-amber-900/50'
                                  : 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setProductToDelete(p)}
                              title="Permanently Delete Product"
                              className="h-8 w-8 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-900/60 hover:bg-rose-950/30 flex items-center justify-center transition shadow-sm"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

          {/* Table Footer with Pagination Controls */}
          <div className="h-14 bg-slate-950 border-t border-slate-800 px-6 flex items-center justify-between text-xs text-slate-400 shrink-0">
            <div className="flex items-center gap-3">
              <span>
                Showing <b className="text-slate-200">{filteredProducts.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</b> to <b className="text-slate-200">{Math.min(currentPage * pageSize, filteredProducts.length)}</b> of <b className="text-slate-200">{filteredProducts.length}</b> products
              </span>
              <div className="h-4 w-px bg-slate-800" />
              <div className="flex items-center gap-1.5">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Pagination Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 px-3 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-mono text-slate-300">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-8 px-3 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EDIT PRODUCT MODAL */}
      {/* ========================================================================= */}
      {editingProduct && (
        <div className="modal-overlay">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Edit Product Catalog & Physical Stock
                </h3>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  ID: {editingProduct.id.slice(0, 16)}... • Branch: {editingProduct.tenantId}
                </div>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-900/60 text-rose-300 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                {/* Product Name */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-sm text-slate-100 font-semibold focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    SKU Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.sku}
                    onChange={e => setEditForm({ ...editForm, sku: e.target.value.toUpperCase() })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Barcode (UPC / EAN) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.barcode}
                    onChange={e => setEditForm({ ...editForm, barcode: e.target.value.trim() })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Live SVG Barcode Preview */}
                <div className="col-span-2 bg-white p-3 rounded-lg flex flex-col items-center justify-center border border-slate-300">
                  <BarcodeSvg value={editForm.barcode || '000000000000'} width={240} height={38} />
                  <span className="text-[10px] text-slate-600 font-mono mt-1">
                    Visual Barcode: {editForm.barcode}
                  </span>
                </div>

                {/* Selling Price */}
                <div>
                  <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Selling Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="10000"
                    required
                    value={editForm.sellingPrice}
                    onChange={e => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-emerald-900/60 rounded-lg px-3.5 text-sm font-bold font-mono text-emerald-400 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Physical Stock Adjustment */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                    Physical Inventory Stock (Units) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    required
                    value={editForm.stock}
                    onChange={e => setEditForm({ ...editForm, stock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-sm font-bold font-mono text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Tax Rate */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Tax Rate (%) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    required
                    value={editForm.defaultTaxRate}
                    onChange={e => setEditForm({ ...editForm, defaultTaxRate: parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Reorder Point */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Reorder Point (ROP)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={editForm.reorderPoint}
                    onChange={e => setEditForm({ ...editForm, reorderPoint: parseInt(e.target.value) || 10 })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Generic Name */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Generic / Formulation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Paracetamol 500mg"
                    value={editForm.genericName}
                    onChange={e => setEditForm({ ...editForm, genericName: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Brand */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Brand / Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GSK, Metro Quality"
                    value={editForm.brand}
                    onChange={e => setEditForm({ ...editForm, brand: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={editForm.categoryId}
                    onChange={e => setEditForm({ ...editForm, categoryId: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Unit of measure */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Unit of Measure
                  </label>
                  <select
                    value={editForm.unitOfMeasure}
                    onChange={e => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  >
                    {['PCS', 'PACK', 'BOTTLE', 'BOX', 'VIAL', 'STRIP'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                {/* Toggles */}
                <div className="col-span-2 flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                    <input
                      type="checkbox"
                      checked={editForm.isPrescriptionRequired}
                      onChange={e => setEditForm({ ...editForm, isPrescriptionRequired: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700 focus:ring-0"
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                    <input
                      type="checkbox"
                      checked={editForm.isActive}
                      onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700 focus:ring-0"
                    />
                    <span>Active in POS Catalog</span>
                  </label>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex justify-between items-center pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const p = editingProduct;
                    setEditingProduct(null);
                    setProductToDelete(p);
                  }}
                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1.5 px-3 py-2 rounded-lg transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Product</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-sm"
                  >
                    {saving ? 'Saving...' : 'Save Product Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD PRODUCT MODAL */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="modal-overlay">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  Register New Product in Catalog
                </h3>
                <div className="text-xs text-slate-400 mt-1">
                  Create new SKU with automatic initial batch inventory allocation
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-900/60 text-rose-300 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Organic Almond Milk 1L"
                    value={addForm.name}
                    onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-sm text-slate-100 font-semibold focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    SKU Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. RET-MILK-01"
                    value={addForm.sku}
                    onChange={e => setAddForm({ ...addForm, sku: e.target.value.toUpperCase() })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Barcode *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const randomBarcode = '890' + Math.floor(100000000 + Math.random() * 900000000);
                        setAddForm({ ...addForm, barcode: randomBarcode });
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold"
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
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Initial Selling Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="10000"
                    required
                    value={addForm.initialPrice}
                    onChange={e => setAddForm({ ...addForm, initialPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-emerald-900/60 rounded-lg px-3.5 text-sm font-bold font-mono text-emerald-400 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                    Initial Inventory Units *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    required
                    value={addForm.initialStock}
                    onChange={e => setAddForm({ ...addForm, initialStock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-sm font-bold font-mono text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={addForm.categoryId}
                    onChange={e => setAddForm({ ...addForm, categoryId: e.target.value })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={addForm.defaultTaxRate}
                    onChange={e => setAddForm({ ...addForm, defaultTaxRate: parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-950 border border-slate-800 rounded-lg px-3.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div className="col-span-2 p-3.5 bg-slate-950 border border-slate-800 rounded-xl">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                    <input
                      type="checkbox"
                      checked={addForm.isPrescriptionRequired}
                      onChange={e => setAddForm({ ...addForm, isPrescriptionRequired: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700 focus:ring-0"
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-sm"
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
        <div className="modal-overlay">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl text-slate-100">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-900/60 flex items-center justify-center text-emerald-400">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-100">
                  PostgreSQL Database Engine
                </h3>
              </div>
              <button
                onClick={() => setIsDbHelpOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs leading-relaxed text-slate-300 space-y-3">
              <p>
                Configure your native PostgreSQL database connection in <code className="text-emerald-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono">backend/.env</code>:
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-200 overflow-x-auto space-y-1">
                <div className="text-slate-500"># backend/.env</div>
                <div className="text-emerald-400">DATABASE_URL=postgresql://postgres:password@localhost:5432/pos_inventory_db</div>
                <div>PORT=5000</div>
                <div>NODE_ENV=development</div>
              </div>

              <div className="bg-slate-950 border border-emerald-900/40 rounded-lg p-3.5 text-xs">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5 mb-1">
                  <span>⚡</span>
                  <span>In-Memory ACID Engine Status:</span>
                </div>
                <p className="text-slate-400 leading-normal">
                  Current mode: <b className="text-slate-200">{dbHealthStatus}</b>. If native PostgreSQL is offline, system automatically executes transaction safety with Pessimistic Row Locking (20-thread concurrency pass).
                </p>
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <button
                onClick={() => setIsDbHelpOpen(false)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE PRODUCT CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {productToDelete && (
        <div className="modal-overlay">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 mb-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-900/60 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Delete Product?</h3>
                <p className="text-xs text-slate-400 font-mono">SKU: {productToDelete.sku}</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 mb-6 leading-relaxed">
              Are you sure you want to permanently remove <strong className="text-white">"{productToDelete.name}"</strong> and its inventory from the catalog? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteProduct(productToDelete)}
                disabled={deleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition shadow-sm"
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
