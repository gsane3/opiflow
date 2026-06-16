import { describe, it, expect } from 'vitest';
import { computePaymentAmount, validatePct, isPaymentKind, PAYMENT_KINDS } from '../payments';

describe('payments', () => {
  describe('computePaymentAmount (server-authoritative)', () => {
    it('computes pct of the gross total, rounded to cents', () => {
      expect(computePaymentAmount(1308.2, 30)).toBe(392.46);
      expect(computePaymentAmount(1000, 100)).toBe(1000);
      expect(computePaymentAmount(100, 70)).toBe(70);
    });
    it('guards bad input → 0 (never NaN/negative)', () => {
      expect(computePaymentAmount(-5, 30)).toBe(0);
      expect(computePaymentAmount(Number.NaN, 30)).toBe(0);
      expect(computePaymentAmount(100, -1)).toBe(0);
    });
  });

  describe('validatePct', () => {
    it('accepts 0 < pct ≤ 100', () => {
      expect(validatePct(30)).toEqual({ ok: true, value: 30 });
      expect(validatePct(100)).toEqual({ ok: true, value: 100 });
    });
    it('rejects out-of-range / non-number', () => {
      expect(validatePct(0).ok).toBe(false);
      expect(validatePct(101).ok).toBe(false);
      expect(validatePct(-5).ok).toBe(false);
      expect(validatePct('30').ok).toBe(false);
      expect(validatePct(null).ok).toBe(false);
    });
  });

  it('isPaymentKind allows only deposit/balance', () => {
    for (const k of PAYMENT_KINDS) expect(isPaymentKind(k)).toBe(true);
    expect(isPaymentKind('foo')).toBe(false);
    expect(isPaymentKind(null)).toBe(false);
  });
});
