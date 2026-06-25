// Tasks — repository (tenant-safe data access). Reference module.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { TASK_COLUMNS, type TaskRow } from './tasks.types';
import type { ListTasksQuery } from './tasks.schema';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export async function listTaskRows(
  ctx: RepoContext,
  query: ListTasksQuery,
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
