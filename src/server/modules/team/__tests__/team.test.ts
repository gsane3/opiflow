import { describe, it, expect } from 'vitest';
import { removeMember, createInvite, revokeInvite, acceptInvite, type TeamContext } from '../team.service';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB; delete(): FB;
  update(v?: unknown): FB; upsert(v?: unknown, o?: unknown): FB; insert(v?: unknown): FB; single(): FB;
  order(a?: unknown, b?: unknown): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeClient(resolve: (table: string, ops: Op[]) => Res) {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), eq: rec('eq'), maybeSingle: rec('maybeSingle'), delete: rec('delete'),
      update: rec('update'), upsert: rec('upsert'), insert: rec('insert'), single: rec('single'),
      order: rec('order'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { from };
}
function ctxWith(resolve: (table: string, ops: Op[]) => Res): TeamContext {
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: fakeClient(resolve) as unknown as TeamContext['supabase'] };
}
const noDbCtx = ctxWith(() => ({ data: null }));

describe('removeMember (parity)', () => {
  it('invalid_user when no target', async () => {
    await expect(removeMember(noDbCtx, undefined)).rejects.toMatchObject({ code: 'invalid_user', status: 400 });
    await expect(removeMember(noDbCtx, '   ')).rejects.toMatchObject({ code: 'invalid_user' });
  });
  it('cannot_remove_self', async () => {
    await expect(removeMember(noDbCtx, 'u1')).rejects.toMatchObject({ code: 'cannot_remove_self', status: 400 });
  });
  it('cannot_remove_owner', async () => {
    const ctx = ctxWith((t, ops) => (t === 'business_users' && ops.some((o) => o.m === 'select') ? { data: { role: 'owner' } } : {}));
    await expect(removeMember(ctx, 'u2')).rejects.toMatchObject({ code: 'cannot_remove_owner', status: 400 });
  });
  it('removes a non-owner member', async () => {
    const ctx = ctxWith((t, ops) => (t === 'business_users' && ops.some((o) => o.m === 'select') ? { data: { role: 'member' } } : {}));
    expect(await removeMember(ctx, 'u2')).toEqual({ removed: true });
  });
});

describe('createInvite (parity validation)', () => {
  it('invalid_email', async () => {
    await expect(createInvite(noDbCtx, 'not-an-email')).rejects.toMatchObject({ code: 'invalid_email', status: 400 });
    await expect(createInvite(noDbCtx, '')).rejects.toMatchObject({ code: 'invalid_email' });
  });
  it('invalid_role', async () => {
    await expect(createInvite(noDbCtx, 'a@b.com', 'superadmin')).rejects.toMatchObject({ code: 'invalid_role', status: 400 });
  });
});

describe('revokeInvite (parity validation)', () => {
  it('invalid_id', async () => {
    await expect(revokeInvite(noDbCtx, '')).rejects.toMatchObject({ code: 'invalid_id', status: 400 });
  });
});

describe('acceptInvite (parity)', () => {
  const validInvite = { id: 'i1', business_id: 'b9', email: 'A@B.com', role: 'member', status: 'pending', expires_at: '2999-01-01T00:00:00Z' };

  it('invite_invalid when no invite or not pending', async () => {
    const c = fakeClient(() => ({ data: null })) as unknown as Parameters<typeof acceptInvite>[0];
    expect(await acceptInvite(c, 'u1', 'a@b.com', 'tok')).toEqual({ ok: false, error: 'invite_invalid', status: 404 });
  });
  it('invite_expired', async () => {
    const c = fakeClient((t) => (t === 'business_invites' ? { data: { ...validInvite, expires_at: '2000-01-01T00:00:00Z' } } : {})) as unknown as Parameters<typeof acceptInvite>[0];
    expect(await acceptInvite(c, 'u1', 'a@b.com', 'tok')).toEqual({ ok: false, error: 'invite_expired', status: 410 });
  });
  it('wrong_account when the email does not match', async () => {
    const c = fakeClient((t) => (t === 'business_invites' ? { data: validInvite } : {})) as unknown as Parameters<typeof acceptInvite>[0];
    expect(await acceptInvite(c, 'u1', 'other@x.com', 'tok')).toEqual({ ok: false, error: 'wrong_account', status: 403, invitedEmail: 'A@B.com' });
  });
  it('accepts and returns businessId + role', async () => {
    const c = fakeClient((t, ops) => {
      if (t === 'business_invites' && ops.some((o) => o.m === 'select')) return { data: validInvite };
      if (t === 'business_users' && ops.some((o) => o.m === 'upsert')) return { error: null };
      return {};
    }) as unknown as Parameters<typeof acceptInvite>[0];
    expect(await acceptInvite(c, 'u1', 'a@b.com', 'tok')).toEqual({ ok: true, businessId: 'b9', role: 'member' });
  });
  it('accept_failed when the membership upsert errors', async () => {
    const c = fakeClient((t, ops) => {
      if (t === 'business_invites' && ops.some((o) => o.m === 'select')) return { data: validInvite };
      if (t === 'business_users' && ops.some((o) => o.m === 'upsert')) return { error: { message: 'boom' } };
      return {};
    }) as unknown as Parameters<typeof acceptInvite>[0];
    expect(await acceptInvite(c, 'u1', 'a@b.com', 'tok')).toEqual({ ok: false, error: 'accept_failed', status: 500 });
  });
});
