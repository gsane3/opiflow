import { describe, it, expect, vi } from 'vitest';
import {
  loadOfferResponse,
  respondToOffer,
} from '../public-offer-response.service';
import type { RepoContext } from '../public-offer-response.repo';

// ---------------------------------------------------------------------------
// Fake service-role supabase client. Each query chain (.select().eq()...maybeSingle()
// / .order()) is a thenable that resolves the per-table { data, error } we configure.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB;
  eq(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string) => Res): RepoContext {
  function from(table: string): FB {
    const rec = () => (): FB => b;
    const b: FB = {
      select: rec(),
      eq: rec(),
      order: rec(),
      maybeSingle: rec(),
      then: (r) => r(resolve(table)),
    };
    return b;
  }
  return { supabase: { from } as unknown as RepoContext['supabase'], businessId: 'b1' };
}

const offerRow = {
  id: 'o1',
  business_id: 'b1',
  customer_id: 'c1',
  offer_number: 'P-001',
  status: 'sent',
  offer_date: '2026-06-20',
  valid_until: '2099-12-31',
  subtotal: 100,
  vat_rate: 24,
  vat_amount: 24,
  total: 124,
  notes: null,
  terms: null,
  acceptance_text: null,
  updated_at: '2026-06-20T00:00:00Z',
};

const tokenRow = { id: 'tok1', business_id: 'b1', offer_id: 'o1', status: 'opened' };

// ---------------------------------------------------------------------------
// GET — loadOfferResponse
// ---------------------------------------------------------------------------

describe('loadOfferResponse (GET parity)', () => {
  it('returns the full public payload on success (canRespond computed from real helper)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'offers') return { data: offerRow };
      if (t === 'offer_items') return { data: [{ description: 'X', quantity: 2, unit_price: 50, line_total: 100, sort_order: 0 }] };
      if (t === 'businesses') return { data: { name: 'Acme', phone: null, email: null, address: null, vat_number: null, logo_url: null, legal_name: null, trade_name: null, address_line1: null, address_line2: null, postal_code: null, city: null, region: null, tax_office: null, website: null } };
      if (t === 'customers') return { data: { name: 'Cust', company_name: null, email: null, address: null } };
      return { data: null };
    });
    const markOpened = vi.fn(async () => {});
    const result = await loadOfferResponse(ctx, tokenRow, { markOpened });
    expect(result).toEqual({
      ok: true,
      body: {
        ok: true,
        tokenStatus: 'opened',
        offer: {
          offerNumber: 'P-001',
          status: 'sent',
          offerDate: '2026-06-20',
          validUntil: '2099-12-31',
          items: [{ description: 'X', quantity: 2, unitPrice: 50, lineTotal: 100, sortOrder: 0 }],
          subtotal: 100,
          vatRate: 24,
          vatAmount: 24,
          total: 124,
          notes: null,
          terms: null,
          acceptanceText: null,
        },
        business: {
          name: 'Acme', phone: null, email: null, address: null, vatNumber: null, logoUrl: null,
          legalName: null, tradeName: null, addressLine1: null, addressLine2: null,
          postalCode: null, city: null, region: null, taxOffice: null, website: null,
        },
        customer: { name: 'Cust', companyName: null, email: null, address: null },
        canRespond: true,
      },
    });
    expect(markOpened).toHaveBeenCalledWith('tok1');
  });

  it('offer_response_link_invalid_or_expired (404) when the offer is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: null } : { data: null }));
    const result = await loadOfferResponse(ctx, tokenRow, { markOpened: vi.fn(async () => {}) });
    expect(result).toEqual({ ok: false, error: 'offer_response_link_invalid_or_expired', status: 404 });
  });

  it('offer_response_load_failed (500) on offer DB error', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { error: { message: 'db down' } } : { data: null }));
    const result = await loadOfferResponse(ctx, tokenRow, { markOpened: vi.fn(async () => {}) });
    expect(result).toEqual({ ok: false, error: 'offer_response_load_failed', status: 500 });
  });

  it('offer_response_load_failed (500) on items DB error', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'offers') return { data: offerRow };
      if (t === 'offer_items') return { error: { message: 'boom' } };
      return { data: null };
    });
    const result = await loadOfferResponse(ctx, tokenRow, { markOpened: vi.fn(async () => {}) });
    expect(result).toEqual({ ok: false, error: 'offer_response_load_failed', status: 500 });
  });

  it('swallows a markOpened throw and still returns the payload', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'offers') return { data: { ...offerRow, customer_id: null } };
      if (t === 'offer_items') return { data: [] };
      if (t === 'businesses') return { data: null };
      return { data: null };
    });
    const markOpened = vi.fn(async () => { throw new Error('opened fail'); });
    const result = await loadOfferResponse(ctx, tokenRow, { markOpened });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.business).toBeNull();
      expect(result.body.customer).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// POST — respondToOffer
// ---------------------------------------------------------------------------

const respondTokenRow = { id: 'tok1', business_id: 'b1', offer_id: 'o1', sent_channel: 'email' as const };

describe('respondToOffer (POST parity)', () => {
  it('maps a successful applyOfferResponse result into the response body', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: offerRow } : { data: null }));
    const apply = vi.fn(async () => ({ ok: true, httpStatus: 200, offerNumber: 'P-001', status: 'accepted', total: 124 }));
    const result = await respondToOffer(
      ctx,
      respondTokenRow,
      { response: 'accepted', comment: 'ok' },
      { applyOfferResponse: apply as unknown as Parameters<typeof respondToOffer>[3]['applyOfferResponse'] },
    );
    expect(result).toEqual({
      ok: true,
      body: { ok: true, response: 'accepted', offer: { offerNumber: 'P-001', status: 'accepted', total: 124 } },
    });
    expect(apply).toHaveBeenCalledWith({
      supabase: ctx.supabase,
      businessId: 'b1',
      offer: offerRow,
      response: 'accepted',
      comment: 'ok',
      sentChannel: 'email',
      tokenId: 'tok1',
    });
  });

  it('offer_not_found (404) when the offer is missing', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    const apply = vi.fn();
    const result = await respondToOffer(
      ctx,
      respondTokenRow,
      { response: 'rejected', comment: null },
      { applyOfferResponse: apply as unknown as Parameters<typeof respondToOffer>[3]['applyOfferResponse'] },
    );
    expect(result).toEqual({ ok: false, error: 'offer_not_found', status: 404 });
    expect(apply).not.toHaveBeenCalled();
  });

  it('offer_response_load_failed (500) on offer DB error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'db down' } }));
    const result = await respondToOffer(
      ctx,
      respondTokenRow,
      { response: 'accepted', comment: null },
      { applyOfferResponse: (vi.fn() as unknown) as Parameters<typeof respondToOffer>[3]['applyOfferResponse'] },
    );
    expect(result).toEqual({ ok: false, error: 'offer_response_load_failed', status: 500 });
  });

  it('passes through the applyOfferResponse failure code + httpStatus verbatim', async () => {
    const ctx = fakeCtx((t) => (t === 'offers' ? { data: offerRow } : { data: null }));
    const apply = vi.fn(async () => ({ ok: false, httpStatus: 409, error: 'offer_already_final' }));
    const result = await respondToOffer(
      ctx,
      respondTokenRow,
      { response: 'accepted', comment: null },
      { applyOfferResponse: apply as unknown as Parameters<typeof respondToOffer>[3]['applyOfferResponse'] },
    );
    expect(result).toEqual({ ok: false, error: 'offer_already_final', status: 409 });
  });
});
