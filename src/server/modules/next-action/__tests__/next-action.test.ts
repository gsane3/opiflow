import { describe, it, expect } from 'vitest';
import { getNextAction, applyNextAction } from '../next-action.service';

type Ctx = Parameters<typeof applyNextAction>[0];
function ctxWith(from: unknown): Ctx {
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as Ctx['supabase'] };
}

describe('applyNextAction (parity validation)', () => {
  const ctx = ctxWith(() => { throw new Error('should not reach the lib'); });
  it('invalid_body when id is missing', async () => {
    await expect(applyNextAction(ctx, { action: 'accept' })).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
  it('invalid_body when action is not a valid lifecycle', async () => {
    await expect(applyNextAction(ctx, { id: 'a1', action: 'bogus' })).rejects.toMatchObject({ code: 'invalid_body', status: 400 });
  });
});

describe('getNextAction (parity)', () => {
  it('returns null when computation throws (tolerant of pre-054)', async () => {
    const ctx = ctxWith(() => { throw new Error('no next_actions table'); });
    expect(await getNextAction(ctx, 'c1')).toBeNull();
  });
});
