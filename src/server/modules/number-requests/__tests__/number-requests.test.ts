import { describe, it, expect } from 'vitest';
import { ensureNumberRequest, getNumberRequest } from '../number-requests.service';
import type { RepoContext } from '../number-requests.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB; limit(n?: number): FB; maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), eq: rec('eq'), order: rec('order'),
      limit: rec('limit'), maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('ensureNumberRequest (parity)', () => {
  it('returns already_assigned when a number is set', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: 'b1', city: 'Αθήνα', business_phone_number: '+302101234567' } };
      return { data: null };
    });
    expect(await ensureNumberRequest(ctx)).toEqual({ status: 'already_assigned' });
  });

  it('throws activation_required for an unentitled subscription', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: 'b1', city: 'Αθήνα', business_phone_number: null } };
      if (t === 'business_subscriptions') return { data: { status: 'pending_payment' } };
      return { data: null };
    });
    await expect(ensureNumberRequest(ctx)).rejects.toMatchObject({ code: 'activation_required', status: 403 });
  });

  it('returns the existing pending request (created:false)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'businesses') return { data: { id: 'b1', city: 'Αθήνα', business_phone_number: null } };
      if (t === 'business_subscriptions') return { data: { status: 'active' } };
      if (t === 'phone_number_requests') return { data: { status: 'pending', requested_city: 'Αθήνα', created_at: '2026-01-01T00:00:00Z' } };
      return { data: null };
    });
    const r = await ensureNumberRequest(ctx);
    expect(r).toMatchObject({ status: 'pending', created: false });
  });

  it('creates a new pending request (created:true)', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'businesses') return { data: { id: 'b1', city: 'Αθήνα', business_phone_number: null } };
      if (t === 'business_subscriptions') return { data: { status: 'active' } };
      if (t === 'phone_number_requests') {
        if (ops.some((o) => o.m === 'insert')) return { error: null };
        return { data: null }; // no existing pending
      }
      return { data: null };
    });
    const r = await ensureNumberRequest(ctx);
    expect(r).toMatchObject({ status: 'pending', created: true, numberRequest: { requestedCity: 'Αθήνα' } });
  });

  it('treats a unique-violation insert as an existing pending (created:false)', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'businesses') return { data: { id: 'b1', city: null, business_phone_number: null } };
      if (t === 'business_subscriptions') return { data: { status: 'trialing' } };
      if (t === 'phone_number_requests') {
        if (ops.some((o) => o.m === 'insert')) return { error: { code: '23505' } };
        return { data: null };
      }
      return { data: null };
    });
    const r = await ensureNumberRequest(ctx);
    expect(r).toMatchObject({ status: 'pending', created: false });
  });
});

describe('getNumberRequest', () => {
  it('maps the latest pending request', async () => {
    const ctx = fakeCtx((t) =>
      t === 'phone_number_requests'
        ? { data: { status: 'pending', requested_city: 'Πάτρα', created_at: '2026-02-02T00:00:00Z' } }
        : { data: null });
    const r = await getNumberRequest(ctx);
    expect(r.numberRequest).toEqual({ status: 'pending', requestedCity: 'Πάτρα', createdAt: '2026-02-02T00:00:00Z' });
  });

  it('returns null when there is no pending request', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect((await getNumberRequest(ctx)).numberRequest).toBeNull();
  });
});
