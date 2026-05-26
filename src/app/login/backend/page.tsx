'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

function mapSignInError(err: unknown): string {
  const e = err as { status?: number; code?: string; name?: string; message?: string };
  const status = e.status ?? 0;
  const msg = (e.message ?? '').toLowerCase();
  const code = (e.code ?? '').toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Λάθος email ή κωδικός.';
  }
  if (msg.includes('email not confirmed') || code.includes('email_not_confirmed')) {
    return 'Πρέπει πρώτα να επιβεβαιώσεις το email σου.';
  }
  if (
    status === 429 ||
    msg.includes('rate limit') ||
    code.includes('rate_limit') ||
    code.includes('over_request_rate_limit')
  ) {
    return 'Έχουν γίνει πολλές προσπάθειες σύνδεσης. Περίμενε λίγο και δοκίμασε ξανά.';
  }
  return 'Δεν μπορέσαμε να σε συνδέσουμε. Έλεγξε τα στοιχεία σου.';
}

export default function LoginBackendPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Δεν μπορέσαμε να σε συνδέσουμε. Έλεγξε τα στοιχεία και δοκίμασε ξανά.');
      return;
    }

    setLoading(true);

    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setError('Το backend auth δεν είναι ρυθμισμένο ακόμα.');
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setLoading(false);

    if (signInError) {
      const e = signInError as { status?: number; code?: string; name?: string };
      console.error('[login/backend] signIn failed', { name: e.name, status: e.status, code: e.code });
      setError(mapSignInError(signInError));
      return;
    }

    setSuccess(true);
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
    setSuccess(false);
    setPassword('');
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[28px] shadow-sm ring-1 ring-zinc-200/60 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Σύνδεση</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Χρησιμοποίησε email και κωδικό για να συνδεθείς.
        </p>

        {success ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
              Συνδέθηκες επιτυχώς στο backend auth.
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
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">
                Κωδικός
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Κωδικός"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Σύνδεση...' : 'Σύνδεση'}
            </button>
          </form>
        )}

        <div className="mt-6 space-y-2 text-center text-sm">
          <p>
            <Link href="/register" className="text-indigo-600 hover:underline">
              Δεν έχεις backend λογαριασμό; Δημιουργία
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
