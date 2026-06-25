// Next action — service. Parity-matched to /api/customers/[id]/next-action.
// The single "Next Best Action" for a customer with no work folder yet. Computation +
// lifecycle live in the existing src/lib/server/next-action-store (relative imports, no
// @/ alias); this layer adds the route's exact validation/tolerance.

import { AppError } from '../../core/errors';
import type { TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  computeCustomerNextAction,
  applyNextActionLifecycle,
  isNextActionLifecycle,
} from '../../../lib/server/next-action-store';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };

/** GET — the computed next action, or null (tolerant of a pending migration 054). */
export async function getNextAction(ctx: Ctx, customerId: string): Promise<unknown> {
  try {
    return await computeCustomerNextAction(ctx.supabase, ctx.businessId, customerId);
  } catch {
    return null;
  }
}

/** PATCH — mark the active action accepted/dismissed/snoozed/completed. invalid_body (400). Returns res.ok. */
export async function applyNextAction(ctx: Ctx, raw: Record<string, unknown>): Promise<boolean> {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const action = isNextActionLifecycle(raw.action) ? raw.action : null;
  if (!id || !action) throw new AppError('invalid_body', 400);
  const snoozeMinutes = typeof raw.snoozeMinutes === 'number' ? raw.snoozeMinutes : undefined;
  const res = await applyNextActionLifecycle(ctx.supabase, { businessId: ctx.businessId, id, action, snoozeMinutes });
  return res.ok;
}
