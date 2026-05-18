'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState, clearState, saveState } from '@/lib/storage';
import { buildRichDemoState } from '@/lib/demo-data';
import DemoTruthBadge from '@/components/common/DemoTruthBadge';
import KnownLimitationsBox from '@/components/common/KnownLimitationsBox';
import {
  startDemoGuide,
  loadDemoGuideSession,
  exitDemoGuide,
  getCurrentGuideHref,
  isDemoGuideDone,
} from '@/lib/demo-guide-session';

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
      'Πάτα μια κάρτα (Tasks, Πελάτες, Προσφορές) για να δεις λεπτομέρειες χωρίς να φύγεις από τη σελίδα.',
      'Χαμένες κλήσεις: demo δεδομένα — δεν υπάρχει πραγματικό VoIP στο MVP.',
      'Tasks: βλέπεις εκπρόθεσμα, σημερινά και επερχόμενα.',
      'Ανοιχτές προσφορές: κατάσταση και ποσό με μία ματιά.',
      'Τοπική εικόνα: σύνοψη χωρίς cloud ή tracking.',
    ],
    ctaLabel: 'Άνοιγμα Αρχικής',
    ctaHref: '/dashboard',
  },
  {
    // 2 — Mock call
    title: 'Demo κλήση + μελλοντικό VoIP',
    subtitle:
      'Δες πώς θα λειτουργεί η in-app κλήση όταν συνδεθεί VoIP provider στο τελικό προϊόν.',
    bullets: [
      'Δεν γίνεται πραγματική κλήση. Δεν υπάρχει VoIP ή ηχογράφηση στο MVP.',
      'Demo VoIP keypad: δείχνει πώς θα φαίνεται το in-app dialer στο τελικό προϊόν.',
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
      'Στο τελικό προϊόν, μετά την κλήση, το AI θα ετοιμάζει brief αυτόματα για το CRM.',
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

  // Step 172: guided demo session state
  const [guideActive, setGuideActive] = useState(false);
  const [guideDone, setGuideDone] = useState(false);
  // Step 172: auto-seed tracking
  const [autoSeeded, setAutoSeeded] = useState(false);

  // Step 161: copy demo URL state
  const [copyLinkCopied, setCopyLinkCopied] = useState(false);
  const [showPilotDetails, setShowPilotDetails] = useState(false);
  const [confirmingDemoExit, setConfirmingDemoExit] = useState(false);

  function handleCopyLink() {
    const url = `${window.location.origin}/demo`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => { setCopyLinkCopied(true); setTimeout(() => setCopyLinkCopied(false), 2000); },
        () => { setCopyLinkCopied(true); setTimeout(() => setCopyLinkCopied(false), 2000); }
      );
    } else {
      setCopyLinkCopied(true);
      setTimeout(() => setCopyLinkCopied(false), 2000);
    }
  }

  // Step 172: load guide session state after mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const session = loadDemoGuideSession();
      setGuideActive(!!(session?.active));
      setGuideDone(isDemoGuideDone());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function handleStartGuide() {
    startDemoGuide();
    // Data is already auto-seeded — skip Settings, go straight to dashboard.
    window.location.href = '/dashboard?demoStep=dashboard&guide=1';
  }

  function handleContinueGuide() {
    window.location.href = getCurrentGuideHref();
  }

  function handleExitGuide() {
    setConfirmingDemoExit(true);
  }

  // Load state + resolve initial step from URL param after mount.
  // Step 172: if browser has no CRM data, auto-seed Rich pilot demo safely.
  useEffect(() => {
    const state = loadState();
    const slug = new URLSearchParams(window.location.search).get('step');
    const initialStep = slug && SLUG_TO_STEP[slug] !== undefined ? SLUG_TO_STEP[slug] : 0;

    const isEmpty =
      !state.customers?.length &&
      !state.tasks?.length &&
      !state.offers?.length &&
      !state.calls?.length &&
      !state.communications?.length;

    let finalState = state;
    let didAutoSeed = false;

    if (isEmpty) {
      const rich = buildRichDemoState();
      clearState();
      saveState(rich);
      finalState = { ...state, ...rich } as typeof state;
      didAutoSeed = true;
    }

    const timer = window.setTimeout(() => {
      setCustomerId(finalState.customers?.[0]?.id ?? '');
      setOfferId(finalState.offers?.[0]?.id ?? '');
      setDataCounts({
        customers: finalState.customers?.length ?? 0,
        offers: finalState.offers?.length ?? 0,
        tasks: finalState.tasks?.length ?? 0,
        communications: finalState.communications?.length ?? 0,
      });
      if (initialStep > 0) setStep(initialStep);
      if (didAutoSeed) setAutoSeeded(true);
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
      {/* Step 154: Public-friendly header */}
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <DemoTruthBadge label="Demo — yorgos.ai" />
          <Link
            href="/demo/production-readiness"
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            Τεχνική ετοιμότητα →
          </Link>
          {/* Step 161: Copy review link */}
          <button
            type="button"
            onClick={handleCopyLink}
            className={`text-xs transition ${
              copyLinkCopied ? 'text-green-600' : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {copyLinkCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή review link'}
          </button>
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Δοκίμασε το yorgos.ai</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Demo CRM για τεχνικές υπηρεσίες — κλήση, AI review, CRM, προσφορά.
          Τα δεδομένα μένουν μόνο στον browser σου. Δεν αποστέλλεται τίποτα αυτόματα.
        </p>
      </div>

      {/* Step 102 / 172: Data state awareness card — shown only on step 0 after hydration */}
      {isFirst && dataCounts !== null && (
        hasDemoData ? (
          <div className="flex items-start gap-3 rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-800">
                {autoSeeded
                  ? 'Έτοιμα demo δεδομένα φορτώθηκαν για να ξεκινήσεις.'
                  : 'Υπάρχουν ήδη δεδομένα σε αυτόν τον browser. Δεν τα αλλάξαμε.'}
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
                Δεν φορτώθηκαν demo δεδομένα.
              </p>
              <p className="text-xs text-amber-700">
                Ανανέωσε τη σελίδα ή χρησιμοποίησε τις Ρυθμίσεις.
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

      {/* Step 172: Guided demo entry — primary CTA, shown before old wizard */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-3">
        {guideDone ? (
          <div className="space-y-2 text-center">
            <p className="text-sm font-semibold text-green-700">
              Το guided demo ολοκληρώθηκε!
            </p>
            <p className="text-xs text-zinc-500">
              Μπορείς να χρησιμοποιήσεις ελεύθερα την εφαρμογή ή να ξεκινήσεις ξανά.
            </p>
            <button
              type="button"
              onClick={handleStartGuide}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
            >
              Ξεκίνα ξανά guided demo
            </button>
          </div>
        ) : guideActive ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-1">
                Guided demo ενεργό
              </p>
              <p className="text-sm font-bold text-zinc-900">Συνέχισε από εκεί που έμεινες</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Ο οδηγός θυμάται το βήμα σου σε αυτό το tab.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleContinueGuide}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Συνέχεια guided demo &rarr;
              </button>
              <button
                type="button"
                onClick={handleExitGuide}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:bg-zinc-50"
              >
                Έξοδος από guided demo
              </button>
            </div>
            {confirmingDemoExit && (
              <div className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-200 space-y-1.5">
                <p className="text-xs font-medium text-zinc-700">Να βγεις από το guided demo;</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { exitDemoGuide(); setGuideActive(false); setGuideDone(false); setConfirmingDemoExit(false); }}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
                  >
                    Ναι, έξοδος
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDemoExit(false)}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-1">
                Για reviewers
              </p>
              <p className="text-sm font-bold text-zinc-900">Ξεκίνα guided demo</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Ο οδηγός θα σε πάει βήμα-βήμα και θα σου λέει τι να πατήσεις.
                Μπορείς να βγεις οπότε θέλεις.
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartGuide}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Ξεκίνα guided demo &rarr;
            </button>
          </div>
        )}
      </div>

      {/* How the product works */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <h2 className="text-base font-bold text-zinc-900">Πώς λειτουργεί</h2>
        <ol className="space-y-4">
          {[
            {
              n: 1,
              title: 'Λαμβάνεις επαφή ή lead',
              body: 'Καταχώρησε πελάτη, υπαγόρευσε brief μετά από επαφή, ή χρησιμοποίησε AI εντολές.',
            },
            {
              n: 2,
              title: 'Το AI οργανώνει',
              body: 'Το AI review δημιουργεί καρτέλα πελάτη, tasks, ραντεβού και draft προσφοράς. Εσύ αποφασίζεις τι αποθηκεύεται.',
            },
            {
              n: 3,
              title: 'Εσύ στέλνεις και παρακολουθείς',
              body: 'Η προσφορά στέλνεται χειροκίνητα ή μέσω email όταν είναι ρυθμισμένο. Μετά την απάντηση πελάτη, το CRM μένει ενημερωμένο.',
            },
          ].map(({ n, title, body }) => (
            <li key={n} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                {n}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-zinc-400">
          Τοπική αποθήκευση στον browser. Χωρίς πραγματική κλήση, SMS ή cloud sync στο MVP.
        </p>
      </div>

      {/* "Τι θα δεις σε 5 λεπτά" card */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-3">
        <h2 className="text-base font-bold text-zinc-900">Τι θα δεις σε 5 λεπτά</h2>
        <ul className="space-y-2">
          {[
            'Κλήση → AI brief → δεδομένα CRM.',
            'Καρτέλα πελάτη με tasks και ιστορικό.',
            'Προσφορά με link αποδοχής από τον πελάτη.',
            'Αποδοχή → αυτόματο follow-up task.',
          ].map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-zinc-600">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              {b}
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-400">
          Στο MVP δεν γίνεται πραγματική κλήση, SMS, VoIP, ή cloud sync. Όλα τοπικά στον browser.
        </p>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-4 text-xs">
        <Link href="/demo/pilot-feedback" className="text-indigo-600 hover:text-indigo-700">Feedback →</Link>
        <Link href="/demo/privacy" className="text-zinc-500 hover:text-zinc-700">Απόρρητο →</Link>
        <Link href="/demo/production-readiness" className="text-zinc-500 hover:text-zinc-700">Τεχνική ετοιμότητα →</Link>
      </div>

      {/* Collapsible pilot section */}
      <button
        type="button"
        onClick={() => setShowPilotDetails((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-100 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100"
      >
        <span>Περισσότερα για pilot χρήστες</span>
        <svg
          className={`h-4 w-4 text-zinc-400 transition-transform ${showPilotDetails ? 'rotate-180' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {showPilotDetails && (
      <>

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

      {/* Step 158: Public review privacy note */}
      <div className="rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200 space-y-1">
        <p className="text-xs font-semibold text-zinc-500">Για reviewers</p>
        <ul className="space-y-0.5">
          {[
            'Μην βάλεις ευαίσθητα πραγματικά δεδομένα.',
            'Τα δεδομένα μένουν μόνο στον browser σου — δεν βλέπω τίποτα αυτόματα.',
            'Για feedback: πάτα «Copy report» στη φόρμα feedback και στείλ\' το χειροκίνητα.',
          ].map((t) => (
            <li key={t} className="flex items-start gap-1.5 text-xs text-zinc-500">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
              {t}
            </li>
          ))}
        </ul>
        <Link href="/demo/privacy" className="text-xs text-indigo-600 hover:text-indigo-700">
          Απόρρητο και αποθήκευση →
        </Link>
      </div>

      {/* Steps 164+166+170: Demo missions — primary reviewer entry */}
      <div className="border-t border-zinc-100 pt-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Demo αποστολές</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Κάνε κλικ σε κάθε αποστολή — η σελίδα θα σε καθοδηγήσει.
          </p>
        </div>
        <ol className="space-y-2">
          {[
            {
              n: 1,
              title: 'Δες το dashboard',
              learn: 'Tasks, χαμένες κλήσεις, ανοιχτές προσφορές.',
              href: '/dashboard?demoStep=dashboard',
            },
            {
              n: 2,
              title: 'Δοκίμασε AI review',
              learn: 'Υπαγόρευση brief και δημιουργία στοιχείων από AI.',
              href: '/ai-review?demoStep=review',
            },
            {
              n: 3,
              title: 'Άνοιξε καρτέλα πελάτη',
              learn: 'Ιστορικό, tasks, προσφορές, timeline.',
              href: '/customers/demo-karagiannis?demoStep=customer',
            },
            {
              n: 4,
              title: 'Tasks',
              learn: 'Εσωτερική λίστα εργασιών: κλήσεις, αποστολές, follow-ups.',
              href: '/tasks?demoStep=tasks',
            },
            {
              n: 5,
              title: 'Ραντεβού',
              learn: 'Εσωτερικό πρόγραμμα ραντεβού. Χωρίς εξωτερικό ημερολόγιο.',
              href: '/appointments?demoStep=appointments',
            },
            {
              n: 6,
              title: 'Άνοιξε προσφορά',
              learn: 'Print PDF, copy Viber/email draft, demo response link.',
              href: '/offers/demo-offer-1?demoStep=offer',
            },
            {
              n: 7,
              title: 'Απάντησε σαν πελάτης',
              learn: 'Αποδοχή ή απόρριψη — αποθηκεύεται τοπικά.',
              href: '/offer-response/demo-offer-1?demoStep=response',
            },
            {
              n: 8,
              title: 'Follow-up task',
              learn: 'Επόμενο βήμα μετά αποδοχή — στο CRM offer.',
              href: '/offers/demo-offer-1?demoStep=followup',
            },
          ].map(({ n, title, learn, href }) => (
            <li key={n}>
              <Link
                href={href}
                className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100 transition hover:ring-indigo-200"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                  {n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{title}</p>
                  <p className="text-xs text-zinc-400">{learn}</p>
                </div>
                <svg className="ml-auto h-4 w-4 shrink-0 self-center text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      {/* New features: AI cmd + Appointments */}
      <div className="border-t border-zinc-100 pt-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Νέα σημεία για demo</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Ενότητες που προστέθηκαν μετά τον βασικό οδηγό.
          </p>
        </div>
        <div className="space-y-2">
          {[
            {
              href: '/cmd',
              title: 'AI εντολές',
              learn: 'Δοκίμασε εντολές για tasks, ραντεβού, draft προσφορές και ακύρωση ραντεβού με επιβεβαίωση.',
            },
          ].map(({ href, title, learn }) => (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100 transition hover:ring-indigo-200"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">{title}</p>
                <p className="text-xs text-zinc-400">{learn}</p>
              </div>
              <svg className="ml-auto h-4 w-4 shrink-0 self-center text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ))}
        </div>
      </div>

      {/* Step 144: Pilot entry point — improved sequence card */}
      <div className="border-t border-zinc-100 pt-6 space-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Για pilot χρήστες
          </p>
          <h2 className="mt-1 text-base font-bold text-zinc-900">Ξεκίνα pilot δοκιμή</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Ακολούθησε αυτά τα βήματα για χρήσιμη δοκιμή με δικά σου δεδομένα.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <ol className="space-y-2">
            {[
              { n: 1, text: 'Κάνε backup για ασφάλεια πριν ξεκινήσεις.' },
              { n: 2, text: 'Πρόσθεσε έναν πελάτη (όνομα + κινητό ή email).' },
              { n: 3, text: 'Δοκίμασε AI review ή demo call — κοίτα τι δημιουργείται.' },
              { n: 4, text: 'Δημιούργησε μια προσφορά και άνοιξε το demo response link.' },
              { n: 5, text: 'Άνοιξε /offer-response/[id] και κάνε αποδοχή ή απόρριψη.' },
              { n: 6, text: 'Στείλε feedback μέσω της φόρμας.' },
            ].map(({ n, text }) => (
              <li key={n} className="flex items-start gap-3 text-sm text-zinc-600">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                  {n}
                </span>
                {text}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-100">
            <Link href="/settings" className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700">
              Δημιουργία backup
            </Link>
            <Link href="/customers" className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Προσθήκη πελάτη
            </Link>
            <Link href="/ai-review" className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
              AI review
            </Link>
            <Link href="/call/mock" className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Demo κλήση
            </Link>
            <Link href="/demo/pilot-feedback" className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Feedback pilot
            </Link>
          </div>
        </div>
      </div>

      {/* Step 115: First real-use checklist ──────────────────────────────── */}
      <FirstUseChecklist />

      {/* Known limitations */}
      <KnownLimitationsBox />

      </>
      )}

    </div>
  );
}

// ── Step 115: First real-use checklist (local state only) ─────────────────────
const FIRST_USE_ITEMS = [
  'Κάνε backup πριν ξεκινήσεις.',
  'Πρόσθεσε έναν πελάτη.',
  'Κάνε demo call ή AI review.',
  'Αποθήκευσε summary στο CRM.',
  'Δημιούργησε ένα task.',
  'Δημιούργησε μία προσφορά.',
  'Αντέγραψε Viber ή email draft.',
  'Κάνε ξανά backup μετά τη δοκιμή.',
];

function FirstUseChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Step 145: reset checklist — local state only, never persisted
  function resetChecklist() { setChecked(new Set()); }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Πρώτη δοκιμή με δικά σου δεδομένα</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Η πρόοδος δεν αποθηκεύεται. Τοπική λίστα μόνο.
          </p>
        </div>
        {checked.size > 0 && (
          <button
            type="button"
            onClick={resetChecklist}
            className="shrink-0 text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
          >
            Καθαρισμός
          </button>
        )}
      </div>
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
        {FIRST_USE_ITEMS.map((item, i) => {
          const done = checked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-center gap-3 text-left"
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                done ? 'border-indigo-600 bg-indigo-600' : 'border-zinc-300 bg-white'
              }`}>
                {done && (
                  <svg className="h-2.5 w-2.5 text-white" fill="none" strokeWidth={3} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </span>
              <span className={`text-sm ${done ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>
                {item}
              </span>
            </button>
          );
        })}
        <p className="pt-1 text-xs text-zinc-400">
          {checked.size} / {FIRST_USE_ITEMS.length} ολοκληρωμένα
        </p>
      </div>
    </div>
  );
}
