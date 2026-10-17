import { Router, Request, Response } from 'express';
import { catalogService } from '../services/catalogService.js';
import { fefoService } from '../services/fefoService.js';
import { checkoutService } from '../services/checkoutService.js';
import { reconciliationService } from '../services/reconciliationService.js';
import { concurrencyTestService } from '../services/concurrencyTestService.js';
import { dbStore, isPgConnected, pgPool } from '../db/database.js';
import { Invoice } from '../types/index.js';

export const apiRouter = Router();

// Middleware to extract tenant context
const getTenantId = (req: Request): string => {
  return (req.headers['x-tenant-id'] as string) || (req.query.tenantId as string) || 't-retail-001';
};

// Health & Database Mode Check
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    version: '1.0.0',
    database: isPgConnected ? 'Native PostgreSQL (ACID Safe)' : 'In-Memory ACID Engine with Row Locks',
    timestamp: new Date().toISOString()
  });
});

// Tenants list
apiRouter.get('/tenants', (req: Request, res: Response) => {
  const tenants = Array.from(dbStore.tenants.values());
  res.json(tenants);
});

// Categories list
apiRouter.get('/categories', (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;
  const all = Array.from(dbStore.categories.values());
  const categories = (!tenantId || tenantId === 'all') 
    ? all 
    : all.filter(c => !c.tenantId || c.tenantId === tenantId);
  res.json(categories);
});

// 1. Catalog Products (Search, Pagination, Duplicate Barcode Guard)
apiRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const search = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const includeInactive = req.query.includeInactive === 'true';

    const result = await catalogService.getProducts(tenantId, search, limit, offset, includeInactive);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
});

apiRouter.post('/products', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const product = await catalogService.createProduct(tenantId, req.body);
    res.status(201).json(product);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

apiRouter.put('/products/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const updated = await catalogService.updateProduct(tenantId, req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

apiRouter.delete('/products/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const hard = req.query.hard !== 'false';
    const result = await catalogService.deleteProduct(tenantId, req.params.id, hard);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

// 2. High-speed Scanner Barcode/SKU & Receipt Lookup (< 25ms)
apiRouter.get('/scanner/lookup/:code', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const start = performance.now();
    const rawCode = req.params.code.trim();
    const cleanDigits = rawCode.replace(/[^0-9]/g, '');

    // 1. Check if scanned barcode is an Invoice Receipt (e.g. starts with INV- or numeric invoice sequence)
    let matchedInvoice = Array.from(dbStore.invoices.values()).find(
      inv => inv.id === rawCode ||
             inv.invoiceNumber.toLowerCase() === rawCode.toLowerCase() ||
             (cleanDigits.length >= 8 && inv.invoiceNumber.replace(/[^0-9]/g, '').includes(cleanDigits))
    );

    if (!matchedInvoice && isPgConnected) {
      try {
        const invRes = await pgPool.query(
          `SELECT * FROM invoices 
           WHERE id = $1 
              OR LOWER(invoice_number) = LOWER($1) 
              OR regexp_replace(invoice_number, '[^0-9]', '', 'g') LIKE '%' || $2 || '%' 
           ORDER BY created_at DESC LIMIT 1`,
          [rawCode, cleanDigits.length >= 8 ? cleanDigits : 'NONE']
        );
        if (invRes.rows.length > 0) {
          const row = invRes.rows[0];
          const itemsRes = await pgPool.query(
            `SELECT ii.*, p.name as product_name, b.batch_number, b.expiry_date
             FROM invoice_items ii
             LEFT JOIN products p ON ii.product_id = p.id
             LEFT JOIN batches b ON ii.batch_id = b.id
             WHERE ii.invoice_id = $1`,
            [row.id]
          );

          const loadedInvoice: Invoice = {
            id: row.id,
            tenantId: row.tenant_id,
            cashierId: row.cashier_id,
            drawerId: row.drawer_id,
            invoiceNumber: row.invoice_number,
            patientId: row.patient_id || undefined,
            doctorLicense: row.doctor_id || undefined,
            prescriptionNumber: row.prescription_number || undefined,
            subtotal: Number(row.subtotal),
            discountAmount: Number(row.discount_amount),
            taxAmount: Number(row.tax_amount),
            roundOff: Number(row.round_off),
            grandTotal: Number(row.grand_total),
            paymentMethod: 'CASH',
            tenderedAmount: Number(row.grand_total),
            changeDue: 0,
            status: row.status,
            items: itemsRes.rows.map(it => ({
              id: it.id,
              invoiceId: it.invoice_id,
              productId: it.product_id,
              productName: it.product_name || 'Item',
              batchId: it.batch_id,
              batchNumber: it.batch_number || 'N/A',
              expiryDate: it.expiry_date || 'N/A',
              quantity: it.quantity,
              unitPrice: Number(it.unit_price),
              taxRate: Number(it.tax_rate),
              taxAmount: Number(it.tax_amount),
              discountAmount: Number(it.discount_amount),
              lineTotal: Number(it.line_total)
            })),
            createdAt: row.created_at
          };
          matchedInvoice = loadedInvoice;
          dbStore.invoices.set(loadedInvoice.id, loadedInvoice);
        }
      } catch (err) {
        console.warn('PG invoice lookup fallback warning:', err);
      }
    }

    if (matchedInvoice) {
      const tenant = dbStore.tenants.get(matchedInvoice.tenantId);
      const latencyMs = Math.round(performance.now() - start);
      return res.json({
        type: 'INVOICE',
        invoice: matchedInvoice,
        store: {
          name: tenant?.name || 'Retail Mart',
          taxIdentifier: tenant?.taxIdentifier || 'TX-9901',
          address: tenant?.address || 'Store Location',
          phone: tenant?.phone || '555-0100',
          isPharmacy: tenant?.domainType === 'HOSPITAL_PHARMACY'
        },
        latencyMs
      });
    }

    // 2. Otherwise look up catalog product by barcode or SKU
    const product = await catalogService.lookupByBarcodeOrSku(tenantId, rawCode);
    const latencyMs = Math.round(performance.now() - start);

    if (!product) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `No item found matching '${rawCode}'` });
    }

    res.json({
      type: 'PRODUCT',
      product,
      latencyMs
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Inbound Stock Intake (Purchase Inward)
apiRouter.post('/inventory/inward', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const result = await catalogService.receiveInwardStock(tenantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 4. FEFO Batch Allocation Resolver
apiRouter.post('/fefo/resolve', (req: Request, res: Response) => {
  try {
    const { productId, requestedQuantity } = req.body;
    if (!productId || !requestedQuantity) {
      return res.status(400).json({ error: 'productId and requestedQuantity are required' });
    }
    const result = fefoService.resolveAllocations(productId, Number(requestedQuantity));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ACID Checkout Pipeline (Pessimistic Row-Level Locking)
apiRouter.post('/checkout/commit', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const cashierId = (req.headers['x-cashier-id'] as string) || 'usr-cashier-01';
    const invoice = await checkoutService.processCheckout(tenantId, cashierId, req.body);
    res.status(200).json(invoice);
  } catch (err: any) {
    console.error('❌ [API /checkout/commit ERROR]:', err.message || err);
    res.status(err.status || 500).json({
      error: err.code || 'CHECKOUT_FAILED',
      message: err.message
    });
  }
});

// 6. Concurrency Race Load Test (20 Threads vs 1 Stock Unit)
apiRouter.post('/test/concurrency-race', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const summary = await concurrencyTestService.executeRaceTest(tenantId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Thermal Receipt Layout Payload (80mm & 58mm)
apiRouter.get('/invoices/:id/receipt', (req: Request, res: Response) => {
  const invoice = dbStore.invoices.get(req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const tenant = dbStore.tenants.get(invoice.tenantId);
  const isPharmacy = tenant?.domainType === 'HOSPITAL_PHARMACY';

  res.json({
    invoice,
    store: {
      name: tenant?.name || 'Retail Mart',
      taxIdentifier: tenant?.taxIdentifier || 'TX-9901',
      address: tenant?.address || 'Store Location',
      phone: tenant?.phone || '555-0100',
      isPharmacy
    },
    printerConfig: {
      defaultFormat: isPharmacy ? '58mm' : '80mm',
      autoCut: true,
      kickCashDrawer: invoice.paymentMethod === 'CASH'
    }
  });
});

// 8. Cash Drawer Session Management & Z-Report
apiRouter.get('/drawers/active', (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const activeDrawer = Array.from(dbStore.cashDrawers.values()).find(
    d => d.tenantId === tenantId && d.status === 'OPEN'
  );
  res.json(activeDrawer || null);
});

apiRouter.post('/drawers/open', (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { cashierId, terminalId, openingFloat } = req.body;
    const drawer = reconciliationService.openDrawerSession(
      tenantId,
      cashierId || 'usr-cashier-01',
      terminalId || 'POS-COUNTER-01',
      Number(openingFloat || 150)
    );
    res.json(drawer);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

apiRouter.post('/drawers/drop', (req: Request, res: Response) => {
  try {
    const { drawerId, amount } = req.body;
    const drawer = reconciliationService.recordCashDrop(drawerId, Number(amount));
    res.json(drawer);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

apiRouter.post('/drawers/close-z-report', (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const result = reconciliationService.closeShiftAndGenerateZReport(tenantId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'DRAWER_ERROR', message: err.message || 'Error processing drawer' });
  }
});

// 9. Clinical Master Records (Patients & Doctors for Hospital Pharmacy)
apiRouter.get('/clinical/patients', (req: Request, res: Response) => {
  const patients = Array.from(dbStore.patients.values());
  res.json(patients);
});

apiRouter.get('/clinical/doctors', (req: Request, res: Response) => {
  const doctors = Array.from(dbStore.doctors.values());
  res.json(doctors);
});
