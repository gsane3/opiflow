// Shared auth guard for cron endpoints.
//
// Accepts the secret via (a) `Authorization: Bearer <CRON_SECRET>` — what
// Vercel Cron sends automatically when the CRON_SECRET env var is set —
// (b) the `x-cron-secret` header, or (c) the `?secret=` query param (manual
// runs / external schedulers). Fails closed in production when CRON_SECRET
// is unset; allows unauthenticated in non-prod so local runs work.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';

export function checkCronSecret(request: NextRequest, label: string): NextResponse | null {
  const expected = process.env.CRON_SECRET?.trim() ?? '';

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[${label}] CRON_SECRET is not set in production — rejecting.`);
      return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 503 });
    }
    console.warn(`[${label}] CRON_SECRET is not set — endpoint is UNAUTHENTICATED (non-prod).`);
    return null;
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const headerSecret = request.headers.get('x-cron-secret') ?? '';
  const querySecret = request.nextUrl.searchParams.get('secret') ?? '';

  if (
    timingSafeEqualSecret(bearer, expected) ||
    timingSafeEqualSecret(headerSecret, expected) ||
    timingSafeEqualSecret(querySecret, expected)
  ) {
    return null;
  }

  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}
