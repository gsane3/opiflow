'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { getEffectiveStatus } from '@/lib/types';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus, CommunicationRecord } from '@/lib/types';
import NextActionsSection from '@/components/dashboard/NextActionsSection';
import RecentCommunicationsSection from '@/components/dashboard/RecentCommunicationsSection';
import HomeActionChips from '@/components/dashboard/HomeActionChips';
import AttentionInboxBar from '@/components/layout/AttentionInboxBar';

const LEAD_STATUSES = new Set<string>([
  'new',
  'in_progress',
]);
const OPEN_OFFER_STATUSES = new Set<string>(['draft', 'ready_to_send', 'sent_manually']);
const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

type FocusTone = 'red' | 'amber' | 'indigo';

interface FocusCard {
  tone: FocusTone;
  label: string;
  title: string;
  customerName?: string;
  primaryHref: string;
}

interface DashboardData {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
  calls: CallRecord[] | undefined;
  communications: CommunicationRecord[];
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
    status: d.status as TaskBaseStatus,
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
    status: (d.status as Customer['status']) ?? 'new',
    preferredContactMethod:
      (d.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: (d.needsSummary as string | null) ?? '',
    notes: (d.notes as string | null) ?? '',
    createdAt: (d.createdAt as string) ?? now,
    updatedAt: (d.updatedAt as string) ?? now,
    crmNumber: (d.crmNumber as string | null) ?? undefined,
  };
}

// Chevron used in metric cards.
function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

// Icon inside the focus card action bubble. Colour is inherited from the bubble
// (currentColor) so it follows the focusCard tone.
function FocusIcon({ tone }: { tone: FocusTone }) {
  if (tone === 'indigo') {
    return (
      <svg
        className="h-5 w-5"
        fill="none"
        strokeWidth={1.7}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
    );
  }
  // Task (red / amber)
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      strokeWidth={1.7}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col justify-between gap-2 rounded-[28px] bg-white dark:bg-[#17232f] px-4 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:bg-zinc-50/60 dark:active:bg-white/5"
    >
      <span className="text-xs font-medium leading-snug text-zinc-600 dark:text-zinc-300">{label}</span>
      <div className="flex items-end justify-between">
        <span
          className={`text-3xl font-bold leading-none ${
            value > 0 ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-500'
          }`}
        >
          {value}
        </span>
        <ChevronRight />
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    customers: [],
    tasks: [],
    offers: [],
    calls: undefined,
    communications: [],
  });
  const tokenRef = useRef<string | null>(null);

  // Undo state - must be declared before any conditional return.
  const [lastCompletedTask, setLastCompletedTask] = useState<Task | null>(null);

  // Auto-clear the undo banner after 8 seconds (pre-existing timer).
  useEffect(() => {
    if (!lastCompletedTask) return;
    const timer = setTimeout(() => setLastCompletedTask(null), 8000);
    return () => clearTimeout(timer);
  }, [lastCompletedTask]);

  const loadData = useCallback(async (token: string) => {
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const [customersResp, tasksResp, offersResp] = await Promise.all([
        fetch('/api/customers?limit=100', { headers }),
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/offers?limit=100', { headers }),
      ]);

      if (!customersResp.ok || !tasksResp.ok || !offersResp.ok) {
        setActionError('Αποτυχία φόρτωσης dashboard. Δοκίμασε ξανά.');
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

      // Communications: best-effort, never breaks the dashboard on failure.
      let communications: CommunicationRecord[] = [];
      try {
        const commsResp = await fetch('/api/communications?limit=5', { headers });
        if (commsResp.ok) {
          const commsData = await commsResp.json();
          if (Array.isArray(commsData.communications)) {
            communications = (commsData.communications as Record<string, unknown>[]).map((c) => {
              const rawStatus = c.status as string;
              const status: CommunicationRecord['status'] =
                rawStatus === 'started' || rawStatus === 'sent' ||
                rawStatus === 'failed' || rawStatus === 'completed'
                  ? rawStatus
                  : 'completed';
              return {
                id: c.id as string,
                customerId:
                  typeof c.customerId === 'string' && c.customerId.length > 0
                    ? c.customerId
                    : undefined,
                channel: c.channel === 'sms' ? ('sms' as const) : ('call' as const),
                direction:
                  c.direction === 'outbound' ? ('outbound' as const) : ('inbound' as const),
                status,
                phone: typeof c.phone === 'string' ? c.phone : undefined,
                summary: typeof c.summary === 'string' ? c.summary : undefined,
                createdAt: c.createdAt as string,
              };
            });
          }
        }
      } catch {
        // best-effort: leave communications as []
      }

      setDashboardData({ customers, tasks, offers, calls: undefined, communications });
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης dashboard. Δοκίμασε ξανά.');
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
        tokenRef.current = session.access_token;
        await loadData(session.access_token);
      } catch {
        setActionError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  // Stable loading skeleton.
  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-5 py-6 md:max-w-4xl md:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
            <div className="h-7 w-36 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
            <div className="h-4 w-44 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
          </div>
          <div className="h-9 w-9 shrink-0 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
        </div>
        <div className="h-36 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-14 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-24 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-24 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-24 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="h-36 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
      </div>
    );
  }

  const { customers, tasks, offers, communications } = dashboardData;

  async function handleCompleteTask(taskId: string) {
    const token = tokenRef.current;
    const task = dashboardData.tasks.find((t) => t.id === taskId);
    if (!task || !token) return;
    setActionError(null);
    const resp = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const updated = mapTask(data.task as Record<string, unknown>);
      setLastCompletedTask(task);
      setDashboardData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
    } else {
      setActionError('Αποτυχία ενημέρωσης task. Δοκίμασε ξανά.');
    }
  }

  async function handleUndoCompleteTask() {
    if (!lastCompletedTask) return;
    const token = tokenRef.current;
    if (!token) { setLastCompletedTask(null); return; }
    setActionError(null);
    const resp = await fetch(`/api/tasks/${lastCompletedTask.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: lastCompletedTask.status }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const restored = mapTask(data.task as Record<string, unknown>);
      setDashboardData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === lastCompletedTask.id ? restored : t)),
      }));
    } else {
      setDashboardData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === lastCompletedTask.id ? lastCompletedTask : t)),
      }));
    }
    setLastCompletedTask(null);
  }

  async function handleMarkOfferSent(offerId: string) {
    const token = tokenRef.current;
    const offer = dashboardData.offers.find((o) => o.id === offerId);
    if (!offer || !token) return;
    setActionError(null);
    const resp = await fetch(`/api/offers/${offerId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent_manually' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const updated = mapOffer(data.offer as Record<string, unknown>);
      setDashboardData((prev) => ({
        ...prev,
        offers: prev.offers.map((o) => (o.id === offerId ? updated : o)),
      }));
    } else {
      setActionError('Αποτυχία ενημέρωσης προσφοράς. Δοκίμασε ξανά.');
    }
  }

  async function handleCreateOfferFollowUpTask(offerId: string) {
    const token = tokenRef.current;
    const offer = dashboardData.offers.find((o) => o.id === offerId);
    if (!offer || !offer.customerId || !token) return;
    const alreadyExists = dashboardData.tasks.some(
      (t) =>
        t.type === 'follow_up_offer' &&
        t.status === 'open' &&
        t.customerId === offer.customerId &&
        (t.offerId === offer.id || t.title === `Follow-up προσφοράς ${offer.offerNumber}`)
    );
    if (alreadyExists) return;
    setActionError(null);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const resp = await fetch('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: offer.customerId,
        offerId: offer.id,
        title: `Follow-up προσφοράς ${offer.offerNumber}`,
        type: 'follow_up_offer',
        status: 'open',
        priority: 'normal',
        dueDate: dueDate.toISOString().split('T')[0],
        note: 'Follow-up μετά την αποστολή της προσφοράς.',
        createdFromAi: false,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const created = mapTask(data.task as Record<string, unknown>);
      setDashboardData((prev) => ({ ...prev, tasks: [...prev.tasks, created] }));
    } else {
      setActionError('Αποτυχία δημιουργίας task. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Data computations
  // ---------------------------------------------------------------------------

  const leads = customers
    .filter((c) => LEAD_STATUSES.has(c.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const urgentTasks = tasks
    .filter((t) => {
      const eff = getEffectiveStatus(t);
      return eff === 'due_today' || eff === 'overdue';
    })
    .sort((a, b) => {
      const ea = getEffectiveStatus(a);
      const eb = getEffectiveStatus(b);
      if (ea === 'overdue' && eb !== 'overdue') return -1;
      if (eb === 'overdue' && ea !== 'overdue') return 1;
      return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    });

  const openOffers = offers.filter((o) => OPEN_OFFER_STATUSES.has(o.status));

  const customerMap: Record<string, string> = Object.fromEntries(
    customers.map((c) => [c.id, c.name])
  );

  // Date label (post-hydration, client-side only)
  const now = new Date();
  const todayLabel = now.toLocaleDateString('el-GR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  // Time-of-day greeting for the eyebrow (Καλημέρα before 18:00, else Καλησπέρα).
  const greeting = now.getHours() < 18 ? 'Καλημέρα' : 'Καλησπέρα';

  // ---------------------------------------------------------------------------
  // Focus card selection
  // Priority: overdue task > due-today task > offer ready to send > lead needing follow-up
  // ---------------------------------------------------------------------------

  const overdueTask = urgentTasks.find((t) => getEffectiveStatus(t) === 'overdue') ?? null;
  const todayTask = overdueTask
    ? null
    : (urgentTasks.find((t) => getEffectiveStatus(t) === 'due_today') ?? null);
  const readyOffer =
    overdueTask || todayTask
      ? null
      : (openOffers.find((o) => o.status === 'ready_to_send') ?? null);
  const focusLead =
    overdueTask || todayTask || readyOffer ? null : (leads[0] ?? null);

  const focusCard: FocusCard | null = overdueTask
    ? {
        tone: 'red',
        label: 'Εκπρόθεσμη εργασία',
        title: overdueTask.title,
        customerName: overdueTask.customerId ? customerMap[overdueTask.customerId] : undefined,
        primaryHref: overdueTask.customerId ? `/customers/${overdueTask.customerId}` : '/tasks',
      }
    : todayTask
    ? {
        tone: 'amber',
        label: 'Χρειάζεται ενέργεια σήμερα',
        title: todayTask.title,
        customerName: todayTask.customerId ? customerMap[todayTask.customerId] : undefined,
        primaryHref: todayTask.customerId ? `/customers/${todayTask.customerId}` : '/tasks',
      }
    : readyOffer
    ? {
        tone: 'indigo',
        label: 'Προσφορά σε αναμονή',
        title: `Προσφορά ${readyOffer.offerNumber}`,
        customerName: readyOffer.customerId ? customerMap[readyOffer.customerId] : undefined,
        primaryHref: `/offers/${readyOffer.id}`,
      }
    : focusLead
    ? {
        tone: 'amber',
        label: 'Να ξαναμιλήσω',
        title: focusLead.name,
        customerName: undefined,
        primaryHref: `/customers/${focusLead.id}`,
      }
    : null;

  // Derive the hero CTA without altering focusCard: prefer "Κλήση τώρα" only when the
  // focused action is clearly a call-back task AND the customer has a phone on file.
  const focusTask = overdueTask ?? todayTask ?? null;
  const focusCustomer =
    focusTask?.customerId
      ? customers.find((c) => c.id === focusTask.customerId)
      : focusLead ?? undefined;
  const focusIsCall =
    focusTask?.type === 'call_back' && !!focusCustomer?.phone;
  const focusCtaLabel = focusIsCall ? 'Κλήση τώρα' : 'Άνοιγμα πελάτη';

  // Hero left-accent color per focusCard tone (card stays white).
  const HERO_ACCENT: Record<FocusTone, string> = {
    red: 'border-l-red-500',
    amber: 'border-l-amber-500',
    indigo: 'border-l-indigo-500',
  };

  // Icon-bubble color per focusCard tone (the FocusIcon inherits via currentColor).
  const HERO_BUBBLE: Record<FocusTone, string> = {
    red: 'bg-red-50 text-red-500',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-500',
  };

  // Stat card computations
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newCustomersThisMonth = customers.filter(
    (c) => new Date(c.createdAt) >= monthStart
  ).length;

  const pendingApptTasks = tasks.filter(
    (t) => t.type === 'book_appointment' && t.status === 'open'
  ).length;

  const followUpCount = tasks.filter(
    (t) => (t.type === 'follow_up_offer' || t.type === 'call_back') && t.status === 'open'
  ).length;

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
            className="mt-2 inline-block rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Σύνδεση
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs capitalize text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-zinc-600 dark:text-zinc-300">{greeting}</span> · {todayLabel}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Τι πρέπει να γίνει τώρα;
          </h1>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">Τα σημαντικά επόμενα βήματα για σήμερα.</p>
        </div>
        <AttentionInboxBar />
      </div>

      {/* Today's chips: appointments + call-backs (tap → agenda/callback popup) */}
      <HomeActionChips />

      {/* Hero card - the single most important pending action */}
      {focusCard ? (
        <div
          className={`rounded-[28px] border-l-4 bg-white dark:bg-[#17232f] px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 ${HERO_ACCENT[focusCard.tone]}`}
        >
          <div className="flex items-start gap-3">
            {/* Icon bubble (color driven by focusCard tone) */}
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${HERO_BUBBLE[focusCard.tone]}`}>
              <FocusIcon tone={focusCard.tone} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-indigo-600">Κάνε αυτό τώρα</p>
              {focusCard.customerName && (
                <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-300">{focusCard.customerName}</p>
              )}
              <p className="text-[19px] font-bold leading-snug text-zinc-900 dark:text-zinc-100">
                {focusCard.title}
              </p>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{focusCard.label}</p>
            </div>
          </div>
          <Link
            href={focusCard.primaryHref}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 text-base font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {focusCtaLabel}
          </Link>
        </div>
      ) : (
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="text-[19px] font-bold leading-snug text-zinc-900 dark:text-zinc-100">Όλα τακτοποιημένα</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Δεν υπάρχει κάτι επείγον αυτή τη στιγμή.
          </p>
          <Link
            href="/customers/new"
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 text-base font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Προσθήκη πελάτη
          </Link>
        </div>
      )}

      {/* Four simple count cards (2x2 on mobile) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Νέοι πελάτες"
          value={newCustomersThisMonth}
          href="/customers"
        />
        <StatCard
          label="Να ξαναμιλήσω"
          value={followUpCount}
          href="/tasks"
        />
        <StatCard
          label="Προσφορές"
          value={openOffers.length}
          href="/offers"
        />
        <StatCard
          label="Ραντεβού"
          value={pendingApptTasks}
          href="/appointments"
        />
      </div>

      {/* Recent communications */}
      <RecentCommunicationsSection
        communications={communications}
        customerMap={customerMap}
      />

      {/* Priorities */}
      <NextActionsSection
        customers={customers}
        tasks={tasks}
        offers={offers}
        onCompleteTask={handleCompleteTask}
        lastCompletedTaskTitle={lastCompletedTask?.title}
        onUndoCompleteTask={handleUndoCompleteTask}
        onMarkOfferSent={handleMarkOfferSent}
        onCreateOfferFollowUpTask={handleCreateOfferFollowUpTask}
        compact
      />

    </div>
  );
}
