'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  loadDemoGuideSession,
  completeDemoGuideStep,
  setCurrentDemoGuideStep,
  getNextDemoGuideStep,
  getGuideStepHref,
  finishDemoGuide,
  exitDemoGuide,
  type DemoGuideStep,
} from '@/lib/demo-guide-session';

interface Props {
  step: DemoGuideStep;
  stepNum: number;       // 1-8
  title: string;
  whatYouSee: string;    // Τι βλέπεις εδωα
  whatToDo: string;      // Τι να κανεις τωρα
  whyItMatters?: string; // Γιατι εχει αξια
  canManualComplete?: boolean;
  isCompleted?: boolean; // externally detected (offer accepted, task created, etc.)
  nextHref?: string;     // override default next URL
  isFinalStep?: boolean; // feedback step — calls finishDemoGuide on complete
  onManualComplete?: () => void;
}

export default function GuidedDemoBanner({
  step,
  stepNum,
  title,
  whatYouSee,
  whatToDo,
  whyItMatters,
  canManualComplete,
  isCompleted: externallyCompleted,
  nextHref,
  isFinalStep,
  onManualComplete,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [guideActive, setGuideActive] = useState(false);
  const [manualDone, setManualDone] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [currentSessionStep, setCurrentSessionStep] = useState<DemoGuideStep | null>(null);
  const [guideFinished, setGuideFinished] = useState(false);
  const [confirmingDemoExit, setConfirmingDemoExit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demoStep = params.get('demoStep');
    const guide = params.get('guide');
    const session = loadDemoGuideSession();

    const timer = window.setTimeout(() => {
      const isStepMatch = demoStep === step;
      const isGuideMode = guide === '1' || !!(session?.active);
      setVisible(isStepMatch && isGuideMode);
      setGuideActive(!!(session?.active));
      setSessionCompleted(session?.completedSteps.includes(step) ?? false);
      setCurrentSessionStep(session?.currentStep ?? null);
      setGuideFinished(!session?.active && session?.currentStep === 'done');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  if (!visible) return null;

  const isDone = manualDone || (externallyCompleted ?? false) || sessionCompleted;

  const nextStep = getNextDemoGuideStep(step);
  const computedNextHref = nextHref ?? getGuideStepHref(nextStep);

  // Soft warning: guide active but user is on a different step
  const isWrongStep =
    guideActive &&
    currentSessionStep !== null &&
    currentSessionStep !== step &&
    currentSessionStep !== 'done' &&
    !sessionCompleted;

  function handleManualComplete() {
    completeDemoGuideStep(step);
    setCurrentDemoGuideStep(nextStep);
    setManualDone(true);
    onManualComplete?.();
  }

  function handleNext() {
    if (!isDone) return;
    if (isFinalStep) {
      completeDemoGuideStep(step);
      finishDemoGuide();
      setGuideFinished(true);
      window.location.href = '/dashboard';
      return;
    }
    if (!sessionCompleted) {
      completeDemoGuideStep(step);
      setCurrentDemoGuideStep(nextStep);
    }
    window.location.href = computedNextHref;
  }

  function handleExit() {
    setConfirmingDemoExit(true);
  }

  function handleConfirmExit() {
    exitDemoGuide();
    window.location.href = '/demo';
  }

  if (guideFinished) {
    return (
      <div className="mb-4 rounded-2xl bg-green-50 p-4 ring-2 ring-green-300 space-y-2 text-center">
        <p className="text-sm font-bold text-green-800">Ολοκληρωθηκε το guided demo!</p>
        <p className="text-xs text-green-700">
          Μπορεις πλεον να χρησιμοποιησεις ελευθερα την εφαρμογη.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-xl bg-green-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-green-700"
        >
          Ανοιγμα Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-indigo-50 p-4 ring-2 ring-indigo-300 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            MISSION {stepNum}/8
          </span>
          <p className="text-sm font-bold text-indigo-900">{title}</p>
        </div>
        <button
          type="button"
          onClick={handleExit}
          className="shrink-0 text-[10px] text-indigo-400 underline-offset-2 hover:text-red-500 hover:underline"
        >
          Εξοδος
        </button>
      </div>

      {confirmingDemoExit && (
        <div className="rounded-xl bg-red-50 px-3 py-2 ring-1 ring-red-200 space-y-1.5">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Να βγεις από το guided demo;</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirmExit}
              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              Ναι, έξοδος
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDemoExit(false)}
              className="rounded-lg border border-zinc-200 dark:border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Πίσω
            </button>
          </div>
        </div>
      )}

      {/* Wrong-step soft warning */}
      {isWrongStep && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
          <p className="text-xs font-medium text-amber-700">
            Εισαι σε αλλο βημα του οδηγου (τρεχον: {currentSessionStep}).
          </p>
          <button
            type="button"
            onClick={() => {
              const href = getGuideStepHref(currentSessionStep!);
              window.location.href = href;
            }}
            className="mt-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Επιστροφη στο τρεχον βημα &rarr;
          </button>
        </div>
      )}

      {/* Content */}
      <div className="space-y-1.5">
        <p className="text-xs text-indigo-700">
          <span className="font-semibold">Τι βλεπεις εδω:</span> {whatYouSee}
        </p>
        <p className="text-xs text-indigo-700">
          <span className="font-semibold">Τι να κανεις τωρα:</span> {whatToDo}
        </p>
        {whyItMatters && (
          <p className="text-xs text-indigo-600">
            <span className="font-semibold">Γιατι εχει αξια:</span> {whyItMatters}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div>
        {isDone ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
            Ολοκληρωθηκε
          </span>
        ) : (
          <span className="rounded-full bg-zinc-200 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Βημα ανολοκληρωτο
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {!isDone && canManualComplete && (
          <button
            type="button"
            onClick={handleManualComplete}
            className="rounded-xl bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-200"
          >
            Το ειδα, παμε επομενο
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={!isDone}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            isDone
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'cursor-not-allowed bg-zinc-200 dark:bg-[#1e2b38] text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {isFinalStep ? 'Ολοκληρωση guided demo' : 'Επομενο →'}
        </button>
        <Link
          href="/demo"
          className="rounded-xl border border-indigo-200 bg-white dark:bg-[#17232f] px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
        >
          ← Αποστολες
        </Link>
      </div>
    </div>
  );
}
