// Domain types & DTO definitions

export type TenantDomain = 'RETAIL_SUPERMARKET' | 'HOSPITAL_PHARMACY';
export type UserRole = 'ADMIN' | 'STORE_MANAGER' | 'PHARMACIST' | 'CASHIER' | 'AUDITOR';
export type MovementType = 'PURCHASE_INWARD' | 'SALE_DEDUCTION' | 'SALE_RETURN' | 'AUDIT_ADJUSTMENT' | 'EXPIRED_QUARANTINE';
export type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'UPI_QR' | 'STORE_CREDIT';
export type InvoiceStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PENDING_PAYMENT';
export type DrawerStatus = 'OPEN' | 'CLOSED';

export interface Tenant {
  id: string;
  name: string;
  domainType: TenantDomain;
  taxIdentifier: string;
  currency: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId?: string;
  sku: string;
  barcode: string;
  name: string;
  genericName?: string;
  brand?: string;
  unitOfMeasure: string;
  defaultTaxRate: number;
  reorderPoint: number;
  isPrescriptionRequired: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  // Computed / Joined
  categoryName?: string;
  totalStock?: number;
  batches?: BatchWithStock[];
}

export interface Batch {
  id: string;
  tenantId: string;
  productId: string;
  supplierId?: string;
  batchNumber: string;
  manufacturingDate?: string;
  expiryDate: string;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  isQuarantined: boolean;
  createdAt: string;
}

export interface InventoryStock {
  id: string;
  tenantId: string;
  batchId: string;
  quantity: number;
  reservedQuantity: number;
  shelfLocation?: string;
  updatedAt: string;
}

export interface BatchWithStock extends Batch {
  quantity: number;
  shelfLocation?: string;
  isExpired?: boolean;
  isNearExpiry?: boolean;
  daysToExpiry?: number;
}

export interface Patient {
  id: string;
  tenantId: string;
  mrn: string;
  fullName: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: string;
}

export interface Doctor {
  id: string;
  tenantId: string;
  licenseNumber: string;
  fullName: string;
  specialization?: string;
  phone?: string;
}

export interface CashDrawer {
  id: string;
  tenantId: string;
  cashierId: string;
  terminalIdentifier: string;
  openedAt: string;
  closedAt?: string;
  openingFloat: number;
  totalCashDrops: number;
  closingCash?: number;
  status: DrawerStatus;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId: string;
  batchId: string;
  productName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  cashierId: string;
  drawerId: string;
  invoiceNumber: string;
  patientId?: string;
  patientName?: string;
  doctorLicense?: string;
  prescriptionNumber?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  tenderedAmount: number;
  changeDue: number;
  status: InvoiceStatus;
  items: InvoiceItem[];
  createdAt: string;
}

export interface StockMovement {
  id: string;
  tenantId: string;
  batchId: string;
  invoiceId?: string;
  movementType: MovementType;
  quantityChanged: number;
  quantityAfter: number;
  referenceNote?: string;
  createdAt: string;
}

export interface ZReport {
  id: string;
  tenantId: string;
  drawerId: string;
  reportCode: string;
  totalCashSales: number;
  totalCardSales: number;
  totalUpiSales: number;
  totalTaxCollected: number;
  totalDiscountsGiven: number;
  grossMargin: number;
  expectedCashInDrawer: number;
  actualCountedCash: number;
  cashVariance: number;
  discrepancyReason?: string;
  generatedAt: string;
}

// Request DTOs
export interface CreateProductDTO {
  sku: string;
  barcode: string;
  name: string;
  genericName?: string;
  categoryId?: string;
  brand?: string;
  unitOfMeasure?: string;
  defaultTaxRate?: number;
  reorderPoint?: number;
  isPrescriptionRequired?: boolean;
}

export interface InboundStockDTO {
  productId: string;
  supplierId?: string;
  batchNumber: string;
  manufacturingDate?: string;
  expiryDate: string;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  quantity: number;
  shelfLocation?: string;
  supplierInvoiceRef?: string;
}

export interface CheckoutItemRequest {
  productId: string;
  batchId?: string; // If omitted, FEFO engine auto-allocates
  quantity: number;
  unitPrice?: number;
  discountAmount?: number;
}

export interface CheckoutRequestDTO {
  drawerId: string;
  items: CheckoutItemRequest[];
  clinical?: {
    patientMrn?: string;
    patientName?: string;
    doctorLicense?: string;
    prescriptionNumber?: string;
  };
  payment: {
    method: PaymentMethod;
    tenderedAmount: number;
  };
}

export interface CloseDrawerDTO {
  drawerId: string;
  actualCountedCash: number;
  supervisorPin?: string;
  discrepancyReason?: string;
}
