// Invoicing — pure, side-effect-free helpers (fully unit-testable). The amounts that
// flow in from offers/payments are GROSS (VAT-inclusive); myDATA needs the net/VAT
// split + the right document type + VAT category.

import { VAT_CATEGORY, type VatRate } from './types';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Split a GROSS (VAT-inclusive) amount into {net, vat} for a given VAT rate (e.g. 24). */
export function splitGrossToNetVat(gross: number, vatRate: number): { net: number; vat: number } {
  if (!Number.isFinite(gross) || gross < 0) return { net: 0, vat: 0 };
  const r = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
  const net = round2(gross / (1 + r / 100));
  const vat = round2(gross - net);
  return { net, vat };
}

/** myDATA vatCategory code for a percentage rate (24→1, 13→2, 6→3, 0→7). Defaults to 1 (24%). */
export function vatCategoryForRate(vatRate: number): number {
  return VAT_CATEGORY[vatRate as VatRate] ?? VAT_CATEGORY[24];
}

/**
 * Pick the myDATA document type for a SERVICE business:
 *  - valid counterparty ΑΦΜ → '2.1' Τιμολόγιο Παροχής Υπηρεσιών (B2B)
 *  - otherwise              → '11.2' ΑΠΥ retail receipt (B2C)
 */
export function pickServiceInvoiceType(counterpartyVat: string | null | undefined): '2.1' | '11.2' {
  return isValidGreekVat(counterpartyVat) ? '2.1' : '11.2';
}

/**
 * Greek ΑΦΜ (TIN) validity: 9 digits, mod-11 checksum over the first 8 (weights
 * 256..2), check digit = (sum % 11) % 10. Returns false for null/empty/non-9-digit.
 */
export function isValidGreekVat(vat: string | null | undefined): boolean {
  if (!vat) return false;
  const digits = vat.replace(/\s|\./g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  if (digits === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(digits[i]) * Math.pow(2, 8 - i);
  }
  const check = (sum % 11) % 10;
  return check === Number(digits[8]);
}

/** Build a single net/VAT-split line item from a GROSS amount + description. */
export function lineItemFromGross(
  description: string,
  gross: number,
  vatRate: number,
  incomeClassification?: string
) {
  const { net, vat } = splitGrossToNetVat(gross, vatRate);
  return {
    description,
    quantity: 1,
    unitNet: net,
    vatRate,
    netAmount: net,
    vatAmount: vat,
    ...(incomeClassification ? { incomeClassification } : {}),
  };
}
