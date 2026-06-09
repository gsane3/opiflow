import { describe, it, expect } from 'vitest';
import { parseOfferItems, calculateOfferTotals, round2 } from '../offer-totals';

describe('parseOfferItems', () => {
  it('returns null for non-arrays and empty arrays', () => {
    expect(parseOfferItems(null)).toBeNull();
    expect(parseOfferItems(undefined)).toBeNull();
    expect(parseOfferItems('x')).toBeNull();
    expect(parseOfferItems([])).toBeNull();
  });

  it('parses a valid item with sortOrder defaulting to 0', () => {
    expect(parseOfferItems([{ description: 'A', quantity: 2, unitPrice: 10 }])).toEqual([
      { description: 'A', quantity: 2, unitPrice: 10, sortOrder: 0 },
    ]);
  });

  it('coerces numeric strings and floors sortOrder', () => {
    expect(parseOfferItems([{ description: 'A', quantity: '2', unitPrice: '10.5', sortOrder: 3.9 }])).toEqual([
      { description: 'A', quantity: 2, unitPrice: 10.5, sortOrder: 3 },
    ]);
  });

  it('rejects the whole array if any item is invalid (no partial accept)', () => {
    expect(parseOfferItems([{ description: '', quantity: 1, unitPrice: 1 }])).toBeNull();
    expect(parseOfferItems([{ description: '   ', quantity: 1, unitPrice: 1 }])).toBeNull();
    expect(parseOfferItems([{ description: 'A', quantity: 0, unitPrice: 1 }])).toBeNull();
    expect(parseOfferItems([{ description: 'A', quantity: -1, unitPrice: 1 }])).toBeNull();
    expect(parseOfferItems([{ description: 'A', quantity: 1, unitPrice: -0.01 }])).toBeNull();
    expect(parseOfferItems([{ description: 'A', quantity: 1, unitPrice: 'oops' }])).toBeNull();
    expect(parseOfferItems([{ description: 'A', quantity: 1, unitPrice: 1 }, 'nope'])).toBeNull();
  });

  it('allows unitPrice of exactly 0', () => {
    expect(parseOfferItems([{ description: 'Free', quantity: 1, unitPrice: 0 }])).toEqual([
      { description: 'Free', quantity: 1, unitPrice: 0, sortOrder: 0 },
    ]);
  });
});

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.2)).toBe(1.2);
    expect(round2(1.111)).toBe(1.11);
    expect(round2(1.119)).toBe(1.12);
    expect(round2(5)).toBe(5);
  });
});

describe('calculateOfferTotals', () => {
  it('computes line totals, subtotal, VAT and grand total', () => {
    expect(calculateOfferTotals([{ description: 'A', quantity: 2, unitPrice: 10, sortOrder: 0 }], 24)).toEqual({
      lineTotals: [20], subtotal: 20, vatAmount: 4.8, total: 24.8,
    });
  });

  it('handles a zero VAT rate and multiple lines', () => {
    expect(calculateOfferTotals([
      { description: 'A', quantity: 1, unitPrice: 10, sortOrder: 0 },
      { description: 'B', quantity: 3, unitPrice: 5, sortOrder: 1 },
    ], 0)).toEqual({ lineTotals: [10, 15], subtotal: 25, vatAmount: 0, total: 25 });
  });

  it('rounds away floating-point error per line and on totals', () => {
    // 0.1 * 3 = 0.30000000000000004 — must round to 0.3
    expect(calculateOfferTotals([{ description: 'A', quantity: 3, unitPrice: 0.1, sortOrder: 0 }], 0)).toEqual({
      lineTotals: [0.3], subtotal: 0.3, vatAmount: 0, total: 0.3,
    });
  });
});
