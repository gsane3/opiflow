// Payments — repository (tenant-safe data access). Mirrors /api/payments/[id].
//
// The single mutation is the ATOMIC settle transition: only a non-final
// (`status not in (confirmed,cancelled)`) row may move to confirmed/cancelled,
// scoped to the tenant. tenantDb injects `.eq('business_id', businessId)`; the
// `.eq('id', id)` + `.not('status','in',...)` + select keep the original guard.
//
// Per-operation error codes match the live route exactly:
//   - DB error               → payment_update_failed (500)
//   - 0 rows (not actionable) → payment_not_actionable (409)

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  PAYMENT_REQUEST_COLUMNS,
  type PaymentRequestRow,
} from '../../../lib/server/payments';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

/**
 * Atomically transition one payment request to a final status, business-scoped.
 * Only moves a non-final row (`.not('status','in','(confirmed,cancelled)')`) so a
 * double-confirm can't double-apply. Returns the updated row, or null when 0 rows
 * matched (not found for this business OR already settled).
 */
export async function settlePaymentRequest(
  ctx: RepoContext,
  id: string,
  fields: Record<string, unknown>,
): Promise<PaymentRequestRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('payment_requests')
    .update(fields)
    .eq('id', id)
    .not('status', 'in', '(confirmed,cancelled)')
    .select(PAYMENT_REQUEST_COLUMNS)
    .maybeSingle();

  if (error) throw new AppError('payment_update_failed', 500);
  return (data as unknown as PaymentRequestRow) ?? null;
}
