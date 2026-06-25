// Offers list and create (GET /api/offers, POST /api/offers).
//
// ADOPTED to the modular pattern (src/server/modules/offers): thin adapter. Validation
// (exact codes), offer-number generation, server-side totals, the offer + items insert
// with orphan cleanup, and the customer-join shape live in the service/repo; the
// work-folder link + notification are injected here. Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { listOffers, createOffer } from '@/server/modules/offers/offers.service';
import { resolveWorkFolderForCreate } from '@/lib/server/folder-link';
import { notifyFolderUpdate } from '@/lib/server/notify-folder-update';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const sp = request.nextUrl.searchParams;
    const offers = await listOffers(ctx, {
      status: sp.get('status'),
      customerId: sp.get('customerId'),
      limit: sp.get('limit'),
      offset: sp.get('offset'),
    });
    return ok({ offers, count: offers.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

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
    const offer = await createOffer(ctx, body as Record<string, unknown>, {
      resolveWorkFolder: (rawWf, customerId) =>
        resolveWorkFolderForCreate(ctx.supabase, ctx.businessId, rawWf, customerId),
      notifyFolderUpdate: (workFolderId, what) => {
        void notifyFolderUpdate({ businessId: ctx.businessId, workFolderId, what }).catch(() => {});
      },
    });
    return ok({ offer }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
