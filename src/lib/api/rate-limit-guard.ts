// Thin per-route rate-limit guard for PUBLIC (unauthenticated) endpoints.
//
// Create one limiter per route module (module-level) so the in-memory window
// persists across requests on a warm instance; on Vercel set UPSTASH_REDIS_REST_*
// for a shared store across instances (createRateLimiter picks it up automatically).
//
// Usage in a route:
//   const guard = makePublicLimiter(30, 60_000);
//   export async function POST(req) {
//     const limited = await guard(req);
//     if (limited) return limited;       // 429 with Retry-After
//     ...
//   }

import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter, clientKey } from '@/lib/rate-limit';

export function makePublicLimiter(
  max = 30,
  windowMs = 60_000,
  // Optional human-readable message added to the 429 body. Omitting it keeps the
  // existing `{ ok: false, error: 'rate_limited' }` response byte-for-byte, so
  // current callers are unaffected; public customer-facing routes can pass a
  // friendly localized string for the page to show.
  options?: { message?: string },
) {
  const limiter = createRateLimiter({ windowMs, max });
  return async function guard(req: NextRequest, userId?: string | null): Promise<NextResponse | null> {
    const rl = await limiter.check(clientKey(req, userId));
    if (rl.allowed) return null;
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: 'rate_limited', ...(options?.message ? { message: options.message } : {}) },
      { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } }
    );
  };
}
