import { describe, it, expect } from 'vitest';
import { getTask, updateTask } from '../tasks.service';
import type { TaskRow } from '../tasks.types';
import type { RepoContext } from '../tasks.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), eq: rec('eq'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const taskRow: TaskRow = {
  id: 't1', customer_id: null, offer_id: null, title: 'Κάλεσε', type: 'call_back', status: 'open',
  priority: 'normal', due_date: '2026-07-01', due_time: null, note: null, created_from_ai: false,
  completed_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const hasUpdateOp = (ops: Op[]) => ops.some((o) => o.m === 'update');
const noDb = fakeCtx(() => ({ data: null }));

describe('getTask (parity)', () => {
  it('task_not_found when no row', async () => {
    await expect(getTask(noDb, 't1')).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
  });
  it('task_query_failed on db error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(getTask(ctx, 't1')).rejects.toMatchObject({ code: 'task_query_failed', status: 500 });
  });
  it('returns the mapped task', async () => {
    const ctx = fakeCtx(() => ({ data: taskRow }));
    const task = await getTask(ctx, 't1');
    expect(task.id).toBe('t1');
    expect(task.title).toBe('Κάλεσε');
  });
});

describe('updateTask (parity validation, exact codes)', () => {
  it('invalid_title', async () => {
    await expect(updateTask(noDb, 't1', { title: '' })).rejects.toMatchObject({ code: 'invalid_title', status: 400 });
  });
  it('invalid_type', async () => {
    await expect(updateTask(noDb, 't1', { type: 'bogus' })).rejects.toMatchObject({ code: 'invalid_type' });
  });
  it('invalid_status for ai_draft and for a bogus value', async () => {
    await expect(updateTask(noDb, 't1', { status: 'ai_draft' })).rejects.toMatchObject({ code: 'invalid_status' });
    await expect(updateTask(noDb, 't1', { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status' });
  });
  it('invalid_priority', async () => {
    await expect(updateTask(noDb, 't1', { priority: 'urgent' })).rejects.toMatchObject({ code: 'invalid_priority' });
  });
  it('invalid_due_date', async () => {
    await expect(updateTask(noDb, 't1', { dueDate: '07/01/2026' })).rejects.toMatchObject({ code: 'invalid_due_date' });
  });
  it('invalid_due_time (but allows null/empty)', async () => {
    await expect(updateTask(noDb, 't1', { dueTime: '99:99' })).rejects.toMatchObject({ code: 'invalid_due_time' });
  });
  it('invalid_completed_at when completedAt is null while completing', async () => {
    await expect(updateTask(noDb, 't1', { status: 'completed', completedAt: null }))
      .rejects.toMatchObject({ code: 'invalid_completed_at' });
  });
  it('customer_not_found for a cross-tenant customer', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(updateTask(ctx, 't1', { customerId: 'c9' }))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
});

describe('updateTask (parity behaviour)', () => {
  it('returns the current task unchanged when no allowed field is supplied', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: taskRow } : { data: null }));
    const task = await updateTask(ctx, 't1', {});
    expect(task.id).toBe('t1');
  });
  it('returns the updated task on a real change', async () => {
    const ctx = fakeCtx((t, ops) =>
      t === 'tasks' && hasUpdateOp(ops) ? { data: { ...taskRow, title: 'Νέο' } } : { data: null },
    );
    const task = await updateTask(ctx, 't1', { title: 'Νέο' });
    expect(task.title).toBe('Νέο');
  });
  it('task_not_found when the update matches no row', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateTask(ctx, 't1', { title: 'Νέο' })).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
  });
});
