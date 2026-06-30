import { describe, it, expect, afterEach } from 'vitest';
import {
  splitGrossToNetVat,
  vatCategoryForRate,
  pickServiceInvoiceType,
  isValidGreekVat,
  lineItemFromGross,
} from '../invoicing.logic';
import { isInvoicingConfigured, getSbzConfig } from '../invoicing.config';
import { INVOICE_TYPES, VAT_CATEGORY } from '../types';

describe('invoicing.logic — net/VAT split', () => {
  it('splits a gross amount into net + vat at 24%', () => {
    expect(splitGrossToNetVat(124, 24)).toEqual({ net: 100, vat: 24 });
  });
  it('handles 0% (net == gross)', () => {
    expect(splitGrossToNetVat(100, 0)).toEqual({ net: 100, vat: 0 });
  });
  it('rounds to 2 decimals and never NaN', () => {
    const { net, vat } = splitGrossToNetVat(100, 24);
    expect(net + vat).toBeCloseTo(100, 2);
    expect(Number.isFinite(net)).toBe(true);
  });
  it('guards negative/invalid gross', () => {
    expect(splitGrossToNetVat(-5, 24)).toEqual({ net: 0, vat: 0 });
  });
});

describe('invoicing.logic — VAT category mapping', () => {
  it('maps Greek rates to myDATA vatCategory codes', () => {
    expect(vatCategoryForRate(24)).toBe(1);
    expect(vatCategoryForRate(13)).toBe(2);
    expect(vatCategoryForRate(6)).toBe(3);
    expect(vatCategoryForRate(0)).toBe(7);
  });
  it('defaults unknown rates to 24% (code 1)', () => {
    expect(vatCategoryForRate(17)).toBe(1);
  });
});

describe('invoicing.logic — Greek ΑΦΜ validity', () => {
  it('accepts a real valid ΑΦΜ (Αντιπλημμυρικά Ελλάδος ΙΚΕ)', () => {
    expect(isValidGreekVat('803311450')).toBe(true);
  });
  it('rejects a wrong checksum / wrong length / empty / all-zeros', () => {
    expect(isValidGreekVat('803311451')).toBe(false);
    expect(isValidGreekVat('12345')).toBe(false);
    expect(isValidGreekVat('')).toBe(false);
    expect(isValidGreekVat(null)).toBe(false);
    expect(isValidGreekVat('000000000')).toBe(false);
  });
  it('tolerates spaces/dots in the input', () => {
    expect(isValidGreekVat('80 3311450')).toBe(true);
  });
});

describe('invoicing.logic — document type selection', () => {
  it('B2B (valid ΑΦΜ) → 2.1 service invoice', () => {
    expect(pickServiceInvoiceType('803311450')).toBe('2.1');
  });
  it('B2C (no/invalid ΑΦΜ) → 11.2 retail service receipt', () => {
    expect(pickServiceInvoiceType(null)).toBe('11.2');
    expect(pickServiceInvoiceType('')).toBe('11.2');
    expect(pickServiceInvoiceType('not-a-vat')).toBe('11.2');
  });
  it('every picked type exists in the INVOICE_TYPES map', () => {
    expect(INVOICE_TYPES['2.1']).toBeTruthy();
    expect(INVOICE_TYPES['11.2']).toBeTruthy();
  });
});

describe('invoicing.logic — line item from gross', () => {
  it('builds a net/VAT-split single line item', () => {
    const li = lineItemFromGross('Υπηρεσία', 124, 24, 'E3_561_001');
    expect(li.quantity).toBe(1);
    expect(li.netAmount).toBe(100);
    expect(li.vatAmount).toBe(24);
    expect(li.incomeClassification).toBe('E3_561_001');
  });
});

describe('invoicing.config — env gating', () => {
  const KEYS = ['SBZ_API_KEY', 'SBZ_API_BASE_URL'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is false when any SBZ var is missing', () => {
    for (const k of KEYS) delete process.env[k];
    expect(isInvoicingConfigured()).toBe(false);
    expect(getSbzConfig()).toBeNull();
  });
  it('is true and exposes a trimmed baseUrl when all are set', () => {
    process.env.SBZ_API_KEY = 'k';
    process.env.SBZ_API_BASE_URL = 'https://sandbox.example/api/';
    expect(isInvoicingConfigured()).toBe(true);
    expect(getSbzConfig()).toEqual({ apiKey: 'k', baseUrl: 'https://sandbox.example/api', mode: 'production' });
  });
});

describe('invoicing — VAT_CATEGORY constant', () => {
  it('exposes the canonical Greek-rate → code map', () => {
    expect(VAT_CATEGORY).toMatchObject({ 24: 1, 13: 2, 6: 3, 0: 7 });
  });
});
