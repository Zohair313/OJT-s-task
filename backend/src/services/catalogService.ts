import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../db/database.js';
import { Product, Batch, InventoryStock, CreateProductDTO, InboundStockDTO, BatchWithStock } from '../types/index.js';

export class CatalogService {
  /**
   * Get products with optional search and tenant filtering
   */
  public async getProducts(tenantId: string, search?: string, limit: number = 100, offset: number = 0, includeInactive: boolean = false): Promise<{ products: Product[]; total: number }> {
    const all = Array.from(dbStore.products.values()).filter(p => 
      (tenantId === 'all' || p.tenantId === tenantId) && (includeInactive ? true : p.isActive)
    );

    let filtered = all;
    if (search && search.trim().length > 0) {
      const q = search.toLowerCase().trim();
      filtered = all.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.genericName && p.genericName.toLowerCase().includes(q))
      );
    }

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    // Enrich with batches, total stock, and category name
    const enriched = paginated.map(p => {
      const batches = this.getProductBatches(p.id);
      const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);
      const cat = p.categoryId ? dbStore.categories.get(p.categoryId) : undefined;
      return {
        ...p,
        categoryName: cat?.name || 'General',
        totalStock,
        batches
      };
    });

    return { products: enriched, total };
  }

  /**
   * High-speed Barcode/SKU Scanner Lookup (< 25ms)
   */
  public async lookupByBarcodeOrSku(tenantId: string, code: string): Promise<Product | null> {
    const cleanCode = code.trim();
    let product = Array.from(dbStore.products.values()).find(
      p => p.tenantId === tenantId && (p.barcode === cleanCode || p.sku.toLowerCase() === cleanCode.toLowerCase())
    );

    // Enterprise fallback: if not in current branch/tenant, check all branches
    if (!product) {
      product = Array.from(dbStore.products.values()).find(
        p => (p.barcode === cleanCode || p.sku.toLowerCase() === cleanCode.toLowerCase())
      );
    }

    if (!product) return null;

    const batches = this.getProductBatches(product.id);
    const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);

    return {
      ...product,
      totalStock,
      batches
    };
  }

  /**
   * Create Product with Duplicate Barcode Guard
   */
  public async createProduct(tenantId: string, dto: CreateProductDTO): Promise<Product> {
    // 1. Guard: Check for duplicate barcode in this tenant
    const existingBarcode = Array.from(dbStore.products.values()).find(
      p => p.tenantId === tenantId && p.barcode === dto.barcode
    );
    if (existingBarcode) {
      throw {
        status: 409,
        code: 'DUPLICATE_BARCODE',
        message: `Barcode '${dto.barcode}' already exists for product '${existingBarcode.name}' (SKU: ${existingBarcode.sku})`
      };
    }

    // 2. Guard: Check for duplicate SKU
    const existingSku = Array.from(dbStore.products.values()).find(
      p => p.tenantId === tenantId && p.sku.toLowerCase() === dto.sku.toLowerCase()
    );
    if (existingSku) {
      throw {
        status: 409,
        code: 'DUPLICATE_SKU',
        message: `SKU '${dto.sku}' already exists for product '${existingSku.name}'`
      };
    }

    const newProd: Product = {
      id: uuidv4(),
      tenantId,
      sku: dto.sku.trim(),
      barcode: dto.barcode.trim(),
      name: dto.name.trim(),
      genericName: dto.genericName?.trim(),
      categoryId: dto.categoryId,
      brand: dto.brand?.trim(),
      unitOfMeasure: dto.unitOfMeasure || 'PCS',
      defaultTaxRate: dto.defaultTaxRate !== undefined ? Number(dto.defaultTaxRate) : 5.00,
      reorderPoint: dto.reorderPoint !== undefined ? Number(dto.reorderPoint) : 10,
      isPrescriptionRequired: !!dto.isPrescriptionRequired,
      isActive: true,
      createdAt: new Date().toISOString()
    };

    dbStore.products.set(newProd.id, newProd);

    // If initialPrice / initialStock provided, create initial active batch
    const initialPrice = (dto as any).initialPrice !== undefined ? Number((dto as any).initialPrice) : 10.00;
    const initialStock = (dto as any).initialStock !== undefined ? Number((dto as any).initialStock) : 25;
    if (initialStock > 0) {
      const batchId = uuidv4();
      const expDate = new Date();
      expDate.setFullYear(expDate.getFullYear() + 1);
      const batch: Batch = {
        id: batchId,
        tenantId,
        productId: newProd.id,
        batchNumber: `LOT-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(100 + Math.random() * 900)}`,
        expiryDate: expDate.toISOString().slice(0, 10),
        costPrice: Number((initialPrice * 0.7).toFixed(2)),
        sellingPrice: initialPrice,
        mrp: initialPrice,
        isQuarantined: false,
        createdAt: new Date().toISOString()
      };
      const stock: InventoryStock = {
        id: uuidv4(),
        tenantId,
        batchId,
        quantity: initialStock,
        reservedQuantity: 0,
        shelfLocation: 'Shelf 1-A',
        updatedAt: new Date().toISOString()
      };
      dbStore.batches.set(batchId, batch);
      dbStore.stocks.set(batchId, stock);
    }

    const batches = this.getProductBatches(newProd.id);
    const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);
    return {
      ...newProd,
      totalStock,
      batches
    };
  }

  /**
   * Update existing product details and optionally batch selling prices
   */
  public async updateProduct(
    tenantId: string,
    id: string,
    dto: Partial<CreateProductDTO> & { isActive?: boolean; sellingPrice?: number }
  ): Promise<Product> {
    const product = dbStore.products.get(id);
    if (!product) {
      throw { status: 404, message: `Product ${id} not found` };
    }

    // Guard: Check for duplicate barcode if barcode is changed
    if (dto.barcode && dto.barcode !== product.barcode) {
      const existingBarcode = Array.from(dbStore.products.values()).find(
        p => p.tenantId === product.tenantId && p.id !== id && p.barcode === dto.barcode
      );
      if (existingBarcode) {
        throw {
          status: 409,
          code: 'DUPLICATE_BARCODE',
          message: `Barcode '${dto.barcode}' is already in use by '${existingBarcode.name}' (SKU: ${existingBarcode.sku})`
        };
      }
      product.barcode = dto.barcode;
    }

    // Guard: Check for duplicate SKU if SKU is changed
    if (dto.sku && dto.sku.toLowerCase() !== product.sku.toLowerCase()) {
      const existingSku = Array.from(dbStore.products.values()).find(
        p => p.tenantId === product.tenantId && p.id !== id && p.sku.toLowerCase() === dto.sku!.toLowerCase()
      );
      if (existingSku) {
        throw {
          status: 409,
          code: 'DUPLICATE_SKU',
          message: `SKU '${dto.sku}' is already in use by '${existingSku.name}'`
        };
      }
      product.sku = dto.sku;
    }

    if (dto.name !== undefined && dto.name.trim()) product.name = dto.name.trim();
    if (dto.genericName !== undefined) product.genericName = dto.genericName.trim();
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    if (dto.brand !== undefined) product.brand = dto.brand.trim();
    if (dto.unitOfMeasure !== undefined) product.unitOfMeasure = dto.unitOfMeasure;
    if (dto.defaultTaxRate !== undefined) product.defaultTaxRate = Number(dto.defaultTaxRate);
    if (dto.reorderPoint !== undefined) product.reorderPoint = Number(dto.reorderPoint);
    if (dto.isPrescriptionRequired !== undefined) product.isPrescriptionRequired = Boolean(dto.isPrescriptionRequired);
    if (dto.isActive !== undefined) product.isActive = Boolean(dto.isActive);

    // If sellingPrice is provided, update all active batches for this product
    if (dto.sellingPrice !== undefined && !isNaN(Number(dto.sellingPrice))) {
      const newPrice = Number(Number(dto.sellingPrice).toFixed(2));
      for (const batch of dbStore.batches.values()) {
        if (batch.productId === product.id) {
          batch.sellingPrice = newPrice;
        }
      }
    }

    dbStore.products.set(product.id, product);

    // Return enriched product
    const batches = this.getProductBatches(product.id);
    const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);
    const cat = product.categoryId ? dbStore.categories.get(product.categoryId) : undefined;
    return {
      ...product,
      categoryName: cat?.name || 'General',
      totalStock,
      batches
    };
  }

  /**
   * Soft-delete or toggle active status of product
   */
  public async deleteProduct(tenantId: string, id: string): Promise<{ success: boolean; message: string }> {
    const product = dbStore.products.get(id);
    if (!product) {
      throw { status: 404, message: `Product ${id} not found` };
    }
    product.isActive = false;
    dbStore.products.set(id, product);
    return { success: true, message: `Product '${product.name}' deactivated successfully.` };
  }

  /**
   * Inbound Stock Intake (Purchase Inward)
   */
  public async receiveInwardStock(tenantId: string, dto: InboundStockDTO): Promise<{ batch: Batch; stock: InventoryStock }> {
    const product = dbStore.products.get(dto.productId);
    if (!product || product.tenantId !== tenantId) {
      throw { status: 404, message: 'Product not found in this tenant' };
    }

    // Check duplicate batch for this product
    const existingBatch = Array.from(dbStore.batches.values()).find(
      b => b.productId === dto.productId && b.batchNumber === dto.batchNumber
    );
    if (existingBatch) {
      throw { status: 409, message: `Batch '${dto.batchNumber}' already exists for this product.` };
    }

    const batchId = uuidv4();
    const batch: Batch = {
      id: batchId,
      tenantId,
      productId: dto.productId,
      supplierId: dto.supplierId,
      batchNumber: dto.batchNumber,
      manufacturingDate: dto.manufacturingDate,
      expiryDate: dto.expiryDate,
      costPrice: dto.costPrice,
      sellingPrice: dto.sellingPrice,
      mrp: dto.mrp,
      isQuarantined: false,
      createdAt: new Date().toISOString()
    };

    const stock: InventoryStock = {
      id: uuidv4(),
      tenantId,
      batchId,
      quantity: dto.quantity,
      reservedQuantity: 0,
      shelfLocation: dto.shelfLocation || 'Main Storage',
      updatedAt: new Date().toISOString()
    };

    dbStore.batches.set(batchId, batch);
    dbStore.stocks.set(batchId, stock);

    // Record stock movement audit
    dbStore.stockMovements.push({
      id: uuidv4(),
      tenantId,
      batchId,
      movementType: 'PURCHASE_INWARD',
      quantityChanged: dto.quantity,
      quantityAfter: dto.quantity,
      referenceNote: `Purchase Inward from Supplier Ref: ${dto.supplierInvoiceRef || 'N/A'}`,
      createdAt: new Date().toISOString()
    });

    return { batch, stock };
  }

  /**
   * Helper: Get batches with current physical stock
   */
  public getProductBatches(productId: string): BatchWithStock[] {
    const now = new Date();
    const batches = Array.from(dbStore.batches.values()).filter(b => b.productId === productId);

    return batches.map(b => {
      const stock = dbStore.stocks.get(b.id);
      const qty = stock ? stock.quantity : 0;
      const exp = new Date(b.expiryDate);
      const diffTime = exp.getTime() - now.getTime();
      const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        ...b,
        quantity: qty,
        shelfLocation: stock?.shelfLocation,
        isExpired: daysToExpiry <= 0,
        isNearExpiry: daysToExpiry > 0 && daysToExpiry <= 30,
        daysToExpiry
      };
    }).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }
}

export const catalogService = new CatalogService();
