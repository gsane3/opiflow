import { describe, it, expect } from 'vitest';
import {
  publicBusiness,
  publicCustomer,
  submitIntake,
  type ResolvedIntake,
} from '../public-intake.service';

// These tests are HERMETIC: they cover the pure response-mapping helpers and the
// submitIntake validation branch that short-circuits BEFORE any DB/token/push call.
// The real token verify, the service-role Supabase client and the push sender all
// need env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / FCM_*), so they
// are intentionally NOT exercised here — only the env-free logic is asserted.

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    business_id: 'b1',
    crm_number: 'CRM-1',
    name: 'Γιώργος',
    company_name: 'ACME',
    phone: '6912345678',
    mobile_phone: null,
    landline_phone: null,
    email: 'g@example.gr',
    address: 'Οδός 1',
    needs_summary: 'Βλάβη',
    notes: 'σημ.',
    intake_status: 'submitted',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Parameters<typeof publicCustomer>[0];
}

describe('publicCustomer (response mapping)', () => {
  it('maps row → public shape with masked phone and extras', () => {
    const result = publicCustomer(customerRow(), { postalCode: '12345', region: 'Αττική' });
    expect(result).toEqual({
      crmNumber: 'CRM-1',
      displayName: 'Γιώργος',
      phoneMasked: '6912***678',
      companyName: 'ACME',
      email: 'g@example.gr',
      address: 'Οδός 1',
      postalCode: '12345',
      region: 'Αττική',
      notes: 'σημ.',
      needsSummary: 'Βλάβη',
      intakeStatus: 'submitted',
    });
  });

  it('falls back through name → company → crm → Πελάτης for the display name', () => {
    expect(
      publicCustomer(customerRow({ name: null, company_name: null, crm_number: null })).displayName,
    ).toBe('Πελάτης');
    expect(publicCustomer(customerRow({ name: null })).displayName).toBe('ACME');
  });

  it('does not mask a short phone (<7 chars) and returns null when no phone', () => {
    expect(publicCustomer(customerRow({ phone: '12345' })).phoneMasked).toBe('12345');
    expect(
      publicCustomer(customerRow({ phone: null, mobile_phone: null, landline_phone: null })).phoneMasked,
    ).toBeNull();
  });

  it('defaults extras to null when omitted', () => {
    const result = publicCustomer(customerRow());
    expect(result.postalCode).toBeNull();
    expect(result.region).toBeNull();
  });
});

describe('publicBusiness (response mapping)', () => {
  it('returns null for a null row', () => {
    expect(publicBusiness(null)).toBeNull();
  });

  it('returns null when there is neither a name nor a logo', () => {
    expect(
      publicBusiness({ name: null, legal_name: null, trade_name: null, logo_url: null, phone: null, email: null, website: null }),
    ).toBeNull();
  });

  it('prefers trade_name → legal_name → name', () => {
    expect(
      publicBusiness({ name: 'N', legal_name: 'L', trade_name: 'T', logo_url: null, phone: null, email: null, website: null })?.name,
    ).toBe('T');
    expect(
      publicBusiness({ name: 'N', legal_name: 'L', trade_name: null, logo_url: null, phone: null, email: null, website: null })?.name,
    ).toBe('L');
  });

  it('falls back to "Η επιχείρηση" when only a logo is present', () => {
    expect(
      publicBusiness({ name: null, legal_name: null, trade_name: null, logo_url: 'https://x/logo.png', phone: null, email: null, website: null }),
    ).toEqual({ name: 'Η επιχείρηση', logoUrl: 'https://x/logo.png', phone: null, email: null, website: null });
  });
});

describe('submitIntake (validation — before any DB/push call)', () => {
  const resolved: ResolvedIntake = {
    tokenRow: {
      id: 'tok1',
      business_id: 'b1',
      customer_id: 'c1',
      token_hash: 'h',
      status: 'opened',
      sent_channel: 'viber',
      sent_to_phone: null,
      expires_at: '2026-07-01T00:00:00Z',
      opened_at: null,
      submitted_at: null,
      revoked_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    customer: customerRow(),
  };

  it('returns missing_name when neither firstName nor lastName is supplied', async () => {
    expect(await submitIntake(resolved, {})).toEqual({ kind: 'missing_name' });
  });

  it('treats whitespace-only names as missing', async () => {
    expect(await submitIntake(resolved, { firstName: '   ', lastName: '' })).toEqual({ kind: 'missing_name' });
  });
});
