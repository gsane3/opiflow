import { describe, it, expect } from 'vitest';
import {
  applyStripeEvent,
  extractSummary,
  processApifonStatus,
} from '../webhooks-other.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };

interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB;
  single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}

// Fake supabase client. `resolve(table, ops)` decides what each terminal query
// returns based on the table name and the chained operations recorded for it.
function fakeClient(resolve: (table: string, ops: Op[]) => Res): SupabaseServer {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'),
      eq: rec('eq'), in: rec('in'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { from } as unknown as SupabaseServer;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

describe('applyStripeEvent (parity)', () => {
  it('checkout.session.completed updates an existing subscription row → ok', async () => {
    // update().eq().select('id') returns a non-empty array → applySubscription true.
    const supabase = fakeClient((t, ops) =>
      t === 'business_subscriptions' && ops.some((o) => o.m === 'update')
        ? { data: [{ id: 'sub1' }] }
        : { data: null });
    const event = {
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_123', metadata: { businessId: 'b1' } } },
    };
    const ok = await applyStripeEvent(supabase, event, 'b1', 'pro');
    expect(ok).toBe(true);
  });

  it('returns false when the update errors AND the fallback insert errors', async () => {
    // update path errors (no row), insert path also errors → applySubscription false.
    const supabase = fakeClient((t, ops) => {
      if (t !== 'business_subscriptions') return { data: null };
      if (ops.some((o) => o.m === 'update')) return { data: null, error: { message: 'boom' } };
      if (ops.some((o) => o.m === 'insert')) return { data: null, error: { message: 'boom' } };
      return { data: null };
    });
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_123', metadata: { businessId: 'b1' } } },
    };
    const ok = await applyStripeEvent(supabase, event, 'b1', 'pro');
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Apifon
// ---------------------------------------------------------------------------

describe('extractSummary (parity)', () => {
  it('reads message-level fields from the confirmed data[0] envelope', () => {
    const root = {
      request_id: 'req1',
      account_id: 7,
      type: 'viber',
      data: [{ message_id: 'm1', status: { code: 2, text: 'DELIVERED' } }],
    };
    const summary = extractSummary(root);
    expect(summary.request_id).toBe('req1');
    expect(summary.account_id).toBe(7);
    expect(summary.message_id).toBe('m1');
    expect(summary.status).toBe('DELIVERED');
    expect(summary.status_code).toBe(2);
    expect(summary.array_count).toBe(1);
  });
});

describe('processApifonStatus (parity)', () => {
  it('matches a viber_messages row and reports matched=true', async () => {
    const summary = extractSummary({
      request_id: 'req1',
      data: [{ message_id: 'm1', status: { code: 2, text: 'DELIVERED' } }],
    });
    const supabase = fakeClient((t, ops) => {
      if (t === 'provider_webhook_events') {
        if (ops.some((o) => o.m === 'insert')) return { data: { id: 'evt1' } };
        return { data: null }; // no existing event
      }
      if (t === 'viber_messages') {
        // the match lookup uses maybeSingle; updates use eq without maybeSingle
        if (ops.some((o) => o.m === 'maybeSingle')) {
          return { data: { id: 'v1', business_id: 'b1', delivered_at: null, failed_at: null, communication_id: 'c1' } };
        }
        return { data: null };
      }
      return { data: null };
    });
    const matched = await processApifonStatus(supabase, summary, { request_id: 'req1' });
    expect(matched).toBe(true);
  });

  it('reports matched=false when no viber_messages row is found', async () => {
    const summary = extractSummary({
      request_id: 'req1',
      data: [{ message_id: 'm1', status: { code: 2, text: 'DELIVERED' } }],
    });
    const supabase = fakeClient((t, ops) => {
      if (t === 'provider_webhook_events') {
        if (ops.some((o) => o.m === 'insert')) return { data: { id: 'evt1' } };
        return { data: null };
      }
      return { data: null }; // viber_messages lookups all miss
    });
    const matched = await processApifonStatus(supabase, summary, { request_id: 'req1' });
    expect(matched).toBe(false);
  });
});
