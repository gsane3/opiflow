import { describe, it, expect } from 'vitest';
import {
  last10,
  isMissingTable,
  listExemptNumbers,
  upsertExemptNumbers,
  deleteExemptNumber,
} from '../exempt-numbers.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; upsert(v?: unknown, o?: unknown): FB;
  update(v?: unknown): FB; delete(): FB; eq(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeSupabase(resolve: (table: string) => Res): SupabaseServer {
  function from(table: string): FB {
    const rec = () => (): FB => b;
    const b: FB = {
      select: rec(), insert: rec(), upsert: rec(), update: rec(), delete: rec(),
      eq: rec(), order: rec(), then: (r) => r(resolve(table)),
    };
    return b;
  }
  return { from } as unknown as SupabaseServer;
}

describe('exempt-numbers helpers', () => {
  it('last10 keeps the last ten digits, dropping non-digits', () => {
    expect(last10('+30 210 123 4567')).toBe('2101234567');
    expect(last10('6900000000')).toBe('6900000000');
    expect(last10(null)).toBe('');
    expect(last10(12345)).toBe('');
  });
  it('isMissingTable detects the migration-060-absent error', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ message: 'relation "business_exempt_numbers" does not exist' })).toBe(true);
    expect(isMissingTable({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe('listExemptNumbers (parity)', () => {
  it('returns the rows on success', async () => {
    const ctx = fakeSupabase(() => ({ data: [{ phone: '2101234567', label: 'Σπίτι' }] }));
    expect(await listExemptNumbers(ctx, 'b1')).toEqual({ kind: 'ok', numbers: [{ phone: '2101234567', label: 'Σπίτι' }] });
  });
  it('reports missing_table on a relation-missing error', async () => {
    const ctx = fakeSupabase(() => ({ error: { code: '42P01' } }));
    expect(await listExemptNumbers(ctx, 'b1')).toEqual({ kind: 'missing_table' });
  });
  it('reports error on any other DB error', async () => {
    const ctx = fakeSupabase(() => ({ error: { code: '500', message: 'boom' } }));
    expect(await listExemptNumbers(ctx, 'b1')).toEqual({ kind: 'error' });
  });
});

describe('upsertExemptNumbers (parity)', () => {
  it('ok on success', async () => {
    const ctx = fakeSupabase(() => ({ error: null }));
    expect(await upsertExemptNumbers(ctx, [{ business_id: 'b1', phone: '2101234567', label: null }])).toEqual({ kind: 'ok' });
  });
  it('missing_table when the table is absent', async () => {
    const ctx = fakeSupabase(() => ({ error: { code: 'PGRST205' } }));
    expect(await upsertExemptNumbers(ctx, [{ business_id: 'b1', phone: '2101234567', label: null }])).toEqual({ kind: 'missing_table' });
  });
  it('error on any other DB error', async () => {
    const ctx = fakeSupabase(() => ({ error: { code: '23514', message: 'check' } }));
    expect(await upsertExemptNumbers(ctx, [{ business_id: 'b1', phone: '2101234567', label: null }])).toEqual({ kind: 'error' });
  });
});

describe('deleteExemptNumber (parity)', () => {
  it('ok on success', async () => {
    const ctx = fakeSupabase(() => ({ error: null }));
    expect(await deleteExemptNumber(ctx, 'b1', '2101234567')).toEqual({ kind: 'ok' });
  });
  it('missing_table when the table is absent', async () => {
    const ctx = fakeSupabase(() => ({ error: { message: 'business_exempt_numbers missing' } }));
    expect(await deleteExemptNumber(ctx, 'b1', '2101234567')).toEqual({ kind: 'missing_table' });
  });
  it('error on any other DB error', async () => {
    const ctx = fakeSupabase(() => ({ error: { code: '500' } }));
    expect(await deleteExemptNumber(ctx, 'b1', '2101234567')).toEqual({ kind: 'error' });
  });
});
