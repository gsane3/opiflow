// POST /api/push/test
//
// ADOPTED to the modular pattern (src/server/modules/push): thin adapter. The
// "is push configured? send to the caller's OWN devices" logic lives in the service.
// Preserves the exact behaviour: 200 + push_not_configured when push is off, the
// sender result spread into the body, and Cache-Control: no-store on every response.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { handleApiError } from '@/server/core/errors';
import { sendTestPush } from '@/server/modules/push/push.service';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  const outcome = await sendTestPush(ctx.userId);
  if (!outcome.configured) {
    return NextResponse.json(
      { ok: false, error: 'push_not_configured' },
      { status: 200, headers: NO_STORE },
    );
  }
  return NextResponse.json({ ok: true, ...outcome.result }, { headers: NO_STORE });
}
