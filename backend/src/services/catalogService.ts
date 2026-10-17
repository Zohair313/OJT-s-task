import { v4 as uuidv4 } from 'uuid';
import { dbStore, pgPool, isPgConnected } from '../db/database.js';
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

    // Sort so newly created or updated products appear at the very top of Page 1
    const sorted = [...filtered].sort((a, b) => {
      const timeA = new Date((a as any).updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date((b as any).updatedAt || b.createdAt || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.id || '').localeCompare(a.id || '');
    });

    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit);

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
    const cleanLower = cleanCode.toLowerCase();
    const strippedCode = cleanCode.replace(/^0+/, '');

    // 1. Primary: Exact match in active tenant
    let product = Array.from(dbStore.products.values()).find(
      p => p.tenantId === tenantId && (
        p.barcode === cleanCode || 
        p.sku.toLowerCase() === cleanLower ||
        p.id === cleanCode ||
        (strippedCode.length > 0 && p.barcode.replace(/^0+/, '') === strippedCode)
      )
    );

    // 2. Secondary: Cross-branch fallback
    if (!product) {
      product = Array.from(dbStore.products.values()).find(
        p => (
          p.barcode === cleanCode || 
          p.sku.toLowerCase() === cleanLower ||
          p.id === cleanCode ||
          (strippedCode.length > 0 && p.barcode.replace(/^0+/, '') === strippedCode)
        )
      );
    }

    // 3. Fallback: Search by product name / generic name if user pressed Enter on query
    if (!product) {
      product = Array.from(dbStore.products.values()).find(
        p => (tenantId === 'all' || p.tenantId === tenantId) && (
          p.name.toLowerCase().includes(cleanLower) ||
          (p.genericName && p.genericName.toLowerCase().includes(cleanLower))
        )
      );
    }

    if (!product) {
      product = Array.from(dbStore.products.values()).find(
        p => (
          p.name.toLowerCase().includes(cleanLower) ||
          (p.genericName && p.genericName.toLowerCase().includes(cleanLower))
        )
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
    const effectiveTenantId = (!tenantId || tenantId === 'all') ? 't-pharma-002' : tenantId;

    // 1. Guard: Check for duplicate barcode in this tenant
    const existingBarcode = Array.from(dbStore.products.values()).find(
      p => p.tenantId === effectiveTenantId && p.barcode === dto.barcode
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
      p => p.tenantId === effectiveTenantId && p.sku.toLowerCase() === dto.sku.toLowerCase()
    );
    if (existingSku) {
      throw {
        status: 409,
        code: 'DUPLICATE_SKU',
        message: `SKU '${dto.sku}' already exists for product '${existingSku.name}'`
      };
    }

    const nowIso = new Date().toISOString();
    const newProd: Product = {
      id: uuidv4(),
      tenantId: effectiveTenantId,
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
      createdAt: nowIso,
      updatedAt: nowIso
    };

    dbStore.products.set(newProd.id, newProd);

    const initialPrice = (dto as any).initialPrice !== undefined ? Number((dto as any).initialPrice) : 10.00;
    const initialStock = (dto as any).initialStock !== undefined ? Number((dto as any).initialStock) : 25;
    let initialBatch: Batch | null = null;
    let initialStockRec: InventoryStock | null = null;

    if (initialStock > 0) {
      const batchId = uuidv4();
      const expDate = new Date();
      expDate.setFullYear(expDate.getFullYear() + 1);
      initialBatch = {
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
      initialStockRec = {
        id: uuidv4(),
        tenantId,
        batchId,
        quantity: initialStock,
        reservedQuantity: 0,
        shelfLocation: 'Shelf 1-A',
        updatedAt: new Date().toISOString()
      };
      dbStore.batches.set(batchId, initialBatch);
      dbStore.stocks.set(batchId, initialStockRec);
    }

    // Persist directly to PostgreSQL
    if (isPgConnected) {
      try {
        await pgPool.query(`
          INSERT INTO products (
            id, tenant_id, category_id, sku, barcode, name, generic_name, brand,
            unit_of_measure, default_tax_rate, reorder_point, is_prescription_required, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [
          newProd.id, newProd.tenantId, newProd.categoryId || null, newProd.sku, newProd.barcode,
          newProd.name, newProd.genericName || null, newProd.brand || null, newProd.unitOfMeasure,
          newProd.defaultTaxRate, newProd.reorderPoint, newProd.isPrescriptionRequired, newProd.isActive,
          newProd.createdAt, newProd.updatedAt
        ]);

        if (initialBatch && initialStockRec) {
          await pgPool.query(`
            INSERT INTO batches (
              id, tenant_id, product_id, batch_number, expiry_date, cost_price, selling_price, mrp, is_quarantined, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            initialBatch.id, initialBatch.tenantId, initialBatch.productId, initialBatch.batchNumber,
            initialBatch.expiryDate, initialBatch.costPrice, initialBatch.sellingPrice,
            initialBatch.mrp, initialBatch.isQuarantined, initialBatch.createdAt
          ]);

          await pgPool.query(`
            INSERT INTO inventory_stocks (
              id, tenant_id, batch_id, quantity, reserved_quantity, shelf_location, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            initialStockRec.id, initialStockRec.tenantId, initialStockRec.batchId,
            initialStockRec.quantity, initialStockRec.reservedQuantity,
            initialStockRec.shelfLocation, initialStockRec.updatedAt
          ]);
        }
      } catch (pgErr) {
        console.error('❌ [POSTGRESQL] Error inserting product into database:', pgErr);
      }
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

    // If stock / quantity is provided, update physical inventory stock
    if ((dto as any).stock !== undefined && !isNaN(Number((dto as any).stock))) {
      const targetStock = Math.max(0, parseInt((dto as any).stock));
      const batches = Array.from(dbStore.batches.values()).filter(b => b.productId === product.id);
      if (batches.length > 0) {
        const primaryBatch = batches[0];
        const stockRecord = dbStore.stocks.get(primaryBatch.id);
        const oldQty = stockRecord ? stockRecord.quantity : 0;
        if (stockRecord) {
          stockRecord.quantity = targetStock;
          stockRecord.updatedAt = new Date().toISOString();
        } else {
          dbStore.stocks.set(primaryBatch.id, {
            id: uuidv4(),
            tenantId: product.tenantId,
            batchId: primaryBatch.id,
            quantity: targetStock,
            reservedQuantity: 0,
            shelfLocation: 'Storage Main',
            updatedAt: new Date().toISOString()
          });
        }
        // Zero out secondary batches so total stock matches targetStock precisely
        for (let i = 1; i < batches.length; i++) {
          const secStock = dbStore.stocks.get(batches[i].id);
          if (secStock) {
            secStock.quantity = 0;
            secStock.updatedAt = new Date().toISOString();
          }
        }
        // Record audit movement
        dbStore.stockMovements.push({
          id: uuidv4(),
          tenantId: product.tenantId,
          batchId: primaryBatch.id,
          movementType: 'AUDIT_ADJUSTMENT',
          quantityChanged: targetStock - oldQty,
          quantityAfter: targetStock,
          referenceNote: `Manual Admin Stock Adjustment by Store Manager`,
          createdAt: new Date().toISOString()
        });
      } else {
        // If product has no batches yet, create initial batch with this stock
        const batchId = uuidv4();
        const expDate = new Date();
        expDate.setFullYear(expDate.getFullYear() + 2);
        const newBatch: Batch = {
          id: batchId,
          tenantId: product.tenantId,
          productId: product.id,
          batchNumber: `LOT-ADJ-${Date.now().toString().slice(-4)}`,
          expiryDate: expDate.toISOString().slice(0, 10),
          costPrice: 5.0,
          sellingPrice: dto.sellingPrice || 10.0,
          mrp: (dto.sellingPrice || 10.0) * 1.2,
          isQuarantined: false,
          createdAt: new Date().toISOString()
        };
        dbStore.batches.set(batchId, newBatch);
        dbStore.stocks.set(batchId, {
          id: uuidv4(),
          tenantId: product.tenantId,
          batchId,
          quantity: targetStock,
          reservedQuantity: 0,
          shelfLocation: 'Storage Main',
          updatedAt: new Date().toISOString()
        });
      }
    }

    product.updatedAt = new Date().toISOString();
    dbStore.products.set(product.id, product);

    // Persist changes to PostgreSQL
    if (isPgConnected) {
      try {
        await pgPool.query(`
          UPDATE products SET
            name = $1, generic_name = $2, brand = $3, unit_of_measure = $4,
            default_tax_rate = $5, reorder_point = $6, is_prescription_required = $7,
            is_active = $8, sku = $9, barcode = $10, category_id = $11, updated_at = $12
          WHERE id = $13
        `, [
          product.name, product.genericName || null, product.brand || null, product.unitOfMeasure,
          product.defaultTaxRate, product.reorderPoint, product.isPrescriptionRequired,
          product.isActive, product.sku, product.barcode, product.categoryId || null,
          product.updatedAt, product.id
        ]);

        if (dto.sellingPrice !== undefined && !isNaN(Number(dto.sellingPrice))) {
          await pgPool.query(`
            UPDATE batches SET selling_price = $1 WHERE product_id = $2
          `, [Number(Number(dto.sellingPrice).toFixed(2)), product.id]);
        }

        if ((dto as any).stock !== undefined && !isNaN(Number((dto as any).stock))) {
          const batches = Array.from(dbStore.batches.values()).filter(b => b.productId === product.id);
          if (batches.length > 0) {
            const primaryBatch = batches[0];
            const primaryStock = dbStore.stocks.get(primaryBatch.id);
            if (primaryStock) {
              await pgPool.query(`
                INSERT INTO inventory_stocks (id, tenant_id, batch_id, quantity, reserved_quantity, shelf_location, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (batch_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at
              `, [
                primaryStock.id, primaryStock.tenantId, primaryStock.batchId,
                primaryStock.quantity, primaryStock.reservedQuantity,
                primaryStock.shelfLocation, primaryStock.updatedAt
              ]);
            }
            for (let i = 1; i < batches.length; i++) {
              await pgPool.query(`
                UPDATE inventory_stocks SET quantity = 0, updated_at = NOW() WHERE batch_id = $1
              `, [batches[i].id]);
            }
          }
        }
      } catch (pgErr) {
        console.error('❌ [POSTGRESQL] Error updating product in database:', pgErr);
      }
    }

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
   * Delete or toggle active status of product
   */
  public async deleteProduct(tenantId: string, id: string, hard: boolean = true): Promise<{ success: boolean; message: string }> {
    const product = dbStore.products.get(id);
    if (!product) {
      throw { status: 404, message: `Product ${id} not found` };
    }
    if (hard) {
      dbStore.products.delete(id);
      for (const [batchId, b] of dbStore.batches.entries()) {
        if (b.productId === id) {
          dbStore.batches.delete(batchId);
          dbStore.stocks.delete(batchId);
        }
      }
      if (isPgConnected) {
        try {
          await pgPool.query('DELETE FROM products WHERE id = $1', [id]);
        } catch (pgErr) {
          console.error('❌ [POSTGRESQL] Error deleting product from database:', pgErr);
        }
      }
      return { success: true, message: `Product '${product.name}' deleted successfully from catalog.` };
    }
    product.isActive = false;
    dbStore.products.set(id, product);
    if (isPgConnected) {
      try {
        await pgPool.query('UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
      } catch (pgErr) {
        console.error('❌ [POSTGRESQL] Error deactivating product in database:', pgErr);
      }
    }
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

    // Persist to PostgreSQL
    if (isPgConnected) {
      try {
        await pgPool.query(`
          INSERT INTO batches (
            id, tenant_id, product_id, supplier_id, batch_number, manufacturing_date,
            expiry_date, cost_price, selling_price, mrp, is_quarantined, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          batch.id, batch.tenantId, batch.productId, batch.supplierId || null, batch.batchNumber,
          batch.manufacturingDate || null, batch.expiryDate, batch.costPrice, batch.sellingPrice,
          batch.mrp, batch.isQuarantined, batch.createdAt
        ]);

        await pgPool.query(`
          INSERT INTO inventory_stocks (
            id, tenant_id, batch_id, quantity, reserved_quantity, shelf_location, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          stock.id, stock.tenantId, stock.batchId, stock.quantity, stock.reservedQuantity,
          stock.shelfLocation, stock.updatedAt
        ]);

        await pgPool.query(`
          INSERT INTO stock_movements (
            id, tenant_id, batch_id, movement_type, quantity_changed, quantity_after, reference_note, created_at
          ) VALUES ($1, $2, $3, 'PURCHASE_INWARD', $4, $5, $6, $7)
        `, [
          uuidv4(), tenantId, batch.id, dto.quantity, dto.quantity,
          `Purchase Inward from Supplier Ref: ${dto.supplierInvoiceRef || 'N/A'}`,
          new Date().toISOString()
        ]);
      } catch (pgErr) {
        console.error('❌ [POSTGRESQL] Error persisting inward stock to database:', pgErr);
      }
    }

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
