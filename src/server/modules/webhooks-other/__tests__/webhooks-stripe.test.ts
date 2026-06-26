import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repo so we can assert exactly what applyStripeEvent persists, without a DB.
vi.mock('../webhooks-other.repo', () => ({
  applySubscription: vi.fn(),
  applySubscriptionExtras: vi.fn(),
  findProviderEventId: vi.fn(),
  findViberMessageRow: vi.fn(),
  insertProviderEvent: vi.fn(),
  markProviderEventProcessed: vi.fn(),
  updateCommunicationStatus: vi.fn(),
  updateViberMessage: vi.fn(),
}));

import { applyStripeEvent } from '../webhooks-other.service';
import { applySubscription, applySubscriptionExtras } from '../webhooks-other.repo';

const mockApply = applySubscription as unknown as ReturnType<typeof vi.fn>;
const mockExtras = applySubscriptionExtras as unknown as ReturnType<typeof vi.fn>;
const supabase = {} as never;

beforeEach(() => {
  mockApply.mockReset().mockResolvedValue(true);
  mockExtras.mockReset().mockResolvedValue(undefined);
});

describe('applyStripeEvent — persists the Stripe linkage', () => {
  it('checkout.session.completed stores stripe_customer_id + stripe_subscription_id (the reliable portal key)', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_X', subscription: 'sub_Y' } },
    };
    const ok = await applyStripeEvent(supabase, event, 'biz1', 'pro');
    expect(ok).toBe(true);
    const fields = mockApply.mock.calls[0][3] as Record<string, unknown>;
    expect(fields.status).toBe('active');
    expect(fields.stripe_customer_id).toBe('cus_X');
    expect(fields.stripe_subscription_id).toBe('sub_Y');
    expect(fields.billing_ref).toBe('sub_Y');
  });

  it('does NOT set stripe_customer_id when the event has no customer (never nulls a stored id)', async () => {
    const event = { type: 'checkout.session.completed', data: { object: { subscription: 'sub_Y' } } };
    await applyStripeEvent(supabase, event, 'biz1', 'pro');
    const fields = mockApply.mock.calls[0][3] as Record<string, unknown>;
    expect('stripe_customer_id' in fields).toBe(false);
    expect(fields.stripe_subscription_id).toBe('sub_Y');
  });

  it('customer.subscription.updated (active) stores the 064 extras tolerantly', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_Y',
          customer: 'cus_X',
          status: 'active',
          items: { data: [{ price: { id: 'price_123' } }] },
          current_period_end: 1893456000, // 2030-01-01 UTC
          cancel_at_period_end: true,
        },
      },
    };
    await applyStripeEvent(supabase, event, 'biz1', 'pro');
    expect(mockExtras).toHaveBeenCalledTimes(1);
    const extras = mockExtras.mock.calls[0][2] as Record<string, unknown>;
    expect(extras.stripe_price_id).toBe('price_123');
    expect(extras.cancel_at_period_end).toBe(true);
    expect(extras.current_period_end).toBe(new Date(1893456000 * 1000).toISOString());
  });

  it('cancellation marks the subscription cancelled and skips the extras', async () => {
    const event = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_Y', customer: 'cus_X' } } };
    await applyStripeEvent(supabase, event, 'biz1', 'pro');
    const fields = mockApply.mock.calls[0][3] as Record<string, unknown>;
    expect(fields.status).toBe('cancelled');
    expect(mockExtras).not.toHaveBeenCalled(); // no price/period fields on a bare delete object
  });
});
