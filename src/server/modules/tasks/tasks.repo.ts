// Tasks — repository (tenant-safe data access). Reference module.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { TASK_COLUMNS, type TaskRow } from './tasks.types';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface ListTaskRowsParams {
  status?: string;
  customerId?: string;
  limit: number;
  offset: number;
}

export async function listTaskRows(
  ctx: RepoContext,
  query: ListTaskRowsParams,
): Promise<TaskRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db.from('tasks').select(TASK_COLUMNS);
  if (query.status) qb = qb.eq('status', query.status);
  if (query.customerId) qb = qb.eq('customer_id', query.customerId);
  qb = qb
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  const { data, error } = await qb;
  if (error) throw new AppError('tasks_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as TaskRow);
}

export async function insertTaskRow(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<TaskRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('tasks')
    .insert(values)
    .select(TASK_COLUMNS)
    .single();
  if (error || !data) throw new AppError('task_create_failed', 500);
  return data as unknown as TaskRow;
}

/** Fetch one task by id (GET). DB error → task_query_failed; null when no row. */
export async function getTaskRowById(ctx: RepoContext, id: string): Promise<TaskRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('tasks').byId(id, TASK_COLUMNS).maybeSingle();
  if (error) throw new AppError('task_query_failed', 500);
  return (data as unknown as TaskRow) ?? null;
}

/** Fetch one task by id on the no-field-change PATCH path. DB error → task_update_failed; null when no row. */
export async function fetchTaskRowForUpdate(ctx: RepoContext, id: string): Promise<TaskRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('tasks').byId(id, TASK_COLUMNS).maybeSingle();
  if (error) throw new AppError('task_update_failed', 500);
  return (data as unknown as TaskRow) ?? null;
}

/** Apply a partial update to one task. DB error → task_update_failed; null when no row. */
export async function updateTaskRow(
  ctx: RepoContext,
  id: string,
  fields: Record<string, unknown>,
): Promise<TaskRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('tasks')
    .update(fields)
    .eq('id', id)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError('task_update_failed', 500);
  return (data as unknown as TaskRow) ?? null;
}

/** True if the customer exists and belongs to this tenant. */
export async function customerExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}

/** True if the offer exists and belongs to this tenant. */
export async function offerExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('offers').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}
