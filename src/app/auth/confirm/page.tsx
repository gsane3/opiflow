'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type PageState = 'loading' | 'no_config' | 'no_params' | 'success' | 'error';

type OtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email';
const VALID_OTP_TYPES: readonly OtpType[] = [
  'signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email',
];

function isOtpType(s: string): s is OtpType {
  return (VALID_OTP_TYPES as readonly string[]).includes(s);
}

export default function AuthConfirmPage() {
  const [state, setState] = useState<PageState>('loading');

  useEffect(() => {
    async function confirm() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        setState('no_config');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setState(error ? 'error' : 'success');
        return;
      }

      if (tokenHash && type && isOtpType(type)) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        setState(error ? 'error' : 'success');
        return;
      }

      setState('no_params');
    }

    confirm();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm ring-1 ring-zinc-100 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Backend email confirmation</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Αυτή η σελίδα επιβεβαιώνει το email για το πραγματικό Supabase Auth. Δεν συνδέει ακόμα τον λογαριασμό με το MVP app.
        </p>

        {state === 'loading' && (
          <p className="text-sm text-zinc-500">Επιβεβαίωση λογαριασμού...</p>
        )}

        {state === 'no_config' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Το backend auth δεν είναι ρυθμισμένο ακόμα.
          </div>
        )}

        {state === 'no_params' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
            Δεν βρέθηκαν παράμετροι επιβεβαίωσης.
          </div>
        )}

        {state === 'success' && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
            Ο λογαριασμός σου επιβεβαιώθηκε.
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Αυτό το link επιβεβαίωσης δεν είναι έγκυρο ή έχει λήξει.
          </div>
        )}

        <div className="mt-6 space-y-2 text-center text-sm">
          <p>
            <Link href="/login/backend" className="text-indigo-600 hover:underline">
              Σύνδεση στο backend
            </Link>
          </p>
          <p>
            <Link href="/register" className="text-indigo-600 hover:underline">
              Δημιουργία backend λογαριασμού
            </Link>
          </p>
          <p>
            <Link href="/demo" className="text-zinc-500 hover:underline">
              Πίσω στο demo MVP
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
