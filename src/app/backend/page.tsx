'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const LINKS = [
  {
    href: '/register',
    title: 'Δημιουργία backend λογαριασμού',
    description: 'Δοκιμή Supabase sign up.',
  },
  {
    href: '/login/backend',
    title: 'Σύνδεση backend λογαριασμού',
    description: 'Δοκιμή Supabase sign in και logout.',
  },
  {
    href: '/onboarding/backend',
    title: 'Backend onboarding test',
    description: 'Δημιουργία ή εντοπισμός business μέσω POST /api/businesses.',
  },
  {
    href: '/business/backend',
    title: 'Backend business test',
    description: 'Ανάγνωση business μέσω GET /api/businesses/me.',
  },
  {
    href: '/communications/backend',
    title: 'Backend communications test',
    description: 'Read-only PBX call viewer through GET /api/communications.',
  },
  {
    href: '/customers/backend',
    title: 'Backend customers test',
    description: 'Read-only Supabase customer list through GET /api/customers.',
  },
  {
    href: '/auth/confirm',
    title: 'Backend email confirmation',
    description: 'Χειρισμός Supabase confirmation callback.',
  },
  {
    href: '/phone-pool/backend',
    title: 'Phone pool',
    description: 'Διαχείριση διαθέσιμων τηλεφωνικών αριθμών για αυτόματη ανάθεση.',
  },
];

type AdminState = 'loading' | 'no_session' | 'admin_ok' | 'forbidden' | 'not_configured' | 'error';

export default function BackendHubPage() {
  const [adminState, setAdminState] = useState<AdminState>('loading');

  useEffect(() => {
    async function checkAdmin() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        setAdminState('not_configured');
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;

      if (!token) {
        setAdminState('no_session');
        return;
      }

      let res: Response;
      try {
        res = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        setAdminState('error');
        return;
      }

      if (res.status === 200) {
        setAdminState('admin_ok');
        return;
      }
      if (res.status === 403) {
        setAdminState('forbidden');
        return;
      }
      if (res.status === 503) {
        setAdminState('not_configured');
        return;
      }
      // 401, 500, or unknown - fail closed
      setAdminState('error');
    }

    checkAdmin();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">

        {adminState === 'loading' && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
            <p className="text-sm text-zinc-500">Έλεγχος πρόσβασης...</p>
          </div>
        )}

        {adminState === 'no_session' && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8 space-y-3">
            <p className="text-sm text-zinc-700">Απαιτείται σύνδεση για πρόσβαση σε αυτή τη σελίδα.</p>
            <Link href="/login/backend" className="inline-block text-sm text-indigo-600 hover:underline">
              Σύνδεση
            </Link>
          </div>
        )}

        {adminState === 'forbidden' && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
            <p className="text-sm text-zinc-700">Δεν έχεις πρόσβαση σε αυτή τη σελίδα.</p>
          </div>
        )}

        {adminState === 'not_configured' && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
            <p className="text-sm text-zinc-700">Η πρόσβαση admin δεν έχει ρυθμιστεί.</p>
          </div>
        )}

        {adminState === 'error' && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
            <p className="text-sm text-zinc-700">Δεν ήταν δυνατός ο έλεγχος πρόσβασης. Δοκίμασε ξανά.</p>
          </div>
        )}

        {adminState === 'admin_ok' && (
          <>
            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8 mb-4">
              <h1 className="text-2xl font-bold text-zinc-900 mb-1">Backend test hub</h1>
              <p className="text-sm text-zinc-500 mb-2">
                Συγκεντρώνει τις standalone backend σελίδες για Supabase Auth και business API. Δεν αντικαθιστά ακόμα το MVP app.
              </p>
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                Το MVP παραμένει localStorage. Αυτές οι σελίδες είναι μόνο για backend δοκιμές.
              </p>
            </div>

            <div className="space-y-2">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 px-6 py-4 hover:ring-indigo-300 hover:shadow-md transition-shadow"
                >
                  <p className="text-sm font-semibold text-indigo-600">{link.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{link.description}</p>
                </Link>
              ))}

              <Link
                href="/dashboard"
                className="block bg-zinc-100 rounded-2xl px-6 py-4 hover:bg-zinc-200 transition-colors"
              >
                <p className="text-sm font-semibold text-zinc-700">Πίσω στο dashboard</p>
                <p className="text-xs text-zinc-500 mt-0.5">Συνέχισε στο live workspace.</p>
              </Link>
            </div>
          </>
        )}

      </div>
    </main>
  );
}
