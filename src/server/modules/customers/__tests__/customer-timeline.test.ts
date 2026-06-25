import { describe, it, expect } from 'vitest';
import { buildCustomerTimeline } from '../customer-timeline';
import type { RepoContext } from '../customers.repo';

type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB;
  not(a?: unknown, b?: unknown, c?: unknown): FB; order(a?: unknown, b?: unknown): FB; limit(n?: number): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string) => Res, throwTables: string[] = []): RepoContext {
  function from(table: string): FB {
    if (throwTables.includes(table)) throw new Error(`boom on ${table}`);
    const rec = () => (): FB => b;
    const b: FB = {
      select: rec(), eq: rec(), in: rec(), not: rec(), order: rec(), limit: rec(),
      maybeSingle: rec(), then: (r) => r(resolve(table)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const custRow = { id: 'c1', name: 'Γιώργος', company_name: null, crm_number: '#1' };

describe('buildCustomerTimeline (parity)', () => {
  it('customer_not_found when the customer is missing/other-tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(buildCustomerTimeline(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });

  it('returns the customer + empty items when there is no activity', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: custRow } : { data: [] }));
    const result = await buildCustomerTimeline(ctx, 'c1');
    expect(result.customer).toEqual({ id: 'c1', name: 'Γιώργος' });
    expect(result.items).toEqual([]);
  });

  it('derives the display name (name → company → crm → fallback)', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: { id: 'c1', name: null, company_name: null, crm_number: null } } : { data: [] }));
    const result = await buildCustomerTimeline(ctx, 'c1');
    expect(result.customer.name).toBe('Πελάτης');
  });

  it('builds one item per communication (oldest→newest)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: custRow };
      if (t === 'communications') return { data: [
        { id: 'm1', channel: 'sms', direction: 'inbound', status: 'received', summary: 'Γεια', created_at: '2026-06-01T10:00:00Z' },
        { id: 'k1', channel: 'call', direction: 'inbound', status: 'missed', summary: null, created_at: '2026-06-02T10:00:00Z' },
      ] };
      return { data: [] };
    });
    const result = await buildCustomerTimeline(ctx, 'c1');
    expect(result.items.map((i) => i.id)).toEqual(['msg:m1', 'call:k1']);
    expect(result.items[1].title).toBe('Αναπάντητη κλήση');
    expect(result.items[0].side).toBe('customer');
  });

  it('timeline_query_failed when a source query throws', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: custRow } : { data: [] }), ['communications']);
    await expect(buildCustomerTimeline(ctx, 'c1')).rejects.toMatchObject({ code: 'timeline_query_failed', status: 500 });
  });
});
