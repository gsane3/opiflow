import { describe, it, expect } from 'vitest';
import { AppError } from '../../../core/errors';
import {
  patchStr,
  cleanText,
  normalizeIban,
  isValidIban,
  getBusinessMe,
  updateBusinessMe,
  getBank,
  updateBank,
} from '../businesses.service';

// --- hermetic supabase fake -------------------------------------------------
// from(table) returns a thenable query builder that records ops and resolves
// from `resolve(table, ops)`; every chain method returns the same builder.
type Resolver = (table: string, ops: Array<[string, unknown[]]>) => { data: unknown; error: unknown };

function fakeSupabase(resolve: Resolver) {
  function makeBuilder(table: string) {
    const ops: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      ops.push([name, args]);
      return builder;
    };
    for (const m of [
      'select', 'eq', 'in', 'is', 'or', 'not', 'order', 'range', 'limit',
      'update', 'insert', 'delete', 'upsert',
    ]) {
      builder[m] = chain(m);
    }
    builder.single = () => Promise.resolve(resolve(table, ops));
    builder.maybeSingle = () => Promise.resolve(resolve(table, ops));
    builder.then = (cb: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(cb(resolve(table, ops)));
    return builder;
  }
  return { from: (table: string) => makeBuilder(table) } as never;
}

describe('businesses helpers', () => {
  it('patchStr trims and nulls empties', () => {
    expect(patchStr('  hi ')).toBe('hi');
    expect(patchStr('   ')).toBeNull();
    expect(patchStr(5)).toBeNull();
  });

  it('cleanText caps at 200 chars', () => {
    expect(cleanText('  a  ')).toBe('a');
    expect(cleanText('')).toBeNull();
    expect((cleanText('x'.repeat(250)) as string).length).toBe(200);
  });

  it('normalizeIban strips spaces + upper-cases', () => {
    expect(normalizeIban(' gr16 0110 ')).toBe('GR160110');
    expect(normalizeIban('   ')).toBeNull();
  });

  it('isValidIban loose structural check', () => {
    expect(isValidIban('GR1601101250000000012300695')).toBe(true);
    expect(isValidIban('XX1')).toBe(false);
  });
});

describe('getBusinessMe', () => {
  it('throws business_not_found when missing', async () => {
    const sb = fakeSupabase((table) =>
      table === 'businesses' ? { data: null, error: null } : { data: null, error: null },
    );
    await expect(getBusinessMe(sb, 'biz1')).rejects.toMatchObject({
      code: 'business_not_found',
      status: 404,
    });
  });

  it('maps business_query_failed on DB error', async () => {
    const sb = fakeSupabase((table) =>
      table === 'businesses'
        ? { data: null, error: { code: 'X', message: 'boom' } }
        : { data: null, error: null },
    );
    await expect(getBusinessMe(sb, 'biz1')).rejects.toMatchObject({
      code: 'business_query_failed',
      status: 500,
    });
  });

  it('builds the full payload (key order + computed fields)', async () => {
    const sb = fakeSupabase((table) => {
      if (table === 'businesses') {
        return { data: { id: 'biz1', business_phone_number: '+302100000000' }, error: null };
      }
      if (table === 'business_subscriptions') {
        return { data: { plan_key: 'pro', status: 'active', trial_ends_at: null }, error: null };
      }
      if (table === 'phone_number_requests') {
        return { data: { status: 'pending', requested_city: 'Αθήνα', created_at: '2026-01-01T00:00:00Z' }, error: null };
      }
      return { data: null, error: null };
    });
    const r = await getBusinessMe(sb, 'biz1');
    expect(r.phoneAssigned).toBe(true);
    expect(r.activationAllowed).toBe(true);
    expect(r.subscription).toEqual({ plan_key: 'pro', status: 'active', trial_ends_at: null });
    expect(r.numberRequest).toEqual({ status: 'pending', requestedCity: 'Αθήνα', createdAt: '2026-01-01T00:00:00Z' });
  });
});

describe('updateBusinessMe validation', () => {
  const sb = fakeSupabase(() => ({ data: null, error: null }));

  it('rejects a blank name', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: '  ' })).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
  });

  it('rejects an unknown type', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'nope', preferred_contact_method: 'phone' }))
      .rejects.toMatchObject({ code: 'invalid_type', status: 400 });
  });

  it('rejects an unknown contact method', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'fax' }))
      .rejects.toMatchObject({ code: 'invalid_contact_method', status: 400 });
  });

  it('rejects an out-of-range vat rate', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone', default_vat_rate: 200 }))
      .rejects.toMatchObject({ code: 'invalid_vat_rate', status: 400 });
  });

  it('rejects a malformed postal code', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone', postal_code: '12' }))
      .rejects.toMatchObject({ code: 'invalid_postal_code', status: 400 });
  });

  it('rejects a non-http website', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone', website: 'ftp://x' }))
      .rejects.toMatchObject({ code: 'invalid_website', status: 400 });
  });

  it('rejects an oversized logo', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(300_001);
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone', logoDataUrl: big }))
      .rejects.toMatchObject({ code: 'logo_too_large', status: 400 });
  });

  it('rejects an invalid logo data url', async () => {
    await expect(updateBusinessMe(sb, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone', logoDataUrl: 'notaurl' }))
      .rejects.toMatchObject({ code: 'invalid_logo', status: 400 });
  });

  it('throws business_not_found when the user owns no business', async () => {
    const noBiz = fakeSupabase(() => ({ data: null, error: null }));
    await expect(updateBusinessMe(noBiz, 'u1', { name: 'A', type: 'other', preferred_contact_method: 'phone' }))
      .rejects.toMatchObject({ code: 'business_not_found', status: 404 });
  });
});

describe('getBank (tolerant)', () => {
  it('returns nulls when the columns are absent (error)', async () => {
    const sb = fakeSupabase(() => ({ data: null, error: { code: '42703' } }));
    await expect(getBank(sb, 'biz1')).resolves.toEqual({ beneficiary: null, bank: null, iban: null });
  });

  it('maps present columns', async () => {
    const sb = fakeSupabase(() => ({
      data: { bank_beneficiary: 'Acme', bank_name: 'Alpha', bank_iban: 'GR16' },
      error: null,
    }));
    await expect(getBank(sb, 'biz1')).resolves.toEqual({ beneficiary: 'Acme', bank: 'Alpha', iban: 'GR16' });
  });
});

describe('updateBank validation', () => {
  it('rejects a structurally invalid IBAN before any side effect', async () => {
    await expect(updateBank('biz1', { iban: 'XX1' })).rejects.toMatchObject({ code: 'invalid_iban', status: 400 });
  });

  it('AppError instance for invalid IBAN', async () => {
    await expect(updateBank('biz1', { iban: 'XX1' })).rejects.toBeInstanceOf(AppError);
  });
});
