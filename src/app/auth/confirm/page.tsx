'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();

  // After a successful confirmation the user already has a session — continue
  // them into the activation/onboarding flow instead of dead-ending on a link.
  useEffect(() => {
    if (state !== 'success') return;
    const t = setTimeout(() => router.replace('/package'), 1500);
    return () => clearTimeout(t);
  }, [state, router]);

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
    <main className="min-h-screen bg-zinc-50 dark:bg-[#0e1722] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-[#17232f] rounded-2xl shadow-sm ring-1 ring-zinc-100 dark:ring-white/10 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Επιβεβαίωση email</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Επιβεβαιώνουμε το email σου...
        </p>

        {state === 'loading' && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Επιβεβαιώνουμε το email σου...</p>
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
            Το email σου επιβεβαιώθηκε. Σε πάμε στη ρύθμιση του λογαριασμού σου...
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            Δεν μπορέσαμε να επιβεβαιώσουμε το email. Δοκίμασε να συνδεθείς ή ζήτησε νέο σύνδεσμο.
          </div>
        )}

        <div className="mt-6 text-center text-sm">
          {state === 'success' ? (
            <Link href="/package" className="font-semibold text-indigo-600 hover:text-indigo-700 transition">
              Συνέχεια
            </Link>
          ) : (
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 transition">
              Σύνδεση
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
