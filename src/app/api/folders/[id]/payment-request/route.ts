// POST /api/folders/[id]/payment-request — create a bank-transfer payment request
// (deposit/balance) for a job.
//
// ADOPTED to the modular pattern (src/server/modules/folder-actions): thin adapter.
// The amount is computed SERVER-SIDE from the offer gross and the IBAN is
// snapshotted from the business bank details (both in the service). The route keeps
// the content-type 415 guard, the invalid_json parse guard, and injects the
// fire-and-forget customer notification; the service preserves the single
// body-level broad-catch (payment_request_failed 500). Requires migration 048.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { fail, handleApiError } from '@/server/core/errors';
import { notifyFolderUpdate } from '@/lib/server/notify-folder-update';
import { createFolderPaymentRequest } from '@/server/modules/folder-actions/folder-actions.service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail('unsupported_content_type', 415);
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  const { id: folderId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const payment = await createFolderPaymentRequest(ctx, folderId, body as Record<string, unknown>, {
      notifyFolderUpdate: (workFolderId, what) => {
        void notifyFolderUpdate({ businessId: ctx.businessId, workFolderId, what }).catch(() => {});
      },
    });
    return NextResponse.json({ ok: true, payment });
  } catch (err) {
    return handleApiError(err);
  }
}
