import { describe, it, expect } from 'vitest';
import {
  reconcileRecordings,
  dispatchScheduledMessages,
  runWeeklySummary,
} from '../cron.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// A minimal thenable query-builder fake. Every chained method returns `this`;
// awaiting the builder resolves to `result`. Count queries read `.count`.
function fakeBuilder(result: { data?: unknown; error?: unknown; count?: number }) {
  const b: Record<string, unknown> = {};
  const methods = [
    'select', 'eq', 'is', 'in', 'or', 'not', 'gt', 'gte', 'lt', 'lte',
    'order', 'limit', 'update', 'insert', 'delete', 'neq',
  ];
  for (const m of methods) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(result);
  b.single = () => Promise.resolve(result);
  b.then = (onFulfilled: (r: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  return b;
}

// Build a fake supabase whose `.from(table)` returns a builder resolving to the
// per-table result the test supplies.
function fakeSupabase(byTable: Record<string, { data?: unknown; error?: unknown; count?: number }>): SupabaseServer {
  return {
    from: (table: string) => fakeBuilder(byTable[table] ?? { data: [], error: null }),
  } as unknown as SupabaseServer;
}

const TWILIO = { accountSid: 'AC', authToken: 'tok' };

describe('reconcileRecordings (parity)', () => {
  it('benign skip when the events table is missing (42P01)', async () => {
    const supabase = fakeSupabase({ provider_webhook_events: { data: null, error: { code: '42P01' } } });
    const r = await reconcileRecordings({ supabase, ...TWILIO });
    expect(r).toEqual({ kind: 'skip', skipped: 'events_unavailable' });
  });

  it('benign skip on PGRST205', async () => {
    const supabase = fakeSupabase({ provider_webhook_events: { data: null, error: { code: 'PGRST205' } } });
    const r = await reconcileRecordings({ supabase, ...TWILIO });
    expect(r).toEqual({ kind: 'skip', skipped: 'events_unavailable' });
  });

  it('query_failed on any other DB error', async () => {
    const supabase = fakeSupabase({ provider_webhook_events: { data: null, error: { code: '500' } } });
    const r = await reconcileRecordings({ supabase, ...TWILIO });
    expect(r).toEqual({ kind: 'query_failed' });
  });

  it('done with zeros on an empty batch', async () => {
    const supabase = fakeSupabase({ provider_webhook_events: { data: [], error: null } });
    const r = await reconcileRecordings({ supabase, ...TWILIO });
    expect(r).toEqual({ kind: 'done', examined: 0, succeeded: 0, deferred: 0, gaveUp: 0 });
  });
});

describe('dispatchScheduledMessages (parity)', () => {
  it('benign skip when the table is missing (42P01)', async () => {
    const supabase = fakeSupabase({ scheduled_messages: { data: null, error: { code: '42P01' } } });
    const r = await dispatchScheduledMessages({ supabase });
    expect(r).toEqual({ kind: 'skip', skipped: 'scheduled_messages_unavailable' });
  });

  it('query_failed on any other DB error', async () => {
    const supabase = fakeSupabase({ scheduled_messages: { data: null, error: { code: '42501' } } });
    const r = await dispatchScheduledMessages({ supabase });
    expect(r).toEqual({ kind: 'query_failed' });
  });

  it('done with zeros on an empty batch', async () => {
    const supabase = fakeSupabase({ scheduled_messages: { data: [], error: null } });
    const r = await dispatchScheduledMessages({ supabase });
    expect(r).toEqual({ kind: 'done', examined: 0, sent: 0, failed: 0 });
  });

  it('fails a row with no resolvable phone (no effectful send)', async () => {
    const supabase = fakeSupabase({
      scheduled_messages: { data: [{ id: 'm1', business_id: 'b1', customer_id: null, channel: 'auto', body: 'hi' }], error: null },
    });
    const r = await dispatchScheduledMessages({ supabase });
    expect(r).toEqual({ kind: 'done', examined: 1, sent: 0, failed: 1 });
  });
});

describe('runWeeklySummary (parity)', () => {
  it('query_failed when the businesses query errors', async () => {
    const supabase = fakeSupabase({ businesses: { data: null, error: { code: 'boom' } } });
    const r = await runWeeklySummary({ supabase });
    expect(r).toEqual({ kind: 'query_failed' });
  });

  it('done with zeros when there are no businesses', async () => {
    const supabase = fakeSupabase({ businesses: { data: [], error: null } });
    const r = await runWeeklySummary({ supabase });
    expect(r).toEqual({ kind: 'done', pushed: 0, skipped: 0, examined: 0 });
  });

  it('skips a business that opted out (weekly_summary_enabled === false)', async () => {
    // First .from('businesses') = list; subsequent = the opt-out lookup.
    let call = 0;
    const supabase = {
      from: (table: string) => {
        if (table === 'businesses') {
          call += 1;
          if (call === 1) return fakeBuilder({ data: [{ id: 'b1' }], error: null });
          return fakeBuilder({ data: { weekly_summary_enabled: false }, error: null });
        }
        return fakeBuilder({ data: [], error: null });
      },
    } as unknown as SupabaseServer;
    const r = await runWeeklySummary({ supabase });
    expect(r).toEqual({ kind: 'done', pushed: 0, skipped: 1, examined: 1 });
  });
});
