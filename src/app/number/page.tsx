'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

function PhoneIcon() {
  return (
    <svg
      className="h-12 w-12 text-indigo-300"
      fill="none"
      strokeWidth={1}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="5" y="1" width="14" height="22" rx="3" ry="3" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

type NumberRequest = {
  status:        string;
  requestedCity: string | null;
  createdAt:     string;
};

type BusinessMeResponse = {
  ok?: boolean;
  business?: {
    business_phone_number?: string | null;
  };
  phoneAssigned?: boolean;
  activationAllowed?: boolean;
  billingConfigured?: boolean;
  subscription?: { status?: string } | null;
  numberRequest?: NumberRequest | null;
  error?: string;
};

const FEATURES = [
  {
    icon: (
      <svg className="h-4 w-4 text-indigo-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
      </svg>
    ),
    text: 'Για εισερχόμενες και εξερχόμενες κλήσεις',
  },
  {
    icon: (
      <svg className="h-4 w-4 text-indigo-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
      </svg>
    ),
    text: 'Σύνοψη και καταγραφή κλήσεων με AI',
  },
  {
    icon: (
      <svg className="h-4 w-4 text-indigo-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
    text: 'Επικοινωνία με πελάτες σε ένα μέρος',
  },
];

// ---------------------------------------------------------------------------
// Module-level helper: fetches business phone info without touching React state.
// Returns a plain result object. Callers set state from the result.
// ---------------------------------------------------------------------------

async function loadPhoneInfo(): Promise<{
  data?:      BusinessMeResponse;
  noSession?: true;
  error?:     true;
}> {
  try {
    const supabase = createBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return { noSession: true };
    }
    const resp = await fetch('/api/businesses/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (resp.ok) {
      const data: BusinessMeResponse = await resp.json();
      return { data };
    }
    return { error: true };
  } catch {
    return { error: true };
  }
}

export default function NumberPage() {
  const router = useRouter();
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneInfo, setPhoneInfo] = useState<BusinessMeResponse | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [localNumberRequest, setLocalNumberRequest] = useState<NumberRequest | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Initial mount fetch. Uses an inline async function and a cancellation flag so
  // that state setters are called directly inside the effect, satisfying lint.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const result = await loadPhoneInfo();
      if (cancelled) return;
      if (result.noSession) {
        setNoSession(true);
      } else if (result.data) {
        setPhoneInfo(result.data);
        setLocalNumberRequest(result.data.numberRequest ?? null);
      } else {
        setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
      }
      setPhoneLoading(false);
    }
    run();
    return () => { cancelled = true; };
  }, []);

  // Manual re-fetch for the "Έλεγχος κατάστασης" button. Not called from
  // any effect, so there is no lint concern about state-in-effect here.
  async function handleCheckStatus() {
    if (phoneLoading) return;
    setPhoneLoading(true);
    setPhoneError(null);
    const result = await loadPhoneInfo();
    if (result.noSession) {
      setNoSession(true);
    } else if (result.data) {
      setPhoneInfo(result.data);
      setLocalNumberRequest(result.data.numberRequest ?? null);
    } else {
      setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
    }
    setPhoneLoading(false);
  }

  // Pay-at-signup: open Stripe Checkout for the subscription. On success the
  // Stripe webhook flips the subscription to 'active'.
  async function handleCheckout() {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setCheckoutError('Πρέπει να συνδεθείς ξανά.');
        setCheckoutBusy(false);
        return;
      }
      const resp = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; url?: string };
      if (resp.ok && typeof data.url === 'string') {
        window.location.href = data.url; // leaving the app for Stripe
        return;
      }
      setCheckoutError('Δεν μπόρεσε να ξεκινήσει η πληρωμή. Δοκίμασε ξανά ή επικοινώνησε μαζί μας.');
      setCheckoutBusy(false);
    } catch {
      setCheckoutError('Δεν μπόρεσε να ξεκινήσει η πληρωμή.');
      setCheckoutBusy(false);
    }
  }

  async function handleCreateRequest() {
    if (requestSubmitting) return;
    setRequestSubmitting(true);
    setRequestError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setRequestError('Πρέπει να συνδεθείς ξανά.');
        setRequestSubmitting(false);
        return;
      }
      const resp = await fetch('/api/number-requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          ok?: boolean;
          status?: string;
          numberRequest?: NumberRequest;
        };
        if (data.ok) {
          setLocalNumberRequest(
            data.numberRequest ?? {
              status:        'pending',
              requestedCity: null,
              createdAt:     new Date().toISOString(),
            }
          );
        } else {
          setRequestError('Δεν μπόρεσε να καταχωρηθεί το αίτημα. Δοκίμασε ξανά.');
        }
      } else {
        setRequestError('Δεν μπόρεσε να καταχωρηθεί το αίτημα. Δοκίμασε ξανά.');
      }
    } catch {
      setRequestError('Δεν μπόρεσε να καταχωρηθεί το αίτημα. Δοκίμασε ξανά.');
    } finally {
      setRequestSubmitting(false);
    }
  }

  function handleContinue() {
    router.push('/dashboard');
  }

  return (
    <main className="min-h-screen bg-white dark:bg-[#0e1722] px-5 pt-6 pb-28">
      <div className="mx-auto max-w-md">

        {/* Back */}
        <Link
          href="/package"
          className="inline-flex items-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition mb-5"
          aria-label="Πίσω"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>

        {/* Step label */}
        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">Βήμα 3 από 3</p>

        {/* Phone illustration area */}
        <div className="flex justify-center mt-2 mb-6">
          <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-indigo-50">
            <PhoneIcon />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 text-center leading-snug">
          Ο αριθμός σου
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 text-center">
          Ο επαγγελματικός αριθμός θα συνδεθεί με τις κλήσεις και το CRM σου.
        </p>

        {/* Number card */}
        <div className="mt-6 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          {phoneLoading ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Έλεγχος αριθμού...</p>
          ) : noSession ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Συνδέσου για να δεις τον αριθμό σου.</p>
          ) : phoneError ? (
            <p className="text-sm text-red-600">
              Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.
            </p>
          ) : phoneInfo?.activationAllowed === false ? (
            <>
              <p className="text-xs font-medium text-red-500">Απαιτείται ενεργοποίηση</p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                Ολοκλήρωσε τη συνδρομή σου για να ενεργοποιήσεις τον αριθμό και τις κλήσεις.
              </p>
              <div className="mt-3">
                {phoneInfo.billingConfigured ? (
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkoutBusy}
                    className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60"
                  >
                    {checkoutBusy ? 'Άνοιγμα πληρωμής…' : 'Πληρωμή & ενεργοποίηση'}
                  </button>
                ) : (
                  <Link
                    href="/package?activation_required=1"
                    className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                  >
                    Επιλογή πακέτου
                  </Link>
                )}
              </div>
              {checkoutError && <p className="mt-2 text-xs text-red-600">{checkoutError}</p>}
            </>
          ) : phoneInfo?.phoneAssigned && phoneInfo.business?.business_phone_number ? (
            <>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Ο αριθμός σου</p>
              <p className="mt-2 text-2xl font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
                {phoneInfo.business.business_phone_number}
              </p>
              <div className="mt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 ring-1 ring-green-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-green-700">Ενεργός</span>
                </span>
              </div>
              <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                Ο αριθμός σου έχει ενεργοποιηθεί για την επιχείρησή σου.
              </p>
              <div className="mt-4">
                <Link
                  href="/calls"
                  className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                  Δοκίμασε το browser τηλέφωνο
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Ο αριθμός σου</p>
              <p className="mt-2 text-base font-medium text-zinc-700 dark:text-zinc-200">
                Ο αριθμός σου ετοιμάζεται.
              </p>
              {localNumberRequest?.status === 'pending' ? (
                <>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Καταγράψαμε ότι χρειάζεσαι αριθμό
                    {localNumberRequest.requestedCity
                      ? ` για ${localNumberRequest.requestedCity}`
                      : ''}.
                  </p>
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 ring-1 ring-indigo-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      <span className="text-xs font-medium text-indigo-700">Αίτημα σε εκκρεμότητα</span>
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                    Θα εμφανιστεί εδώ μόλις ενεργοποιηθεί.
                  </p>
                  <button
                    type="button"
                    disabled
                    className="mt-4 rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-4 py-2 text-sm font-medium text-zinc-400 dark:text-zinc-500 cursor-not-allowed"
                  >
                    Το αίτημα έχει καταχωρηθεί
                  </button>
                  <button
                    type="button"
                    onClick={handleCheckStatus}
                    disabled={phoneLoading}
                    className="mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {phoneLoading ? 'Έλεγχος...' : 'Έλεγχος κατάστασης'}
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 ring-1 ring-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      <span className="text-xs font-medium text-amber-700">Σε αναμονή</span>
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                    Δεν χρειάζεται να ρυθμίσεις κάτι άλλο τώρα.
                  </p>
                  <button
                    type="button"
                    onClick={handleCreateRequest}
                    disabled={requestSubmitting}
                    className={`mt-4 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800${requestSubmitting ? ' opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {requestSubmitting ? 'Αποστολή...' : 'Καταχώρηση αιτήματος'}
                  </button>
                  {requestError && (
                    <p className="mt-2 text-xs text-red-600">{requestError}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Feature list */}
        <ul className="mt-5 space-y-3.5 px-1">
          {FEATURES.map((f, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50">
                {f.icon}
              </div>
              <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{f.text}</span>
            </li>
          ))}
        </ul>

        {/* Secondary note */}
        <div className="mt-6 rounded-[28px] bg-zinc-50 dark:bg-[#1e2b38] px-5 py-4 ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Μπορείς να συνεχίσεις στην εφαρμογή και να το ρυθμίσεις αργότερα.
          </p>
        </div>

        {/* CTAs */}
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleContinue}
            className="w-full rounded-[28px] bg-indigo-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800"
          >
            Συνέχεια στην εφαρμογή
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="w-full py-2.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Θα το ρυθμίσω αργότερα
          </button>
        </div>

      </div>
    </main>
  );
}
