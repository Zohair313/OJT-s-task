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
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  
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

  // Open Add Product Modal with Auto-generated SKU, Barcode, and Defaults
  const handleOpenAdd = () => {
    setFormError(null);
    const prefix = tenantId === 't-retail-001' ? 'RET' : 'MED';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const autoSku = `SKU-${prefix}-${randomNum}`;
    const autoBarcode = '890' + Math.floor(100000000 + Math.random() * 900000000);

    setAddForm({
      name: '',
      sku: autoSku,
      barcode: autoBarcode,
      genericName: '',
      brand: '',
      categoryId: categories.length > 0 ? categories[0].id : '',
      unitOfMeasure: tenantId === 't-retail-001' ? 'PCS' : 'BOX',
      defaultTaxRate: 5.0,
      initialPrice: 15.0,
      initialStock: 50,
      reorderPoint: 10,
      isPrescriptionRequired: tenantId !== 't-retail-001'
    });
    setIsAddModalOpen(true);
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
    if (Number(editForm.sellingPrice) <= 0) {
      setFormError('Selling price must be greater than $0.00.');
      return;
    }
    if (Number(editForm.stock) < 0) {
      setFormError('Stock cannot be negative.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const targetTenant = editingProduct.tenantId || (tenantId === 'all' ? 't-pharma-002' : tenantId);

    try {
      const res = await fetch(`/api/v1/products/${editingProduct.id}?tenantId=${targetTenant}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          sellingPrice: Number(editForm.sellingPrice),
          stock: Number(editForm.stock),
          defaultTaxRate: Number(editForm.defaultTaxRate),
          reorderPoint: Number(editForm.reorderPoint)
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || 'Failed to update product');
        showToast(data.message || 'Failed to update product', 'error');
        setSaving(false);
        return;
      }

      showToast(`Product '${data.name}' and stock updated!`, 'success');
      setEditingProduct(null);

      // Optimistically update product in local table right away
      setProducts(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p));
      setHighlightedProductId(data.id);
      setTimeout(() => setHighlightedProductId(null), 5000);

      // Background sync
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Network error while updating product');
      showToast(err.message || 'Network error while updating product', 'error');
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

    const targetTenant = (!tenantId || tenantId === 'all') ? 't-pharma-002' : tenantId;

    try {
      const res = await fetch(`/api/v1/products?tenantId=${targetTenant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addForm,
          initialPrice: Number(addForm.initialPrice),
          initialStock: Number(addForm.initialStock),
          defaultTaxRate: Number(addForm.defaultTaxRate),
          reorderPoint: Number(addForm.reorderPoint),
          categoryId: addForm.categoryId || (categories.length > 0 ? categories[0].id : undefined)
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || 'Failed to create product');
        showToast(data.message || 'Failed to create product', 'error');
        setSaving(false);
        return;
      }

      showToast(`New product '${data.name}' created with ${addForm.initialStock} units in stock!`, 'success');
      setIsAddModalOpen(false);

      // Prepend to top of products list, jump to Page 1 and clear search so user sees it right away!
      setProducts(prev => [data, ...prev.filter(p => p.id !== data.id)]);
      setCurrentPage(1);
      setSearchQuery('');
      setHighlightedProductId(data.id);
      setTimeout(() => setHighlightedProductId(null), 5000);

      // Background sync
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Network error while creating product');
      showToast(err.message || 'Network error while creating product', 'error');
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
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 select-none">
      
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-5 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold border animate-in fade-in slide-in-from-top-3 ${
          toast.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <span>{toast.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{toast.text}</span>
        </div>
      )}

      {/* 1. TOP NAVBAR */}
      <header className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0 z-20 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-xs">
              <Building2 className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-slate-900">PulsePOS</span>
          </div>

          {/* Navigation Switcher */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1">
            <button
              onClick={onBackToPos}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 transition"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-slate-500" />
              <span>POS Counter</span>
            </button>
            <button
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-xs border border-slate-200/80 transition"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Product Admin</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200" />

          {/* Page Title */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-800">Catalog Management</span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[11px] border border-slate-200">/admin</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Database Info */}
          <button
            onClick={() => setIsDbHelpOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded-lg transition shadow-xs"
            title="Database Connection & Credentials"
          >
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            <span>DB Credentials</span>
          </button>

          {/* Branch Selector */}
          <div className="relative flex items-center">
            <select
              value={tenantId}
              onChange={e => onTenantChange(e.target.value)}
              className="appearance-none bg-white border border-slate-200 rounded-lg px-3.5 py-2 pr-8 text-xs font-medium text-slate-700 hover:border-slate-300 cursor-pointer focus:outline-none focus:border-emerald-500 transition shadow-xs"
            >
              <option value="t-retail-001">Metro Supermarket Flagship</option>
              <option value="t-pharma-002">City Hospital Outpatient Pharmacy</option>
              <option value="all">🌐 All Branches (Consolidated)</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Add Product Button */}
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>

          {/* Refresh Data */}
          <button
            onClick={loadData}
            title="Refresh Catalog Data"
            className="p-2 border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-900 rounded-lg transition shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col overflow-hidden p-6 gap-5 w-full max-w-[2200px] mx-auto">
        
        {/* KPI Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-xs">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Total Products
              </div>
              <div className="text-3xl font-extrabold font-mono text-slate-900 mt-1.5">
                {totalCount}
              </div>
              <div className="text-xs text-slate-400 mt-1">Active SKU catalog</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-xs">
              <Package className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-xs">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Low Stock (≤ ROP)
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-1.5 ${lowStockCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                {lowStockCount}
              </div>
              <div className="text-xs text-slate-400 mt-1">Needs reorder replenishment</div>
            </div>
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shadow-xs ${
              lowStockCount > 0 
                ? 'bg-amber-50 border-amber-200 text-amber-600' 
                : 'bg-slate-100 border-slate-200 text-slate-400'
            }`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-xs">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Out of Stock
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-1.5 ${outOfStockCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {outOfStockCount}
              </div>
              <div className="text-xs text-slate-400 mt-1">Zero inventory units remaining</div>
            </div>
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shadow-xs ${
              outOfStockCount > 0 
                ? 'bg-rose-50 border-rose-200 text-rose-600' 
                : 'bg-slate-100 border-slate-200 text-slate-400'
            }`}>
              <Ban className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-xs">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Categories
              </div>
              <div className="text-3xl font-extrabold font-mono text-slate-900 mt-1.5">
                {categories.length}
              </div>
              <div className="text-xs text-slate-400 mt-1">Active merchandise classes</div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
              <Tag className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Filter & Live Search Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-xs">
          {/* Live Search Input */}
          <div className="relative flex-1 min-w-[340px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search product by name, SKU, barcode, generic formulation, or brand..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-11 pl-11 pr-10 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-emerald-500 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none transition shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Category Dropdown Filter */}
            <div className="relative flex items-center">
              <select
                value={selectedCategory}
                onChange={e => {
                  setSelectedCategory(e.target.value);
                  setCurrentPage(1);
                }}
                className="appearance-none h-11 bg-white border border-slate-200 rounded-lg px-4 pr-9 text-xs font-medium text-slate-700 hover:border-slate-300 cursor-pointer focus:outline-none focus:border-emerald-500 transition shadow-xs"
              >
                <option value="ALL">All Categories ({categories.length})</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 pointer-events-none" />
            </div>

            {/* Stock Filter Pills */}
            <div className="flex bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1">
              {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => {
                    setStockFilter(filter);
                    setCurrentPage(1);
                  }}
                  className={`h-9 px-3.5 text-xs font-semibold rounded-md transition ${
                    stockFilter === filter
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
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
        </div>

        {/* 3. FULL-WIDTH ENTERPRISE DATA TABLE */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-xs">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-xs font-medium">Loading enterprise product catalog...</span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3 text-slate-400">
                <Search className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-slate-900 mb-1">No products match your search or filters</div>
              <p className="text-xs text-slate-500 max-w-sm mb-4">
                Try searching with a different SKU, barcode, generic name, or clear your active filters.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setStockFilter('ALL');
                  setCurrentPage(1);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[1200px] text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="py-3.5 px-6 w-[28%]">Product Information</th>
                    <th className="py-3.5 px-6 w-[18%]">SKU & Barcode</th>
                    <th className="py-3.5 px-5 w-[14%]">Category</th>
                    <th className="py-3.5 px-5 text-right w-[11%]">Unit Price</th>
                    <th className="py-3.5 px-4 text-center w-[7%]">Tax %</th>
                    <th className="py-3.5 px-5 text-center w-[11%]">Stock Level</th>
                    <th className="py-3.5 px-4 text-center w-[7%]">Status</th>
                    <th className="py-3.5 px-6 text-center w-[12%]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedProducts.map(p => {
                    const stock = p.totalStock ?? 0;
                    const rop = p.reorderPoint ?? 10;
                    const isLow = stock <= rop && stock > 0;
                    const isOut = stock === 0;

                    const displayPrice = p.batches && p.batches.length > 0 
                      ? p.batches[0].sellingPrice 
                      : 0.0;

                    return (
                      <tr 
                        key={p.id} 
                        className={`transition group ${
                          p.id === highlightedProductId 
                            ? 'bg-emerald-50/70 border-l-4 border-l-emerald-500 ring-1 ring-emerald-400/50' 
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        {/* 1. Product Details */}
                        <td className="py-4 px-6">
                          <div className="font-semibold text-slate-900 text-sm leading-snug group-hover:text-emerald-900 transition">
                            {p.name}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-1.5">
                            {p.genericName && (
                              <span className="text-xs text-slate-500 italic">
                                {p.genericName}
                              </span>
                            )}
                            {p.brand && (
                              <span className="text-[11px] bg-slate-100 border border-slate-200 text-slate-700 px-2.5 py-0.5 rounded font-medium">
                                {p.brand}
                              </span>
                            )}
                            {p.isPrescriptionRequired && (
                              <span className="text-[10px] bg-rose-50 border border-rose-200 text-rose-700 px-2 py-0.5 rounded font-bold tracking-wider">
                                Rx ONLY
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2. SKU & Barcode */}
                        <td className="py-4 px-6">
                          <div className="font-mono text-xs text-slate-700 font-semibold">
                            <span className="text-slate-400 mr-1.5">SKU:</span>
                            <span>{p.sku}</span>
                          </div>
                          <div className="font-mono text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                            <span className="text-slate-400">BAR:</span>
                            <span>{p.barcode}</span>
                          </div>
                        </td>

                        {/* 3. Category */}
                        <td className="py-4 px-5">
                          <span className="inline-flex px-3 py-1 rounded-md text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700">
                            {p.categoryName || 'General'}
                          </span>
                        </td>

                        {/* 4. Selling Price */}
                        <td className="py-4 px-5 text-right font-mono text-sm font-bold text-emerald-600">
                          ${displayPrice.toFixed(2)}
                        </td>

                        {/* 5. Tax Rate */}
                        <td className="py-4 px-4 text-center font-mono text-xs text-slate-500">
                          {p.defaultTaxRate}%
                        </td>

                        {/* 6. Stock Level */}
                        <td className="py-4 px-5 text-center">
                          <span className={`inline-flex px-3 py-1 rounded-md text-xs font-mono font-semibold border ${
                            isOut
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : isLow
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}>
                            {stock} {p.unitOfMeasure}
                          </span>
                          {isLow && (
                            <div className="text-[10px] text-amber-700 font-medium mt-1">
                              Low (ROP {rop})
                            </div>
                          )}
                          {isOut && (
                            <div className="text-[10px] text-rose-700 font-medium mt-1">
                              Out of Stock
                            </div>
                          )}
                        </td>

                        {/* 7. Status */}
                        <td className="py-4 px-4 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider border ${
                            p.isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>

                        {/* 8. Actions */}
                        <td className="py-4 px-6 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleOpenEdit(p)}
                              title="Edit Details, Stock & Price"
                              className="h-8 px-3 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-emerald-500 text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Edit</span>
                            </button>
                            
                            <button
                              onClick={() => handleToggleActive(p)}
                              title={p.isActive ? 'Deactivate Product' : 'Activate Product'}
                              className={`h-8 w-8 rounded-lg border flex items-center justify-center transition shadow-xs ${
                                p.isActive
                                  ? 'border-slate-200 bg-white text-slate-500 hover:text-amber-600 hover:border-amber-300'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setProductToDelete(p)}
                              title="Permanently Delete Product"
                              className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 flex items-center justify-center transition shadow-xs"
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
          <div className="h-14 bg-slate-50/70 border-t border-slate-200 px-6 flex items-center justify-between text-xs text-slate-600 shrink-0">
            <div className="flex items-center gap-3">
              <span>
                Showing <b className="text-slate-800">{filteredProducts.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</b> to <b className="text-slate-800">{Math.min(currentPage * pageSize, filteredProducts.length)}</b> of <b className="text-slate-800">{filteredProducts.length}</b> products
              </span>
              <div className="h-4 w-px bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none shadow-xs"
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
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition shadow-xs"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-mono text-slate-700 font-semibold">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition shadow-xs"
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
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-slate-900">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Edit Product Catalog & Physical Stock
                </h3>
                <div className="text-xs text-slate-500 mt-1 font-mono">
                  ID: {editingProduct.id.slice(0, 16)}... • Branch: {editingProduct.tenantId}
                </div>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                {/* Product Name */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-sm text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    SKU Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.sku}
                    onChange={e => setEditForm({ ...editForm, sku: e.target.value.toUpperCase() })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Barcode (UPC / EAN) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.barcode}
                    onChange={e => setEditForm({ ...editForm, barcode: e.target.value.trim() })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Live SVG Barcode Preview */}
                <div className="col-span-2 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-200">
                  <BarcodeSvg value={editForm.barcode || '000000000000'} width={240} height={38} />
                  <span className="text-[10px] text-slate-500 font-mono mt-1">
                    Visual Barcode: {editForm.barcode}
                  </span>
                </div>

                {/* Selling Price */}
                <div>
                  <label className="block text-[11px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
                    Selling Price ($) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={editForm.sellingPrice}
                    onChange={e => setEditForm({ ...editForm, sellingPrice: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-emerald-300 rounded-lg px-3.5 text-sm font-bold font-mono text-emerald-700 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Physical Stock Adjustment */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Physical Inventory Stock (Units) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    required
                    value={editForm.stock}
                    onChange={e => setEditForm({ ...editForm, stock: e.target.value === '' ? ('' as any) : parseInt(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-sm font-bold font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Tax Rate */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Tax Rate (%) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    required
                    value={editForm.defaultTaxRate}
                    onChange={e => setEditForm({ ...editForm, defaultTaxRate: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Reorder Point */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Reorder Point (ROP)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={editForm.reorderPoint}
                    onChange={e => setEditForm({ ...editForm, reorderPoint: e.target.value === '' ? ('' as any) : parseInt(e.target.value) || 10 })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Generic Name */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Generic / Formulation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Paracetamol 500mg"
                    value={editForm.genericName}
                    onChange={e => setEditForm({ ...editForm, genericName: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Brand */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Brand / Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GSK, Metro Quality"
                    value={editForm.brand}
                    onChange={e => setEditForm({ ...editForm, brand: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={editForm.categoryId}
                    onChange={e => setEditForm({ ...editForm, categoryId: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  >
                    <option value="">General (Default Category)</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Unit of measure */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Unit of Measure
                  </label>
                  <select
                    value={editForm.unitOfMeasure}
                    onChange={e => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  >
                    {['PCS', 'PACK', 'BOTTLE', 'BOX', 'VIAL', 'STRIP'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                {/* Toggles */}
                <div className="col-span-2 flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.isPrescriptionRequired}
                      onChange={e => setEditForm({ ...editForm, isPrescriptionRequired: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-0"
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.isActive}
                      onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-0"
                    />
                    <span>Active in POS Catalog</span>
                  </label>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    const p = editingProduct;
                    setEditingProduct(null);
                    setProductToDelete(p);
                  }}
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold flex items-center gap-1.5 px-3 py-2 rounded-lg transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Product</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-xs"
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
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-slate-900">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Register New Product in Catalog
                </h3>
                <div className="text-xs text-slate-500 mt-1">
                  Create new SKU with automatic initial batch inventory allocation
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Organic Almond Milk 1L"
                    value={addForm.name}
                    onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-sm text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    SKU Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. RET-MILK-01"
                    value={addForm.sku}
                    onChange={e => setAddForm({ ...addForm, sku: e.target.value.toUpperCase() })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      Barcode *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const randomBarcode = '890' + Math.floor(100000000 + Math.random() * 900000000);
                        setAddForm({ ...addForm, barcode: randomBarcode });
                      }}
                      className="text-[10px] text-emerald-600 hover:text-emerald-700 font-bold"
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
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                {/* Live SVG Barcode Preview */}
                <div className="col-span-2 bg-slate-50 p-3 rounded-lg flex flex-col items-center justify-center border border-slate-200">
                  <BarcodeSvg value={addForm.barcode || '890000000000'} width={240} height={38} />
                  <span className="text-[10px] text-slate-500 font-mono mt-1">
                    Visual Barcode: {addForm.barcode || 'Auto-Generated'}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
                    Initial Selling Price ($) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={addForm.initialPrice}
                    onChange={e => setAddForm({ ...addForm, initialPrice: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-emerald-300 rounded-lg px-3.5 text-sm font-bold font-mono text-emerald-700 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Initial Inventory Units *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    required
                    value={addForm.initialStock}
                    onChange={e => setAddForm({ ...addForm, initialStock: e.target.value === '' ? ('' as any) : parseInt(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-sm font-bold font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={addForm.categoryId}
                    onChange={e => setAddForm({ ...addForm, categoryId: e.target.value })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  >
                    <option value="">General (Default Category)</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    value={addForm.defaultTaxRate}
                    onChange={e => setAddForm({ ...addForm, defaultTaxRate: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0 })}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3.5 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-emerald-500 transition shadow-xs"
                  />
                </div>

                <div className="col-span-2 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={addForm.isPrescriptionRequired}
                      onChange={e => setAddForm({ ...addForm, isPrescriptionRequired: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-0"
                    />
                    <span>Prescription Required (Rx Only)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-xs"
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
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-lg w-full shadow-2xl text-slate-900">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  PostgreSQL Database Engine
                </h3>
              </div>
              <button
                onClick={() => setIsDbHelpOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs leading-relaxed text-slate-600 space-y-3">
              <p>
                Configure your native PostgreSQL database connection in <code className="text-emerald-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-mono">backend/.env</code>:
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[11px] text-slate-800 overflow-x-auto space-y-1">
                <div className="text-slate-400"># backend/.env</div>
                <div className="text-emerald-700 font-semibold">DATABASE_URL=postgresql://postgres:password@localhost:5432/pos_inventory_db</div>
                <div>PORT=5000</div>
                <div>NODE_ENV=development</div>
              </div>

              <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-3.5 text-xs">
                <div className="font-bold text-emerald-800 flex items-center gap-1.5 mb-1">
                  <span>⚡</span>
                  <span>Database Engine Status:</span>
                </div>
                <p className="text-slate-600 leading-normal">
                  Current mode: <b className="text-slate-900">{dbHealthStatus}</b>. If native PostgreSQL is offline, system automatically executes transaction safety with Pessimistic Row Locking (20-thread concurrency pass).
                </p>
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <button
                onClick={() => setIsDbHelpOpen(false)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-xs"
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
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl text-slate-900">
            <div className="flex items-center gap-3 mb-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Product?</h3>
                <p className="text-xs text-slate-500 font-mono">SKU: {productToDelete.sku}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">
              Are you sure you want to permanently remove <strong className="text-slate-900">"{productToDelete.name}"</strong> and its inventory from the catalog? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteProduct(productToDelete)}
                disabled={deleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition shadow-xs"
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
