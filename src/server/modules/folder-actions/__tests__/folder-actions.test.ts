import { describe, it, expect } from 'vitest';
import {
  getFolderNextAction,
  applyFolderNextAction,
  getFolderAttention,
  createFolderPaymentRequest,
  listFolderPaymentRequests,
} from '../folder-actions.service';
import type { RepoContext } from '../folder-actions.repo';
import type { PaymentRequestRow } from '../../../../lib/server/payments';

// ---------------------------------------------------------------------------
// Hermetic fake Supabase: every builder method records the op and returns `this`;
// the terminal awaits/`.then` resolve to whatever `resolve(table, ops)` returns.
// ---------------------------------------------------------------------------
type Res = { data?: unknown; error?: unknown; count?: number | null };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB; not(a?: unknown, b?: unknown, c?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB; limit(a?: number): FB;
  range(a?: number, b?: number): FB; single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), eq: rec('eq'), not: rec('not'),
      is: rec('is'), or: rec('or'), order: rec('order'), in: rec('in'), limit: rec('limit'),
      range: rec('range'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

type Ctx = Parameters<typeof applyFolderNextAction>[0];
function ctxWith(from: unknown): Ctx {
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as Ctx['supabase'] };
}

const paymentRow: PaymentRequestRow = {
  id: 'pr1', business_id: 'b1', customer_id: 'c1', work_folder_id: 'f1', offer_id: 'o1',
  kind: 'deposit', pct: 30, amount: 300, currency: 'EUR', status: 'pending',
  receiving_account: 'GR00 0000', declared_at: null, confirmed_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// next-action (PATCH validation + tolerant GET)
// ---------------------------------------------------------------------------
describe('applyFolderNextAction (parity validation)', () => {
  const ctx = ctxWith(() => { throw new Error('should not reach the lib'); });
  it('invalid_body when id is missing', async () => {
    await expect(applyFolderNextAction(ctx, { action: 'accept' })).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when action is not a valid lifecycle', async () => {
    await expect(applyFolderNextAction(ctx, { id: 'a1', action: 'bogus' })).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
});

describe('getFolderNextAction (parity)', () => {
  it('returns null when computation throws (tolerant of pre-054)', async () => {
    const ctx = ctxWith(() => { throw new Error('no next_actions table'); });
    expect(await getFolderNextAction(ctx, 'f1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// attention (tolerant GET)
// ---------------------------------------------------------------------------
describe('getFolderAttention (parity)', () => {
  it('returns null when the attention engine throws', async () => {
    const ctx = ctxWith(() => { throw new Error('attention boom'); });
    expect(await getFolderAttention(ctx, 'f1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// payment-request (create) — pure validation/guard throws BEFORE the notify effect
// ---------------------------------------------------------------------------
const noDb = fakeCtx(() => ({ data: null }));

describe('createFolderPaymentRequest (parity validation + guards)', () => {
  it('invalid_kind when kind is not deposit/balance', async () => {
    await expect(createFolderPaymentRequest(noDb, 'f1', { kind: 'tip', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'invalid_kind', status: 400 });
  });

  it('invalid_pct when pct is out of range', async () => {
    await expect(createFolderPaymentRequest(noDb, 'f1', { kind: 'deposit', pct: 0, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'invalid_pct', status: 400 });
    await expect(createFolderPaymentRequest(noDb, 'f1', { kind: 'deposit', pct: 101, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'invalid_pct', status: 400 });
  });

  it('offer_required when offerId is missing/blank', async () => {
    await expect(createFolderPaymentRequest(noDb, 'f1', { kind: 'deposit', pct: 30 }))
      .rejects.toMatchObject({ code: 'offer_required', status: 400 });
    await expect(createFolderPaymentRequest(noDb, 'f1', { kind: 'deposit', pct: 30, offerId: '   ' }))
      .rejects.toMatchObject({ code: 'offer_required', status: 400 });
  });

  it('folder_not_found (404) when the folder is not this tenant', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: null }));
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('payment_request_failed (500) on a folder DB error', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { error: { message: 'boom' } } : { data: null }));
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'payment_request_failed', status: 500 });
  });

  it('offer_not_found (404) when the offer is not in this folder', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: null };
      return { data: null };
    });
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'offer_not_found', status: 404 });
  });

  it('bank_not_configured (400) when the business has no IBAN', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: { id: 'o1', total: 1000 } };
      if (t === 'businesses') return { data: { bank_iban: '  ', bank_beneficiary: null } };
      return { data: null };
    });
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'bank_not_configured', status: 400 });
  });

  it('payment_request_failed (500) when the insert returns no row', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: { id: 'o1', total: 1000 } };
      if (t === 'businesses') return { data: { bank_iban: 'GR00 0000', bank_beneficiary: null } };
      if (t === 'payment_requests') return { data: null };
      return { data: null };
    });
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'payment_request_failed', status: 500 });
  });

  it('payment_request_failed (500) collapses an unexpected throw', async () => {
    const ctx = fakeCtx(() => { throw new Error('unexpected'); });
    await expect(createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }))
      .rejects.toMatchObject({ code: 'payment_request_failed', status: 500 });
  });

  it('maps the created row + fires the notification on the happy path', async () => {
    const notified: Array<{ id: string; what: string }> = [];
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: { id: 'o1', total: 1000 } };
      if (t === 'businesses') return { data: { bank_iban: 'GR00 0000', bank_beneficiary: null } };
      if (t === 'payment_requests' && ops.some((o) => o.m === 'insert')) return { data: paymentRow };
      return { data: null };
    });
    const payment = await createFolderPaymentRequest(ctx, 'f1', { kind: 'deposit', pct: 30, offerId: 'o1' }, {
      notifyFolderUpdate: (workFolderId, what) => notified.push({ id: workFolderId, what }),
    });
    expect(payment.id).toBe('pr1');
    expect(payment.kind).toBe('deposit');
    expect(payment.amount).toBe(300);
    expect(payment.receivingAccount).toBe('GR00 0000');
    expect(notified).toEqual([{ id: 'f1', what: 'αίτημα προκαταβολής' }]);
  });

  it('balance kind notifies with the εξόφληση copy', async () => {
    const notified: string[] = [];
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: { id: 'o1', total: 1000 } };
      if (t === 'businesses') return { data: { bank_iban: 'GR00 0000', bank_beneficiary: null } };
      if (t === 'payment_requests' && ops.some((o) => o.m === 'insert')) return { data: { ...paymentRow, kind: 'balance' } };
      return { data: null };
    });
    await createFolderPaymentRequest(ctx, 'f1', { kind: 'balance', pct: 70, offerId: 'o1' }, {
      notifyFolderUpdate: (_id, what) => notified.push(what),
    });
    expect(notified).toEqual(['αίτημα εξόφλησης']);
  });
});

// ---------------------------------------------------------------------------
// payment-requests (list)
// ---------------------------------------------------------------------------
describe('listFolderPaymentRequests (parity)', () => {
  it('folder_not_found (404) when the folder is not this tenant', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: null }));
    const out = await listFolderPaymentRequests(ctx, 'f1');
    expect(out).toEqual({ folderNotFound: true, payments: [] });
  });

  it('empty list (never 404) when the folder check itself errors', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { error: { message: 'boom' } } : { data: null }));
    const out = await listFolderPaymentRequests(ctx, 'f1');
    expect(out).toEqual({ folderNotFound: false, payments: [] });
  });

  it('degrades to empty list on a payment_requests query error (pre-048)', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1' } };
      if (t === 'payment_requests') return { error: { message: 'relation does not exist' } };
      return { data: null };
    });
    const out = await listFolderPaymentRequests(ctx, 'f1');
    expect(out).toEqual({ folderNotFound: false, payments: [] });
  });

  it('maps the rows on the happy path', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1' } };
      if (t === 'payment_requests') return { data: [paymentRow] };
      return { data: null };
    });
    const out = await listFolderPaymentRequests(ctx, 'f1');
    expect(out.folderNotFound).toBe(false);
    expect(out.payments).toHaveLength(1);
    expect(out.payments[0]).toMatchObject({ id: 'pr1', kind: 'deposit', amount: 300, receivingAccount: 'GR00 0000', status: 'pending' });
  });
});
