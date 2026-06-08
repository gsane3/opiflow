// Lightweight observability: structured JSON logging + a Sentry-ready error hook.
// No heavy SDK dependency yet — forward to Sentry inside captureException once
// @sentry/nextjs + SENTRY_DSN are configured (see docs/PRODUCTION_ROADMAP.md).
// Callers must NOT pass secrets/PII in context.

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...(context ?? {}), ts: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};

/**
 * Capture an exception for monitoring. Always structured-logs; additionally
 * forwards to Sentry when SENTRY_DSN is configured. The Sentry import is lazy
 * (fire-and-forget) so this module never pulls the SDK into a bundle that does
 * not use monitoring, and stays a safe no-op when the DSN is unset.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  const info =
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) };
  emit('error', 'exception', { ...info, ...(context ?? {}) });

  if (process.env.SENTRY_DSN) {
    void import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(err, { extra: context }))
      .catch(() => {
        // monitoring must never throw into the caller
      });
  }
}
