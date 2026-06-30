import { describe, it, expect } from 'vitest';
import { SettingsInputSchema, settingsInputToDb, IssueInputSchema } from '../invoicing.schema';

describe('invoicing.schema — SettingsInput', () => {
  it('accepts a valid partial update and maps to snake_case DB columns', () => {
    const input = SettingsInputSchema.parse({ enabled: true, issuerVat: '803311450', invoiceSeries: 'A', autoIssueOnPayment: true });
    expect(settingsInputToDb(input)).toEqual({
      enabled: true,
      issuer_vat: '803311450',
      invoice_series: 'A',
      auto_issue_on_payment: true,
    });
  });
  it('rejects an invalid ΑΦΜ', () => {
    expect(() => SettingsInputSchema.parse({ issuerVat: '123' })).toThrow();
  });
  it('rejects unknown keys (strict)', () => {
    expect(() => SettingsInputSchema.parse({ bogus: 1 })).toThrow();
  });
  it('maps an empty issuerVat to null', () => {
    const input = SettingsInputSchema.parse({ issuerVat: '' });
    expect(settingsInputToDb(input)).toEqual({ issuer_vat: null });
  });
});

describe('invoicing.schema — IssueInput', () => {
  it('accepts an offerId-only request', () => {
    expect(() => IssueInputSchema.parse({ offerId: '11111111-1111-1111-1111-111111111111' })).not.toThrow();
  });
  it('accepts an ad-hoc amount + description', () => {
    expect(() => IssueInputSchema.parse({ amount: 124, description: 'Υπηρεσία', vatRate: 24 })).not.toThrow();
  });
  it('rejects when neither offerId nor (amount+description) is present', () => {
    expect(() => IssueInputSchema.parse({ vatRate: 24 })).toThrow();
    expect(() => IssueInputSchema.parse({ amount: 124 })).toThrow(); // missing description
  });
});
