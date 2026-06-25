// CRM communications timeline — list/create/delete/relink.
//
// ADOPTED to the modular pattern (src/server/modules/communications): thin HTTP
// adapter; the validation, customer-join assembly, ownership checks, and tenant-safe
// DB access live in the service/repo. Responses (incl. the customer-join shape, the
// `count`, the `Cache-Control: no-store` on writes, and every error code) are identical.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import {
  listCommunications,
  createCommunication,
  deleteCommunication,
  updateCommunication,
} from '@/server/modules/communications/communications.service';

export const runtime = 'nodejs';

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const sp = request.nextUrl.searchParams;
    const communications = await listCommunications(ctx, {
      channel: sp.get('channel'),
      direction: sp.get('direction'),
      customerId: sp.get('customerId'),
      limit: sp.get('limit'),
      offset: sp.get('offset'),
    });
    return ok({ communications, count: communications.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore(fail('invalid_body', 400));
  }
  try {
    const communication = await createCommunication(ctx, body);
    return noStore(ok({ communication }));
  } catch (err) {
    return noStore(handleApiError(err));
  }
}

export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return noStore(fail('missing_id', 400));
  try {
    await deleteCommunication(ctx, id);
    return noStore(ok({}));
  } catch (err) {
    return noStore(handleApiError(err));
  }
}

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return noStore(fail('missing_id', 400));
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore(fail('invalid_body', 400));
  }
  try {
    const communication = await updateCommunication(ctx, id, body);
    return noStore(ok({ communication }));
  } catch (err) {
    return noStore(handleApiError(err));
  }
}
