'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

function mapSignUpError(err: unknown): string {
  const e = err as { status?: number; code?: string; name?: string; message?: string };
  const status = e.status ?? 0;
  const msg = (e.message ?? '').toLowerCase();
  const code = (e.code ?? '').toLowerCase();
  if (
    status === 429 ||
    msg.includes('rate limit') ||
    code.includes('rate_limit') ||
    code.includes('over_email_send')
  ) {
    return 'Έχουν γίνει πολλές προσπάθειες εγγραφής. Περίμενε λίγο και δοκίμασε ξανά.';
  }
  if (msg.includes('password') || msg.includes('should be at least')) {
    return 'Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.';
  }
  if (msg.includes('signup disabled') || msg.includes('signups not allowed')) {
    return 'Η εγγραφή είναι προσωρινά απενεργοποιημένη.';
  }
  if (
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('user already registered')
  ) {
    return 'Υπάρχει ήδη λογαριασμός με αυτό το email. Κάνε σύνδεση.';
  }
  return 'Δεν μπορέσαμε να δημιουργήσουμε λογαριασμό. Έλεγξε τα στοιχεία και δοκίμασε ξανά.';
}

export default function RegisterPage() {
  const router = useRouter();

  // UI-only fields (not submitted to auth)
  const [name, setProfessionalName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Auth fields (submitted to Supabase)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Δεν μπορέσαμε να δημιουργήσουμε λογαριασμό. Έλεγξε τα στοιχεία και δοκίμασε ξανά.');
      return;
    }
    if (password.length < 6) {
      setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
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

    const { error: signUpError } = await supabase.auth.signUp({ email: trimmedEmail, password });
    setLoading(false);

    if (signUpError) {
      const e = signUpError as { status?: number; code?: string; name?: string };
      console.error('[register] signUp failed', { name: e.name, status: e.status, code: e.code });
      setError(mapSignUpError(signUpError));
      return;
    }

    try {
      localStorage.setItem(
        'yorgos_onboarding_prefill',
        JSON.stringify({ ownerName: name.trim(), email: trimmedEmail })
      );
    } catch {
      // non-fatal
    }
    router.push('/package');
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center px-5 pt-10 pb-12">
      <div className="w-full max-w-md">

        {/* Wordmark */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-1">
            <span className="text-[22px] font-bold tracking-tight text-zinc-900">yorgos</span>
            <span className="text-[22px] font-bold tracking-tight text-indigo-600">.ai</span>
            <svg
              className="ml-0.5 h-3.5 w-3.5 text-indigo-400"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2l1.09 6.26L19 9l-5.5 5.14 1.68 6.86L12 17.77l-3.18 3.23L10.5 14.14 5 9l5.91-.74L12 2z" />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl font-bold text-zinc-900 text-center leading-snug">
            Καλωσόρισες στο yorgos.ai
          </h1>
          <p className="mt-2 text-sm text-zinc-500 text-center">
            Δημιούργησε τον λογαριασμό σου σε λίγα δευτερόλεπτα.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Ονοματεπώνυμο */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Ονοματεπώνυμο
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setProfessionalName(e.target.value)}
              placeholder="π.χ. Κωνσταντίνος Σιδέρης"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="π.χ. ksid@example.com"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
            />
          </div>

          {/* Κωδικός */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Κωδικός
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl border border-zinc-200 bg-white pl-11 pr-11 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition"
              >
                {showPassword ? (
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Terms */}
          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-indigo-600 shrink-0"
            />
            <span className="text-xs text-zinc-500 leading-relaxed">
              Συμφωνώ με τους{' '}
              <span className="font-medium text-indigo-600">Όρους Χρήσης</span>
              {' '}και την{' '}
              <span className="font-medium text-indigo-600">Πολιτική Απορρήτου</span>
              .
            </span>
          </label>

          {/* Error */}
          {error && (
            <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* CTA */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[28px] bg-indigo-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60"
            >
              {loading ? 'Δημιουργία...' : 'Συνέχεια'}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Έχεις ήδη λογαριασμό;{' '}
          <Link
            href="/login/backend"
            className="font-semibold text-indigo-600 hover:text-indigo-700 transition"
          >
            Σύνδεση
          </Link>
        </p>

      </div>
    </main>
  );
}
