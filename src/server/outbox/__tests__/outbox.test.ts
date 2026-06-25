import { describe, it, expect, vi } from 'vitest';
import { recordOutbox, dispatchOutbox, type OutboxRow } from '../outbox';

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
type AnyClient = Parameters<typeof recordOutbox>[0];

function outboxRow(over: Partial<OutboxRow>): OutboxRow {
  return {
    id: 'e1', business_id: null, kind: 'viber', dedup_key: null, payload: {}, status: 'pending',
    attempts: 0, next_retry_at: '2020-01-01T00:00:00Z', last_error: null, sent_at: null,
    created_at: '', updated_at: '', ...over,
  };
}

describe('recordOutbox', () => {
  it('records a new event (created=true)', async () => {
    const client = fakeClient((_t, ops) =>
      ops.some((o) => o.m === 'insert') ? { data: { id: 'e1' }, error: null } : { data: null, error: null });
    const r = await recordOutbox(client as unknown as AnyClient, 'viber', { to: 'x' }, { dedupKey: 'k1' });
    expect(r).toEqual({ id: 'e1', created: true });
  });

  it('is idempotent: returns the existing event on a dedup conflict', async () => {
    const client = fakeClient((_t, ops) => {
      if (ops.some((o) => o.m === 'insert')) return { data: null, error: { code: '23505' } };
      if (ops.some((o) => o.m === 'select')) return { data: { id: 'e0' }, error: null };
      return { data: null, error: null };
    });
    const r = await recordOutbox(client as unknown as AnyClient, 'viber', { to: 'x' }, { dedupKey: 'k1', businessId: 'b1' });
    expect(r).toEqual({ id: 'e0', created: false });
  });
});

describe('dispatchOutbox', () => {
  it('sends via the matching sender and marks sent', async () => {
    const client = fakeClient((_t, ops) => {
      if (ops.some((o) => o.m === 'update')) return { data: [{ id: 'e1' }], error: null };
      if (ops.some((o) => o.m === 'select')) return { data: [outboxRow({})], error: null };
      return { data: null, error: null };
    });
    const sender = vi.fn(async () => {});
    const res = await dispatchOutbox(client as unknown as AnyClient, { viber: sender });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ sent: 1, failed: 0 });
  });

  it('fails an event whose kind has no sender', async () => {
    const client = fakeClient((_t, ops) => {
      if (ops.some((o) => o.m === 'update')) return { data: [{ id: 'e9' }], error: null };
      if (ops.some((o) => o.m === 'select')) return { data: [outboxRow({ id: 'e9', kind: 'telegram' })], error: null };
      return { data: null, error: null };
    });
    const res = await dispatchOutbox(client as unknown as AnyClient, {});
    expect(res).toEqual({ sent: 0, failed: 1 });
  });
});
