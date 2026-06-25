// GET /api/folders/[id]/payment-requests — list a folder's payment requests for
// the owner UI (create / confirm / cancel).
//
// ADOPTED to the modular pattern (src/server/modules/folder-actions): thin adapter.
// The folder is verified to belong to this business first (folder_not_found 404,
// no cross-tenant leak). Tolerant of the pre-migration-048 state: a query error
// (table absent) degrades to an empty list instead of 500, and the route's
// body-level broad-catch keeps the same { ok:true, payments:[] } fallback.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { fail, handleApiError } from '@/server/core/errors';
import { listFolderPaymentRequests } from '@/server/modules/folder-actions/folder-actions.service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  try {
    const { id: folderId } = await params;
    const { folderNotFound, payments } = await listFolderPaymentRequests(ctx, folderId);
    if (folderNotFound) return fail('folder_not_found', 404);
    return NextResponse.json({ ok: true, payments });
  } catch {
    return NextResponse.json({ ok: true, payments: [] });
  }
}
