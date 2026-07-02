'use client';

// Τιμολόγια — συγκεντρωτική λίστα εκδοθέντων παραστατικών ανά μήνα, με
// «Αποστολή στον λογιστή» (λήψη CSV) ανά μήνα. Route: /invoices, φτάνει από
// την κάρτα «Τιμολόγια» της Αρχικής (ορατή μόνο με ενεργή τιμολόγηση).
// Native parity: native/src/app/invoices.tsx.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { fmtEur } from '@/lib/offer-calculations';

interface InvoiceRow {
  id: string;
  invoice_type: string | null;
  series: string | null;
  aa: string | number | null;
  issue_date: string | null;
  created_at?: string | null;
  counterparty_name: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  total_amount: number | null;
  mark: string | null;
  qr_url: string | null;
}

const MONTHS_EL = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
];

function monthKey(inv: InvoiceRow): string {
  return (inv.issue_date ?? inv.created_at ?? '').slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS_EL[idx]} ${y}` : key;
}

function docLabel(inv: InvoiceRow): string {
  const kind = (inv.invoice_type ?? '').startsWith('11') ? 'Απόδειξη' : 'Τιμολόγιο';
  const num = [inv.series, inv.aa].filter((v) => v !== null && v !== undefined && `${v}` !== '').join('');
  return num ? `${kind} ${num}` : kind;
}

// Semicolon-separated (Greek Excel opens it into columns directly) — same
// format the native app shares, so the accountant sees one shape everywhere.
function buildAccountantCsv(label: string, rows: InvoiceRow[]): string {
  const header = 'Ημερομηνία;Παραστατικό;Πελάτης;Καθαρή αξία;ΦΠΑ;Σύνολο;ΜΑΡΚ';
  const lines = rows.map((r) =>
    [
      r.issue_date ?? '',
      docLabel(r),
      (r.counterparty_name ?? '').replace(/;/g, ','),
      r.net_amount ?? '',
      r.vat_amount ?? '',
      r.total_amount ?? '',
      r.mark ?? '',
    ].join(';')
  );
  const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  return `Τιμολόγια ${label} — Opiflow\n${header}\n${lines.join('\n')}\nΣύνολο;;;;;${total.toFixed(2)};`;
}

// The web «Αποστολή στον λογιστή» downloads a real .csv (BOM so Excel reads
// the Greek correctly) — the user forwards it however they like.
function downloadMonthCsv(key: string, rows: InvoiceRow[]) {
  const csv = '﻿' + buildAccountantCsv(monthLabel(key), rows); // BOM → Excel reads UTF-8 Greek
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `timologia-${key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred: Safari resolves the blob async after the click — a same-task
  // revoke can abort the download (same pattern as ics.ts/ImportExportPanel).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InvoicesPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  const loadData = useCallback(async (token: string) => {
    try {
      const resp = await fetch('/api/invoicing/invoices?status=issued&limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setActionError('Αποτυχία φόρτωσης τιμολογίων. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }
      const json = (await resp.json()) as { invoices?: InvoiceRow[] };
      setInvoices(json.invoices ?? []);
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης τιμολογίων. Δοκίμασε ξανά.');
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setAuthRequired(true);
          setHydrated(true);
          return;
        }
        await loadData(session.access_token);
      } catch {
        setActionError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  const months = new Map<string, InvoiceRow[]>();
  for (const inv of invoices) {
    const k = monthKey(inv);
    if (!k) continue;
    const list = months.get(k) ?? [];
    list.push(inv);
    months.set(k, list);
  }
  const monthEntries = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-5 py-6 md:max-w-4xl md:px-8">
        <div className="space-y-1.5">
          <div className="h-3 w-24 rounded-full bg-zinc-200 dark:bg-white/10" />
          <div className="h-7 w-36 rounded-full bg-zinc-200 dark:bg-white/10" />
        </div>
        <div className="h-40 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10" />
        <div className="h-40 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
      {actionError && (
        <div className="rounded-[28px] bg-red-50 px-4 py-2.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {authRequired && (
        <div className="rounded-[28px] bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-sm text-amber-700">Συνδέσου για να φορτωθούν τα πραγματικά δεδομένα.</p>
          <Link
            href="/login"
            className="mt-2 inline-block rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      )}

      {/* Header */}
      <div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">ΑΑΔΕ / myDATA</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Τιμολόγια</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Συγκεντρωτικά μήνα για τον λογιστή.</p>
      </div>

      {!authRequired && monthEntries.length === 0 && !actionError ? (
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
          <p className="text-base font-medium text-zinc-600 dark:text-zinc-300">
            Δεν υπάρχουν εκδοθέντα παραστατικά ακόμη.
          </p>
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
            Όσα εκδίδεις θα εμφανίζονται εδώ ανά μήνα.
          </p>
        </div>
      ) : (
        monthEntries.map(([key, rows]) => {
          const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
          return (
            <div
              key={key}
              className="rounded-[28px] bg-white px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{monthLabel(key)}</h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {rows.length} παρ. · {fmtEur(total)}
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {rows.map((inv) => {
                  const body = (
                    <>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" aria-hidden>
                        <svg className="h-4.5 w-4.5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {docLabel(inv)}
                        </span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {[inv.issue_date, inv.counterparty_name].filter(Boolean).join(' · ')}
                          {inv.mark ? ` · ΜΑΡΚ ${inv.mark}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {fmtEur(inv.total_amount ?? 0)}
                      </span>
                    </>
                  );
                  const rowClass =
                    'flex w-full items-center gap-3 rounded-[20px] bg-zinc-50 px-3 py-2.5 text-left ring-1 ring-zinc-200/60 dark:bg-[#1e2b38] dark:ring-white/10';
                  return inv.qr_url ? (
                    <a
                      key={inv.id}
                      href={inv.qr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${rowClass} transition hover:ring-indigo-200 active:scale-[0.99]`}
                    >
                      {body}
                    </a>
                  ) : (
                    <div key={inv.id} className={rowClass}>
                      {body}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => downloadMonthCsv(key, rows)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-600 px-4 py-2.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Αποστολή στον λογιστή
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
