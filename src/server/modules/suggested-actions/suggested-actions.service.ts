// Suggested actions — service. Parity-matched to /api/customers/[id]/suggested-actions.
// Persisted AI "next action" chips (table: suggested_actions, migration 041). The pure
// derive helper is reused verbatim; every query is tenant-scoped via tenantDb.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { deriveSuggestedActions, type LooseAiResult } from '../../../lib/server/suggested-actions';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };

const ACTION_COLUMNS = 'id, action_type, label, params, status, created_at';
const VALID_PATCH_STATUS = ['done', 'dismissed'] as const;

interface ActionRow {
  id: string;
  action_type: string;
  label: string;
  params: Record<string, unknown> | null;
  status: string;
  created_at: string;
}
export interface SuggestedActionDTO {
  id: string;
  actionType: string;
  label: string;
  params: Record<string, unknown> | null;
  createdAt: string;
}
function mapAction(r: ActionRow): SuggestedActionDTO {
  return { id: r.id, actionType: r.action_type, label: r.label, params: r.params, createdAt: r.created_at };
}

/** GET — pending actions for a customer (newest first). query_failed (500) on DB error. */
export async function listSuggestedActions(ctx: Ctx, customerId: string): Promise<SuggestedActionDTO[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('suggested_actions')
    .select(ACTION_COLUMNS)
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new AppError('query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => mapAction(r as ActionRow));
}

/**
 * POST — derive actions from an AI result and replace the pending set. Empty derivation
 * short-circuits to { inserted:0, actions:[] } BEFORE any DB work. customer_not_found
 * (404) for a cross-tenant id; insert_failed (500) on the replacement insert.
 */
export async function deriveAndReplaceActions(
  ctx: Ctx,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<{ inserted: number; actions: SuggestedActionDTO[] }> {
  const derived = deriveSuggestedActions((raw.result ?? null) as LooseAiResult | null);
  if (derived.length === 0) return { inserted: 0, actions: [] };

  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data: cust } = await db.from('customers').byId(customerId, 'id').maybeSingle();
  if (!cust) throw new AppError('customer_not_found', 404);

  // Supersede the existing pending set so chips reflect the latest brief.
  await db.from('suggested_actions').update({ status: 'dismissed' }).eq('customer_id', customerId).eq('status', 'pending');

  const rows = derived.map((d) => ({
    customer_id: customerId,
    action_type: d.actionType,
    label: d.label,
    params: d.params,
    status: 'pending',
  }));
  const { data, error } = await db.from('suggested_actions').insert(rows).select(ACTION_COLUMNS);
  if (error) throw new AppError('insert_failed', 500);
  const actions = ((data ?? []) as unknown[]).map((r) => mapAction(r as ActionRow));
  return { inserted: actions.length, actions };
}

/** PATCH — mark one action done/dismissed. invalid_body (400); update_failed (500). */
export async function updateSuggestedAction(
  ctx: Ctx,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const actionId = typeof raw.id === 'string' ? raw.id : null;
  const status =
    typeof raw.status === 'string' && (VALID_PATCH_STATUS as readonly string[]).includes(raw.status) ? raw.status : null;
  if (!actionId || !status) throw new AppError('invalid_body', 400);

  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('suggested_actions').update({ status }).eq('id', actionId).eq('customer_id', customerId);
  if (error) throw new AppError('update_failed', 500);
}
