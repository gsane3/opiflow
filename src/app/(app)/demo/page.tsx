'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState } from '@/lib/storage';

interface StepDef {
  title: string;
  subtitle: string;
  bullets: string[];
  ctaLabel?: string;
  ctaHref?: string;
  warningNote?: string;
}

const STEPS: StepDef[] = [
  {
    // 0 — Welcome (Step 92)
    title: 'Καλώς ήρθες στον Demo οδηγό',
    subtitle:
      'Ακολούθησε τα βήματα για να δεις πώς μια κλήση γίνεται CRM, task και προσφορά.',
    bullets: [
      'Δεν γίνεται πραγματική κλήση ή αποστολή μηνύματος σε κανέναν.',
      'Όλα τα δεδομένα αποθηκεύονται μόνο τοπικά στον browser.',
      'Μπορείς να ακολουθήσεις τα βήματα με σειρά ή να ανοίξεις απευθείας όποια ενότητα θέλεις.',
      'Για να επαναφέρεις demo δεδομένα, χρησιμοποίησε τις Ρυθμίσεις.',
    ],
  },
  {
    // 1 — Dashboard (Step 93)
    title: 'Αρχική εικόνα',
    subtitle:
      'Το dashboard δείχνει κάθε εκκρεμές μαζί — χαμένες κλήσεις, tasks σήμερα, ανοιχτές προσφορές.',
    bullets: [
      'Χαμένες κλήσεις: demo δεδομένα — δεν υπάρχει πραγματικό VoIP στο MVP.',
      'Tasks: βλέπεις εκπρόθεσμα, σημερινά και επερχόμενα.',
      'Ανοιχτές προσφορές: κατάσταση και ποσό με μία ματιά.',
      'Ποιότητα δεδομένων: σε ειδοποιεί για ελλιπείς καρτέλες.',
      'Τοπική εικόνα: σύνοψη χωρίς cloud ή tracking.',
    ],
    ctaLabel: 'Άνοιγμα Αρχικής',
    ctaHref: '/dashboard',
  },
  {
    // 2 — Mock call (Step 94)
    title: 'Demo κλήση',
    subtitle:
      'Δες πώς θα λειτουργεί η εισαγωγή νέου πελάτη από κλήση όταν συνδεθεί το VoIP.',
    bullets: [
      'Δεν γίνεται πραγματική κλήση. Δεν υπάρχει VoIP ή ηχογράφηση στο MVP.',
      'Η demo κλήση προσομοιώνει τη ροή: κλήση → υπαγόρευση brief → AI review.',
      'Το αποτέλεσμα περνάει στο AI review για έλεγχο πριν αποθηκευτεί.',
      'Τίποτα δεν αποθηκεύεται χωρίς να επιβεβαιώσεις εσύ.',
    ],
    ctaLabel: 'Άνοιγμα demo κλήσης',
    ctaHref: '/call/mock',
    warningNote: 'Demo μόνο — χωρίς πραγματική κλήση, ηχογράφηση ή VoIP.',
  },
  {
    // 3 — AI review (Step 95)
    title: 'Έλεγχος AI',
    subtitle:
      'Το AI ετοιμάζει περίληψη, tasks και πρόταση προσφοράς. Εσύ αποφασίζεις τι αποθηκεύεται.',
    bullets: [
      'Το AI προτείνει — δεν αποθηκεύει τίποτα αυτόματα.',
      'Μπορείς να επεξεργαστείς κάθε πεδίο πριν πατήσεις Αποθήκευση.',
      'Χωρίς API key: τρέχει σε demo λειτουργία με υποδειγματικά δεδομένα.',
      'Με API key: η υπαγόρευση στέλνεται στο Claude AI για ανάλυση.',
    ],
    ctaLabel: 'Άνοιγμα AI review',
    ctaHref: '/ai-review',
  },
  {
    // 4 — Customer profile (Step 96) — ctaHref is set dynamically
    title: 'Προφίλ πελάτη',
    subtitle: 'Δες τι αποθηκεύεται στην καρτέλα μετά από AI review.',
    bullets: [
      'Περίληψη κλήσης και ανάγκες πελάτη.',
      'Επόμενες ενέργειες και ανοιχτά tasks.',
      'Ιστορικό timeline: κλήσεις, SMS, προσφορές, αρχεία.',
      'Στατιστικά δραστηριότητας: τελευταία κλήση, ανοιχτές προσφορές.',
    ],
    ctaLabel: 'Άνοιγμα καρτέλας',
  },
  {
    // 5 — Offer (Step 97) — ctaHref is set dynamically
    title: 'Προσφορά και μήνυμα',
    subtitle:
      'Δες πώς δημιουργείται η προσφορά και πώς αποστέλλεται χειροκίνητα.',
    bullets: [
      'Η προσφορά δημιουργείται με αντικείμενα, ΦΠΑ και σύνολο.',
      'Αντιγραφή κειμένου για Viber ή email — η εφαρμογή δεν στέλνει.',
      'Δεν υπάρχει αυτόματη αποστολή ή real SMS/email provider.',
      'Αλλαγή status χειροκίνητα: Στάλθηκε, Αποδεκτή, Απορρίφθηκε.',
    ],
    ctaLabel: 'Άνοιγμα προσφοράς',
  },
  {
    // 6 — Completion (Step 98)
    title: 'Τι είδες στο demo',
    subtitle:
      'Ο κύκλος ολόκληρος: από κλήση σε CRM, task, προσφορά και μήνυμα.',
    bullets: [
      'Demo κλήση → υπαγόρευση brief.',
      'AI review → επεξεργασία και αποθήκευση.',
      'CRM → καρτέλα πελάτη με tasks και ιστορικό.',
      'Δημιουργία προσφοράς → αντιγραφή μηνύματος.',
      'Αποστολή χειροκίνητα → Viber / email / τηλέφωνο.',
    ],
  },
];

export default function DemoPage() {
  const [step, setStep] = useState(0);
  const [customerId, setCustomerId] = useState('');
  const [offerId, setOfferId] = useState('');

  // Load first customer and offer IDs after mount — used for dynamic CTAs in steps 4 and 5.
  useEffect(() => {
    const state = loadState();
    const timer = window.setTimeout(() => {
      setCustomerId(state.customers?.[0]?.id ?? '');
      setOfferId(state.offers?.[0]?.id ?? '');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  function getCtaHref(): string {
    if (step === 4) return customerId ? `/customers/${customerId}` : '/customers';
    if (step === 5) return offerId ? `/offers/${offerId}` : '/offers';
    return current.ctaHref ?? '';
  }

  const ctaHref = getCtaHref();
  const ctaEmptyNote =
    (step === 4 && !customerId) || (step === 5 && !offerId)
      ? 'Δεν βρέθηκαν δεδομένα — άνοιξε τη λίστα ή επαναφέρε demo δεδομένα από τις Ρυθμίσεις.'
      : undefined;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">
      {/* Header */}
      <div>
        <div className="mb-1 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          Demo / Internal
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Demo οδηγός</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ακολούθησε τα βήματα για να δεις πώς μια κλήση γίνεται CRM, task και προσφορά.
        </p>
      </div>

      {/* Progress bar (Step 92) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Βήμα {step + 1} από {STEPS.length}
          </p>
          {/* Restart wizard only (Step 99) — does NOT reset CRM data */}
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(0)}
              className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
            >
              Επανεκκίνηση οδηγού
            </button>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-1.5 rounded-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step card */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-500">
            Βήμα {step + 1}
          </p>
          <h2 className="text-lg font-bold text-zinc-900">{current.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{current.subtitle}</p>
        </div>

        <ul className="space-y-2">
          {current.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-zinc-600">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              {b}
            </li>
          ))}
        </ul>

        {current.warningNote && (
          <div className="rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
            <p className="text-xs text-amber-700">{current.warningNote}</p>
          </div>
        )}

        {/* CTA link for steps 1–5 */}
        {ctaHref && current.ctaLabel && (
          <div className="space-y-1.5">
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              {current.ctaLabel}
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
            {ctaEmptyNote && (
              <p className="text-xs text-zinc-400">{ctaEmptyNote}</p>
            )}
          </div>
        )}

        {/* Completion actions (Step 98) */}
        {isLast && (
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            >
              Επανάληψη demo
            </button>
            <Link
              href="/dashboard"
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Άνοιγμα Αρχικής
            </Link>
            <Link
              href="/settings"
              className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-center text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            >
              Ρυθμίσεις
            </Link>
          </div>
        )}
      </div>

      {/* Back / Next navigation */}
      <div className={`flex items-center gap-3 ${isFirst ? 'justify-end' : 'justify-between'}`}>
        {!isFirst && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            ← Πίσω
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              isFirst
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            {isFirst ? 'Ξεκινάμε →' : 'Επόμενο →'}
          </button>
        )}
      </div>

      {/* Disclaimer */}
      <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <p className="text-xs text-amber-700">
          Όλα τα δεδομένα είναι τοπικά σε αυτόν τον browser. Δεν υπάρχει πραγματική VoIP,
          ηχογράφηση, SMS provider ή cloud sync.
        </p>
      </div>
    </div>
  );
}
