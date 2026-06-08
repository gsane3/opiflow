// Next.js server instrumentation — Sentry server/edge init + request-error hook.
//
// Fully env-gated: Sentry only initialises when SENTRY_DSN is set. With no DSN
// (the default), register() returns immediately and onRequestError is a no-op,
// so this file has ZERO runtime effect until monitoring is configured.
//
// PII: sendDefaultPii is false so request bodies, headers, cookies and user IPs
// are NOT attached automatically.

import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const common = {
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(common);
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(common);
  }
}

// Captures errors thrown in nested React Server Components / route handlers.
// No-op when Sentry was never initialised (DSN unset).
export const onRequestError = Sentry.captureRequestError;
