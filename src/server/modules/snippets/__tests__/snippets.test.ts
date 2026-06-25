import { describe, it, expect } from 'vitest';
import { createSnippet, dbToSnippet } from '../snippets.service';
import type { SnippetRow } from '../snippets.types';
import type { RepoContext } from '../snippets.repo';

type Res = { data?: unknown; error?: unknown; count?: number };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string, o?: unknown): FB; insert(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  single(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), eq: rec('eq'), single: rec('single'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const row: SnippetRow = { id: 's1', title: 'Γεια', body: 'Καλημέρα', sort_order: 2 };

describe('dbToSnippet', () => {
  it('maps sort_order → sortOrder', () => {
    expect(dbToSnippet(row).sortOrder).toBe(2);
  });
});

describe('createSnippet (parity)', () => {
  it('requires title and body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createSnippet(ctx, { title: 'only' })).rejects.toMatchObject({ code: 'title_and_body_required', status: 400 });
  });

  it('rejects an over-long title/body', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createSnippet(ctx, { title: 'x'.repeat(81), body: 'ok' })).rejects.toMatchObject({ code: 'too_long' });
  });

  it('appends at sort_order = current count and maps the row', async () => {
    const captured: Record<string, unknown>[] = [];
    const ctx = fakeCtx((_t, ops) => {
      if (ops.some((o) => o.m === 'insert')) {
        const ins = ops.find((o) => o.m === 'insert');
        captured.push(ins!.args[0] as Record<string, unknown>);
        return { data: row, error: null };
      }
      return { count: 2, data: null, error: null }; // count query
    });
    const snippet = await createSnippet(ctx, { title: 'Γεια', body: 'Καλημέρα' });
    expect(snippet.sortOrder).toBe(2);
    expect(captured[0]).toMatchObject({ sort_order: 2, title: 'Γεια', body: 'Καλημέρα' });
  });
});
