import { describe, it, expect, vi } from 'vitest';
import { enqueueJob, runDueJobs, type JobRow } from '../queue';

// A tiny typed fake of the Supabase query builder: every method records the call
// and returns itself; awaiting resolves to whatever the `resolve` router returns.
type Res = { data: unknown; error: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB; delete(): FB;
  eq(a?: unknown, b?: unknown): FB; lte(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB; limit(n?: number): FB;
  single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeClient(resolve: (table: string, ops: Op[]) => Res) {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), delete: rec('delete'),
      eq: rec('eq'), lte: rec('lte'), in: rec('in'), is: rec('is'), order: rec('order'),
      limit: rec('limit'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { from };
}
type AnyClient = Parameters<typeof enqueueJob>[0];

function jobRow(over: Partial<JobRow>): JobRow {
  return {
    id: 'j1', business_id: null, type: 'greet', payload: {}, status: 'pending',
    attempts: 0, run_at: '2020-01-01T00:00:00Z', created_at: '', updated_at: '', ...over,
  };
}

describe('enqueueJob', () => {
  it('inserts a pending job and returns its id', async () => {
    const client = fakeClient((_t, ops) =>
      ops.some((o) => o.m === 'insert') ? { data: { id: 'job1' }, error: null } : { data: null, error: null });
    const id = await enqueueJob(client as unknown as AnyClient, 'greet', { x: 1 });
    expect(id).toBe('job1');
  });
});

describe('runDueJobs', () => {
  it('runs the matching handler and marks the job done', async () => {
    const client = fakeClient((_t, ops) => {
      if (ops.some((o) => o.m === 'update')) return { data: [{ id: 'j1' }], error: null }; // claim ok
      if (ops.some((o) => o.m === 'select')) return { data: [jobRow({ type: 'greet' })], error: null };
      return { data: null, error: null };
    });
    const handler = vi.fn(async () => {});
    const res = await runDueJobs(client as unknown as AnyClient, { greet: handler });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ processed: 1, failed: 0 });
  });

  it('fails a job whose type has no handler', async () => {
    const client = fakeClient((_t, ops) => {
      if (ops.some((o) => o.m === 'update')) return { data: [{ id: 'j2' }], error: null };
      if (ops.some((o) => o.m === 'select')) return { data: [jobRow({ id: 'j2', type: 'nope' })], error: null };
      return { data: null, error: null };
    });
    const res = await runDueJobs(client as unknown as AnyClient, {});
    expect(res).toEqual({ processed: 0, failed: 1 });
  });
});
