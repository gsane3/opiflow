'use client';

// "Κατάσταση υπηρεσιών" — surfaces which optional integrations are actually
// configured in the deployment (from /api/health, booleans only). Turns
// "silently broken in prod" into a glanceable checklist for the owner: an
// integration that is off means its buttons degrade (copy-paste / disabled).

import { useEffect, useState } from 'react';

interface Row {
  key: string;
  label: string;
  hint: string;
}

// Order = importance for the operator. We only show the user-facing ones.
const ROWS: Row[] = [
  { key: 'viber', label: 'Viber (Apifon)', hint: 'Αποστολή link σε πελάτες μέσω Viber' },
  { key: 'email', label: 'Email (Resend)', hint: 'Αποστολή προσφορών/link μέσω email' },
  { key: 'anthropic', label: 'AI βοηθός', hint: 'Σύνοψη πελάτη & /cmd εντολές' },
  { key: 'openai', label: 'Μεταγραφή κλήσεων', hint: 'Ηχογράφηση → κείμενο → brief' },
  { key: 'push', label: 'Ειδοποιήσεις', hint: 'Push στο κινητό σε απαντήσεις πελατών' },
  { key: 'billing', label: 'Πληρωμές (Stripe)', hint: 'Online συνδρομές' },
];

export default function SystemStatusCard() {
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setStatus((d?.integrations ?? {}) as Record<string, boolean>);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  return (
    <div className="mt-4 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Κατάσταση υπηρεσιών</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Ποιες δυνατότητες είναι ενεργές. Αν κάτι είναι ανενεργό, η σχετική ενέργεια δεν λειτουργεί ακόμα.
      </p>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-white/10">
        {ROWS.map((row) => {
          const on = status?.[row.key] === true;
          const known = status !== null;
          return (
            <li key={row.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-zinc-800 dark:text-zinc-200">{row.label}</p>
                <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{row.hint}</p>
              </div>
              {!known ? (
                <span className="shrink-0 text-[11px] text-zinc-300 dark:text-zinc-500">…</span>
              ) : on ? (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  Ενεργό
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200 dark:ring-white/10">
                  Ανενεργό
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
