import type { OfferItem } from './types';

export interface OfferTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
}

export function calculateTotals(items: OfferItem[], vatRate: number): OfferTotals {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const vatAmount = Number((subtotal * vatRate / 100).toFixed(2));
  const total = Number((subtotal + vatAmount).toFixed(2));
  return { subtotal, vatAmount, total };
}

export function lineTotal(item: OfferItem): number {
  return item.quantity * item.unitPrice;
}

// THE single money formatter for every owner- AND customer-facing amount, so an
// offer total reads identically on the owner's screen and the customer's document.
// Greek-canonical form: "1.234,56 €" (suffix + space).
export function fmtEur(amount: number): string {
  return (
    amount.toLocaleString('el-GR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' €'
  );
}
