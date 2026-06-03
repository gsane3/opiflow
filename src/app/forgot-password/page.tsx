'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
    } catch {
      // Ignore — never reveal whether the email exists (enumeration-safe).
    }
    setLoading(false);
    setSent(true);
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[28px] shadow-sm ring-1 ring-zinc-200/60 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Επαναφορά κωδικού</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Δώσε το email σου και θα σου στείλουμε σύνδεσμο επαναφοράς.
        </p>

        {sent ? (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-700">
            Αν υπάρχει λογαριασμός με αυτό το email, στείλαμε σύνδεσμο επαναφοράς. Έλεγξε τα εισερχόμενά σου.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Αποστολή...' : 'Αποστολή συνδέσμου'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 transition">
            Πίσω στη σύνδεση
          </Link>
        </p>
      </div>
    </main>
  );
}
