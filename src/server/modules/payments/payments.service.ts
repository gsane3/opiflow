// Payments — service (explicit validation + orchestration). Parity-matched to
// PATCH /api/payments/[id].
//
// The live route validates status route-side (return) and wraps its whole body in
// a single catch that returns ONE code: payment_update_failed (500). To preserve
// that, this service:
//   - throws AppError('invalid_status', 400) for a bad status (exact code+status),
//   - lets the repo throw payment_update_failed (500) on DB error and
//     payment_not_actionable (409) on 0 rows,
//   - converts ANY other unexpected throw to AppError('payment_update_failed', 500)
//     (rethrowing AppError as-is), so an unexpected rejection yields that one code
//     rather than a generic internal_error.
//
// 'confirmed' is the only authoritative state; confirming also stamps confirmed_at.

import { AppError } from '../../core/errors';
import {
  mapBusinessPayment,
  type BusinessPayment,
  type PaymentRequestRow,
} from '../../../lib/server/payments';
import { settlePaymentRequest, type RepoContext } from './payments.repo';

/** Optional post-confirm side-effect hook (e.g. auto-issue a myDATA invoice). */
export interface UpdatePaymentDeps {
  /** Called AFTER a successful 'confirmed' transition, with the raw settled row.
   *  Must be fire-and-forget at the call site — it can never affect the response. */
  onConfirmed?: (row: PaymentRequestRow) => void;
}

/**
 * Confirm (or cancel) a payment request. `raw` is the parsed JSON body.
 * Validation order + codes match the route exactly:
 *   1. status must be 'confirmed' | 'cancelled' → invalid_status (400)
 * Then the atomic settle (payment_update_failed 500 / payment_not_actionable 409).
 */
export async function updatePaymentRequest(
  ctx: RepoContext,
  id: string,
  raw: Record<string, unknown>,
  deps: UpdatePaymentDeps = {},
): Promise<BusinessPayment> {
  // status validation runs OUTSIDE the broad-catch semantics (it's a known code).
  if (raw.status !== 'confirmed' && raw.status !== 'cancelled') {
    throw new AppError('invalid_status', 400);
  }
  const status = raw.status;

  try {
    const now = new Date().toISOString();

    const row = await settlePaymentRequest(ctx, id, {
      status,
      updated_at: now,
      ...(status === 'confirmed' ? { confirmed_at: now } : {}),
    });

    if (!row) throw new AppError('payment_not_actionable', 409);

    // Post-confirm side-effect (best-effort): guarded so it can NEVER throw into
    // the broad-catch below (which would wrongly collapse to payment_update_failed).
    if (status === 'confirmed') {
      try {
        deps.onConfirmed?.(row);
      } catch {
        /* side-effect must never affect the confirm response */
      }
    }

    return mapBusinessPayment(row);
  } catch (err) {
    // Broad-catch parity: rethrow known AppErrors; collapse anything else to the
    // route's single body-level code.
    if (err instanceof AppError) throw err;
    throw new AppError('payment_update_failed', 500);
  }
}
