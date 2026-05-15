'use client';

import { useState } from 'react';
import type { Customer } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  waiting_sms: 'Αναμονή απάντησης SMS',
  reminder_sent: 'Στάλθηκε δεύτερο SMS υπενθύμισης',
  no_response: 'Δεν απάντησε στο SMS στοιχείων',
};

const STATUS_DOT: Record<string, string> = {
  waiting_sms: 'bg-blue-400',
  reminder_sent: 'bg-amber-400',
  no_response: 'bg-red-500',
};

interface Props {
  customers: Customer[];
  onDeleteCustomer: (customerId: string) => void;
  onCreateFollowUp: (customerId: string) => void;
  onKeepDraft: (customerId: string) => void;
}

export default function SmsIntakeNotificationBar({
  customers,
  onDeleteCustomer,
  onCreateFollowUp,
  onKeepDraft,
}: Props) {
  const [open, setOpen] = useState(false);

  const pending = customers.filter(
    (c) =>
      c.intakeStatus === 'waiting_sms' ||
      c.intakeStatus === 'reminder_sent' ||
      c.intakeStatus === 'no_response'
  );

  if (pending.length === 0) return null;

  const hasUrgent = pending.some((c) => c.intakeStatus === 'no_response');

  return (
    <div>
      {/* Bell toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
          hasUrgent
            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
        }`}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        <span>Ειδοποιήσεις</span>
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${hasUrgent ? 'bg-red-500' : 'bg-amber-500'}`}>
          {pending.length}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {/* Inline expanded panel */}
      {open && (
        <div className="mt-2 rounded-2xl bg-white ring-1 ring-zinc-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-zinc-100">
            <p className="text-sm font-semibold text-zinc-900">Ειδοποιήσεις</p>
            <p className="text-xs text-zinc-400">Εκκρεμείς SMS καταχωρήσεις</p>
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-50">
            {pending.map((c) => {
              const label = c.crmNumber ? `Πελάτης ${c.crmNumber}` : c.name;
              const statusText = STATUS_LABELS[c.intakeStatus ?? ''] ?? c.intakeStatus;
              const dot = STATUS_DOT[c.intakeStatus ?? ''] ?? 'bg-zinc-300';
              const isNoResponse = c.intakeStatus === 'no_response';

              return (
                <li key={c.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800">{label}</p>
                      <p className="text-xs text-zinc-500">{statusText}</p>
                    </div>
                  </div>
                  {isNoResponse && (
                    <div className="flex flex-wrap gap-1.5 pl-4">
                      <button
                        type="button"
                        onClick={() => onCreateFollowUp(c.id)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                      >
                        Follow-up
                      </button>
                      <button
                        type="button"
                        onClick={() => onKeepDraft(c.id)}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                      >
                        Κράτηση
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCustomer(c.id)}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50"
                      >
                        Διαγραφή
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-zinc-50 px-4 py-2">
            <p className="text-xs text-zinc-400">
              Demo: στο cloud θα λειτουργεί με scheduler και SMS provider.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
