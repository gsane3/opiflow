// Scheduled messages — repository (tenant-safe data access). Mirrors
// /api/scheduled-messages/[id].

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

/**
 * Cancel a pending scheduled message. Scoped to id + business + status='pending',
 * so already-sent/cancelled rows (or another tenant's id) match nothing — a no-op
 * that still resolves ok, exactly like the live route.
 */
export async function cancelScheduledMessageRow(ctx: RepoContext, id: string): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) throw new AppError('cancel_failed', 500);
}
