import { describe, it, expect } from 'vitest';
import { computeFolderNextAction, applyNextActionLifecycle } from '../next-action-store';

// A recording fake Supabase client. Every chained query records the table, the
// operation, the .eq/.is/.in filters, and any insert/update payload — so the tests
// assert that the REAL production code paths (computeFolderNextAction /
// applyNextActionLifecycle) scope every query by business_id. This replaces the
// previous proxy test of a helper that production never called.

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  filters: Array<[string, unknown]>;
  payload: Record<string, unknown> | null;
}

function makeFakeSupabase(results: Record<string, unknown>) {
  const calls: Recorded[] = [];

  function makeBuilder(table: string) {
    const rec: Recorded = { table, op: 'select', filters: [], payload: null };
    let recorded = false;
    const finalize = (single: boolean): Promise<{ data: unknown; error: null }> => {
      if (!recorded) { calls.push(rec); recorded = true; }
      const key = `${rec.table}:${rec.op}`;
      const data = Object.prototype.hasOwnProperty.call(results, key)
        ? results[key]
        : (single ? null : []);
      return Promise.resolve({ data, error: null });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      insert: (p: Record<string, unknown>) => { rec.op = 'insert'; rec.payload = p; return b; },
      update: (p: Record<string, unknown>) => { rec.op = 'update'; rec.payload = p; return b; },
      eq: (k: string, v: unknown) => { rec.filters.push([k, v]); return b; },
      is: (k: string, v: unknown) => { rec.filters.push([k, v]); return b; },
      in: (k: string, v: unknown) => { rec.filters.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => finalize(true),
      single: () => finalize(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (onF: any, onR: any) => finalize(false).then(onF, onR),
    };
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = { from: (t: string) => makeBuilder(t) };
  return { client, calls };
}

const BIZ = 'biz-123';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (c: { client: unknown }) => c.client as any;

function isBusinessScoped(c: Recorded): boolean {
  return c.filters.some(([k, v]) => k === 'business_id' && v === BIZ)
    || (c.payload != null && c.payload.business_id === BIZ);
}

describe('next-action-store — production queries are business-scoped', () => {
  it('computeFolderNextAction scopes EVERY read + the insert to the business', async () => {
    const fake = makeFakeSupabase({
      // folder exists → compute proceeds
      'work_folders:select': { id: 'f1', customer_id: 'c1', status: 'in_progress', updated_at: '2023-11-14T00:00:00.000Z' },
      // no existing active row → reconcile inserts
      'next_actions:select': [],
      // the persisted row that comes back from the insert
      'next_actions:insert': {
        id: 'na1', action_type: 'share_folder_link', title: 'Στείλε το link στον πελάτη',
        explanation: 'x', confidence: 0.8, priority: 20, status: 'pending', due_at: null, updated_at: '2023-11-14T00:00:00.000Z',
      },
    });

    const action = await computeFolderNextAction(asClient(fake), BIZ, 'f1');

    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) {
      expect(isBusinessScoped(c), `${c.table}:${c.op} not scoped by business_id`).toBe(true);
    }
    // The next_actions insert carried business_id (+ the folder + customer) explicitly.
    const insert = fake.calls.find((c) => c.table === 'next_actions' && c.op === 'insert');
    expect(insert?.payload?.business_id).toBe(BIZ);
    expect(insert?.payload?.work_folder_id).toBe('f1');
    expect(insert?.payload?.customer_id).toBe('c1');
    // No transcript/brief text ever lands in a persisted column.
    expect(JSON.stringify(insert?.payload ?? {})).not.toMatch(/transcript|brief/i);
    // With no link sent, the computed action is share_folder_link.
    expect(action?.actionType).toBe('share_folder_link');
  });

  it('a foreign-business folder yields no action (folder lookup is business-scoped)', async () => {
    // work_folders lookup returns null (the folder is not in THIS business) → null.
    const fake = makeFakeSupabase({ 'work_folders:select': null });
    const action = await computeFolderNextAction(asClient(fake), BIZ, 'foreign-folder');
    expect(action).toBeNull();
    const folderRead = fake.calls.find((c) => c.table === 'work_folders');
    expect(folderRead?.filters).toContainEqual(['business_id', BIZ]);
  });

  it('applyNextActionLifecycle scopes the update to the business + action id', async () => {
    const fake = makeFakeSupabase({});
    const res = await applyNextActionLifecycle(asClient(fake), { businessId: BIZ, id: 'na9', action: 'dismiss' });
    expect(res.ok).toBe(true);
    const upd = fake.calls.find((c) => c.table === 'next_actions' && c.op === 'update');
    expect(upd, 'expected an update on next_actions').toBeTruthy();
    expect(upd!.filters).toContainEqual(['id', 'na9']);
    expect(upd!.filters).toContainEqual(['business_id', BIZ]);
    expect(upd!.payload?.status).toBe('dismissed');
  });

  it('snooze lifecycle sets a future due_at and stays business-scoped', async () => {
    const fake = makeFakeSupabase({});
    const res = await applyNextActionLifecycle(asClient(fake), { businessId: BIZ, id: 'na9', action: 'snooze', snoozeMinutes: 60 });
    expect(res.ok).toBe(true);
    const upd = fake.calls.find((c) => c.table === 'next_actions' && c.op === 'update');
    expect(upd!.filters).toContainEqual(['business_id', BIZ]);
    expect(upd!.payload?.status).toBe('snoozed');
    expect(typeof upd!.payload?.due_at).toBe('string');
  });
});
