import { describe, it, expect } from 'vitest';
import { cancelScheduledMessage } from '../scheduled-messages.service';
import type { RepoContext } from '../scheduled-messages.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  update(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = { update: rec('update'), eq: rec('eq'), then: (r) => r(resolve(table, ops)) };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('cancelScheduledMessage (parity)', () => {
  it('sets status=cancelled scoped to id + business + pending', async () => {
    let seen: Op[] = [];
    const ctx = fakeCtx((_t, ops) => { seen = ops; return { error: null }; });
    await expect(cancelScheduledMessage(ctx, 'm1')).resolves.toBeUndefined();
    expect(seen.find((o) => o.m === 'update')?.args[0]).toMatchObject({ status: 'cancelled' });
    const eqArgs = seen.filter((o) => o.m === 'eq').map((o) => o.args);
    expect(eqArgs).toContainEqual(['business_id', 'b1']); // injected by tenantDb
    expect(eqArgs).toContainEqual(['id', 'm1']);
    expect(eqArgs).toContainEqual(['status', 'pending']);
  });
  it('throws cancel_failed on a db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(cancelScheduledMessage(ctx, 'm1')).rejects.toMatchObject({ code: 'cancel_failed', status: 500 });
  });
});
