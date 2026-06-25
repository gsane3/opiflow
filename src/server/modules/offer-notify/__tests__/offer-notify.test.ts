import { describe, it, expect } from 'vitest';
import { notifyOffer, type OfferNotifyDeps } from '../offer-notify.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB; is(a?: unknown, b?: unknown): FB; gt(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeClient(resolve: (table: string, ops: Op[]) => Res): SupabaseClient {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), eq: rec('eq'), in: rec('in'),
      is: rec('is'), gt: rec('gt'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { from } as unknown as SupabaseClient;
}

const OFFER = { id: 'o1', business_id: 'b1', customer_id: 'c1', offer_number: 'ΠΡ-1', status: 'draft', total: 120 };
const CUSTOMER = { id: 'c1', mobile_phone: '6900000000', phone: null, preferred_contact_method: 'viber' };

function baseDeps(over: Partial<OfferNotifyDeps> = {}): OfferNotifyDeps {
  return {
    selectViberPhone: (c) => c.mobile_phone ?? c.phone ?? null,
    normalizeApifonMsisdn: () => '306900000000',
    sendViaPreferredChannel: async () => ({ ok: true, channel: 'viber', viber: { requestId: 'rq1', messageId: 'mg1' }, fallbackApplied: false }),
    recordOutboundMessage: async () => {},
    createOfferResponseToken: async () => ({ responseUrl: 'https://opiflow.app/offer-response/RAWTOKEN' }),
    hashOfferResponseToken: (t) => `hash:${t}`,
    buildOfferResponseUrl: (t) => `https://opiflow.app/offer-response/${t}`,
    markOfferResponseTokenSent: async () => {},
    ...over,
  };
}

describe('notifyOffer (parity)', () => {
  it('offer_not_found (404) when the offer is missing', async () => {
    const c = fakeClient((t) => (t === 'offers' ? { data: null } : { error: null }));
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'draft', raw: {} }, baseDeps());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'offer_not_found' });
  });

  it('offer_notify_failed (500) when the offer query errors', async () => {
    const c = fakeClient((t) => (t === 'offers' ? { error: { message: 'boom' } } : { error: null }));
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'draft', raw: {} }, baseDeps());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'offer_notify_failed' });
  });

  it('draft mode → returns responseUrl + message + recipient, sent:false', async () => {
    const c = fakeClient((t, ops) => {
      if (t === 'offers') return { data: OFFER };
      if (t === 'offer_response_tokens') return { error: null };
      if (t === 'customers' && ops.some((o) => o.m === 'select')) return { data: CUSTOMER };
      return { error: null };
    });
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'draft', raw: {} }, baseDeps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      mode: 'draft',
      responseUrl: 'https://opiflow.app/offer-response/RAWTOKEN',
      message: 'Γεια σας. Σας αποστέλλουμε την προσφορά μας ΠΡ-1. Για να την αποδεχτείτε ή απορρίψετε, επισκεφθείτε: https://opiflow.app/offer-response/RAWTOKEN',
      recipient: '6900000000',
      sent: false,
    });
  });

  it('send mode with no customer → fallback_required / missing_customer', async () => {
    const c = fakeClient((t) => {
      if (t === 'offers') return { data: { ...OFFER, customer_id: null } };
      return { error: null };
    });
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'send', raw: {} }, baseDeps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(false);
    expect(body.status).toBe('fallback_required');
    expect(body.reason).toBe('missing_customer');
  });

  it('send mode success → sent:true with provider ids', async () => {
    const c = fakeClient((t, ops) => {
      if (t === 'offers' && ops.some((o) => o.m === 'select')) return { data: OFFER };
      if (t === 'offer_response_tokens') return { error: null };
      if (t === 'customers' && ops.some((o) => o.m === 'select')) return { data: CUSTOMER };
      return { error: null };
    });
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'send', raw: {} }, baseDeps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      sent: true,
      channel: 'viber',
      status: 'sent',
      reason: null,
      requestId: 'rq1',
      messageId: 'mg1',
    });
  });

  it('send mode provider failure → fallback_required / provider_failed', async () => {
    const c = fakeClient((t, ops) => {
      if (t === 'offers' && ops.some((o) => o.m === 'select')) return { data: OFFER };
      if (t === 'offer_response_tokens') return { error: null };
      if (t === 'customers' && ops.some((o) => o.m === 'select')) return { data: CUSTOMER };
      return { error: null };
    });
    const deps = baseDeps({
      sendViaPreferredChannel: async () => ({ ok: false, channel: 'none', fallbackApplied: false, reason: 'send_error' }),
    });
    const res = await notifyOffer({ supabase: c, serviceClient: c, businessId: 'b1', offerId: 'o1', mode: 'send', raw: {} }, deps);
    const body = await res.json();
    expect(body.sent).toBe(false);
    expect(body.status).toBe('fallback_required');
    expect(body.reason).toBe('provider_failed');
    expect(body.channel).toBe('none');
  });
});
