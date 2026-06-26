// POST/DELETE /api/push/register
//
// ADOPTED to the modular pattern (src/server/modules/push): thin adapter. Token/
// platform validation + the upsert/delete live in the service; this keeps the exact
// behaviour, including degraded:true (200, never 500) when migration 032 is missing,
// and Cache-Control: no-store on every response.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { handleApiError } from '@/server/core/errors';
import { registerDeviceToken, unregisterDeviceToken } from '@/server/modules/push/push.service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  let body: { token?: string; platform?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await registerDeviceToken(ctx, body);
    if (result.status === 'degraded') {
      return NextResponse.json(
        { ok: false, error: 'push_register_unavailable', degraded: true },
        { status: 200, headers: NO_STORE },
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
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

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await unregisterDeviceToken(ctx, body);
    if (result.status === 'degraded') {
      return NextResponse.json({ ok: true, degraded: true }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return noStore(handleApiError(err));
  }
}
