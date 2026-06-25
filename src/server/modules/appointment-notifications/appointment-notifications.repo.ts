// Appointment notifications — repository (tenant-safe data access).
// Parity-matched to the task + customer lookups in POST /api/appointment-notifications.
//
// The two reads are tenant-scoped via tenantDb (auto .eq('business_id', …)). The task
// read surfaces its DB error so the service can map it to the route's appointment_
// notification_failed (500); the customer read in the original IGNORES its error and
// only branches on a missing row → the repo returns null on both error and no-row.

import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface TaskRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  type: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
}

export interface CustomerRow {
  id: string;
  name: string | null;
  mobile_phone: string | null;
  phone: string | null;
}

/**
 * Fetch one appointment task by id, tenant-scoped. Returns `{ row, error }` so the
 * service can mirror the route: on DB error → appointment_notification_failed (500);
 * on no row → task_not_found (404).
 */
export async function getTaskRow(
  ctx: RepoContext,
  taskId: string,
): Promise<{ row: TaskRow | null; error: boolean }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('tasks')
    .select('id, business_id, customer_id, type, status, due_date, due_time')
    .eq('id', taskId)
    .maybeSingle();
  if (error) return { row: null, error: true };
  return { row: (data as unknown as TaskRow) ?? null, error: false };
}

/**
 * Fetch one customer by id, tenant-scoped. The original ignores any DB error and
 * branches only on the absence of a row → return null on both error and no-row.
 */
export async function getCustomerRow(
  ctx: RepoContext,
  customerId: string,
): Promise<CustomerRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db
    .from('customers')
    .select('id, name, mobile_phone, phone')
    .eq('id', customerId)
    .maybeSingle();
  return (data as unknown as CustomerRow) ?? null;
}
