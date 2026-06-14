'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import OAuthButtons from '@/components/auth/OAuthButtons';

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (e.g. native cold-start landing here via NativeGate, or a
  // returning web visitor) → go straight to the app instead of showing the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session && !cancelled) router.replace('/dashboard');
      } catch {
        // ignore — show the login form
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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
      setError('Η σύνδεση δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκίμασε ξανά.');
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
      console.error('[login] signIn failed', { name: e.name, status: e.status, code: e.code });
      setError(mapSignInError(signInError));
      return;
    }

    router.push('/dashboard');
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-[#0e1722] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-[#17232f] rounded-[28px] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 p-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Σύνδεση</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Συνδέσου με email και κωδικό.
        </p>

        <OAuthButtons />
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">ή με email</span>
          <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
              Κωδικός
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="Κωδικός"
              className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-700 transition">
            Ξέχασες τον κωδικό;
          </Link>
        </p>

        <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Δεν έχεις λογαριασμό;{' '}
          <Link
            href="/register"
            className="font-semibold text-indigo-600 hover:text-indigo-700 transition"
          >
            Δημιουργία λογαριασμού
          </Link>
        </p>
      </div>
    </main>
  );
}
