import { describe, it, expect } from 'vitest';
import { CreateTaskSchema, ListTasksQuerySchema } from '../tasks.schema';
import { dbToTask } from '../tasks.service';
import type { TaskRow } from '../tasks.types';

describe('CreateTaskSchema', () => {
  it('accepts a valid task', () => {
    const r = CreateTaskSchema.safeParse({ title: 'Κάλεσε', type: 'call_back', dueDate: '2026-07-01' });
    expect(r.success).toBe(true);
  });

  it('rejects a missing title', () => {
    const r = CreateTaskSchema.safeParse({ type: 'call_back', dueDate: '2026-07-01' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown type', () => {
    const r = CreateTaskSchema.safeParse({ title: 'X', type: 'nope', dueDate: '2026-07-01' });
    expect(r.success).toBe(false);
  });

  it('rejects ai_draft as a write status', () => {
    const r = CreateTaskSchema.safeParse({ title: 'X', type: 'other', dueDate: '2026-07-01', status: 'ai_draft' });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed due date', () => {
    const r = CreateTaskSchema.safeParse({ title: 'X', type: 'other', dueDate: '01/07/2026' });
    expect(r.success).toBe(false);
  });

  it('accepts an empty dueTime (treated as null)', () => {
    const r = CreateTaskSchema.safeParse({ title: 'X', type: 'other', dueDate: '2026-07-01', dueTime: '' });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed dueTime', () => {
    const r = CreateTaskSchema.safeParse({ title: 'X', type: 'other', dueDate: '2026-07-01', dueTime: '25:00' });
    expect(r.success).toBe(false);
  });
});

describe('ListTasksQuerySchema', () => {
  it('defaults limit/offset', () => {
    const q = ListTasksQuerySchema.parse({});
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
  });
});

describe('dbToTask', () => {
  it('maps snake_case to camelCase', () => {
    const row = {
      id: 't1', customer_id: 'c1', offer_id: null, title: 'Κάλεσε', type: 'call_back',
      status: 'open', priority: 'high', due_date: '2026-07-01', due_time: '09:30',
      note: null, created_from_ai: false, completed_at: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    } satisfies TaskRow;
    const dto = dbToTask(row);
    expect(dto.customerId).toBe('c1');
    expect(dto.dueTime).toBe('09:30');
    expect(dto.createdFromAi).toBe(false);
  });
});
