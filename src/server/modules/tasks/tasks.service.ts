// Tasks — service (explicit validation + orchestration). Parity-matched to /api/tasks.
//
// Validation produces the route's EXACT error codes (invalid_title/_type/_due_date/
// _status/_priority/_due_time, customer_not_found, offer_not_found) rather than a
// generic Zod error, so the response contract is unchanged. The work-folder link and
// the customer notification are injected by the route (dependency injection), so this
// service imports nothing that would change behaviour or break unit tests.

import { AppError } from '../../core/errors';
import {
  TASK_PRIORITIES,
  TASK_STATUSES_READ,
  TASK_STATUSES_WRITE,
  TASK_TYPES,
} from './tasks.schema';
import { type Task, type TaskRow } from './tasks.types';
import {
  customerExists,
  fetchTaskRowForUpdate,
  getTaskRowById,
  insertTaskRow,
  listTaskRows,
  offerExists,
  updateTaskRow,
  type RepoContext,
} from './tasks.repo';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
function isValidEnum<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value);
}
const isValidDueDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isValidDueTime = (v: unknown): v is string => typeof v === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);

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

export interface ListTasksInput {
  status?: string | null;
  customerId?: string | null;
  limit?: string | null;
  offset?: string | null;
}

export async function listTasks(ctx: RepoContext, input: ListTasksInput): Promise<Task[]> {
  if (input.status && !isValidEnum(input.status, TASK_STATUSES_READ)) {
    throw new AppError('invalid_status', 400);
  }
  const limitRaw = parseInt(input.limit ?? '50', 10);
  const offsetRaw = parseInt(input.offset ?? '0', 10);
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
  const offset = Math.max(Number.isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  const rows = await listTaskRows(ctx, {
    status: input.status ?? undefined,
    customerId: input.customerId ?? undefined,
    limit,
    offset,
  });
  return rows.map(dbToTask);
}

export type FolderResolution =
  | { ok: true; workFolderId: string | null }
  | { ok: false; error: string; status: number };

export interface CreateTaskDeps {
  /** Resolve/validate an optional work-folder link (injected by the route). */
  resolveWorkFolder?: (rawWorkFolderId: unknown, customerId: string | null) => Promise<FolderResolution>;
  /** Notify the customer when a task is filed into their project (fire-and-forget). */
  notifyFolderUpdate?: (workFolderId: string, what: string) => void;
}

export async function createTask(
  ctx: RepoContext,
  raw: Record<string, unknown>,
  deps: CreateTaskDeps = {},
): Promise<Task> {
  const title = str(raw.title);
  if (!title) throw new AppError('invalid_title', 400);
  if (!isValidEnum(raw.type, TASK_TYPES)) throw new AppError('invalid_type', 400);
  if (!isValidDueDate(raw.dueDate)) throw new AppError('invalid_due_date', 400);

  if (raw.status != null) {
    if (raw.status === 'ai_draft' || !isValidEnum(raw.status, TASK_STATUSES_WRITE)) {
      throw new AppError('invalid_status', 400);
    }
  }
  if (raw.priority != null && !isValidEnum(raw.priority, TASK_PRIORITIES)) {
    throw new AppError('invalid_priority', 400);
  }
  if (raw.dueTime != null && raw.dueTime !== '' && !isValidDueTime(raw.dueTime)) {
    throw new AppError('invalid_due_time', 400);
  }

  const customerId = raw.customerId != null ? str(raw.customerId) : null;
  if (customerId && !(await customerExists(ctx, customerId))) {
    throw new AppError('customer_not_found', 404);
  }
  const rawOfferId = raw.offerId != null ? str(raw.offerId) : null;
  const offerId = rawOfferId && rawOfferId.length > 0 ? rawOfferId : null;
  if (offerId && !(await offerExists(ctx, offerId))) {
    throw new AppError('offer_not_found', 404);
  }

  let workFolderId: string | null = null;
  if (deps.resolveWorkFolder) {
    const fl = await deps.resolveWorkFolder(raw.workFolderId, customerId);
    if (!fl.ok) throw new AppError(fl.error, fl.status);
    workFolderId = fl.workFolderId;
  }

  const status = isValidEnum(raw.status, TASK_STATUSES_WRITE) ? raw.status : 'open';
  const dueTime = raw.dueTime != null && raw.dueTime !== '' && isValidDueTime(raw.dueTime) ? raw.dueTime : null;

  const row = await insertTaskRow(ctx, {
    customer_id: customerId,
    offer_id: offerId,
    title,
    type: raw.type,
    status,
    priority: isValidEnum(raw.priority, TASK_PRIORITIES) ? raw.priority : 'normal',
    due_date: raw.dueDate,
    due_time: dueTime,
    note: str(raw.note),
    created_from_ai: false,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    ...(workFolderId ? { work_folder_id: workFolderId } : {}),
  });

  if (workFolderId && (raw.type === 'book_appointment' || raw.type === 'visit_customer')) {
    deps.notifyFolderUpdate?.(workFolderId, 'νέο ραντεβού');
  }

  return dbToTask(row);
}

/** GET /api/tasks/[id]. task_query_failed (500) on DB error; task_not_found (404) when missing. */
export async function getTask(ctx: RepoContext, id: string): Promise<Task> {
  const row = await getTaskRowById(ctx, id);
  if (!row) throw new AppError('task_not_found', 404);
  return dbToTask(row);
}

/**
 * PATCH /api/tasks/[id]. Validates with the route's exact codes and order, builds the
 * update from whitelisted fields only (preserving every coercion quirk: dueTime ''→null,
 * customerId/offerId null-or-string, auto completed_at on status='completed'), and
 * returns the current row unchanged when no allowed field was supplied.
 */
export async function updateTask(
  ctx: RepoContext,
  id: string,
  raw: Record<string, unknown>,
): Promise<Task> {
  // ---- validation (exact codes, exact order) ----
  if ('title' in raw && !str(raw.title)) {
    throw new AppError('invalid_title', 400);
  }
  if ('type' in raw && !isValidEnum(raw.type, TASK_TYPES)) {
    throw new AppError('invalid_type', 400);
  }
  if ('status' in raw) {
    if (raw.status === 'ai_draft') throw new AppError('invalid_status', 400);
    if (!isValidEnum(raw.status, TASK_STATUSES_WRITE)) throw new AppError('invalid_status', 400);
  }
  if ('priority' in raw && !isValidEnum(raw.priority, TASK_PRIORITIES)) {
    throw new AppError('invalid_priority', 400);
  }
  if ('dueDate' in raw && !isValidDueDate(raw.dueDate)) {
    throw new AppError('invalid_due_date', 400);
  }
  if ('dueTime' in raw && raw.dueTime !== null && raw.dueTime !== '' && !isValidDueTime(raw.dueTime)) {
    throw new AppError('invalid_due_time', 400);
  }
  // completedAt explicit null while status is being set to completed is contradictory.
  if ('completedAt' in raw && raw.completedAt === null) {
    const incomingStatus = 'status' in raw ? raw.status : undefined;
    if (incomingStatus === 'completed') throw new AppError('invalid_completed_at', 400);
  }
  // Customer ownership validation (drops cross-tenant ids → 404).
  if ('customerId' in raw && raw.customerId !== null) {
    const customerId = str(raw.customerId);
    if (customerId && !(await customerExists(ctx, customerId))) {
      throw new AppError('customer_not_found', 404);
    }
  }

  // ---- build update object from allowed fields only ----
  const updateFields: Record<string, unknown> = {};
  let hasUpdate = false;

  if ('title' in raw) { updateFields.title = str(raw.title); hasUpdate = true; }
  if ('type' in raw && isValidEnum(raw.type, TASK_TYPES)) { updateFields.type = raw.type; hasUpdate = true; }
  if ('status' in raw && isValidEnum(raw.status, TASK_STATUSES_WRITE)) { updateFields.status = raw.status; hasUpdate = true; }
  if ('priority' in raw && isValidEnum(raw.priority, TASK_PRIORITIES)) { updateFields.priority = raw.priority; hasUpdate = true; }
  if ('dueDate' in raw && isValidDueDate(raw.dueDate)) { updateFields.due_date = raw.dueDate; hasUpdate = true; }
  if ('dueTime' in raw) {
    updateFields.due_time = (raw.dueTime === null || raw.dueTime === '') ? null : raw.dueTime;
    hasUpdate = true;
  }
  if ('note' in raw) { updateFields.note = str(raw.note); hasUpdate = true; }
  if ('customerId' in raw) {
    updateFields.customer_id = raw.customerId === null ? null : str(raw.customerId);
    hasUpdate = true;
  }
  if ('offerId' in raw) {
    updateFields.offer_id = raw.offerId === null ? null : str(raw.offerId);
    hasUpdate = true;
  }
  if ('completedAt' in raw) {
    updateFields.completed_at = raw.completedAt === null ? null : str(raw.completedAt);
    hasUpdate = true;
  } else if ('status' in raw && isValidEnum(raw.status, TASK_STATUSES_WRITE) && raw.status === 'completed') {
    updateFields.completed_at = new Date().toISOString();
    hasUpdate = true;
  }

  // No allowed field supplied → return the current task unchanged.
  if (!hasUpdate) {
    const existing = await fetchTaskRowForUpdate(ctx, id);
    if (!existing) throw new AppError('task_not_found', 404);
    return dbToTask(existing);
  }

  updateFields.updated_at = new Date().toISOString();
  const row = await updateTaskRow(ctx, id, updateFields);
  if (!row) throw new AppError('task_not_found', 404);
  return dbToTask(row);
}
