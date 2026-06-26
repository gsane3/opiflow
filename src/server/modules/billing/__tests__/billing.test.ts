import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the Stripe helpers thin AND hermetic: mock the lib so no real fetch / env
// is touched. The service must call them verbatim and map their result exactly.
vi.mock('../../../../lib/billing/stripe', () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  findCustomerIdByEmail: vi.fn(),
}));

import {
  createCheckoutSession,
  createPortalSession,
  findCustomerIdByEmail,
} from '../../../../lib/billing/stripe';
import { startCheckout, startPortal } from '../billing.service';
import type { SupabaseServer } from '../billing.repo';

const mockCheckout = createCheckoutSession as unknown as ReturnType<typeof vi.fn>;
const mockPortal = createPortalSession as unknown as ReturnType<typeof vi.fn>;
const mockFind = findCustomerIdByEmail as unknown as ReturnType<typeof vi.fn>;

// Fake supabase service client: auth.admin.getUserById + a from() that returns the
// (configurable) stored stripe_customer_id for the billing_subscriptions lookup.
function fakeSupabase(getUserById: () => unknown, storedCustomerId: string | null = null): SupabaseServer {
  return {
    auth: { admin: { getUserById: vi.fn(async () => getUserById()) } },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: storedCustomerId ? { stripe_customer_id: storedCustomerId } : null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseServer;
}

beforeEach(() => {
  mockCheckout.mockReset();
  mockPortal.mockReset();
  mockFind.mockReset();
});

describe('startCheckout (parity)', () => {
  it('returns ok with the session url and builds the success/cancel URLs', async () => {
    mockCheckout.mockResolvedValue({ ok: true, status: 200, data: { url: 'https://stripe/checkout' } });
    const res = await startCheckout({ priceId: 'price_1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'ok', url: 'https://stripe/checkout' });
    expect(mockCheckout).toHaveBeenCalledWith({
      priceId: 'price_1',
      businessId: 'b1',
      successUrl: 'https://app.test/settings?billing=success',
      cancelUrl: 'https://app.test/settings?billing=cancelled',
    });
  });

  it('returns checkout_failed when the helper is not ok', async () => {
    mockCheckout.mockResolvedValue({ ok: false, status: 502, data: {} });
    const res = await startCheckout({ priceId: 'price_1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'checkout_failed' });
  });

  it('returns checkout_failed when the session url is not a string', async () => {
    mockCheckout.mockResolvedValue({ ok: true, status: 200, data: { url: 123 } });
    const res = await startCheckout({ priceId: 'price_1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'checkout_failed' });
  });
});

describe('startPortal (parity + stored customer id)', () => {
  // No stored stripe_customer_id → falls back to the email path (legacy behaviour).
  const supabase = fakeSupabase(() => ({ data: { user: { email: 'owner@test.gr' } } }));

  it('PREFERS the stored stripe_customer_id and skips the email lookup', async () => {
    const withStored = fakeSupabase(() => ({ data: { user: { email: 'owner@test.gr' } } }), 'cus_stored');
    mockPortal.mockResolvedValue({ ok: true, status: 200, data: { url: 'https://stripe/portal' } });
    const res = await startPortal({ supabase: withStored, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'ok', url: 'https://stripe/portal' });
    expect(mockFind).not.toHaveBeenCalled(); // email lookup bypassed
    expect(mockPortal).toHaveBeenCalledWith({ customerId: 'cus_stored', returnUrl: 'https://app.test/settings' });
  });

  it('falls back to the email lookup when no stripe_customer_id is stored', async () => {
    mockFind.mockResolvedValue('cus_123');
    mockPortal.mockResolvedValue({ ok: true, status: 200, data: { url: 'https://stripe/portal' } });
    const res = await startPortal({ supabase, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'ok', url: 'https://stripe/portal' });
    expect(mockFind).toHaveBeenCalledWith('owner@test.gr');
    expect(mockPortal).toHaveBeenCalledWith({ customerId: 'cus_123', returnUrl: 'https://app.test/settings' });
  });

  it('returns no_email when there is no stored id AND the user has no email', async () => {
    const noEmail = fakeSupabase(() => ({ data: { user: { email: null } } }));
    const res = await startPortal({ supabase: noEmail, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'no_email' });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('returns no_email when the admin lookup throws (swallowed → null)', async () => {
    const boom = fakeSupabase(() => { throw new Error('boom'); });
    const res = await startPortal({ supabase: boom, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'no_email' });
  });

  it('returns no_customer when no stored id and no Stripe customer matches the email', async () => {
    mockFind.mockResolvedValue(null);
    const res = await startPortal({ supabase, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'no_customer' });
    expect(mockPortal).not.toHaveBeenCalled();
  });

  it('returns portal_failed when the portal session url is not a string', async () => {
    mockFind.mockResolvedValue('cus_123');
    mockPortal.mockResolvedValue({ ok: true, status: 200, data: { url: null } });
    const res = await startPortal({ supabase, userId: 'u1', businessId: 'b1', origin: 'https://app.test' });
    expect(res).toEqual({ kind: 'portal_failed' });
  });
});
