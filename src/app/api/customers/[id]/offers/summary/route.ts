// GET /api/customers/[id]/offers/summary
//
// Aggregated offers for one customer — backs the "συγκεντρωτικά προσφορές" block
// in the customer info panel (redesign P3). Derived (no new table). Service-role
// bypasses RLS, so the query is explicitly scoped by business_id + customer_id.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  const { data, error } = await supabase
    .from('offers')
    .select('id, status, total, offer_date, created_at')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: 'offers_summary_failed' }, { status: 500 });
  }

  const offers = ((data ?? []) as unknown[]) as Array<{
    id: string; status: string; total: number | null; offer_date: string | null; created_at: string;
  }>;

  const PENDING = new Set(['draft', 'ready_to_send', 'sent_manually']);
  let totalValue = 0;
  let acceptedCount = 0;
  let pendingCount = 0;
  for (const o of offers) {
    if (typeof o.total === 'number') totalValue += o.total;
    if (o.status === 'accepted') acceptedCount += 1;
    else if (PENDING.has(o.status)) pendingCount += 1;
  }

  const latest = offers[0] ?? null;

  return NextResponse.json({
    ok: true,
    summary: {
      offerCount: offers.length,
      totalValue,
      acceptedCount,
      pendingCount,
      latestStatus: latest?.status ?? null,
      latestOfferDate: latest?.offer_date ?? latest?.created_at ?? null,
    },
  });
}
