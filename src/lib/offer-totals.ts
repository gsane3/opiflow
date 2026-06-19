// Offer item parsing + money math — the single source of truth shared by the
// offer create (POST /api/offers) and update (PATCH /api/offers/[id]) routes.
// Pure + dependency-free so it is unit-tested and cannot drift between the two
// routes (it previously lived duplicated in both). Client-supplied
// subtotal/vatAmount/total are ALWAYS ignored — totals are computed here.

export interface ValidOfferItem {
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
}

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

/**
 * Validate a raw items array. Returns null if the array is missing, empty, or
 * ANY item is invalid (no partial acceptance):
 *   - description: required non-empty string
 *   - quantity: number > 0
 *   - unitPrice: number >= 0
 *   - sortOrder: integer (defaults to 0)
 */
export function parseOfferItems(raw: unknown): ValidOfferItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: ValidOfferItem[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    const description = str(r.description);
    if (!description) return null;
    const quantity = optionalNumber(r.quantity);
    if (quantity === null || quantity <= 0) return null;
    const unitPrice = optionalNumber(r.unitPrice);
    if (unitPrice === null || unitPrice < 0) return null;
    const sortOrder = typeof r.sortOrder === 'number' ? Math.floor(r.sortOrder) : 0;
    items.push({ description, quantity, unitPrice, sortOrder });
  }
  return items;
}

/** Round to 2 decimals (currency). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute per-line totals + subtotal + VAT + grand total, each rounded to 2
 * decimals. `lineTotals[i]` corresponds to `items[i]`.
 */
export function calculateOfferTotals(
  items: ValidOfferItem[],
  vatRate: number,
): { subtotal: number; vatAmount: number; total: number; lineTotals: number[] } {
  // Defense in depth: clamp VAT to a sane 0–100% so a bad/absurd rate can never
  // produce a negative or wildly inflated total stored + shown to the customer.
  const safeRate = Math.min(Math.max(Number.isFinite(vatRate) ? vatRate : 0, 0), 100);
  const lineTotals = items.map((item) => round2(item.quantity * item.unitPrice));
  const subtotal = round2(lineTotals.reduce((s, t) => s + t, 0));
  const vatAmount = round2((subtotal * safeRate) / 100);
  const total = round2(subtotal + vatAmount);
  return { subtotal, vatAmount, total, lineTotals };
}
