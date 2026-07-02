'use client';

// Βήμα 2 του signup + η σελίδα πληρωμής/ενεργοποίησης.
//
// Two modes, same tier chooser (TIERS from src/lib/billing/tiers.ts):
// - SIGNUP (fresh account, no business yet): pick Base/Premium + Ετήσια/Μηνιαία
//   → «Συνέχεια» → /onboarding?plan=… (the interval is stashed in localStorage
//   and used by the payment step after onboarding).
// - PAYMENT (?activation_required=1 — the business exists, subscription is
//   pending_payment): the SAME cards, CTA becomes «Πληρωμή & ενεργοποίηση» →
//   POST /api/billing/checkout {plan, interval} → Stripe hosted checkout.
//   When billing isn't configured yet, an honest notice replaces the dead
//   package→onboarding→number loop this page used to cause.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { TIERS, exVatLabel, type Tier } from '@/lib/billing/tiers';

const PLAN_STASH_KEY = 'opiflow_selected_plan';
const INTERVAL_STASH_KEY = 'opiflow_billing_interval';

type Interval = 'annual' | 'monthly';

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-indigo-500"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

export default function PackagePage() {
  const router = useRouter();
  const [voucherInput, setVoucherInput] = useState<string>('');
  const [selected, setSelected] = useState<Tier['key']>('premium');
  const [interval, setInterval] = useState<Interval>('annual');
  const [paymentMode, setPaymentMode] = useState(false);
  const [billingConfigured, setBillingConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Mode + preselect: URL ?plan wins, then the stash from /pricing / /register
  // (the OAuth and email-confirm paths lose the querystring), then Premium.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = qs.get('plan');
    const stashed = localStorage.getItem(PLAN_STASH_KEY);
    const pick = fromUrl === 'base' || fromUrl === 'premium' ? fromUrl : stashed === 'base' || stashed === 'premium' ? stashed : null;
    if (pick) setSelected(pick);
    const stashedInterval = localStorage.getItem(INTERVAL_STASH_KEY);
    if (stashedInterval === 'monthly') setInterval('monthly');

    if (qs.get('activation_required') === '1') {
      setPaymentMode(true);
      // The payment CTA needs to know whether Stripe is live + the plan already
      // chosen at signup (best-effort — the chooser still lets the user switch).
      void (async () => {
        try {
          const supabase = createBrowserSupabaseClient();
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token) return;
          const res = await fetch('/api/businesses/me', { headers: { Authorization: `Bearer ${token}` } });
          const json = (await res.json().catch(() => ({}))) as {
            billingConfigured?: boolean;
            subscription?: { plan_key?: string } | null;
          };
          if (typeof json.billingConfigured === 'boolean') setBillingConfigured(json.billingConfigured);
          const pk = json.subscription?.plan_key;
          if (!pick && (pk === 'base' || pk === 'premium')) setSelected(pk);
        } catch {
          // best-effort — the chooser still works
        }
      })();
    }
  }, []);

  function stash() {
    try {
      localStorage.setItem(PLAN_STASH_KEY, selected);
      localStorage.setItem(INTERVAL_STASH_KEY, interval);
    } catch {
      // storage unavailable — the URL param still carries the plan
    }
  }

  function handleContinue() {
    stash();
    const params = new URLSearchParams({ plan: selected });
    const trimmedVoucher = voucherInput.trim();
    if (trimmedVoucher) {
      params.set('voucher', trimmedVoucher);
    }
    router.push(`/onboarding?${params.toString()}`);
  }

  async function handlePay() {
    if (busy) return;
    setBusy(true);
    setError('');
    stash();
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError('Πρέπει να συνδεθείς ξανά.');
        setBusy(false);
        return;
      }
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selected, interval }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && typeof json.url === 'string') {
        window.location.href = json.url; // leaving for Stripe hosted checkout
        return;
      }
      setError(
        json.error === 'billing_not_configured'
          ? 'Οι online πληρωμές δεν έχουν ενεργοποιηθεί ακόμη. Επικοινώνησε μαζί μας για ενεργοποίηση.'
          : 'Δεν μπόρεσε να ξεκινήσει η πληρωμή. Δοκίμασε ξανά ή επικοινώνησε μαζί μας.',
      );
      setBusy(false);
    } catch {
      setError('Δεν μπόρεσε να ξεκινήσει η πληρωμή.');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-white dark:bg-[#0e1722] px-5 pt-6 pb-28">
      <div className="mx-auto max-w-md">
        {!paymentMode && (
          <Link
            href="/register"
            className="inline-flex items-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition mb-5"
            aria-label="Πίσω"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
        )}

        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
          {paymentMode ? 'Πληρωμή & ενεργοποίηση' : 'Βήμα 2 από 3'}
        </p>

        <h1 className="text-2xl font-bold leading-snug text-zinc-900 dark:text-zinc-100">
          {paymentMode ? 'Ολοκλήρωσε τη συνδρομή σου' : 'Διάλεξε πακέτο'}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          {paymentMode
            ? 'Ένα βήμα έμεινε — με την πληρωμή ενεργοποιούνται όλα αμέσως.'
            : 'Ακύρωση οποτεδήποτε. Όλες οι τιμές + ΦΠΑ.'}
        </p>

        {/* Ετήσια (the deal) / Μηνιαία (the pricier option) */}
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-full bg-zinc-100 p-1 dark:bg-white/5">
          <button
            type="button"
            onClick={() => setInterval('annual')}
            className={
              'rounded-full py-2 text-sm font-semibold transition ' +
              (interval === 'annual'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#17232f] dark:text-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400')
            }
          >
            Ετήσια <span className="ml-1 text-[11px] font-bold text-emerald-600">έως -50%</span>
          </button>
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={
              'rounded-full py-2 text-sm font-semibold transition ' +
              (interval === 'monthly'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#17232f] dark:text-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400')
            }
          >
            Μηνιαία
          </button>
        </div>

        {/* Tier cards */}
        <div className="mt-4 space-y-3">
          {TIERS.map((t) => {
            const isSelected = selected === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelected(t.key)}
                aria-pressed={isSelected}
                className={
                  'relative w-full rounded-[28px] bg-white px-5 py-5 text-left shadow-sm transition dark:bg-[#17232f] ' +
                  (isSelected
                    ? 'ring-2 ring-indigo-600'
                    : 'ring-1 ring-zinc-200 hover:ring-zinc-300 dark:ring-white/10')
                }
              >
                {t.badge && (
                  <span className="absolute right-5 top-5 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {t.badge}
                  </span>
                )}
                <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{t.name}</p>
                {interval === 'annual' ? (
                  <div className="mt-1">
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      <s>{exVatLabel(t.monthlyExVat * 12)}</s>{' '}
                      <span className="font-bold text-emerald-600">{t.discountLabel}</span>
                    </p>
                    <p className="mt-0.5">
                      <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{exVatLabel(t.priceExVat)}</span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500"> + ΦΠΑ / έτος · {t.perMonthHint}</span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-1">
                    <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{exVatLabel(t.monthlyExVat)}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500"> + ΦΠΑ / μήνα</span>
                  </p>
                )}
                <ul className="mt-3 space-y-1.5">
                  {t.bullets.slice(0, isSelected ? t.bullets.length : 3).map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckIcon />
                      <span className="text-sm text-zinc-600 dark:text-zinc-300">{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {interval === 'annual' && (
          <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
            Η ετήσια χρέωση γίνεται μία φορά τον χρόνο. Ακύρωση οποτεδήποτε.
          </p>
        )}

        {/* Voucher (signup only) */}
        {!paymentMode && (
          <div className="mt-4">
            <label
              htmlFor="voucher-input"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Κωδικός pilot ή demo (προαιρετικό)
            </label>
            <input
              id="voucher-input"
              type="text"
              value={voucherInput}
              onChange={(e) => setVoucherInput(e.target.value)}
              placeholder="π.χ. PILOT2025"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-[28px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              Αν δεν έχεις κωδικό, άφησε το πεδίο κενό.
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-6">
          {paymentMode ? (
            billingConfigured === false ? (
              <div className="rounded-[28px] bg-amber-50 p-4 text-center ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/20">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Οι online πληρωμές ενεργοποιούνται σύντομα
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Ο λογαριασμός σου έχει δημιουργηθεί. Στείλε μας email στο{' '}
                  <a className="font-semibold underline" href="mailto:support@opiflow.ai">
                    support@opiflow.ai
                  </a>{' '}
                  για άμεση ενεργοποίηση.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handlePay()}
                disabled={busy}
                className="w-full rounded-[28px] bg-indigo-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60"
              >
                {busy ? 'Άνοιγμα πληρωμής…' : `Πληρωμή & ενεργοποίηση — ${interval === 'annual' ? exVatLabel(TIERS.find((t) => t.key === selected)!.priceExVat) + ' + ΦΠΑ / έτος' : exVatLabel(TIERS.find((t) => t.key === selected)!.monthlyExVat) + ' + ΦΠΑ / μήνα'}`}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={handleContinue}
              className="w-full rounded-[28px] bg-indigo-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800"
            >
              Συνέχεια
            </button>
          )}
          {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
        </div>

        {!paymentMode && (
          <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
            Η πληρωμή γίνεται στο τέλος, αφού στηθεί η επιχείρησή σου.
          </p>
        )}
      </div>
    </main>
  );
}
