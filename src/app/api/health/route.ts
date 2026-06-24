import { NextResponse } from 'next/server';
import { missingRequiredEnv, integrationStatus, missingIntegrationEnv } from '@/lib/env';
import { isPushEnabled } from '@/lib/server/push';
import { isDurableRateLimitConfigured } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Actual readiness probe: confirms Supabase is reachable, not just that the env
// vars are present. Returns false (→ 503) if the round-trip fails so monitors
// catch a DB outage instead of staying green. Cheap: one indexed row, no payload.
async function checkDatabase(): Promise<boolean> {
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('businesses').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

// Liveness/readiness probe for uptime monitors and load balancers.
// Returns booleans only — never secret values.
export async function GET() {
  const missing = missingRequiredEnv();
  const coreConfigured = missing.length === 0;
  // Only attempt the DB round-trip when core config is present (else it can't work).
  const dbReachable = coreConfigured ? await checkDatabase() : false;
  const ok = coreConfigured && dbReachable;
  return NextResponse.json(
    {
      ok,
      service: 'opiflow',
      time: new Date().toISOString(),
      coreConfigured,
      database: dbReachable,
      // Durable cross-instance rate limiting (Upstash). false in prod = the public
      // token surface only has per-instance, cold-start-resetting limits.
      rateLimitDurable: isDurableRateLimitConfigured(),
      integrations: { ...integrationStatus(), push: isPushEnabled() },
      // Names only (never values) of env vars still missing per integration —
      // a safe debugging aid for "why is X off?".
      missingEnv: missingIntegrationEnv(),
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
