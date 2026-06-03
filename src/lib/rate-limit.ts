// Pluggable rate limiter.
//
// The default backend is in-memory (fine for a single instance / local dev). On
// serverless (Vercel) the in-memory store resets on cold starts and is
// per-instance, so for production swap in a shared store — Upstash Redis
// (@upstash/ratelimit) keyed by user id. The interface below stays the same, so
// call sites don't change. See docs/PRODUCTION_ROADMAP.md.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimiter(opts: { windowMs: number; max: number }): RateLimiter {
  const store = new Map<string, Bucket>();
  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const b = store.get(key);
      if (!b || now >= b.resetAt) {
        const resetAt = now + opts.windowMs;
        store.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: opts.max - 1, resetAt };
      }
      if (b.count >= opts.max) {
        return { allowed: false, remaining: 0, resetAt: b.resetAt };
      }
      b.count += 1;
      return { allowed: true, remaining: opts.max - b.count, resetAt: b.resetAt };
    },
  };
}

/** Derive a stable rate-limit key: prefer the authenticated user, fall back to IP. */
export function clientKey(
  req: { headers: { get(name: string): string | null } },
  userId?: string | null
): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get('x-forwarded-for');
  return `ip:${fwd ? fwd.split(',')[0].trim() : 'unknown'}`;
}
