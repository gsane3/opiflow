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
// Includes sent_provider to match native + the dashboard count.
const OPEN_OFFER_STATUSES = new Set<string>(['draft', 'ready_to_send', 'sent_manually', 'sent_provider']);
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

// Minimal call shape for the answer-rate verdict — read raw so 'missed' isn't
// coerced away by the shared CommunicationRecord mapper.
interface CallRow {
  direction: string;
  status: string;
}

interface StatsData {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
  calls: CallRow[];
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
    <div className="flex flex-col justify-between gap-2 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <span className="text-xs font-medium leading-snug text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-3xl font-bold leading-none text-zinc-900 dark:text-zinc-100">{value}</span>
      {hint && <span className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </div>
  );
}

// douleutaras-style verdict line: value + 👍/👎 + one-line explanation
// (native Κοντέρ parity).
function VerdictRow({
  label,
  value,
  good,
  hint,
}: {
  label: string;
  value: string;
  good: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: good ? '#1B8A4C' : '#D14343' }}
        fill="none"
        strokeWidth={1.7}
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {good ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384m-10.253 1.5H9.7m8.075-9.75c.01.05.027.1.05.148.593 1.2.925 2.55.925 3.977 0 1.487-.36 2.89-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 0 0 .303-.54" />
        )}
      </svg>
      <div className="min-w-0">
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          {label}: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{value}</span>
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [data, setData] = useState<StatsData>({ customers: [], tasks: [], offers: [], calls: [] });

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

      // Calls: best-effort, feeds only the answer-rate verdict of the score.
      let calls: CallRow[] = [];
      try {
        const callsResp = await fetch('/api/communications?channel=call&limit=100', { headers });
        if (callsResp.ok) {
          const callsData = await callsResp.json();
          if (Array.isArray(callsData.communications)) {
            calls = (callsData.communications as Record<string, unknown>[]).map((c) => ({
              direction: typeof c.direction === 'string' ? c.direction : '',
              status: typeof c.status === 'string' ? c.status : '',
            }));
          }
        }
      } catch {
        // best-effort: leave calls as []
      }

      setData({ customers, tasks, offers, calls });
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
          <div className="h-3 w-24 rounded-full bg-zinc-200 dark:bg-white/10" />
          <div className="h-7 w-36 rounded-full bg-zinc-200 dark:bg-white/10" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="h-28 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
          <div className="h-28 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
          <div className="h-28 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        </div>
        <div className="h-56 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-56 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
      </div>
    );
  }

  const { customers, tasks, offers, calls } = data;

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

  // Win rate: won / (won + lost) customers — null (shown as «—») until at least
  // one offer is decided; a made-up 0% reads as failure on day one.
  const wonCount = customers.filter((c) => c.status === 'won').length;
  const lostCount = customers.filter((c) => c.status === 'lost').length;
  const decidedCount = wonCount + lostCount;
  const winRate = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : null;

  // Τηλέφωνο — answer rate from real telephony data (native Κοντέρ parity).
  const inboundCalls = calls.filter((k) => k.direction === 'inbound');
  const missedCalls = inboundCalls.filter((k) => k.status === 'missed' || k.status === 'failed');
  const answerRate =
    inboundCalls.length > 0
      ? Math.round(((inboundCalls.length - missedCalls.length) / inboundCalls.length) * 100)
      : null;

  // «Σκορ» v1 — one number the owner can improve (0–100):
  //   50% answer rate + 25% task hygiene (μη-εκπρόθεσμες) + 25% win rate.
  // Missing components (no calls / no decided offers) redistribute to the rest.
  const scoreParts: Array<{ w: number; v: number }> = [];
  if (answerRate !== null) scoreParts.push({ w: 2, v: answerRate });
  if (openTasks.length > 0)
    scoreParts.push({ w: 1, v: Math.round(((openTasks.length - overdueTasks.length) / openTasks.length) * 100) });
  if (winRate !== null) scoreParts.push({ w: 1, v: winRate });
  const scoreTotalW = scoreParts.reduce((s, p) => s + p.w, 0);
  const score =
    scoreTotalW > 0
      ? Math.round(scoreParts.reduce((s, p) => s + p.w * p.v, 0) / scoreTotalW)
      : null;
  const scoreColor = (s: number) => (s >= 70 ? '#1B8A4C' : s >= 30 ? '#E0922F' : '#D14343');

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
  // Drop leading zero-months — a stack of «—» rows carries no information
  // (native Κοντέρ parity).
  const firstMonthWithData = months.findIndex((m) => m.value > 0);
  const shownMonths = firstMonthWithData > 0 ? months.slice(firstMonthWithData) : months;
  const maxMonthValue = Math.max(...shownMonths.map((m) => m.value), 0);

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
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Επισκόπηση</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Στατιστικά</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Πορεία πωλήσεων και pipeline.</p>
      </div>

      {!authRequired && !hasAnyData ? (
        /* Empty state */
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="text-base font-medium text-zinc-600 dark:text-zinc-300">Δεν υπάρχουν ακόμα δεδομένα</p>
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
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
          {/* «Σκορ επιχείρησης» — native Κοντέρ parity: one number to improve */}
          {score !== null && (
            <div className="rounded-[28px] bg-white px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Σκορ επιχείρησης</h2>
                <span className="text-4xl font-bold leading-none tabular-nums" style={{ color: scoreColor(score) }}>
                  {score}
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1e2b38]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${score}%`, backgroundColor: scoreColor(score) }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Απαντημένες κλήσεις + εργασίες στην ώρα τους + κερδισμένες προσφορές
              </p>
              <div className="mt-3 space-y-2.5">
                {answerRate !== null && (
                  <VerdictRow
                    label="Ποσοστό απάντησης"
                    value={`${answerRate}%`}
                    good={answerRate >= 80}
                    hint={`${missedCalls.length} αναπάντητες σε ${inboundCalls.length} εισερχόμενες`}
                  />
                )}
                <VerdictRow
                  label="Εκπρόθεσμες εργασίες"
                  value={String(overdueTasks.length)}
                  good={overdueTasks.length === 0}
                  hint={overdueTasks.length > 0 ? 'Κλείσε τις παλιές για να ανέβει το σκορ' : 'Όλα στην ώρα τους'}
                />
              </div>
            </div>
          )}

          {/* Headline metrics */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Σε εξέλιξη (αξία)"
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
              value={winRate === null ? '—' : `${winRate}% (${wonCount}/${decidedCount})`}
              hint={
                winRate === null
                  ? 'δεν έχουν κριθεί προσφορές ακόμα'
                  : `${wonCount} κερδισμένοι / ${lostCount} χαμένοι`
              }
            />
            <MetricCard
              label="Εκκρεμείς εργασίες"
              value={String(openTasks.length)}
              hint={overdueTasks.length > 0 ? `${overdueTasks.length} εκπρόθεσμες` : 'καμία εκπρόθεσμη'}
            />
          </div>

          {/* Status breakdown */}
          <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-6 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Πελάτες ανά κατάσταση</h2>
            <ul className="mt-4 space-y-2.5">
              {statusCounts.map((row) => (
                <li key={row.status} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-300">{row.label}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      row.count > 0 ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-500'
                    }`}
                  >
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Value per month */}
          <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-6 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Αξία ανά μήνα</h2>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Τελευταίοι 6 μήνες (σύνολο προσφορών)</p>
            {maxMonthValue > 0 ? (
              <div className="mt-5 space-y-3">
                {shownMonths.map((m) => {
                  const pct = maxMonthValue > 0 ? Math.round((m.value / maxMonthValue) * 100) : 0;
                  return (
                    <div key={m.key} className="flex items-center gap-3">
                      <span className="w-9 shrink-0 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {m.label}
                      </span>
                      <div className="h-6 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1e2b38]">
                        <div
                          className="flex h-full items-center justify-end rounded-full bg-indigo-500 px-2"
                          style={{ width: `${Math.max(pct, m.value > 0 ? 6 : 0)}%` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                        {m.value > 0 ? fmtEur(m.value) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-5 text-sm text-zinc-400 dark:text-zinc-500">
                Δεν υπάρχουν προσφορές στους τελευταίους 6 μήνες.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
