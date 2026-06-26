import { describe, it, expect } from 'vitest';
import { listSuggestedActions, deriveAndReplaceActions, updateSuggestedAction } from '../suggested-actions.service';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
type Ctx = Parameters<typeof listSuggestedActions>[0];
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB; order(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB; update(v?: unknown): FB; insert(v?: unknown): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): Ctx {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), maybeSingle: rec('maybeSingle'), order: rec('order'),
      limit: rec('limit'), update: rec('update'), insert: rec('insert'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as Ctx['supabase'] };
}

const row = { id: 'a1', action_type: 'send_offer', label: 'Δημιουργία προσφοράς', params: null, status: 'pending', created_at: '2026-01-01T00:00:00Z' };
const OFFER_RESULT = { result: { offer: { shouldCreate: true } } };

describe('listSuggestedActions (parity)', () => {
  it('maps rows to camelCase', async () => {
    const ctx = fakeCtx(() => ({ data: [row] }));
    expect(await listSuggestedActions(ctx, 'c1')).toEqual([{ id: 'a1', actionType: 'send_offer', label: 'Δημιουργία προσφοράς', params: null, createdAt: '2026-01-01T00:00:00Z' }]);
  });
  it('query_failed on db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(listSuggestedActions(ctx, 'c1')).rejects.toMatchObject({ code: 'query_failed', status: 500 });
  });
});

describe('deriveAndReplaceActions (parity)', () => {
  it('short-circuits to inserted:0 when the AI result yields nothing (no DB work)', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    expect(await deriveAndReplaceActions(ctx, 'c1', { result: null })).toEqual({ inserted: 0, actions: [] });
  });
  it('customer_not_found for a cross-tenant customer', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(deriveAndReplaceActions(ctx, 'c1', OFFER_RESULT)).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('inserts the derived set and returns it', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'suggested_actions' && ops.some((o) => o.m === 'insert')) return { data: [row] };
      return {}; // supersede update
    });
    expect(await deriveAndReplaceActions(ctx, 'c1', OFFER_RESULT)).toEqual({
      inserted: 1,
      actions: [{ id: 'a1', actionType: 'send_offer', label: 'Δημιουργία προσφοράς', params: null, createdAt: '2026-01-01T00:00:00Z' }],
    });
  });
  it('insert_failed when the replacement insert errors', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'suggested_actions' && ops.some((o) => o.m === 'insert')) return { error: { message: 'boom' } };
      return {};
    });
    await expect(deriveAndReplaceActions(ctx, 'c1', OFFER_RESULT)).rejects.toMatchObject({ code: 'insert_failed', status: 500 });
  });
});

describe('updateSuggestedAction (parity)', () => {
  const okCtx = fakeCtx(() => ({ error: null }));
  it('invalid_body when id or status is missing/invalid', async () => {
    await expect(updateSuggestedAction(okCtx, 'c1', {})).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
    await expect(updateSuggestedAction(okCtx, 'c1', { id: 'a1', status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_body' });
  });
  it('resolves on a valid done/dismissed update', async () => {
    await expect(updateSuggestedAction(okCtx, 'c1', { id: 'a1', status: 'done' })).resolves.toBeUndefined();
  });
  it('update_failed on db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(updateSuggestedAction(ctx, 'c1', { id: 'a1', status: 'dismissed' })).rejects.toMatchObject({ code: 'update_failed', status: 500 });
  });
});
