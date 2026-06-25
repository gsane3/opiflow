import { describe, it, expect } from 'vitest';
import { getOffer, updateOffer, deleteOffer } from '../offers.service';
import type { OfferRow, OfferItemRow } from '../offers.types';
import type { RepoContext } from '../offers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; delete(): FB; insert(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), delete: rec('delete'), insert: rec('insert'),
      eq: rec('eq'), in: rec('in'), order: rec('order'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const offerRow: OfferRow = {
  id: 'o1', business_id: 'b1', customer_id: null, related_task_id: null, related_call_id: null,
  offer_number: 'OFFER-1-2026', status: 'draft', offer_date: '2026-06-01', valid_until: null,
  subtotal: 100, vat_rate: 24, vat_amount: 24, total: 124, notes: null, terms: null,
  acceptance_text: null, viber_draft: null, email_subject: null, email_body: null,
  created_from_ai: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const itemRow: OfferItemRow = {
  id: 'i1', business_id: 'b1', offer_id: 'o1', description: 'Εργασία', quantity: 1,
  unit_price: 100, line_total: 100, sort_order: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const hasUpdateOp = (ops: Op[]) => ops.some((o) => o.m === 'update');

describe('getOffer (parity)', () => {
  it('offer_not_found when no row', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: null } : { data: [] }));
    await expect(getOffer(ctx, 'o1')).rejects.toMatchObject({ code: 'offer_not_found', status: 404 });
  });
  it('offer_query_failed on db error', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { error: { message: 'boom' } } : { data: [] }));
    await expect(getOffer(ctx, 'o1')).rejects.toMatchObject({ code: 'offer_query_failed', status: 500 });
  });
  it('returns the offer with its items', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: offerRow } : { data: [itemRow] }));
    const offer = await getOffer(ctx, 'o1');
    expect(offer.id).toBe('o1');
    expect(offer.items).toHaveLength(1);
    expect(offer.items[0].unitPrice).toBe(100);
  });
});

describe('updateOffer (parity)', () => {
  it('offer_not_found when the offer is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: null } : { data: [] }));
    await expect(updateOffer(ctx, 'o1', { notes: 'x' })).rejects.toMatchObject({ code: 'offer_not_found', status: 404 });
  });
  it('invalid_status', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: offerRow } : { data: [] }));
    await expect(updateOffer(ctx, 'o1', { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });
  it('customer_not_found for a cross-tenant customer', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'offers' && !hasUpdateOp(ops)) return { data: offerRow };
      if (t === 'customers') return { data: null };
      return { data: [] };
    });
    await expect(updateOffer(ctx, 'o1', { customerId: 'c9' })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('task_not_found for a cross-tenant related task', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'offers' && !hasUpdateOp(ops)) return { data: offerRow };
      if (t === 'tasks') return { data: null };
      return { data: [] };
    });
    await expect(updateOffer(ctx, 'o1', { relatedTaskId: 't9' })).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
  });
  it('returns the existing offer unchanged when no allowed field is supplied', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: offerRow } : { data: [itemRow] }));
    const offer = await updateOffer(ctx, 'o1', {});
    expect(offer.id).toBe('o1');
    expect(offer.items).toHaveLength(1);
  });
  it('updates a scalar field and returns the offer', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'offers') return { data: hasUpdateOp(ops) ? { ...offerRow, notes: 'Νέο' } : offerRow };
      return { data: [itemRow] };
    });
    const offer = await updateOffer(ctx, 'o1', { notes: 'Νέο' });
    expect(offer.notes).toBe('Νέο');
  });
});

describe('deleteOffer (parity guards)', () => {
  it('offer_not_found when the offer is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: null } : { data: [] }));
    await expect(deleteOffer(ctx, 'o1')).rejects.toMatchObject({ code: 'offer_not_found', status: 404 });
  });
  it('offer_delete_failed when the existence check errors', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { error: { message: 'boom' } } : { data: [] }));
    await expect(deleteOffer(ctx, 'o1')).rejects.toMatchObject({ code: 'offer_delete_failed', status: 500 });
  });
});
