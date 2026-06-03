import { describe, it, expect } from 'vitest';
import { calculateTotals, lineTotal, fmtEur } from '../offer-calculations';
import type { OfferItem } from '../types';

function item(partial: Partial<OfferItem>): OfferItem {
  return {
    id: partial.id ?? 'x',
    description: partial.description ?? '',
    quantity: partial.quantity ?? 1,
    unitPrice: partial.unitPrice ?? 0,
  };
}

describe('lineTotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(lineTotal(item({ quantity: 3, unitPrice: 10 }))).toBe(30);
  });

  it('handles fractional quantities and prices', () => {
    expect(lineTotal(item({ quantity: 2.5, unitPrice: 4 }))).toBe(10);
    expect(lineTotal(item({ quantity: 1, unitPrice: 19.99 }))).toBeCloseTo(19.99, 5);
  });

  it('returns 0 when quantity or price is 0', () => {
    expect(lineTotal(item({ quantity: 0, unitPrice: 100 }))).toBe(0);
    expect(lineTotal(item({ quantity: 5, unitPrice: 0 }))).toBe(0);
  });
});

describe('calculateTotals', () => {
  it('returns all-zero totals for an empty item list', () => {
    expect(calculateTotals([], 24)).toEqual({ subtotal: 0, vatAmount: 0, total: 0 });
  });

  it('sums line items into the subtotal', () => {
    const items = [
      item({ quantity: 2, unitPrice: 50 }), // 100
      item({ quantity: 1, unitPrice: 25 }), // 25
    ];
    const { subtotal } = calculateTotals(items, 0);
    expect(subtotal).toBe(125);
  });

  it('applies the VAT rate correctly (24%)', () => {
    const items = [item({ quantity: 1, unitPrice: 100 })];
    const { subtotal, vatAmount, total } = calculateTotals(items, 24);
    expect(subtotal).toBe(100);
    expect(vatAmount).toBe(24);
    expect(total).toBe(124);
  });

  it('produces zero VAT when the rate is 0', () => {
    const items = [item({ quantity: 1, unitPrice: 80 })];
    expect(calculateTotals(items, 0)).toEqual({ subtotal: 80, vatAmount: 0, total: 80 });
  });

  it('rounds the VAT amount to 2 decimals', () => {
    // subtotal 99.99 * 24% = 23.9976 -> 24.00
    const items = [item({ quantity: 1, unitPrice: 99.99 })];
    const { vatAmount, total } = calculateTotals(items, 24);
    expect(vatAmount).toBe(24);
    expect(total).toBe(123.99);
  });

  it('rounds VAT half-up at the cent boundary', () => {
    // subtotal 10.10 * 24% = 2.424 -> 2.42
    expect(calculateTotals([item({ quantity: 1, unitPrice: 10.1 })], 24).vatAmount).toBe(2.42);
    // subtotal 10.30 * 24% = 2.472 -> 2.47
    expect(calculateTotals([item({ quantity: 1, unitPrice: 10.3 })], 24).vatAmount).toBe(2.47);
  });

  it('computes the total as the rounded sum of subtotal and VAT', () => {
    const items = [
      item({ quantity: 3, unitPrice: 33.33 }), // 99.99
      item({ quantity: 1, unitPrice: 0.01 }), //   0.01
    ];
    const { subtotal, vatAmount, total } = calculateTotals(items, 24);
    expect(subtotal).toBeCloseTo(100, 5);
    expect(vatAmount).toBe(24);
    expect(total).toBe(124);
  });

  it('supports a fractional VAT rate', () => {
    // 200 * 13% = 26
    const { vatAmount, total } = calculateTotals([item({ quantity: 4, unitPrice: 50 })], 13);
    expect(vatAmount).toBe(26);
    expect(total).toBe(226);
  });
});

describe('fmtEur', () => {
  it('prefixes the euro sign and shows exactly two decimals', () => {
    const out = fmtEur(1234.5);
    expect(out.startsWith('€')).toBe(true);
    // Regardless of locale grouping separators, the digits must read 1234.50 / 1234,50.
    const digitsOnly = out.replace(/[^0-9]/g, '');
    expect(digitsOnly).toBe('123450');
  });

  it('always renders two fraction digits for whole numbers', () => {
    const out = fmtEur(5);
    expect(out.replace(/[^0-9]/g, '')).toBe('500');
  });

  it('rounds to two decimals', () => {
    // 0.005 rounds to 0.01 (banker-independent for this value in toLocaleString)
    const out = fmtEur(0.005);
    expect(out.replace(/[^0-9]/g, '')).toBe('001');
  });

  it('renders zero as a two-decimal value', () => {
    const out = fmtEur(0);
    expect(out.replace(/[^0-9]/g, '')).toBe('000');
    expect(out.startsWith('€')).toBe(true);
  });
});
