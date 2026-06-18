import { describe, it, expect } from 'vitest';
import { computeFolderAttentionForFolder, addCalendarDay } from '../folder-attention-store';

// Recording fake Supabase (same approach as next-action-store.test.ts): proves the
// REAL production path scopes every query by business_id AND never selects call-brief text.

interface Recorded { table: string; op: 'select'; filters: Array<[string, unknown]>; select: string }

function makeFakeSupabase(results: Record<string, unknown>) {
  const calls: Recorded[] = [];
  function makeBuilder(table: string) {
    const rec: Recorded = { table, op: 'select', filters: [], select: '' };
    let recorded = false;
    const finalize = (single: boolean): Promise<{ data: unknown; error: null }> => {
      if (!recorded) { calls.push(rec); recorded = true; }
      const key = `${rec.table}:select`;
      const data = Object.prototype.hasOwnProperty.call(results, key) ? results[key] : (single ? null : []);
      return Promise.resolve({ data, error: null });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: (cols?: string) => { rec.select = cols ?? ''; return b; },
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

describe('folder-attention-store — production queries are business-scoped', () => {
  it('computeFolderAttentionForFolder scopes EVERY read to the business', async () => {
    const fake = makeFakeSupabase({
      'work_folders:select': { id: 'f1', status: 'in_progress', updated_at: '2023-11-14T00:00:00.000Z' },
      // all signal tables default to [] → no link token → link_not_sent attention
    });
    const attention = await computeFolderAttentionForFolder(asClient(fake), BIZ, 'f1');

    expect(fake.calls.length).toBeGreaterThan(1); // folder + signal loads
    for (const c of fake.calls) {
      expect(c.filters.some(([k, v]) => k === 'business_id' && v === BIZ), `${c.table} not business-scoped`).toBe(true);
    }
    // It reads next_actions only as a signal (rule 8) — and still business-scoped.
    expect(fake.calls.some((c) => c.table === 'next_actions')).toBe(true);
    expect(attention?.waitingOn).toBe('business');
    expect(attention?.severity).toBe('info'); // link_not_sent
  });

  it('closed (done/archived) folder → null, and runs ONLY the business-scoped folder lookup', async () => {
    const fake = makeFakeSupabase({ 'work_folders:select': { id: 'f1', status: 'done', updated_at: '2023-11-14T00:00:00.000Z' } });
    const attention = await computeFolderAttentionForFolder(asClient(fake), BIZ, 'f1');
    expect(attention).toBeNull();
    // no signal loads happened for a closed folder
    expect(fake.calls.map((c) => c.table)).toEqual(['work_folders']);
    expect(fake.calls[0].filters).toContainEqual(['business_id', BIZ]);
  });

  it('foreign-business / missing folder → null (lookup is business-scoped)', async () => {
    const fake = makeFakeSupabase({ 'work_folders:select': null });
    const attention = await computeFolderAttentionForFolder(asClient(fake), BIZ, 'foreign');
    expect(attention).toBeNull();
    expect(fake.calls.find((c) => c.table === 'work_folders')?.filters).toContainEqual(['business_id', BIZ]);
  });

  it('NEVER selects call-brief/transcript text (no summary in any select)', async () => {
    const fake = makeFakeSupabase({
      'work_folders:select': { id: 'f1', status: 'in_progress', updated_at: '2023-11-14T00:00:00.000Z' },
    });
    await computeFolderAttentionForFolder(asClient(fake), BIZ, 'f1');
    for (const c of fake.calls) {
      expect(/summary|brief|transcript/i.test(c.select), `${c.table} select leaks brief text: "${c.select}"`).toBe(false);
    }
    // the communications read is restricted to direction + timestamp only
    const comm = fake.calls.find((c) => c.table === 'communications');
    expect(comm?.select).toBe('direction, created_at');
  });
});

describe('addCalendarDay — DST-safe tomorrow', () => {
  it('advances one calendar day across Athens DST transitions and normal days', () => {
    expect(addCalendarDay('2024-03-30')).toBe('2024-03-31'); // spring-forward eve (no skip)
    expect(addCalendarDay('2024-10-27')).toBe('2024-10-28'); // fall-back day (no double)
    expect(addCalendarDay('2024-01-31')).toBe('2024-02-01'); // month rollover
    expect(addCalendarDay('2024-12-31')).toBe('2025-01-01'); // year rollover
    expect(addCalendarDay('2024-02-28')).toBe('2024-02-29'); // leap day
  });
});
