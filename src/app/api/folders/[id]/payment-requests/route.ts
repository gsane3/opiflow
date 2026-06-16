// GET /api/folders/[id]/payment-requests — list a folder's payment requests for
// the owner UI (create / confirm / cancel). Authenticated business API; the
// service-role client is explicitly scoped by business_id + work_folder_id, and
// the folder is verified to belong to this business first (no cross-tenant leak).
// Tolerant of the pre-migration-048 state: if payment_requests doesn't exist yet
// it degrades to an empty list instead of 500, so the folder panel never breaks.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { mapBusinessPayment, PAYMENT_REQUEST_COLUMNS, type PaymentRequestRow } from '@/lib/server/payments';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: folderId } = await params;

    // Folder must belong to this business (work_folders exists since migration 046).
    const { data: folderData, error: folderErr } = await supabase
      .from('work_folders')
      .select('id')
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) return NextResponse.json({ ok: true, payments: [] });
    if (!folderData) return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });

    const { data, error } = await supabase
      .from('payment_requests')
      .select(PAYMENT_REQUEST_COLUMNS)
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .order('created_at', { ascending: false });
    if (error) {
      // Most likely pre-048 (table absent) — degrade to empty, never 500.
      return NextResponse.json({ ok: true, payments: [] });
    }

    const payments = ((data as unknown as PaymentRequestRow[]) ?? []).map(mapBusinessPayment);
    return NextResponse.json({ ok: true, payments });
  } catch {
    return NextResponse.json({ ok: true, payments: [] });
  }
}
