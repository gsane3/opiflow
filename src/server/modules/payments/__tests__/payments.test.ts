import { describe, it, expect } from 'vitest';
import { updatePaymentRequest } from '../payments.service';
import type { RepoContext } from '../payments.repo';
import type { PaymentRequestRow } from '../../../../lib/server/payments';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB; not(a?: unknown, b?: unknown, c?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  range(a?: number, b?: number): FB; single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), eq: rec('eq'), not: rec('not'),
      is: rec('is'), or: rec('or'), order: rec('order'), range: rec('range'), single: rec('single'),
      maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const paymentRow: PaymentRequestRow = {
  id: 'pr1', business_id: 'b1', customer_id: 'c1', work_folder_id: null, offer_id: 'o1',
  kind: 'deposit', pct: 30, amount: 100, currency: 'EUR', status: 'confirmed',
  receiving_account: 'GR00 0000', declared_at: null, confirmed_at: '2026-01-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
};

const noDb = fakeCtx(() => ({ data: null }));

describe('updatePaymentRequest (parity validation)', () => {
  it('invalid_status when status is missing', async () => {
    await expect(updatePaymentRequest(noDb, 'pr1', {}))
      .rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });

  it('invalid_status for an unsupported status value', async () => {
    await expect(updatePaymentRequest(noDb, 'pr1', { status: 'declared' }))
      .rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });

  it('payment_not_actionable (409) when 0 rows transition', async () => {
    const ctx = fakeCtx((t) => (t === 'payment_requests' ? { data: null } : { data: null }));
    await expect(updatePaymentRequest(ctx, 'pr1', { status: 'confirmed' }))
      .rejects.toMatchObject({ code: 'payment_not_actionable', status: 409 });
  });

  it('payment_update_failed (500) on a DB error', async () => {
    const ctx = fakeCtx((t) => (t === 'payment_requests' ? { error: { message: 'boom' } } : { data: null }));
    await expect(updatePaymentRequest(ctx, 'pr1', { status: 'cancelled' }))
      .rejects.toMatchObject({ code: 'payment_update_failed', status: 500 });
  });

  it('payment_update_failed (500) collapses an unexpected throw', async () => {
    const ctx = fakeCtx(() => { throw new Error('unexpected'); });
    await expect(updatePaymentRequest(ctx, 'pr1', { status: 'confirmed' }))
      .rejects.toMatchObject({ code: 'payment_update_failed', status: 500 });
  });

  it('maps the settled row on the happy path (confirm)', async () => {
    const ctx = fakeCtx((t, ops) =>
      (t === 'payment_requests' && ops.some((o) => o.m === 'update') ? { data: paymentRow } : { data: null }));
    const payment = await updatePaymentRequest(ctx, 'pr1', { status: 'confirmed' });
    expect(payment.id).toBe('pr1');
    expect(payment.status).toBe('confirmed');
    expect(payment.receivingAccount).toBe('GR00 0000');
    expect(payment.confirmedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('stamps confirmed_at only when confirming', async () => {
    let confirmOps: Op[] = [];
    const ctxConfirm = fakeCtx((t, ops) => {
      if (t === 'payment_requests' && ops.some((o) => o.m === 'update')) { confirmOps = ops; return { data: paymentRow }; }
      return { data: null };
    });
    await updatePaymentRequest(ctxConfirm, 'pr1', { status: 'confirmed' });
    const confirmUpdate = confirmOps.find((o) => o.m === 'update');
    expect((confirmUpdate?.args[0] as Record<string, unknown>).confirmed_at).toBeDefined();

    let cancelOps: Op[] = [];
    const ctxCancel = fakeCtx((t, ops) => {
      if (t === 'payment_requests' && ops.some((o) => o.m === 'update')) { cancelOps = ops; return { data: { ...paymentRow, status: 'cancelled', confirmed_at: null } }; }
      return { data: null };
    });
    await updatePaymentRequest(ctxCancel, 'pr1', { status: 'cancelled' });
    const cancelUpdate = cancelOps.find((o) => o.m === 'update');
    expect('confirmed_at' in (cancelUpdate?.args[0] as Record<string, unknown>)).toBe(false);
  });
});
