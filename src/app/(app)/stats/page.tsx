'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Customer, Task, Offer, CustomerStatus } from '@/lib/types';
import { fmtEur } from '@/lib/offer-calculations';

// ---------------------------------------------------------------------------
// Backend -> local mappers (same shape as the dashboard, plus opportunityValue)
// ---------------------------------------------------------------------------

function mapCustomer(d: Record<string, unknown>): Customer {
  const now = new Date().toISOString();
  return {
    id: d.id as string,
    name:
      (d.name as string | null) ??
      (d.companyName as string | null) ??
      (d.crmNumber as string | null) ??
      'Πελάτης',
    companyName: (d.companyName as string | null) ?? '',
    phone: (d.phone as string | null) ?? '',
    email: (d.email as string | null) ?? '',
    address: (d.address as string | null) ?? '',
    source: (d.source as Customer['source']) ?? 'manual_entry',
    opportunityValue:
      typeof d.opportunityValue === 'number' ? (d.opportunityValue as number) : undefined,
    status: (d.status as Customer['status']) ?? 'new_lead',
    preferredContactMethod:
      (d.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: (d.needsSummary as string | null) ?? '',
    notes: (d.notes as string | null) ?? '',
    createdAt: (d.createdAt as string) ?? now,
    updatedAt: (d.updatedAt as string) ?? now,
    crmNumber: (d.crmNumber as string | null) ?? undefined,
  };
}

function mapOffer(d: Record<string, unknown>): Offer {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    relatedTaskId: (d.relatedTaskId as string | null) ?? undefined,
    offerNumber: d.offerNumber as string,
    status: d.status as Offer['status'],
    offerDate: d.offerDate as string,
    validUntil: (d.validUntil as string | null) ?? (d.offerDate as string),
    items: (d.items as unknown as Offer['items']) ?? [],
    subtotal: d.subtotal as number,
    vatRate: d.vatRate as number,
    vatAmount: d.vatAmount as number,
    total: d.total as number,
    notes: (d.notes as string | null) ?? '',
    terms: (d.terms as string | null) ?? '',
    acceptanceText: (d.acceptanceText as string | null) ?? '',
    createdFromAi: (d.createdFromAi as boolean) ?? false,
    createdAt: d.createdAt as string,
    updatedAt: d.updatedAt as string,
  };
}

function mapTask(d: Record<string, unknown>): Task {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    offerId: (d.offerId as string | null) ?? undefined,
    title: d.title as string,
    type: (d.type as Task['type']) ?? 'other',
    status: d.status as Task['status'],
    priority: (d.priority as Task['priority']) ?? 'normal',
    dueDate: d.dueDate as string,
    dueTime: (d.dueTime as string | null) ?? undefined,
    note: (d.note as string | null) ?? '',
    createdFromAi: (d.createdFromAi as boolean) ?? false,
    completedAt: (d.completedAt as string | null) ?? undefined,
    createdAt: d.createdAt as string,
    updatedAt: d.updatedAt as string,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Offer statuses considered "open" (not yet won/lost), used as pipeline fallback.
const OPEN_OFFER_STATUSES = new Set<string>(['draft', 'ready_to_send', 'sent_manually']);
// Offer statuses considered "won" this month.
const WON_OFFER_STATUSES = new Set<string>(['accepted']);

// Greek labels for every customer status, shown in the breakdown list.
const STATUS_LABELS: Record<CustomerStatus, string> = {
  new: 'Νέοι',
  in_progress: 'Σε εξέλιξη',
  new_lead: 'Νέοι',
  contacted: 'Μίλησα',
  follow_up_needed: 'Να ξαναμιλήσω',
  offer_drafted: 'Πρόχειρη προσφορά',
  offer_sent: 'Στάλθηκε προσφορά',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

// Order in which statuses appear in the breakdown list.
const STATUS_ORDER: CustomerStatus[] = [
  'new',
  'in_progress',
  'new_lead',
  'contacted',
  'follow_up_needed',
  'offer_drafted',
  'offer_sent',
  'won',
  'lost',
];

const GREEK_MONTHS_SHORT = [
  'Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν',
  'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ',
];

interface StatsData {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-[28px] bg-white px-5 py-5 shadow-sm ring-1 ring-zinc-200/60">
      <span className="text-xs font-medium leading-snug text-zinc-500">{label}</span>
      <span className="text-3xl font-bold leading-none text-zinc-900">{value}</span>
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </div>
  );
}

export default function StatsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [data, setData] = useState<StatsData>({ customers: [], tasks: [], offers: [] });

  const loadData = useCallback(async (token: string) => {
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const [customersResp, tasksResp, offersResp] = await Promise.all([
        fetch('/api/customers?limit=100', { headers }),
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/offers?limit=100', { headers }),
      ]);

      if (!customersResp.ok || !tasksResp.ok || !offersResp.ok) {
        setActionError('Αποτυχία φόρτωσης στατιστικών. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }

      const [customersData, tasksData, offersData] = await Promise.all([
        customersResp.json(),
        tasksResp.json(),
        offersResp.json(),
      ]);

      const customers: Customer[] = (
        Array.isArray(customersData) ? customersData : (customersData.customers ?? [])
      ).map(mapCustomer);

      const tasks: Task[] = (
        Array.isArray(tasksData) ? tasksData : (tasksData.tasks ?? [])
      ).map(mapTask);

      const offers: Offer[] = (
        Array.isArray(offersData) ? offersData : (offersData.offers ?? [])
      ).map(mapOffer);

      setData({ customers, tasks, offers });
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης στατιστικών. Δοκίμασε ξανά.');
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

  // Loading skeleton (matches the dashboard).
  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-5 py-6 md:max-w-4xl md:px-8">
        <div className="space-y-1.5">
          <div className="h-3 w-24 rounded-full bg-zinc-200" />
          <div className="h-7 w-36 rounded-full bg-zinc-200" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="h-28 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
          <div className="h-28 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
          <div className="h-28 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        </div>
        <div className="h-56 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        <div className="h-56 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
      </div>
    );
  }

  const { customers, tasks, offers } = data;

  // ---------------------------------------------------------------------------
  // Computations
  // ---------------------------------------------------------------------------

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Agenda health: open / overdue tasks.
  const todayStr = new Date().toISOString().split('T')[0];
  const openTasks = tasks.filter((t) => t.status === 'open');
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < todayStr);

  const openOffers = offers.filter((o) => OPEN_OFFER_STATUSES.has(o.status));

  // Pipeline value: open customers' opportunityValue, with open-offers total as fallback.
  const openCustomers = customers.filter((c) => c.status !== 'won' && c.status !== 'lost');
  const pipelineFromCustomers = openCustomers.reduce(
    (sum, c) => sum + (c.opportunityValue ?? 0),
    0
  );
  const pipelineFromOffers = openOffers.reduce((sum, o) => sum + (o.total ?? 0), 0);
  const pipelineValue = pipelineFromCustomers > 0 ? pipelineFromCustomers : pipelineFromOffers;

  // Won this month: won customers updated this month, fallback to accepted offers this month.
  const wonCustomersThisMonth = customers.filter(
    (c) => c.status === 'won' && new Date(c.updatedAt) >= monthStart
  );
  const wonFromCustomers = wonCustomersThisMonth.reduce(
    (sum, c) => sum + (c.opportunityValue ?? 0),
    0
  );
  const wonOffersThisMonth = offers.filter(
    (o) => WON_OFFER_STATUSES.has(o.status) && new Date(o.updatedAt) >= monthStart
  );
  const wonFromOffers = wonOffersThisMonth.reduce((sum, o) => sum + (o.total ?? 0), 0);
  const wonThisMonth = wonFromCustomers > 0 ? wonFromCustomers : wonFromOffers;

  // Win rate: won / (won + lost) customers.
  const wonCount = customers.filter((c) => c.status === 'won').length;
  const lostCount = customers.filter((c) => c.status === 'lost').length;
  const decidedCount = wonCount + lostCount;
  const winRate = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : 0;

  // Counts by status.
  const statusCounts = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: customers.filter((c) => c.status === status).length,
  }));

  // Value per month: last 6 months of offers.total grouped by offerDate month.
  const months: { key: string; label: string; value: number }[] = [];
  const base = new Date();
  base.setDate(1);
  base.setHours(0, 0, 0, 0);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: GREEK_MONTHS_SHORT[d.getMonth()],
      value: 0,
    });
  }
  for (const o of offers) {
    if (!o.offerDate || o.offerDate.length < 7) continue;
    const key = o.offerDate.slice(0, 7); // YYYY-MM
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.value += o.total ?? 0;
  }
  const maxMonthValue = Math.max(...months.map((m) => m.value), 0);

  const hasAnyData = customers.length > 0 || offers.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
      {/* Error banner */}
      {actionError && (
        <div className="rounded-[28px] bg-red-50 px-4 py-2.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Auth required */}
      {authRequired && (
        <div className="rounded-[28px] bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-sm text-amber-700">
            Συνδέσου για να φορτωθούν τα πραγματικά δεδομένα.
          </p>
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
        <p className="text-xs text-zinc-400">Επισκόπηση</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">Στατιστικά</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Πορεία πωλήσεων και pipeline.</p>
      </div>

      {!authRequired && !hasAnyData ? (
        /* Empty state */
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-base font-medium text-zinc-600">Δεν υπάρχουν ακόμα δεδομένα</p>
          <p className="mt-1 text-sm text-zinc-400">
            Πρόσθεσε πελάτες και προσφορές για να εμφανιστούν στατιστικά.
          </p>
          <Link
            href="/customers"
            className="mt-4 inline-block rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Πελάτες
          </Link>
        </div>
      ) : (
        <>
          {/* Headline metrics */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Αξία pipeline"
              value={fmtEur(pipelineValue)}
              hint={`${openCustomers.length} ανοιχτοί πελάτες`}
            />
            <MetricCard
              label="Κερδισμένα (μήνα)"
              value={fmtEur(wonThisMonth)}
              hint={
                wonCustomersThisMonth.length > 0
                  ? `${wonCustomersThisMonth.length} πελάτες`
                  : `${wonOffersThisMonth.length} προσφορές`
              }
            />
            <MetricCard
              label="Ποσοστό επιτυχίας"
              value={`${winRate}%`}
              hint={`${wonCount} κερδισμένοι / ${lostCount} χαμένοι`}
            />
            <MetricCard
              label="Εκκρεμείς εργασίες"
              value={String(openTasks.length)}
              hint={overdueTasks.length > 0 ? `${overdueTasks.length} εκπρόθεσμες` : 'καμία εκπρόθεσμη'}
            />
          </div>

          {/* Status breakdown */}
          <div className="rounded-[28px] bg-white px-5 py-6 shadow-sm ring-1 ring-zinc-200/60">
            <h2 className="text-sm font-semibold text-zinc-900">Πελάτες ανά κατάσταση</h2>
            <ul className="mt-4 space-y-2.5">
              {statusCounts.map((row) => (
                <li key={row.status} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-600">{row.label}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      row.count > 0 ? 'text-zinc-900' : 'text-zinc-300'
                    }`}
                  >
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Value per month */}
          <div className="rounded-[28px] bg-white px-5 py-6 shadow-sm ring-1 ring-zinc-200/60">
            <h2 className="text-sm font-semibold text-zinc-900">Αξία ανά μήνα</h2>
            <p className="mt-0.5 text-xs text-zinc-400">Τελευταίοι 6 μήνες (σύνολο προσφορών)</p>
            {maxMonthValue > 0 ? (
              <div className="mt-5 space-y-3">
                {months.map((m) => {
                  const pct = maxMonthValue > 0 ? Math.round((m.value / maxMonthValue) * 100) : 0;
                  return (
                    <div key={m.key} className="flex items-center gap-3">
                      <span className="w-9 shrink-0 text-xs font-medium text-zinc-400">
                        {m.label}
                      </span>
                      <div className="h-6 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className="flex h-full items-center justify-end rounded-full bg-indigo-500 px-2"
                          style={{ width: `${Math.max(pct, m.value > 0 ? 6 : 0)}%` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-700">
                        {m.value > 0 ? fmtEur(m.value) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-5 text-sm text-zinc-400">
                Δεν υπάρχουν προσφορές στους τελευταίους 6 μήνες.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
