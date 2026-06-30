import { describe, it, expect, vi, afterEach } from 'vitest';
import { isInvoicingAddonConfigured, applyAddonSubscriptionEvent } from '../invoicing-addon.service';
import { createCheckoutSession } from '../../../../lib/billing/stripe';

// ── env gating ──────────────────────────────────────────────────────────────
describe('isInvoicingAddonConfigured', () => {
  const saved = { sk: process.env.STRIPE_SECRET_KEY, price: process.env.STRIPE_INVOICING_PRICE_ID };
  afterEach(() => {
    if (saved.sk === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved.sk;
    if (saved.price === undefined) delete process.env.STRIPE_INVOICING_PRICE_ID; else process.env.STRIPE_INVOICING_PRICE_ID = saved.price;
  });
  it('is false unless BOTH the Stripe key and the add-on price id are set', () => {
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_INVOICING_PRICE_ID;
    expect(isInvoicingAddonConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    expect(isInvoicingAddonConfigured()).toBe(false);
    process.env.STRIPE_INVOICING_PRICE_ID = 'price_x';
    expect(isInvoicingAddonConfigured()).toBe(true);
  });
});

// ── createCheckoutSession stamps the kind discriminator ───────────────────────
describe('createCheckoutSession — kind metadata', () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved;
  });
  async function captureBody(opts: Parameters<typeof createCheckoutSession>[0]): Promise<string> {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      body = init.body;
      return { ok: true, status: 200, json: async () => ({ url: 'https://checkout' }) } as never;
    }));
    await createCheckoutSession(opts);
    return body;
  }
  const base = { priceId: 'price_x', businessId: 'biz1', successUrl: 's', cancelUrl: 'c' };

  it('stamps metadata[kind] on the session AND the subscription when kind is given', async () => {
    const body = await captureBody({ ...base, kind: 'invoicing_addon' });
    const p = new URLSearchParams(body);
    expect(p.get('metadata[kind]')).toBe('invoicing_addon');
    expect(p.get('subscription_data[metadata][kind]')).toBe('invoicing_addon');
    expect(p.get('metadata[businessId]')).toBe('biz1');
  });
  it('omits the kind keys entirely for a normal plan checkout (byte-identical)', async () => {
    const body = await captureBody(base);
    const p = new URLSearchParams(body);
    expect(p.has('metadata[kind]')).toBe(false);
    expect(p.has('subscription_data[metadata][kind]')).toBe(false);
  });
});

// ── webhook handler: applyAddonSubscriptionEvent ──────────────────────────────
// Minimal in-memory fake for business_invoicing_settings (select id / insert / update).
function makeFake(store: Record<string, unknown>[], opts: { errorCode?: string } = {}) {
  function build() {
    const st: { op: string; values: Record<string, unknown> | null; filters: [string, unknown][] } = { op: 'select', values: null, filters: [] };
    let ran = false, cached: unknown;
    const match = (r: Record<string, unknown>) => st.filters.every(([c, v]) => r[c] === v);
    const run = () => {
      if (ran) return cached; ran = true;
      if (opts.errorCode) { cached = { data: null, error: { code: opts.errorCode, message: 'column "addon_status" does not exist' } }; return cached; }
      if (st.op === 'insert') { const row = { id: `id${store.length + 1}`, ...st.values }; store.push(row); cached = { data: row, error: null }; }
      else if (st.op === 'update') { const hit = store.filter(match); hit.forEach((r) => Object.assign(r, st.values)); cached = { data: hit[0] ?? null, error: null }; }
      else { const hit = store.filter(match); cached = { data: hit[0] ?? null, error: null }; }
      return cached;
    };
    const api: Record<string, unknown> = {
      select: () => api, insert: (v: Record<string, unknown>) => { st.op = 'insert'; st.values = v; return api; },
      update: (v: Record<string, unknown>) => { st.op = 'update'; st.values = v; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      maybeSingle: () => api, single: () => api,
      then: (resolve: (r: unknown) => void) => resolve(run()),
    };
    return api;
  }
  return { from: () => build() } as never;
}

const ev = (type: string, object: Record<string, unknown>) => ({ type, data: { object } });

describe('applyAddonSubscriptionEvent', () => {
  it('checkout.session.completed → addon_status active (+ subscription id), row created', async () => {
    const store: Record<string, unknown>[] = [];
    const ok = await applyAddonSubscriptionEvent(makeFake(store), ev('checkout.session.completed', { subscription: 'sub_1', customer: 'cus_1' }), 'biz1');
    expect(ok).toBe(true);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ business_id: 'biz1', addon_status: 'active', addon_subscription_id: 'sub_1' });
  });

  it('customer.subscription.deleted → addon_status cancelled on the existing row', async () => {
    const store: Record<string, unknown>[] = [{ id: 'id1', business_id: 'biz1', addon_status: 'active', addon_subscription_id: 'sub_1' }];
    const ok = await applyAddonSubscriptionEvent(makeFake(store), ev('customer.subscription.deleted', { id: 'sub_1' }), 'biz1');
    expect(ok).toBe(true);
    expect(store[0].addon_status).toBe('cancelled');
  });

  it('subscription.updated past_due → no-op, acknowledged', async () => {
    const store: Record<string, unknown>[] = [{ id: 'id1', business_id: 'biz1', addon_status: 'active' }];
    const ok = await applyAddonSubscriptionEvent(makeFake(store), ev('customer.subscription.updated', { id: 'sub_1', status: 'past_due' }), 'biz1');
    expect(ok).toBe(true);
    expect(store[0].addon_status).toBe('active'); // unchanged
  });

  it('a pre-068 schema (missing column) is ACKNOWLEDGED (true), never an infinite Stripe retry', async () => {
    const ok = await applyAddonSubscriptionEvent(makeFake([], { errorCode: '42703' }), ev('checkout.session.completed', { subscription: 'sub_1' }), 'biz1');
    expect(ok).toBe(true);
  });
});
