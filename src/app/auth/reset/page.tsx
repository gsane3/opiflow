'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const supabase = createBrowserSupabaseClient();
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) await supabase.auth.exchangeCodeForSession(code);
      } catch {
        // The recovery session may already be set via the URL hash.
      }
      setReady(true);
    }
    init();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
      return;
    }
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      setLoading(false);
      if (updErr) {
        setError('Ο σύνδεσμος έληξε ή δεν είναι έγκυρος. Ζήτησε νέο σύνδεσμο επαναφοράς.');
        return;
      }
      setDone(true);
      setTimeout(() => router.replace('/dashboard'), 1200);
    } catch {
      setLoading(false);
      setError('Κάτι πήγε στραβά. Δοκίμασε ξανά.');
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[28px] shadow-sm ring-1 ring-zinc-200/60 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-1">Νέος κωδικός</h1>
        <p className="text-sm text-zinc-500 mb-6">Όρισε έναν νέο κωδικό για τον λογαριασμό σου.</p>

        {done ? (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-700">
            Ο κωδικός άλλαξε. Σε συνδέουμε...
          </div>
        ) : !ready ? (
          <p className="text-sm text-zinc-400">Φόρτωση...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="pw" className="block text-sm font-medium text-zinc-700 mb-1">Νέος κωδικός</label>
              <input
                id="pw"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Τουλάχιστον 6 χαρακτήρες"
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Αποθήκευση...' : 'Αλλαγή κωδικού'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
