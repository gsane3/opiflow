// Notifications endpoint: returns recent customer-driven events for the
// authenticated business user. No provider sends. Read-only aggregation over
// offer_response_tokens, appointment_response_tokens, customer_intake_tokens,
// customer_upload_sessions (joined to customer_upload_tokens), and communications.
//
// Every query is explicitly scoped by business_id because the service-role
// client bypasses RLS. Never relax that filter.
//
// Thin route: auth (requireBusinessUser) → service (listNotifications) → error map.
// The big aggregation now lives in src/server/modules/notifications/. Auth-404 still
// returns an empty list rather than 404 so the bell never breaks; every other failure
// (including the offer/appointment token-query error) maps to notifications_query_failed.

import { NextRequest } from 'next/server';
import { AppError, handleApiError, ok } from '@/server/core/errors';
import { requireBusinessUser } from '@/server/core/http';
import { listNotifications } from '@/server/modules/notifications/notifications.service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    const notifications = await listNotifications(ctx);
    return ok({ notifications });
  } catch (err) {
    // No business yet: return empty list rather than 404 to avoid breaking the bell.
    if (err instanceof AppError && err.status === 404) {
      return ok({ notifications: [] });
    }
    return handleApiError(err);
  }
}
