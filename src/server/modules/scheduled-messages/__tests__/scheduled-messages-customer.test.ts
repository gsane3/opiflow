import { describe, it, expect } from 'vitest';
import { listScheduledMessages, scheduleMessage } from '../scheduled-messages.service';
import type { RepoContext } from '../scheduled-messages.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; insert(v?: unknown): FB; single(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), order: rec('order'), maybeSingle: rec('maybeSingle'),
      insert: rec('insert'), single: rec('single'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const FUTURE = '2999-01-01T10:00:00Z';
const withPhone = { phone: '+306900000000', mobile_phone: null, landline_phone: null };

describe('listScheduledMessages (parity)', () => {
  it('maps rows to camelCase', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 'm1', body: 'Γεια', channel: 'sms', scheduled_for: FUTURE, status: 'pending' }] }));
    expect(await listScheduledMessages(ctx, 'c1')).toEqual([{ id: 'm1', body: 'Γεια', channel: 'sms', scheduledFor: FUTURE, status: 'pending' }]);
  });
  it('returns [] on a db error (pre-044)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42P01' } }));
    expect(await listScheduledMessages(ctx, 'c1')).toEqual([]);
  });
});

describe('scheduleMessage (parity validation)', () => {
  const noDb = fakeCtx(() => ({ data: null }));
  it('empty_text', async () => {
    await expect(scheduleMessage(noDb, 'c1', { scheduledFor: FUTURE })).rejects.toMatchObject({ code: 'empty_text', status: 400 });
  });
  it('too_long', async () => {
    await expect(scheduleMessage(noDb, 'c1', { text: 'x'.repeat(1001), scheduledFor: FUTURE })).rejects.toMatchObject({ code: 'too_long' });
  });
  it('invalid_date', async () => {
    await expect(scheduleMessage(noDb, 'c1', { text: 'γεια', scheduledFor: 'not-a-date' })).rejects.toMatchObject({ code: 'invalid_date' });
  });
  it('past_date', async () => {
    await expect(scheduleMessage(noDb, 'c1', { text: 'γεια', scheduledFor: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'past_date' });
  });
  it('customer_not_found', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(scheduleMessage(ctx, 'c1', { text: 'γεια', scheduledFor: FUTURE })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('no_phone', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: { phone: null, mobile_phone: null, landline_phone: null } } : { data: null }));
    await expect(scheduleMessage(ctx, 'c1', { text: 'γεια', scheduledFor: FUTURE })).rejects.toMatchObject({ code: 'no_phone', status: 400 });
  });
});

describe('scheduleMessage (parity behaviour)', () => {
  it('schedules and returns the id', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: withPhone };
      if (t === 'scheduled_messages' && ops.some((o) => o.m === 'insert')) return { data: { id: 'm9' } };
      return { data: null };
    });
    expect(await scheduleMessage(ctx, 'c1', { text: 'γεια', scheduledFor: FUTURE })).toEqual({ scheduled: true, id: 'm9' });
  });
  it('returns scheduled:false when the insert fails (pre-044)', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: withPhone };
      if (t === 'scheduled_messages' && ops.some((o) => o.m === 'insert')) return { error: { code: '42P01' } };
      return { data: null };
    });
    expect(await scheduleMessage(ctx, 'c1', { text: 'γεια', scheduledFor: FUTURE })).toEqual({ scheduled: false });
  });
});
