'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DemoCallScenario } from '@/lib/demo-data';

const SMS_MESSAGE =
  'Παρακαλώ στείλτε μου τα παρακάτω με σειρά:\n\nΌνομα:\nΕπώνυμο:\nΔιεύθυνση:\nEmail:';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function buildSmsHref(phone: string): string {
  return `sms:${phone}?body=${encodeURIComponent(SMS_MESSAGE)}`;
}

interface Props {
  durationSeconds: number;
  scenario: DemoCallScenario | null;
  customerPhone?: string;
  onNewCall: () => void;
}

export default function PostCallScreen({
  durationSeconds,
  scenario,
  customerPhone,
  onNewCall,
}: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(SMS_MESSAGE).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
        () => fallbackCopy()
      );
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const el = document.createElement('textarea');
    el.value = SMS_MESSAGE;
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(el);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-zinc-900">Κλήση ολοκληρώθηκε</h1>
        <p className="mt-1 text-sm text-zinc-500">Διάρκεια: {formatDuration(durationSeconds)}</p>
      </div>

      {/* Demo summary */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Demo περίληψη κλήσης
          </h2>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
        </div>
        <p className="text-sm text-zinc-700 leading-relaxed">
          {scenario?.summaryText ??
            'Η κλήση ολοκληρώθηκε. Σε πραγματική χρήση, το yorgos.ai θα δημιουργούσε αυτόματα περίληψη, tasks και draft προσφοράς από τη συνομιλία.'}
        </p>
      </div>

      {/* SMS details request */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-1 text-sm font-semibold text-zinc-800">Ζήτησε στοιχεία με SMS</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Άνοιξε έτοιμο SMS στο κινητό σου. Το μήνυμα δεν στέλνεται αυτόματα.
        </p>

        {/* Message preview */}
        <pre className="mb-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap ring-1 ring-zinc-100">
          {SMS_MESSAGE}
        </pre>

        <div className="flex flex-col gap-2 sm:flex-row">
          {customerPhone ? (
            <a
              href={buildSmsHref(customerPhone)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              Άνοιγμα SMS
            </a>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-400">
              Δεν υπάρχει τηλέφωνο πελάτη.
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition sm:flex-none sm:w-auto ${
              copied
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {copied ? 'Αντιγράφηκε' : 'Αντιγραφή μηνύματος'}
          </button>
        </div>
      </div>

      {/* AI review */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
        <h2 className="mb-1 text-sm font-semibold text-indigo-700">AI Review</h2>
        <p className="text-sm text-zinc-600">
          Δεν αποθηκεύτηκε τίποτα στο CRM ακόμα. Έλεγξε και αποθήκευσε το αποτέλεσμα χειροκίνητα.
        </p>
        <Link
          href="/ai-review"
          className="mt-3 inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Άνοιγμα AI Review →
        </Link>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Πίσω στην αρχική
        </Link>
        <button
          type="button"
          onClick={onNewCall}
          className="flex items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
        >
          Νέα κλήση
        </button>
      </div>
    </div>
  );
}
