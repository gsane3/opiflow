'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import OAuthButtons from '@/components/auth/OAuthButtons';

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
  // When email confirmation is required, signUp returns no session — show a
  // "check your email" screen instead of dropping the user into /package.
  const [awaitingVerify, setAwaitingVerify] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'busy' | 'sent'>('idle');

  // /pricing arrives as ?plan=base|premium. The OAuth and email-confirm paths
  // lose the querystring, so stash the choice for /package to preselect.
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get('plan');
    if (plan === 'base' || plan === 'premium') {
      try {
        localStorage.setItem('opiflow_selected_plan', plan);
      } catch {
        // storage unavailable — the URL param still flows on the email path
      }
    }
  }, []);

  async function resendVerification() {
    if (resendState === 'busy') return;
    setResendState('busy');
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      });
      setResendState('sent');
    } catch {
      setResendState('idle');
      setError('Η επαναποστολή απέτυχε. Δοκίμασε ξανά σε λίγο.');
    }
  }

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

    if (!agreed) {
      setError('Πρέπει να αποδεχτείς τους όρους για να συνεχίσεις.');
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

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      // Send the confirmation link back to THIS origin (not the Supabase Site URL
      // default), so a misconfigured Site URL can't redirect users to localhost.
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setLoading(false);

    if (signUpError) {
      const e = signUpError as { status?: number; code?: string; name?: string };
      console.error('[register] signUp failed', { name: e.name, status: e.status, code: e.code });
      setError(mapSignUpError(signUpError));
      return;
    }

    // Supabase's email-enumeration protection: signing up an EXISTING email
    // doesn't error — it returns a user with an empty identities array and no
    // session. Treat that as "already registered" instead of a silent dead-end.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError('Υπάρχει ήδη λογαριασμός με αυτό το email. Κάνε σύνδεση.');
      return;
    }

    try {
      localStorage.setItem(
        'deskop_onboarding_prefill',
        JSON.stringify({ ownerName: name.trim(), email: trimmedEmail })
      );
    } catch {
      // non-fatal
    }

    if (data.session) {
      // Email confirmation is disabled → the user is already signed in. Continue.
      {
        // /pricing CTAs arrive as /register?plan=base|premium — forward the
        // choice to /package instead of silently dropping it. Read at push
        // time from the URL (no useSearchParams → no Suspense requirement).
        const planParam = new URLSearchParams(window.location.search).get('plan');
        const planQS = planParam === 'base' || planParam === 'premium' ? `?plan=${planParam}` : '';
        router.push(`/package${planQS}`);
      }
    } else {
      // Confirmation required → wait for the email link (→ /auth/confirm → /package).
      // Do NOT push to /package: there's no session, so the app would just bounce
      // them to /login on the next navigation.
      setAwaitingVerify(true);
    }
  }

  return (
    <main className="min-h-screen bg-white dark:bg-[#0e1722] flex flex-col items-center px-5 pt-10 pb-12">
      <div className="w-full max-w-md">

        {/* Wordmark */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-1">
            <span className="text-[22px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">opiflow</span>
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
          <h1 className="mt-6 text-2xl font-bold text-zinc-900 dark:text-zinc-100 text-center leading-snug">
            Καλωσόρισες στο Opiflow
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 text-center">
            Δημιούργησε τον λογαριασμό σου σε λίγα δευτερόλεπτα.
          </p>
        </div>

        {awaitingVerify ? (
          <div className="rounded-2xl bg-indigo-50 p-5 text-center ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/20">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/20">
              <svg className="h-6 w-6 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Έλεγξε το email σου</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Στείλαμε σύνδεσμο επιβεβαίωσης στο{' '}
              <span className="font-semibold">{email.trim()}</span>. Πάτησέ τον για να ενεργοποιήσεις τον λογαριασμό σου και να συνεχίσεις στην επιλογή πακέτου.
            </p>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Δεν ήρθε; Έλεγξε και τα ανεπιθύμητα (spam).</p>
            <button
              type="button"
              onClick={() => void resendVerification()}
              disabled={resendState !== 'idle'}
              className="mt-3 inline-block rounded-full border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-500/30 dark:hover:bg-indigo-500/10"
            >
              {resendState === 'sent' ? '✓ Στάλθηκε ξανά' : resendState === 'busy' ? 'Αποστολή…' : 'Επαναποστολή email'}
            </button>
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              Μετά την επιβεβαίωση συνεχίζεις στην επιλογή πακέτου (Base ή Premium).
            </p>
            <Link href="/login" className="mt-2 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700">
              Πήγαινε στη Σύνδεση
            </Link>
          </div>
        ) : (
        <>
        <OAuthButtons />
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">ή με email</span>
          <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Ονοματεπώνυμο */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
              Ονοματεπώνυμο
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setProfessionalName(e.target.value)}
              placeholder="π.χ. Κωνσταντίνος Σιδέρης"
              className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="π.χ. ksid@example.com"
              className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
            />
          </div>

          {/* Κωδικός */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
              Κωδικός
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
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
                className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] pl-11 pr-11 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
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
            <span className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Συμφωνώ με τους{' '}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium text-indigo-600 hover:text-indigo-700">Όρους Χρήσης</Link>
              {' '}και την{' '}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium text-indigo-600 hover:text-indigo-700">Πολιτική Απορρήτου</Link>
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
              {loading ? 'Δημιουργία...' : 'Δημιουργία λογαριασμού'}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Έχεις ήδη λογαριασμό;{' '}
          <Link
            href="/login"
            className="font-semibold text-indigo-600 hover:text-indigo-700 transition"
          >
            Σύνδεση
          </Link>
        </p>
        </>
        )}

      </div>
    </main>
  );
}
