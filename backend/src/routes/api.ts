import { Router, Request, Response } from 'express';
import { catalogService } from '../services/catalogService.js';
import { fefoService } from '../services/fefoService.js';
import { checkoutService } from '../services/checkoutService.js';
import { reconciliationService } from '../services/reconciliationService.js';
import { concurrencyTestService } from '../services/concurrencyTestService.js';
import { dbStore, isPgConnected } from '../db/database.js';

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
  const categories = Array.from(dbStore.categories.values());
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
    const result = await catalogService.deleteProduct(tenantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

// 2. High-speed Scanner Barcode/SKU Lookup (< 25ms)
apiRouter.get('/scanner/lookup/:code', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const start = performance.now();
    const product = await catalogService.lookupByBarcodeOrSku(tenantId, req.params.code);
    const latencyMs = Math.round(performance.now() - start);

    if (!product) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `No item found matching '${req.params.code}'` });
    }

    res.json({
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
    res.status(err.status || 500).json({ error: err.message });
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
