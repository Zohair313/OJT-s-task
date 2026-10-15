import { dbStore } from '../db/database.js';
import { catalogService } from './catalogService.js';
import { BatchWithStock } from '../types/index.js';

export interface BatchAllocation {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  allocatedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  isNearExpiry: boolean;
  shelfLocation?: string;
}

export interface FEFOResolutionResult {
  productId: string;
  requestedQuantity: number;
  totalAllocated: number;
  isSplitAcrossBatches: boolean;
  allocations: BatchAllocation[];
  hasNearExpiryWarning: boolean;
  unfulfilledQuantity: number;
}

export class FEFOService {
  /**
   * Resolves FEFO allocations for a requested product and quantity.
   * Prioritizes earliest expiring valid batches, quarantines expired ones,
   * and splits quantities across lots if needed.
   */
  public resolveAllocations(productId: string, requestedQty: number): FEFOResolutionResult {
    const batches = catalogService.getProductBatches(productId);
    const validBatches = batches.filter(b => !b.isExpired && !b.isQuarantined && b.quantity > 0);

    // Sort strictly ascending by expiration date (FEFO)
    validBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    let remainingNeeded = requestedQty;
    const allocations: BatchAllocation[] = [];
    let hasNearExpiryWarning = false;

    for (const b of validBatches) {
      if (remainingNeeded <= 0) break;

      const takeQty = Math.min(b.quantity, remainingNeeded);
      if (takeQty > 0) {
        if (b.isNearExpiry) {
          hasNearExpiryWarning = true;
        }

        allocations.push({
          batchId: b.id,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          daysToExpiry: b.daysToExpiry || 0,
          allocatedQuantity: takeQty,
          unitPrice: b.sellingPrice,
          lineTotal: Number((takeQty * b.sellingPrice).toFixed(2)),
          isNearExpiry: !!b.isNearExpiry,
          shelfLocation: b.shelfLocation
        });

        remainingNeeded -= takeQty;
      }
    }

    const totalAllocated = requestedQty - remainingNeeded;

    return {
      productId,
      requestedQuantity: requestedQty,
      totalAllocated,
      isSplitAcrossBatches: allocations.length > 1,
      allocations,
      hasNearExpiryWarning,
      unfulfilledQuantity: remainingNeeded
    };
  }
}

export const fefoService = new FEFOService();
