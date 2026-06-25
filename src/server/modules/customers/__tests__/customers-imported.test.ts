import { describe, it, expect } from 'vitest';
import { bulkDeleteCustomers } from '../customers.service';
import type { RepoContext } from '../customers.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  delete(): FB; eq(a?: unknown, b?: unknown): FB; select(c?: string): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = { delete: rec('delete'), eq: rec('eq'), select: rec('select'), then: (r) => r(resolve(table, ops)) };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('bulkDeleteCustomers (parity)', () => {
  it('all scope returns deleted count + scope:all', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 'a' }, { id: 'b' }] }));
    expect(await bulkDeleteCustomers(ctx, 'all')).toEqual({ deleted: 2, scope: 'all' });
  });
  it('imported scope returns deleted count + scope:imported', async () => {
    const ctx = fakeCtx(() => ({ data: [{ id: 'a' }] }));
    expect(await bulkDeleteCustomers(ctx, 'imported')).toEqual({ deleted: 1, scope: 'imported' });
  });
  it('imported scope degrades to columnMissing on a pre-053 schema (no scope field)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42703', message: 'column imported_from_phone does not exist' } }));
    expect(await bulkDeleteCustomers(ctx, 'imported')).toEqual({ deleted: 0, columnMissing: true });
  });
  it('throws delete_failed on a generic db error', async () => {
    const ctx = fakeCtx(() => ({ error: { code: 'XX000', message: 'boom' } }));
    await expect(bulkDeleteCustomers(ctx, 'all')).rejects.toMatchObject({ code: 'delete_failed', status: 500 });
  });
});
