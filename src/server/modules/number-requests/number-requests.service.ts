// Phone-number requests — service. Parity-matched to /api/number-requests.
// Returns the exact success payload shapes the route serializes; throws AppError for
// the error cases (business_query_failed, activation_required, request_create_failed,
// business_not_found). The route maps any *unexpected* throw to number_request_route_failed.

import { AppError } from '../../core/errors';
import { hasFeature } from '../../../lib/billing/entitlement';
import {
  getBusinessNumberInfo,
  getPendingRequest,
  getSubscriptionStatus,
  insertPendingRequest,
  type PendingRequestRow,
  type RepoContext,
} from './number-requests.repo';

interface NumberRequestView {
  status: string;
  requestedCity: string | null;
  createdAt: string;
}

function toView(row: PendingRequestRow): NumberRequestView {
  return { status: row.status, requestedCity: row.requested_city ?? null, createdAt: row.created_at };
}

export async function getNumberRequest(ctx: RepoContext): Promise<{ numberRequest: NumberRequestView | null }> {
  const pending = await getPendingRequest(ctx, true);
  return { numberRequest: pending ? toView(pending) : null };
}

export type EnsureNumberRequestResult =
  | { status: 'already_assigned' }
  | { status: 'pending'; created: boolean; numberRequest: NumberRequestView };

export async function ensureNumberRequest(ctx: RepoContext): Promise<EnsureNumberRequestResult> {
  const business = await getBusinessNumberInfo(ctx);
  if (!business) throw new AppError('business_not_found', 404);

  // Number already assigned: no request needed.
  if (business.business_phone_number) return { status: 'already_assigned' };

  // Activation guard: a number is telephony — entitled AND non-Base plans only.
  const sub = await getSubscriptionStatus(ctx);
  if (!hasFeature(sub?.status ?? null, sub?.plan_key ?? null, 'telephony')) {
    throw new AppError('activation_required', 403);
  }

  // Idempotency: return any existing pending request.
  const existing = await getPendingRequest(ctx, false);
  if (existing) {
    return { status: 'pending', created: false, numberRequest: toView(existing) };
  }

  const requestedCity = business.city ?? null;
  const error = await insertPendingRequest(ctx, requestedCity);
  if (error) {
    // A concurrent insert won the partial-unique index → treat as an existing pending request.
    if (error.code === '23505' || (error.message ?? '').toLowerCase().includes('unique')) {
      return {
        status: 'pending',
        created: false,
        numberRequest: { status: 'pending', requestedCity, createdAt: new Date().toISOString() },
      };
    }
    throw new AppError('request_create_failed', 500);
  }

  return {
    status: 'pending',
    created: true,
    numberRequest: { status: 'pending', requestedCity, createdAt: new Date().toISOString() },
  };
}
