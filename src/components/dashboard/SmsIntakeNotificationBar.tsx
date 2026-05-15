'use client';

import type { Customer } from '@/lib/types';

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
  const pending = customers.filter((c) => c.intakeStatus === 'no_response');
  if (pending.length === 0) return null;

  return (
    <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 space-y-3">
      <p className="text-sm font-semibold text-amber-900">Εκκρεμείς καρτέλες SMS</p>
      <ul className="space-y-2">
        {pending.map((c) => {
          const label = c.crmNumber ? `Πελάτης ${c.crmNumber}` : c.name;
          return (
            <li
              key={c.id}
              className="rounded-xl bg-white px-3 py-3 ring-1 ring-amber-100 space-y-2"
            >
              <p className="text-sm text-zinc-700">
                <span className="font-medium">{label}</span>{' '}
                δεν απάντησε στο SMS στοιχείων.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onCreateFollowUp(c.id)}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                >
                  Follow-up task
                </button>
                <button
                  type="button"
                  onClick={() => onKeepDraft(c.id)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                >
                  Κράτηση ως πρόχειρη
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteCustomer(c.id)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50"
                >
                  Διαγραφή καρτέλας
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
