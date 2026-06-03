'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type AdminState = 'loading' | 'no_session' | 'admin_ok' | 'forbidden' | 'not_configured' | 'error';

/**
 * Client-side gate for the /backend/* dev-admin cluster. Verifies the caller is
 * the configured ADMIN_USER_ID (via GET /api/admin/me) before rendering its
 * children. Fails closed: anything other than a 200 renders a gate message and
 * never the wrapped page.
 *
 * This is defense-in-depth and UI hygiene — the authoritative check stays
 * server-side on every admin API route. It keeps the internal dev/admin tools
 * out of regular users' hands and off the public surface. Do NOT wrap
 * /login/backend with this (that page is the entry point used to obtain the
 * session the check depends on).
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [adminState, setAdminState] = useState<AdminState>('loading');

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) setAdminState('not_configured');
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        if (!cancelled) setAdminState('no_session');
        return;
      }

      let res: Response;
      try {
        res = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        if (!cancelled) setAdminState('error');
        return;
      }
      if (cancelled) return;

      if (res.status === 200) setAdminState('admin_ok');
      else if (res.status === 403) setAdminState('forbidden');
      else if (res.status === 503) setAdminState('not_configured');
      else setAdminState('error'); // 401, 500, or unknown -> fail closed
    }

    checkAdmin();
    return () => {
      cancelled = true;
    };
  }, []);

  if (adminState === 'admin_ok') return <>{children}</>;

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="space-y-3 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-100">
          {adminState === 'loading' && <p className="text-sm text-zinc-500">Έλεγχος πρόσβασης...</p>}
          {adminState === 'no_session' && (
            <>
              <p className="text-sm text-zinc-700">Απαιτείται σύνδεση για πρόσβαση σε αυτή τη σελίδα.</p>
              <Link href="/login/backend" className="inline-block text-sm text-indigo-600 hover:underline">
                Σύνδεση
              </Link>
            </>
          )}
          {adminState === 'forbidden' && (
            <p className="text-sm text-zinc-700">Δεν έχεις πρόσβαση σε αυτή τη σελίδα.</p>
          )}
          {adminState === 'not_configured' && (
            <p className="text-sm text-zinc-700">Η πρόσβαση admin δεν έχει ρυθμιστεί.</p>
          )}
          {adminState === 'error' && (
            <p className="text-sm text-zinc-700">Δεν ήταν δυνατός ο έλεγχος πρόσβασης. Δοκίμασε ξανά.</p>
          )}
        </div>
      </div>
    </main>
  );
}
