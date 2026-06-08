// Next.js client instrumentation — Sentry browser init.
//
// Fully env-gated: Sentry only initialises when NEXT_PUBLIC_SENTRY_DSN is set.
// With no DSN (the default) nothing runs, so this file has ZERO effect on the
// client bundle's behaviour until monitoring is configured.
//
// Session Replay and tracing are off by default (sample rates 0) to avoid any
// PII capture and keep payloads minimal; raise the *_SAMPLE_RATE envs to enable.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  });
}

// Instruments App Router navigations for tracing. No-op when DSN is unset.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
