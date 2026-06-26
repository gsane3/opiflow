// GET /api/customers/[id]/offers/summary
//
// ADOPTED to the modular pattern (src/server/modules/customers): thin adapter. The
// aggregation (count, total value, accepted/pending counts, latest) lives in the
// service; the query stays tenant-scoped (business_id + customer_id). Byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { getCustomerOffersSummary } from '@/server/modules/customers/customers.service';

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
    const summary = await getCustomerOffersSummary(ctx, customerId);
    return ok({ summary });
  } catch (err) {
    return handleApiError(err);
  }
}
