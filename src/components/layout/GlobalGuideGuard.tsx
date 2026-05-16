'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  loadDemoGuideSession,
  exitDemoGuide,
  getGuideStepHref,
  getStepPathname,
  STEP_DISPLAY_TITLES,
  type DemoGuideStep,
} from '@/lib/demo-guide-session';

export default function GlobalGuideGuard() {
  const pathname = usePathname();

  const [show, setShow] = useState(false);
  const [currentStep, setCurrentStep] = useState<DemoGuideStep | null>(null);
  const [expectedHref, setExpectedHref] = useState('/demo');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const session = loadDemoGuideSession();

      if (!session?.active || session.currentStep === 'done') {
        setShow(false);
        return;
      }

      const step = session.currentStep;
      const expectedPath = getStepPathname(step);

      // User is on the correct page — no guard needed.
      const isOnExpected =
        pathname === expectedPath || pathname.startsWith(expectedPath + '/');
      // Guard never overlays the guide home.
      const isOnGuideHome = pathname === '/demo';

      setCurrentStep(step);
      setExpectedHref(getGuideStepHref(step));
      setShow(!isOnExpected && !isOnGuideHome);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!show) return null;

  const stepTitle = currentStep ? (STEP_DISPLAY_TITLES[currentStep] ?? currentStep) : '';

  function handleExit() {
    if (window.confirm('Θέλεις να βγεις από το guided demo;')) {
      exitDemoGuide();
      setShow(false);
    }
  }

  return (
    <div className="mx-3 mt-3 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-300 space-y-2 print:hidden">
      <p className="text-xs font-semibold text-amber-800">
        Είσαι εκτός του τρέχοντος βήματος του guided demo.
      </p>
      <p className="text-xs text-amber-700">
        Ο οδηγός περιμένει:{' '}
        <span className="font-semibold">{stepTitle}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { window.location.href = expectedHref; }}
          className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
        >
          Επιστροφή στο σωστό βήμα →
        </button>
        <button
          type="button"
          onClick={handleExit}
          className="rounded-xl border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
        >
          Έξοδος από guided demo
        </button>
      </div>
    </div>
  );
}
