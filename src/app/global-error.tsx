'use client';

// Root-level error boundary. Unlike app/error.tsx (which renders INSIDE the root
// layout), global-error.tsx catches errors thrown in the root layout itself and
// REPLACES the whole document — so it must render its own <html>/<body>, and it
// cannot rely on the app's CSS/layout being available. Inline styles only.

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Last-resort capture (no-op until NEXT_PUBLIC_SENTRY_DSN is configured).
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="el">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: 24,
          textAlign: 'center',
          background: '#F5F5F7',
          color: '#18181b',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 6px' }}>Κάτι πήγε στραβά</h1>
          <p style={{ fontSize: 14, color: '#71717a', maxWidth: 320, margin: 0 }}>
            Παρουσιάστηκε ένα πρόβλημα. Δοκίμασε ξανά σε λίγο.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            border: 'none',
            borderRadius: 16,
            background: '#226c9e',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            padding: '10px 20px',
            cursor: 'pointer',
          }}
        >
          Δοκίμασε ξανά
        </button>
      </body>
    </html>
  );
}
