import { describe, it, expect } from 'vitest';
import { registerDeviceToken, unregisterDeviceToken } from '../push.service';
import type { TenantContext } from '../../../core/tenant';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };
type Res = { error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  upsert(v?: unknown, o?: unknown): FB; delete(): FB; eq(a?: unknown, b?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): Ctx {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = { upsert: rec('upsert'), delete: rec('delete'), eq: rec('eq'), then: (r) => r(resolve(table, ops)) };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as Ctx['supabase'] };
}

describe('registerDeviceToken (parity)', () => {
  it('invalid_token when empty or too long', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(registerDeviceToken(ctx, { token: '', platform: 'android' })).rejects.toMatchObject({ code: 'invalid_token' });
    await expect(registerDeviceToken(ctx, { token: 'x'.repeat(4097), platform: 'android' })).rejects.toMatchObject({ code: 'invalid_token' });
  });
  it('invalid_platform', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(registerDeviceToken(ctx, { token: 'tok', platform: 'blackberry' })).rejects.toMatchObject({ code: 'invalid_platform' });
  });
  it('ok on a clean upsert', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    expect(await registerDeviceToken(ctx, { token: 'tok', platform: 'android' })).toEqual({ status: 'ok' });
  });
  it('degraded when the table is missing (migration 032 not applied)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42P01' } }));
    expect(await registerDeviceToken(ctx, { token: 'tok', platform: 'ios' })).toEqual({ status: 'degraded' });
  });
});

describe('unregisterDeviceToken (parity)', () => {
  it('invalid_token when empty', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(unregisterDeviceToken(ctx, { token: '' })).rejects.toMatchObject({ code: 'invalid_token' });
  });
  it('ok on delete', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    expect(await unregisterDeviceToken(ctx, { token: 'tok' })).toEqual({ status: 'ok' });
  });
});
