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

import { NextRequest, NextResponse } from 'next/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import {
  createServiceSupabaseClient,
  createCustomerIntakeToken,
} from '@/lib/server/intake-tokens';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';

export const runtime = 'nodejs';

// Don't let a cron invocation be cached / statically optimised.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
const MAX_REMINDERS = 2; // never send more than 2 reminders per customer
const BATCH_LIMIT = 50; // cap work per run
// Soft-expire grace after the last (2nd) reminder — the owner's "6h after the
// 24h mark". Approximate on the daily cron, which the owner accepted.
const EXPIRE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CandidateTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
  reminder_count: number | null;
  reminder_sent_at: string | null;
}

interface CustomerRow {
  id: string;
  business_id: string;
  name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  preferred_contact_method: string | null;
}

interface ReminderRunResult {
  ok: boolean;
  resent: number;
  skipped: number;
  expired?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Secret gating
// ---------------------------------------------------------------------------

// Cron auth uses the shared guard (src/lib/server/cron-auth.ts) which also
// accepts `Authorization: Bearer <CRON_SECRET>` — what Vercel Cron sends — so the
// vercel.json daily schedule authenticates (the old inline guard only accepted
// x-cron-secret/?secret= and silently 401'd Vercel's own invocation).

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Prefer a mobile number; fall back to the generic phone field.
function selectPhone(customer: CustomerRow): string | null {
  return str(customer.mobile_phone) ?? str(customer.phone);
}

function buildReminderMessage(url: string): string {
  return `Υπενθύμιση: συμπλήρωσε τα στοιχεία σου: ${url}`;
}

// Postgres "undefined column" error code. When migration 035 has not been
// applied yet, selecting reminder_count / reminder_sent_at fails with 42703.
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return (
    msg.includes('reminder_count') ||
    msg.includes('reminder_sent_at') ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

// ---------------------------------------------------------------------------
// Core run
// ---------------------------------------------------------------------------

async function runReminderSweep(): Promise<ReminderRunResult> {
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - STALE_AFTER_MS).toISOString();

  // ---------------------------------------------------------------------------
  // Candidate query.
  //
  // A token is a reminder candidate when:
  //   - status = 'sent'              (a link was actually delivered)
  //   - submitted_at IS NULL         (customer has not completed intake)
  //   - expires_at > now             (token still valid / not expired)
  //   - updated_at < now - 1h        (at least an hour has elapsed since the
  //                                    send / last touch — gives the customer
  //                                    a window before nudging)
  //   - reminder_count < 2           (per-customer reminder cap)
  //   - reminder_sent_at IS NULL OR reminder_sent_at < now - 1h
  //                                  (don't double-remind within an hour)
  //
  // reminder_count / reminder_sent_at come from migration 035. If 035 is not
  // applied the SELECT below errors on those columns; we catch and no-op.
  // ---------------------------------------------------------------------------

  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .select('id, business_id, customer_id, reminder_count, reminder_sent_at')
    .eq('status', 'sent')
    .is('submitted_at', null)
    .gt('expires_at', nowIso)
    .lt('updated_at', staleBeforeIso)
    .lt('reminder_count', MAX_REMINDERS)
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${staleBeforeIso}`)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    // Migration 035 not applied yet -> safe no-op until it lands.
    if (isMissingColumnError(error)) {
      return { ok: true, resent: 0, skipped: 0, reason: 'migration_035_pending' };
    }
    console.error('[intake-reminder cron] candidate query failed:', error.message);
    return { ok: false, resent: 0, skipped: 0, reason: 'query_failed' };
  }

  const candidates = (data ?? []) as CandidateTokenRow[];
  if (candidates.length === 0) {
    return { ok: true, resent: 0, skipped: 0 };
  }

  let resent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      // Load the customer for this token.
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, business_id, name, phone, mobile_phone, preferred_contact_method')
        .eq('id', candidate.customer_id)
        .eq('business_id', candidate.business_id)
        .maybeSingle();

      if (customerError || !customerData) {
        skipped += 1;
        continue;
      }

      const customer = customerData as unknown as CustomerRow;
      const phone = selectPhone(customer);
      if (!phone) {
        skipped += 1;
        continue;
      }

      // Mint a fresh, sendable token (raw token of the old row is not
      // recoverable — only its hash is stored). Default 72h expiry.
      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId: candidate.business_id,
          customerId: candidate.customer_id,
          phone,
          sentChannel: null, // becomes 'sent' below only if the send succeeds
        });
      } catch (err) {
        console.error(
          '[intake-reminder cron] token mint failed for customer',
          candidate.customer_id,
          err instanceof Error ? err.message : err
        );
        skipped += 1;
        continue;
      }

      const newTokenId = tokenResult.row.id;
      const text = buildReminderMessage(tokenResult.intakeUrl);

      // Send via the customer's preferred channel (Viber -> SMS fallback, or
      // SMS direct). Non-throwing; the message TEXT carries the URL so SMS works.
      const sendResult = await sendViaPreferredChannel({
        preferred: customer.preferred_contact_method,
        phone,
        text,
        customerId: customer.id,
        referenceId: `reminder:${candidate.id}`,
      });

      const sentNowIso = new Date().toISOString();
      const nextReminderCount = (candidate.reminder_count ?? 0) + 1;

      if (sendResult.ok) {
        // Mark the new token as actually sent and carry the reminder
        // bookkeeping forward onto it.
        await supabase
          .from('customer_intake_tokens')
          .update({
            status: 'sent',
            sent_channel: sendResult.channel === 'none' ? null : sendResult.channel,
            sent_to_phone: phone,
            reminder_count: nextReminderCount,
            reminder_sent_at: sentNowIso,
            updated_at: sentNowIso,
          })
          .eq('id', newTokenId);

        // Supersede the stale token so it is no longer a candidate.
        await supabase
          .from('customer_intake_tokens')
          .update({
            status: 'revoked',
            revoked_at: sentNowIso,
            updated_at: sentNowIso,
          })
          .eq('id', candidate.id);

        resent += 1;
      } else {
        // Send failed (e.g. Apifon not configured). Revoke the freshly-minted,
        // never-delivered token to avoid orphan pending rows, and bump the
        // OLD token's reminder bookkeeping so we back off for an hour and
        // eventually stop after the cap (prevents tight retry loops).
        await supabase
          .from('customer_intake_tokens')
          .update({
            status: 'revoked',
            revoked_at: sentNowIso,
            updated_at: sentNowIso,
          })
          .eq('id', newTokenId);

        await supabase
          .from('customer_intake_tokens')
          .update({
            reminder_count: nextReminderCount,
            reminder_sent_at: sentNowIso,
            updated_at: sentNowIso,
          })
          .eq('id', candidate.id);

        skipped += 1;
      }
    } catch (err) {
      console.error(
        '[intake-reminder cron] candidate processing failed:',
        err instanceof Error ? err.message : err
      );
      skipped += 1;
    }
  }

  return { ok: true, resent, skipped };
}

// ---------------------------------------------------------------------------
// Soft-expire sweep
//
// Customers who were sent the intake request, received both reminders, and still
// haven't submitted after a grace period are soft-expired: the token is marked
// 'expired' and the customer's intake_status flips to 'expired'. That drops them
// off the «Λείπουν στοιχεία» top-of-list (they stop being chased) — but the
// contact record itself is KEPT (soft, recoverable), per the owner's choice.
// ---------------------------------------------------------------------------

async function runExpireSweep(): Promise<{ expired: number; reason?: string }> {
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const graceBeforeIso = new Date(now.getTime() - EXPIRE_GRACE_MS).toISOString();

  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .select('id, business_id, customer_id')
    .eq('status', 'sent')
    .is('submitted_at', null)
    .gte('reminder_count', MAX_REMINDERS)
    .lt('reminder_sent_at', graceBeforeIso)
    .limit(BATCH_LIMIT);

  if (error) {
    if (isMissingColumnError(error)) return { expired: 0, reason: 'migration_035_pending' };
    console.error('[intake-reminder cron] expire query failed:', error.message);
    return { expired: 0, reason: 'query_failed' };
  }

  const stale = (data ?? []) as Array<{ id: string; business_id: string; customer_id: string }>;
  let expired = 0;
  for (const tok of stale) {
    try {
      const ts = new Date().toISOString();
      await supabase
        .from('customer_intake_tokens')
        .update({ status: 'expired', updated_at: ts })
        .eq('id', tok.id);
      await supabase
        .from('customers')
        .update({ intake_status: 'expired', updated_at: ts })
        .eq('id', tok.customer_id)
        .eq('business_id', tok.business_id)
        .neq('intake_status', 'submitted');
      expired += 1;
    } catch (err) {
      console.error(
        '[intake-reminder cron] expire failed for token',
        tok.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { expired };
}

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
