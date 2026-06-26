// Tasks — service (business logic). Reference module.
//
// NOTE: the live route also resolves an optional work-folder link and fires a
// customer notification for appointments filed into a project. Those orchestration
// side-effects are intentionally omitted from this reference cut and are folded
// back in during adoption (they live in src/lib/server/{folder-link,notify-folder-update}).

import { AppError } from '../../core/errors';
import { CreateTaskSchema, ListTasksQuerySchema } from './tasks.schema';
import { type Task, type TaskRow } from './tasks.types';
import {
  customerExists,
  insertTaskRow,
  listTaskRows,
  offerExists,
  type RepoContext,
} from './tasks.repo';

export function dbToTask(row: TaskRow): Task {
  return {
    id: row.id,
    customerId: row.customer_id,
    offerId: row.offer_id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    note: row.note,
    createdFromAi: row.created_from_ai,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTasks(ctx: RepoContext, rawQuery: unknown): Promise<Task[]> {
  const query = ListTasksQuerySchema.parse(rawQuery);
  const rows = await listTaskRows(ctx, query);
  return rows.map(dbToTask);
}

export async function createTask(ctx: RepoContext, rawInput: unknown): Promise<Task> {
  const input = CreateTaskSchema.parse(rawInput);

  if (input.customerId && !(await customerExists(ctx, input.customerId))) {
    throw new AppError('customer_not_found', 404);
  }
  if (input.offerId && !(await offerExists(ctx, input.offerId))) {
    throw new AppError('offer_not_found', 404);
  }

  const status = input.status ?? 'open';
  const dueTime = input.dueTime && input.dueTime !== '' ? input.dueTime : null;

  const row = await insertTaskRow(ctx, {
    customer_id: input.customerId ?? null,
    offer_id: input.offerId ?? null,
    title: input.title,
    type: input.type,
    status,
    priority: input.priority ?? 'normal',
    due_date: input.dueDate,
    due_time: dueTime,
    note: input.note ?? null,
    created_from_ai: false,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  });

  return dbToTask(row);
}
