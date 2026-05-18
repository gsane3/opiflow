'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setError('Το backend auth δεν είναι ρυθμισμένο ακόμα.');
      setLoading(false);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (signUpError) {
      setError('Δεν μπορέσαμε να δημιουργήσουμε λογαριασμό. Έλεγξε τα στοιχεία και δοκίμασε ξανά.');
      return;
    }

    setSuccess(true);
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Δημιουργία backend λογαριασμού</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Αυτή η σελίδα δοκιμάζει το πραγματικό Supabase Auth. Δεν αντικαθιστά ακόμα το demo MVP login.
        </p>

        {success ? (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
            Έλεγξε το email σου για επιβεβαίωση.
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Τουλάχιστον 6 χαρακτήρες"
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
              {loading ? 'Δημιουργία...' : 'Δημιουργία λογαριασμού'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link href="/demo" className="text-sm text-indigo-600 hover:underline">
            Πίσω στο demo MVP
          </Link>
        </div>
      </div>
    </main>
  );
}
