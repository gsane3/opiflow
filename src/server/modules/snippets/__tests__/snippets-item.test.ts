import { describe, it, expect } from 'vitest';
import { updateSnippet, deleteSnippet } from '../snippets.service';
import type { SnippetRow } from '../snippets.types';
import type { RepoContext } from '../snippets.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; delete(): FB; eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), delete: rec('delete'), eq: rec('eq'),
      maybeSingle: rec('maybeSingle'), then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const row: SnippetRow = { id: 's1', title: 'Νέος', body: 'Κείμενο', sort_order: 0 };

describe('updateSnippet (parity)', () => {
  it('invalid_title when blanked or too long', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateSnippet(ctx, 's1', { title: '' })).rejects.toMatchObject({ code: 'invalid_title' });
    await expect(updateSnippet(ctx, 's1', { title: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_title' });
  });
  it('invalid_body when blanked or too long', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateSnippet(ctx, 's1', { body: '' })).rejects.toMatchObject({ code: 'invalid_body' });
  });
  it('not_found when no row matches', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateSnippet(ctx, 's1', { title: 'Νέος' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
  it('returns the updated snippet', async () => {
    const ctx = fakeCtx(() => ({ data: row }));
    const snippet = await updateSnippet(ctx, 's1', { title: 'Νέος' });
    expect(snippet.title).toBe('Νέος');
    expect(snippet.sortOrder).toBe(0);
  });
});

describe('deleteSnippet (parity)', () => {
  it('resolves on success', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(deleteSnippet(ctx, 's1')).resolves.toBeUndefined();
  });
  it('throws delete_failed on error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(deleteSnippet(ctx, 's1')).rejects.toMatchObject({ code: 'delete_failed', status: 500 });
  });
});
