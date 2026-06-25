import { describe, it, expect } from 'vitest';
import { getCallBrief } from '../calls.service';
import type { RepoContext } from '../calls.repo';

type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB; order(a?: unknown, b?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string) => Res): RepoContext {
  function from(table: string): FB {
    const rec = () => (): FB => b;
    const b: FB = { select: rec(), eq: rec(), maybeSingle: rec(), order: rec(), then: (r) => r(resolve(table)) };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const commRow = {
  id: 'k1', customer_id: 'c1', channel: 'call', direction: 'inbound', status: 'completed',
  phone: '+306900000000', summary: 'σύντομη', brief_created_at: null,
};

describe('getCallBrief (parity)', () => {
  it('not_found when there is no matching call', async () => {
    const ctx = fakeCtx((t) => (t === 'communications' ? { data: null } : { data: null }));
    await expect(getCallBrief(ctx, 'k1')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
  it('server_error when both communications selects error', async () => {
    const ctx = fakeCtx((t) => (t === 'communications' ? { error: { message: 'boom' } } : { data: null }));
    await expect(getCallBrief(ctx, 'k1')).rejects.toMatchObject({ code: 'server_error', status: 500 });
  });
  it('assembles ready transcript brief + name + derived actions', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'communications') return { data: commRow };
      if (t === 'call_briefs') return { data: [{ brief_kind: 'transcript', brief_text: 'Ο πελάτης θέλει προσφορά', created_at: '2026-06-01T00:00:00Z' }] };
      if (t === 'customers') return { data: { name: 'Γιώργος', company_name: null } };
      return { data: null };
    });
    const result = await getCallBrief(ctx, 'k1');
    expect(result.ready).toBe(true);
    expect(result.briefKind).toBe('transcript');
    expect(result.summary).toBe('Ο πελάτης θέλει προσφορά');
    expect(result.customerName).toBe('Γιώργος');
    expect(result.suggestedActions).toEqual([{ actionType: 'send_offer', label: 'Δημιουργία προσφοράς' }]);
  });
  it('not ready when only the plain summary exists', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'communications') return { data: { ...commRow, customer_id: null } };
      return { data: [] };
    });
    const result = await getCallBrief(ctx, 'k1');
    expect(result.ready).toBe(false);
    expect(result.briefKind).toBeNull();
    expect(result.summary).toBe('σύντομη');
    expect(result.customerName).toBeNull();
  });
});
