'use client';

import Link from 'next/link';
import type { Customer } from '@/lib/types';
import { isLikelyMobile } from '@/lib/phone';

const ACTIVE_INTAKE_STATUSES = new Set([
  'waiting_sms',
  'reminder_sent',
  'no_response',
  'kept_draft',
]);

const INTAKE_LABELS: Record<string, string> = {
  waiting_sms: 'Αναμονή SMS',
  reminder_sent: 'Υπενθύμιση SMS',
  no_response: 'Δεν απάντησε',
  kept_draft: 'Πρόχειρη',
};

function isPlaceholderName(c: Customer): boolean {
  return /^Πελάτης #\d+/.test(c.name) || c.name.includes('Καταχώρηση');
}

function hasMobile(c: Customer): boolean {
  return !!(c.mobilePhone?.trim() || (c.phone?.trim() && isLikelyMobile(c.phone)));
}

function getMissingFields(c: Customer): string[] {
  const missing: string[] = [];
  if (isPlaceholderName(c)) missing.push('Όνομα');
  if (!hasMobile(c)) missing.push('Κινητό');
  if (!c.email?.trim()) missing.push('Email');
  if (!c.address?.trim()) missing.push('Διεύθυνση');
  return missing;
}

export function isIncompleteCustomer(c: Customer): boolean {
  const hasActiveIntake = !!(c.intakeStatus && ACTIVE_INTAKE_STATUSES.has(c.intakeStatus));
  return getMissingFields(c).length > 0 || hasActiveIntake;
}

interface Props {
  customers: Customer[];
}

export default function CustomerDataQualityPanel({ customers }: Props) {
  const incomplete = customers.filter(isIncompleteCustomer);
  if (incomplete.length === 0) return null;

  const shown = incomplete.slice(0, 5);
  const extra = incomplete.length - shown.length;

  return (
    <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-800">Καρτέλες που θέλουν συμπλήρωση</p>
        <p className="text-xs text-zinc-500">
          Βρέθηκαν {incomplete.length} καρτέλ{incomplete.length === 1 ? 'α' : 'ες'} με ελλιπή στοιχεία.
        </p>
      </div>
      <ul className="space-y-2">
        {shown.map((c) => {
          const missing = getMissingFields(c);
          const intakeLabel = c.intakeStatus ? INTAKE_LABELS[c.intakeStatus] : null;
          return (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-zinc-100"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-zinc-800">{c.name}</span>
                  {c.crmNumber && (
                    <span className="text-xs text-zinc-400">Πελάτης {c.crmNumber}</span>
                  )}
                </div>
                {(missing.length > 0 || intakeLabel) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {missing.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600"
                      >
                        {f}
                      </span>
                    ))}
                    {intakeLabel && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        {intakeLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Link
                href={`/customers/${c.id}`}
                className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-zinc-50"
              >
                Άνοιγμα
              </Link>
            </li>
          );
        })}
      </ul>
      {extra > 0 && (
        <p className="text-xs text-zinc-400">+{extra} ακόμα</p>
      )}
    </div>
  );
}
