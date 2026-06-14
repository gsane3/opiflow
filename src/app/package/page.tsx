'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  recommended: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '€29',
    period: '/μήνα',
    description: 'Για έναν επαγγελματία',
    features: [
      'Κλήσεις και πελάτες',
      'Βασικά follow-ups',
    ],
    recommended: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '€59',
    period: '/μήνα',
    description: 'Για καθημερινή χρήση',
    features: [
      'AI brief κλήσεων',
      'Προσφορές και ραντεβού',
    ],
    recommended: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: 'Κατόπιν επικοινωνίας',
    period: '',
    description: 'Για μικρή ομάδα',
    features: [
      'Περισσότεροι χρήστες',
      'Προηγμένες ροές αργότερα',
    ],
    recommended: false,
  },
];

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
  const [selected, setSelected] = useState<string>('pro');
  const [voucherInput, setVoucherInput] = useState<string>('');

  function handleContinue() {
    const params = new URLSearchParams({ plan: selected });
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
          Διάλεξε πακέτο
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ξεκίνα απλά. Μπορείς να αλλάξεις αργότερα.
        </p>

        {/* Plan cards */}
        <div className="mt-6 space-y-3">
          {PLANS.map((plan) => {
            const isSelected = selected === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelected(plan.id)}
                className={`relative w-full rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 text-left shadow-sm transition ${
                  isSelected
                    ? 'ring-2 ring-indigo-600'
                    : 'ring-1 ring-zinc-200/60 dark:ring-white/10 hover:ring-zinc-300 dark:hover:ring-white/20'
                }`}
              >
                {/* Recommended badge */}
                {plan.recommended && (
                  <span className="absolute right-4 top-4 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-semibold text-white">
                    Προτείνεται
                  </span>
                )}

                {/* Plan header */}
                <div className="flex items-start justify-between pr-24">
                  <div>
                    <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{plan.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{plan.description}</p>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <span className={`font-bold ${plan.period ? 'text-lg text-zinc-900 dark:text-zinc-100' : 'text-sm text-zinc-500 dark:text-zinc-400'}`}>
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">{plan.period}</span>
                    )}
                  </div>
                </div>

                {/* Features */}
                <ul className="mt-3 space-y-1.5">
                  {plan.features.map((f) => (
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

        {/* Billing truth note */}
        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          Η επιβεβαίωση ενεργοποίησης γίνεται μετά την καταχώρηση.
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
