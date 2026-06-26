// Appointment response links — repository (tenant-safe data access).
//
// The appointment task lookup that gates link creation. `tasks` carries a
// business_id column, so the read is tenant-scoped via tenantDb. A DB error is
// surfaced as the route's single catch-all code (appointment_response_link_create_failed,
// 500); a missing row returns null so the service can map it to task_not_found (404).

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface TaskCheckRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  type: string;
  status: string;
}

/**
 * Fetch the appointment task that a response link will point at, scoped to this
 * tenant. DB error → appointment_response_link_create_failed (500); null when no row.
 */
export async function getAppointmentTaskForLink(
  ctx: RepoContext,
  taskId: string,
): Promise<TaskCheckRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('tasks')
    .byId(taskId, 'id, business_id, customer_id, type, status')
    .maybeSingle();

  if (error) throw new AppError('appointment_response_link_create_failed', 500);
  return (data as unknown as TaskCheckRow) ?? null;
}
