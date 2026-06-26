import { describe, it, expect } from 'vitest';
import { logCall } from '../calls.service';
import type { RepoContext } from '../calls.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB; limit(n?: number): FB; single(): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), eq: rec('eq'), or: rec('or'),
      order: rec('order'), limit: rec('limit'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('logCall (parity)', () => {
  it('rejects an invalid direction/status', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(logCall(ctx, { direction: 'sideways', status: 'completed' }))
      .rejects.toMatchObject({ code: 'invalid_call', status: 400 });
    await expect(logCall(ctx, { direction: 'inbound', status: 'pending' }))
      .rejects.toMatchObject({ code: 'invalid_call' });
  });

  it('inserts a new call row (phone matched to no customer)', async () => {
    const captured: Record<string, unknown>[] = [];
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: null }; // no phone match
      if (t === 'communications' && ops.some((o) => o.m === 'insert')) {
        captured.push(ops.find((o) => o.m === 'insert')!.args[0] as Record<string, unknown>);
        return { data: { id: 'comm1' } };
      }
      return { data: null };
    });
    const r = await logCall(ctx, { direction: 'outbound', status: 'completed', phone: '2101234567' });
    expect(r).toEqual({ communicationId: 'comm1', brief: null });
    expect(captured[0]).toMatchObject({ channel: 'call', direction: 'outbound', status: 'completed', summary: 'Εξερχόμενη κλήση' });
  });

  it('finalises an existing dial-time row by providerCallId (no duplicate insert)', async () => {
    let inserted = false;
    const ctx = fakeCtx((t, ops) => {
      if (t === 'communications' && ops.some((o) => o.m === 'insert')) { inserted = true; return { data: { id: 'NEW' } }; }
      if (t === 'communications') return { data: { id: 'comm0', customer_id: null, brief_created_at: null } };
      return { data: null };
    });
    const r = await logCall(ctx, { direction: 'inbound', status: 'completed', providerCallId: 'CA123' });
    expect(r.communicationId).toBe('comm0');
    expect(inserted).toBe(false);
  });

  it('labels a missed call', async () => {
    const captured: Record<string, unknown>[] = [];
    const ctx = fakeCtx((t, ops) => {
      if (t === 'communications' && ops.some((o) => o.m === 'insert')) {
        captured.push(ops.find((o) => o.m === 'insert')!.args[0] as Record<string, unknown>);
        return { data: { id: 'm1' } };
      }
      return { data: null };
    });
    await logCall(ctx, { direction: 'inbound', status: 'missed' });
    expect(captured[0]).toMatchObject({ summary: 'Αναπάντητη κλήση', status: 'missed' });
  });
});
