import { describe, it, expect, vi } from 'vitest';
import { createOffer, listOffers } from '../offers.service';
import type { OfferItemRow, OfferRow } from '../offers.types';
import type { RepoContext } from '../offers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB; not(a?: unknown, b?: unknown, c?: unknown): FB;
  order(a?: unknown, b?: unknown): FB; range(a?: number, b?: number): FB; delete(): FB;
  single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(
  resolve: (table: string, ops: Op[]) => Res,
  rpcResolve: () => Res = () => ({ data: null }),
): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), eq: rec('eq'), in: rec('in'), not: rec('not'),
      order: rec('order'), range: rec('range'), delete: rec('delete'), single: rec('single'),
      maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  const rpc = () => ({ then: (r: (x: Res) => unknown) => r(rpcResolve()) });
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from, rpc } as unknown as RepoContext['supabase'] };
}

const validItems = [{ description: 'Εργασία', quantity: 1, unitPrice: 100 }];
const offerRow: OfferRow = {
  id: 'o1', business_id: 'b1', customer_id: null, related_task_id: null, related_call_id: null,
  offer_number: 'OFFER-7-2026', status: 'draft', offer_date: '2026-06-01', valid_until: null,
  subtotal: 100, vat_rate: 24, vat_amount: 24, total: 124, notes: null, terms: null,
  acceptance_text: null, viber_draft: null, email_subject: null, email_body: null,
  created_from_ai: false, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
};
const itemRow: OfferItemRow = {
  id: 'i1', business_id: 'b1', offer_id: 'o1', description: 'Εργασία', quantity: 1,
  unit_price: 100, line_total: 100, sort_order: 0, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
};

describe('createOffer (parity validation)', () => {
  it('invalid_items when items are missing/invalid', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(createOffer(ctx, {})).rejects.toMatchObject({ code: 'invalid_items', status: 400 });
  });
  it('invalid_status', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(createOffer(ctx, { items: validItems, status: 'paid' })).rejects.toMatchObject({ code: 'invalid_status' });
  });
  it('invalid_vat_rate', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(createOffer(ctx, { items: validItems, vatRate: 200 })).rejects.toMatchObject({ code: 'invalid_vat_rate' });
  });
  it('customer_not_found', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(createOffer(ctx, { items: validItems, customerId: 'c1' })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
});

describe('createOffer (folder DI + happy path)', () => {
  it('throws the folder resolver error', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(
      createOffer(ctx, { items: validItems }, { resolveWorkFolder: async () => ({ ok: false, error: 'folder_not_found', status: 404 }) }),
    ).rejects.toMatchObject({ code: 'folder_not_found' });
  });

  it('inserts offer + items, notifies, and maps', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'offers' && ops.some((o) => o.m === 'insert')) return { data: offerRow };
      if (t === 'offer_items' && ops.some((o) => o.m === 'insert')) return { data: [itemRow] };
      return { data: null };
    }, () => ({ data: 7 }));
    const notify = vi.fn();
    const offer = await createOffer(ctx, { items: validItems }, {
      resolveWorkFolder: async () => ({ ok: true, workFolderId: 'f1' }),
      notifyFolderUpdate: notify,
    });
    expect(offer.id).toBe('o1');
    expect(offer.items).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('f1', 'νέα προσφορά');
  });
});

describe('listOffers (parity)', () => {
  it('rejects an invalid status', async () => {
    const ctx = fakeCtx(() => ({ data: [] }));
    await expect(listOffers(ctx, { status: 'paid' })).rejects.toMatchObject({ code: 'invalid_status' });
  });
  it('lists offers with their items', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'offers') return { data: [offerRow] };
      if (t === 'offer_items') return { data: [itemRow] };
      return { data: null };
    });
    const offers = await listOffers(ctx, {});
    expect(offers).toHaveLength(1);
    expect(offers[0].items).toHaveLength(1);
  });
});
