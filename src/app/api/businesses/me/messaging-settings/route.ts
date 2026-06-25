// GET   /api/businesses/me/messaging-settings
// PATCH /api/businesses/me/messaging-settings
//
// ADOPTED to the modular pattern (src/server/modules/messaging-settings): thin adapter.
// The 044-tolerant read/write + parseHours live in the service. The route preserves the
// exact header/shape asymmetry: GET responses + the PATCH success/update_failed carry
// Cache-Control: no-store, but PATCH invalid_json/no_fields do NOT; a 404 (no business
// yet) on GET returns the defaults. Byte-identical.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { fail, handleApiError, AppError } from '@/server/core/errors';
import { getMessagingSettings, updateMessagingSettings, MESSAGING_DEFAULTS } from '@/server/modules/messaging-settings/messaging-settings.service';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      return NextResponse.json({ ok: true, settings: MESSAGING_DEFAULTS }, { headers: NO_STORE });
    }
    return handleApiError(err);
  }

  const result = await getMessagingSettings(ctx);
  if (result.degraded) {
    return NextResponse.json({ ok: true, settings: result.settings, degraded: true }, { headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, settings: result.settings }, { headers: NO_STORE });
}

export async function PATCH(request: NextRequest) {
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

  try {
    const result = await updateMessagingSettings(ctx, body as Record<string, unknown>);
    if (!result.updated) {
      return NextResponse.json(
        { ok: false, error: 'update_failed', hint: 'migration_044_pending' },
        { status: 503, headers: NO_STORE },
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return handleApiError(err);
  }
}
