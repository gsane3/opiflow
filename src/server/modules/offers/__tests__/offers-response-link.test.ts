import { describe, it, expect } from 'vitest';
import { createOfferResponseLink } from '../offers.service';
import type { RepoContext } from '../offers.repo';

type Res = { data?: unknown; error?: unknown };
interface FB { select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown; }
function fakeCtx(resolve: (table: string) => Res): RepoContext {
  function from(table: string): FB {
    const rec = () => (): FB => b;
    const b: FB = { select: rec(), eq: rec(), maybeSingle: rec(), then: (r) => r(resolve(table)) };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

describe('createOfferResponseLink (parity guards)', () => {
  it('offer_not_found when the offer does not belong to the tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(createOfferResponseLink(ctx, 'o1')).rejects.toMatchObject({ code: 'offer_not_found', status: 404 });
  });
  it('response_link_failed when the ownership check errors', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(createOfferResponseLink(ctx, 'o1')).rejects.toMatchObject({ code: 'response_link_failed', status: 500 });
  });
});
