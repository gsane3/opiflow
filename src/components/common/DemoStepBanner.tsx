'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { isDemoGuideActive } from '@/lib/demo-guide-session';

interface Props {
  step: string;        // which ?demoStep= value activates this banner
  stepNum?: number;    // badge number (1-8)
  title: string;
  body: string;
  watchLabel?: string; // "Τι να προσέξεις"
  actionLabel?: string;
  actionHref?: string;
  backHref?: string;
}

export default function DemoStepBanner({
  step,
  stepNum,
  title,
  body,
  watchLabel,
  actionLabel,
  actionHref,
  backHref = '/demo',
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      // Hide in guided mode (guide=1 URL param OR active session) — GuidedDemoBanner takes over
      const isGuided = params.get('guide') === '1' || isDemoGuideActive();
      setVisible(params.get('demoStep') === step && !isGuided);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  if (!visible) return null;

  return (
    <div className="mb-4 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-200 space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {stepNum ? `MISSION ${stepNum}` : 'DEMO'}
        </span>
        <p className="text-sm font-semibold text-indigo-900">{title}</p>
      </div>
      <p className="text-xs text-indigo-700">{body}</p>
      {watchLabel && (
        <p className="text-xs text-indigo-600">
          <span className="font-semibold">Τι να προσέξεις:</span> {watchLabel}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            {actionLabel} →
          </Link>
        )}
        <Link
          href={backHref}
          className="rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
        >
          ← Αποστολές
        </Link>
      </div>
    </div>
  );
}
