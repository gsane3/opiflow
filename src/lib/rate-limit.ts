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

export interface AsyncRateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

// Shared-store limiter via Upstash Redis REST (no SDK). Enabled when
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Atomic INCR+EXPIRE
// per fixed window; fails OPEN on infra errors so the app never hard-breaks.
function createUpstashRateLimiter(opts: { windowMs: number; max: number }): AsyncRateLimiter | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const windowSec = Math.max(1, Math.ceil(opts.windowMs / 1000));
  return {
    async check(key: string): Promise<RateLimitResult> {
      const bucket = Math.floor(Date.now() / opts.windowMs);
      const redisKey = `rl:${key}:${bucket}`;
      const resetAt = (bucket + 1) * opts.windowMs;
      try {
        const res = await fetch(`${url}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([
            ['INCR', redisKey],
            ['EXPIRE', redisKey, String(windowSec)],
          ]),
        });
        const data = (await res.json()) as Array<{ result?: number }>;
        const count = typeof data?.[0]?.result === 'number' ? data[0].result! : 1;
        return { allowed: count <= opts.max, remaining: Math.max(0, opts.max - count), resetAt };
      } catch {
        return { allowed: true, remaining: opts.max, resetAt };
      }
    },
  };
}

/**
 * Production rate limiter: Upstash Redis when configured (shared across
 * serverless instances), otherwise the in-memory limiter (dev / single node).
 */
export function createRateLimiter(opts: { windowMs: number; max: number }): AsyncRateLimiter {
  const upstash = createUpstashRateLimiter(opts);
  if (upstash) return upstash;
  const mem = createInMemoryRateLimiter(opts);
  return { check: (key: string) => Promise.resolve(mem.check(key)) };
}
