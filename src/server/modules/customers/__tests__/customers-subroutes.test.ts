import { describe, it, expect } from 'vitest';
import { pinCustomer, getCustomerOffersSummary } from '../customers.service';
import type { RepoContext } from '../customers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  update(v?: unknown): FB; select(c?: string): FB; eq(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB; limit(n?: number): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      update: rec('update'), select: rec('select'), eq: rec('eq'), order: rec('order'), limit: rec('limit'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('pinCustomer (parity)', () => {
  it('returns true when the update succeeds', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    expect(await pinCustomer(ctx, 'c1', true)).toBe(true);
  });
  it('returns false when the pinned column is missing (pre-044)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42703' } }));
    expect(await pinCustomer(ctx, 'c1', true)).toBe(false);
  });
});

describe('getCustomerOffersSummary (parity)', () => {
  it('offers_summary_failed on db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(getCustomerOffersSummary(ctx, 'c1')).rejects.toMatchObject({ code: 'offers_summary_failed', status: 500 });
  });
  it('aggregates count/total/accepted/pending + latest', async () => {
    const ctx = fakeCtx(() => ({ data: [
      { id: 'o3', status: 'accepted', total: 100, offer_date: '2026-06-03', created_at: '2026-06-03T00:00:00Z' },
      { id: 'o2', status: 'draft', total: 50, offer_date: '2026-06-02', created_at: '2026-06-02T00:00:00Z' },
      { id: 'o1', status: 'rejected', total: null, offer_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z' },
    ] }));
    const s = await getCustomerOffersSummary(ctx, 'c1');
    expect(s).toEqual({
      offerCount: 3, totalValue: 150, acceptedCount: 1, pendingCount: 1,
      latestStatus: 'accepted', latestOfferDate: '2026-06-03',
    });
  });
});
