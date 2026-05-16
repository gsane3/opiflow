'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState } from '@/lib/storage';
import DemoTruthBadge from '@/components/common/DemoTruthBadge';

// ── Step 104: Scenario types ───────────────────────────────────────────────────
type Scenario = 'technical' | 'sales' | 'construction';

const SCENARIO_LABELS: Record<Scenario, string> = {
  technical: 'Τεχνική υπηρεσία',
  sales: 'Πωλήσεις / υπηρεσίες',
  construction: 'Έργο / κατασκευή',
};

// ── Step 105: URL slug ↔ step index maps ───────────────────────────────────────
const SLUG_TO_STEP: Record<string, number> = {
  dashboard: 1,
  call: 2,
  review: 3,
  customer: 4,
  offer: 5,
  complete: 6,
};

const STEP_TO_SLUG: Record<number, string> = {
  1: 'dashboard',
  2: 'call',
  3: 'review',
  4: 'customer',
  5: 'offer',
  6: 'complete',
};

// ── Step 104: Scenario-specific hints for relevant steps ──────────────────────
function getScenarioNote(stepIndex: number, scenario: Scenario | ''): string | null {
  if (!scenario) return null;
  const notes: Record<Scenario, Partial<Record<number, string>>> = {
    technical: {
      2: 'Σενάριο: HVAC 120τμ, ηλεκτρολογικές εργασίες ή εγκατάσταση κλιματισμού.',
      3: 'Το AI θα εντοπίσει τύπο εργασίας, υλικά και εκτίμηση κόστους.',
      5: 'Η προσφορά θα έχει εργασία + υλικά + ΦΠΑ 24%.',
    },
    sales: {
      2: 'Σενάριο: πακέτο υπηρεσιών, ανανέωση σύμβασης ή αναβάθμιση πελάτη.',
      3: 'Το AI θα εντοπίσει ζητούμενο προϊόν, έκπτωση ή ανανέωση σύμβασης.',
      5: 'Η προσφορά θα έχει πακέτο υπηρεσιών ή ανανέωση.',
    },
    construction: {
      2: 'Σενάριο: ανακαίνιση χώρου, κατασκευή πέργκολας ή νέο έργο.',
      3: 'Το AI θα εντοπίσει τετραγωνικά, υλικά και χρόνο παράδοσης.',
      5: 'Η προσφορά θα έχει εργατικά + υλικά κατασκευής.',
    },
  };
  return notes[scenario]?.[stepIndex] ?? null;
}

// ── Step data ─────────────────────────────────────────────────────────────────
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
    // 0 — Welcome
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
    // 1 — Dashboard
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
    // 2 — Mock call
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
    // 3 — AI review
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
    // 4 — Customer profile (ctaHref is dynamic)
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
    // 5 — Offer (ctaHref is dynamic)
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
    // 6 — Completion
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

// ── State awareness types (Step 102) ─────────────────────────────────────────
interface DataCounts {
  customers: number;
  offers: number;
  tasks: number;
  communications: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [step, setStep] = useState(0);
  const [scenario, setScenario] = useState<Scenario | ''>('');
  const [customerId, setCustomerId] = useState('');
  const [offerId, setOfferId] = useState('');
  // Step 102: data state awareness
  const [dataCounts, setDataCounts] = useState<DataCounts | null>(null);

  // Load state + resolve initial step from URL param after mount
  useEffect(() => {
    const state = loadState();
    // Step 105: read ?step=slug from URL
    const slug = new URLSearchParams(window.location.search).get('step');
    const initialStep = slug && SLUG_TO_STEP[slug] !== undefined ? SLUG_TO_STEP[slug] : 0;

    const timer = window.setTimeout(() => {
      setCustomerId(state.customers?.[0]?.id ?? '');
      setOfferId(state.offers?.[0]?.id ?? '');
      setDataCounts({
        customers: state.customers?.length ?? 0,
        offers: state.offers?.length ?? 0,
        tasks: state.tasks?.length ?? 0,
        communications: state.communications?.length ?? 0,
      });
      if (initialStep > 0) setStep(initialStep);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Step 105: update URL slug when step changes
  function goToStep(newStep: number) {
    setStep(newStep);
    const slug = STEP_TO_SLUG[newStep];
    const url = slug ? `/demo?step=${slug}` : '/demo';
    window.history.replaceState(null, '', url);
  }

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const hasDemoData =
    dataCounts !== null &&
    (dataCounts.customers > 0 || dataCounts.offers > 0 || dataCounts.tasks > 0);

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

  const scenarioNote = getScenarioNote(step, scenario);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">
      {/* Header */}
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <DemoTruthBadge label="Demo / Internal" />
          <Link
            href="/demo/production-readiness"
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            Τεχνική ετοιμότητα →
          </Link>
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Demo οδηγός</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ακολούθησε τα βήματα για να δεις πώς μια κλήση γίνεται CRM, task και προσφορά.
        </p>
      </div>

      {/* Step 102: Data state awareness card — shown only on step 0 after hydration */}
      {isFirst && dataCounts !== null && (
        hasDemoData ? (
          <div className="flex items-start gap-3 rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-800">
                Υπάρχουν demo δεδομένα για να ακολουθήσεις τη ροή.
              </p>
              <p className="text-xs text-green-600">
                {dataCounts.customers} πελάτες · {dataCounts.tasks} tasks · {dataCounts.offers} προσφορές
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-800">
                Δεν υπάρχουν αρκετά demo δεδομένα.
              </p>
              <p className="text-xs text-amber-700">
                Η ροή θα δείξει λιστάρισμα αντί για συγκεκριμένα αποτελέσματα.
              </p>
            </div>
            <Link
              href="/settings"
              className="shrink-0 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              Ρυθμίσεις →
            </Link>
          </div>
        )
      )}

      {/* Step 104: Scenario selector — shown on step 0 */}
      {isFirst && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500">Επέλεξε σενάριο (προαιρετικό):</p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(SCENARIO_LABELS) as [Scenario, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScenario(scenario === key ? '' : key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  scenario === key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {scenario && (
            <p className="text-xs text-indigo-600">
              Σενάριο: {SCENARIO_LABELS[scenario]} — τα παραδείγματα θα προσαρμοστούν.
            </p>
          )}
        </div>
      )}

      {/* Step 105: Progress bar with URL-synced steps */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Βήμα {step + 1} από {STEPS.length}
          </p>
          {step > 0 && (
            <button
              type="button"
              onClick={() => goToStep(0)}
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

        {/* Step 104: Scenario-specific note */}
        {scenarioNote && (
          <div className="rounded-xl bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-100">
            <p className="text-xs text-indigo-700">
              <span className="font-semibold">{SCENARIO_LABELS[scenario as Scenario]}:</span>{' '}
              {scenarioNote}
            </p>
          </div>
        )}

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

        {/* Completion actions */}
        {isLast && (
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() => goToStep(0)}
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
            onClick={() => goToStep(Math.max(0, step - 1))}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            ← Πίσω
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            onClick={() => goToStep(Math.min(STEPS.length - 1, step + 1))}
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
