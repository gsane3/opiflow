'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { RequireAdmin } from '@/components/admin/RequireAdmin';

type SessionState = 'loading' | 'no_config' | 'no_session' | 'ready';
type AdminState = 'checking' | 'ok' | 'forbidden' | 'not_configured' | 'error';
type CreateState = 'idle' | 'loading' | 'success' | 'exists' | 'error';

interface BusinessResult {
  id: string;
  name: string;
}

function OnboardingBackendPageInner() {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [adminState, setAdminState] = useState<AdminState>('checking');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [createState, setCreateState] = useState<CreateState>('idle');
  const [business, setBusiness] = useState<BusinessResult | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        setSessionState('no_config');
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (!session?.access_token) {
        setSessionState('no_session');
        return;
      }

      setAccessToken(session.access_token);
      setUserEmail(session.user?.email ?? null);
      setSessionState('ready');

      // Admin check - runs immediately after session is confirmed.
      let res: Response;
      try {
        res = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      } catch {
        setAdminState('error');
        return;
      }

      if (res.status === 200) {
        setAdminState('ok');
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
      // 401, 500, or unknown - fail closed.
      setAdminState('error');
    }

    checkSession();
  }, []);

  async function handleCreate() {
    if (!accessToken || adminState !== 'ok') return;
    setCreateState('loading');
    setBusiness(null);

    let res: Response;
    try {
      res = await fetch('/api/businesses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: 'Backend Test Business',
          type: 'technical_services',
          email: userEmail ?? null,
          default_vat_rate: 24,
          preferred_contact_method: 'phone',
        }),
      });
    } catch {
      setCreateState('error');
      return;
    }

    if (res.status === 201) {
      try {
        const json = await res.json();
        if (json?.business?.id && json?.business?.name) {
          setBusiness({ id: json.business.id, name: json.business.name });
        }
      } catch {
        // JSON parse failure is non-fatal; success state still shown.
      }
      setCreateState('success');
      return;
    }

    if (res.status === 409) {
      setCreateState('exists');
      return;
    }

    setCreateState('error');
  }

  async function handleLogout() {
    setLogoutLoading(true);
    setLogoutError(null);
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setLogoutError('Δεν μπορέσαμε να κάνουμε αποσύνδεση. Δοκίμασε ξανά.');
      setLogoutLoading(false);
      return;
    }
    const { error: signOutError } = await supabase.auth.signOut();
    setLogoutLoading(false);
    if (signOutError) {
      setLogoutError('Δεν μπορέσαμε να κάνουμε αποσύνδεση. Δοκίμασε ξανά.');
      return;
    }
    setAccessToken(null);
    setUserEmail(null);
    setBusiness(null);
    setCreateState('idle');
    setSessionState('no_session');
    setAdminState('checking');
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[28px] shadow-sm ring-1 ring-zinc-200/60 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Ρύθμιση επιχείρησης</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Δημιουργία επιχείρησης για τον λογαριασμό σου.
        </p>

        {sessionState === 'loading' && (
          <p className="text-sm text-zinc-500">Έλεγχος backend session...</p>
        )}

        {sessionState === 'no_config' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Το backend auth δεν είναι ρυθμισμένο ακόμα.
          </div>
        )}

        {sessionState === 'no_session' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm space-y-1">
            <p className="font-medium">Δεν υπάρχει ενεργό backend session.</p>
            <p>Συνδέσου πρώτα από τη backend login σελίδα.</p>
          </div>
        )}

        {sessionState === 'ready' && (
          <div className="space-y-4">

            {adminState === 'checking' && (
              <p className="text-sm text-zinc-500">Έλεγχος διαχειριστή...</p>
            )}

            {adminState === 'forbidden' && (
              <>
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
                  Δεν έχεις πρόσβαση σε αυτή τη σελίδα.
                </div>
                {logoutError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
                    {logoutError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={logoutLoading}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                >
                  {logoutLoading ? 'Αποσύνδεση...' : 'Αποσύνδεση'}
                </button>
              </>
            )}

            {adminState === 'not_configured' && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
                Η πρόσβαση admin δεν έχει ρυθμιστεί.
              </div>
            )}

            {adminState === 'error' && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
                Δεν ήταν δυνατός ο έλεγχος πρόσβασης. Δοκίμασε ξανά.
              </div>
            )}

            {adminState === 'ok' && (
              <>
                <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
                  <p className="font-medium">Συνδεδεμένος backend χρήστης</p>
                  {userEmail && <p className="mt-0.5 text-green-700">{userEmail}</p>}
                </div>

                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={createState === 'loading'}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {createState === 'loading' ? 'Δημιουργία...' : 'Δημιουργία επιχείρησης'}
                </button>

                {createState === 'success' && (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
                    <p className="font-medium">Η επιχείρηση δημιουργήθηκε στο backend.</p>
                    {business && (
                      <p className="mt-1 text-green-700 font-mono text-xs break-all">
                        {business.name} · {business.id}
                      </p>
                    )}
                  </div>
                )}

                {createState === 'exists' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
                    Υπάρχει ήδη επιχείρηση για αυτόν τον backend λογαριασμό.
                  </div>
                )}

                {createState === 'error' && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
                    Δεν μπορέσαμε να ολοκληρώσουμε το backend onboarding.
                  </div>
                )}

                {logoutError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
                    {logoutError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={logoutLoading}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                >
                  {logoutLoading ? 'Αποσύνδεση...' : 'Αποσύνδεση'}
                </button>
              </>
            )}

          </div>
        )}

        <div className="mt-6 space-y-2 text-center text-sm">
          <p>
            <Link href="/login/backend" className="text-indigo-600 hover:underline">
              Backend login
            </Link>
          </p>
          <p>
            <Link href="/register" className="text-indigo-600 hover:underline">
              Δημιουργία backend λογαριασμού
            </Link>
          </p>
          <p>
            <Link href="/dashboard" className="text-zinc-500 hover:underline">
              Πίσω στο dashboard
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function OnboardingBackendPage() {
  return (
    <RequireAdmin>
      <OnboardingBackendPageInner />
    </RequireAdmin>
  );
}
