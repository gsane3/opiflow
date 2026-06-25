// GET|POST /api/cron/intake-reminder
//
// Hourly cron endpoint that re-sends the customer intake request to customers
// who were sent an intake link but have not submitted it within ~1 hour.
//
// Trusted, system-wide cron (NOT per-user): it scans intake tokens across all
// businesses. Access is gated by a shared secret (CRON_SECRET) supplied via the
// `x-cron-secret` header or a `?secret=` query param. In production, if
// CRON_SECRET is unset the endpoint fails closed (503); in non-prod it is
// allowed so local/dev runs work without configuration.
//
// Graceful degradation: the candidate query reads the reminder bookkeeping
// columns (reminder_sent_at, reminder_count) introduced in migration 035. Those
// migrations are applied MANUALLY. If 035 has not been applied yet the query
// errors on the missing columns; we detect that and return a safe no-op
// ({ ok: true, skipped: true, reason: 'migration_035_pending', resent: 0 })
// instead of failing, so the cron is harmless until the migration lands.
//
// Re-send mechanics: intake tokens store only a SHA-256 hash of the raw public
// token (see migration 005), so the original sendable URL cannot be recovered
// from an existing row. To re-send we mint a FRESH token for the customer
// (createCustomerIntakeToken), revoke the stale one, and carry the reminder
// bookkeeping forward onto the new token (reminder_count + 1, reminder_sent_at
// = now). The new token inherits the elapsed reminder budget so we never exceed
// the per-customer cap of 2 reminders.
//
// The post-auth sweep logic lives in src/server/modules/cron (cron.service.ts →
// runReminderSweep + runExpireSweep); this route stays a thin auth → service →
// response shell.

import { NextRequest, NextResponse } from 'next/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { runReminderSweep, runExpireSweep } from '@/server/modules/cron/cron.service';

export const runtime = 'nodejs';

// Don't let a cron invocation be cached / statically optimised.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Secret gating
// ---------------------------------------------------------------------------

// Cron auth uses the shared guard (src/lib/server/cron-auth.ts) which also
// accepts `Authorization: Bearer <CRON_SECRET>` — what Vercel Cron sends — so the
// vercel.json daily schedule authenticates (the old inline guard only accepted
// x-cron-secret/?secret= and silently 401'd Vercel's own invocation).

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handle(request: NextRequest): Promise<NextResponse> {
  const gate = checkCronSecret(request, 'intake-reminder cron');
  if (gate) return gate;

  try {
    const result = await runReminderSweep();
    // Run the soft-expire sweep regardless of whether anything was re-sent.
    const expireResult = await runExpireSweep();
    result.expired = expireResult.expired;
    const status = result.ok ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error(
      '[intake-reminder cron] unexpected failure:',
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { ok: false, resent: 0, skipped: 0, reason: 'server_error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
