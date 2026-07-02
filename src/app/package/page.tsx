'use client';

import { useState } from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {
  PLAN,
  PLAN_FEATURES,
  PLAN_PRICE_EX_VAT_LABEL,
  PLAN_PRICE_INC_VAT_LABEL,
} from '@/lib/billing/plans';

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

  function handleContinue() {
    // Tier choice forwarded from /pricing → /register → here. Read at click
    // time from the URL (a useSearchParams hook would force a Suspense
    // boundary just for this). The chooser UI still shows the single live
    // plan; the KEY simply flows through to the signup row.
    const forwarded = new URLSearchParams(window.location.search).get('plan');
    const planKey = forwarded === 'base' || forwarded === 'premium' ? forwarded : PLAN.key;
    const params = new URLSearchParams({ plan: planKey });
    const trimmedVoucher = voucherInput.trim();
    if (trimmedVoucher) {
      params.set('voucher', trimmedVoucher);
    }
    router.push(`/onboarding?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-white dark:bg-[#0e1722] px-5 pt-6 pb-28">
      <div className="mx-auto max-w-md">

        {/* Back */}
        <Link
          href="/register"
          className="inline-flex items-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition mb-5"
          aria-label="Πίσω"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>

        {/* Step label */}
        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">Βήμα 2 από 3</p>

        {/* Title */}
        <h1 className="text-2xl font-bold leading-snug text-zinc-900 dark:text-zinc-100">
          Η συνδρομή σου
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ένα απλό πακέτο με όλα μέσα. Ακύρωση οποτεδήποτε.
        </p>

        {/* The single plan */}
        <div className="mt-6 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-5 shadow-sm ring-2 ring-indigo-600">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{PLAN.name}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Όλα όσα χρειάζεσαι</p>
            </div>
            <div className="ml-auto shrink-0 text-right">
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{PLAN_PRICE_EX_VAT_LABEL}</span>
              <span className="block text-xs text-zinc-400 dark:text-zinc-500">/μήνα</span>
            </div>
          </div>

          <ul className="mt-4 space-y-1.5">
            {PLAN_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckIcon />
                <span className="text-sm text-zinc-600 dark:text-zinc-300">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Billing truth note */}
        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          {PLAN_PRICE_INC_VAT_LABEL} τον μήνα. Μηνιαία χρέωση, ακύρωση οποτεδήποτε.
        </p>

        {/* Voucher or demo code */}
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

        {/* CTA */}
        <div className="mt-6">
          <button
            type="button"
            onClick={handleContinue}
            className="w-full rounded-[28px] bg-indigo-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:bg-indigo-800"
          >
            Συνέχεια
          </button>
        </div>

      </div>
    </main>
  );
}
