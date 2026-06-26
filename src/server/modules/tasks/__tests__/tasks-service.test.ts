import { describe, it, expect, vi } from 'vitest';
import { createTask, listTasks } from '../tasks.service';
import type { TaskRow } from '../tasks.types';
import type { RepoContext } from '../tasks.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  range(a?: number, b?: number): FB; single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), eq: rec('eq'), is: rec('is'), or: rec('or'),
      order: rec('order'), range: rec('range'), single: rec('single'), maybeSingle: rec('maybeSingle'),
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

const noDb = fakeCtx(() => ({ data: null }));

describe('createTask (parity validation)', () => {
  it('invalid_title', async () => {
    await expect(createTask(noDb, {})).rejects.toMatchObject({ code: 'invalid_title', status: 400 });
  });
  it('invalid_type', async () => {
    await expect(createTask(noDb, { title: 'x' })).rejects.toMatchObject({ code: 'invalid_type' });
  });
  it('invalid_due_date', async () => {
    await expect(createTask(noDb, { title: 'x', type: 'other' })).rejects.toMatchObject({ code: 'invalid_due_date' });
  });
  it('rejects ai_draft status', async () => {
    await expect(createTask(noDb, { title: 'x', type: 'other', dueDate: '2026-07-01', status: 'ai_draft' }))
      .rejects.toMatchObject({ code: 'invalid_status' });
  });
  it('customer_not_found when the customer is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(createTask(ctx, { title: 'x', type: 'other', dueDate: '2026-07-01', customerId: 'c1' }))
      .rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });
  it('inserts and maps on the happy path (no customer)', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'tasks' && ops.some((o) => o.m === 'insert') ? { data: taskRow } : { data: null }));
    const task = await createTask(ctx, { title: 'Κάλεσε', type: 'call_back', dueDate: '2026-07-01' });
    expect(task.id).toBe('t1');
  });
});

describe('createTask (folder dependency injection)', () => {
  it('throws the folder resolver error', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(
      createTask(ctx, { title: 'x', type: 'book_appointment', dueDate: '2026-07-01' }, {
        resolveWorkFolder: async () => ({ ok: false, error: 'folder_not_found', status: 404 }),
      }),
    ).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('notifies when an appointment is filed into a folder', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'tasks' && ops.some((o) => o.m === 'insert') ? { data: taskRow } : { data: null }));
    const notify = vi.fn();
    await createTask(ctx, { title: 'Ραντεβού', type: 'book_appointment', dueDate: '2026-07-01' }, {
      resolveWorkFolder: async () => ({ ok: true, workFolderId: 'f1' }),
      notifyFolderUpdate: notify,
    });
    expect(notify).toHaveBeenCalledWith('f1', 'νέο ραντεβού');
  });
});

describe('listTasks (parity)', () => {
  it('rejects an invalid status', async () => {
    await expect(listTasks(noDb, { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });
  it('returns mapped rows', async () => {
    const ctx = fakeCtx((t) => (t === 'tasks' ? { data: [taskRow] } : { data: null }));
    const tasks = await listTasks(ctx, {});
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Κάλεσε');
  });
});
