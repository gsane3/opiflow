import { NextResponse } from 'next/server';
import { missingRequiredEnv, integrationStatus } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness/readiness probe for uptime monitors and load balancers.
// Returns booleans only — never secret values.
export async function GET() {
  const missing = missingRequiredEnv();
  return NextResponse.json(
    {
      ok: missing.length === 0,
      service: 'opiflow',
      time: new Date().toISOString(),
      coreConfigured: missing.length === 0,
      integrations: integrationStatus(),
    },
    { status: missing.length === 0 ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
