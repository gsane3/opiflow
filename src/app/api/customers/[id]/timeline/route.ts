// GET /api/customers/[id]/timeline
//
// ADOPTED to the modular pattern (src/server/modules/customers/customer-timeline): thin
// adapter. The per-customer "chat" aggregation (communications + call_briefs, offers +
// responses, appointment tasks + responses, intake tokens, upload sessions) lives in the
// service, every query scoped by business_id + customer_id. Byte-identical: customer_not_found
// (404), timeline_query_failed (500), oldest→newest order, ITEM_LIMIT cap.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { buildCustomerTimeline } from '@/server/modules/customers/customer-timeline';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id: customerId } = await params;
    const result = await buildCustomerTimeline(ctx, customerId);
    return ok({ customer: result.customer, items: result.items });
  } catch (err) {
    return handleApiError(err);
  }
}
