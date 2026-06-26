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

export interface ScheduledMessageRow {
  id: string;
  body: string;
  channel: string;
  scheduled_for: string;
  status: string;
}

/** Pending scheduled messages for one customer. DB error (pre-044) → []. */
export async function listScheduledMessageRowsForCustomer(
  ctx: RepoContext,
  customerId: string,
): Promise<ScheduledMessageRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('scheduled_messages')
    .select('id, body, channel, scheduled_for, status')
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true });
  if (error) return [];
  return ((data ?? []) as unknown[]).map((r) => r as ScheduledMessageRow);
}

/** Fetch the customer's phone columns to validate ownership + reachability. null when not this tenant. */
export async function fetchCustomerForSchedule(
  ctx: RepoContext,
  customerId: string,
): Promise<{ phone: string | null; mobile_phone: string | null; landline_phone: string | null } | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(customerId, 'id, phone, mobile_phone, landline_phone').maybeSingle();
  return (data as unknown as { phone: string | null; mobile_phone: string | null; landline_phone: string | null }) ?? null;
}

/** Insert a scheduled message. Returns the new id, or null when the insert failed (pre-044). */
export async function insertScheduledMessage(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<string | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('scheduled_messages').insert(values).select('id').single();
  if (error || !data) return null;
  return (data as unknown as { id: string }).id;
}
