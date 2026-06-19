'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus, CommunicationRecord } from '@/lib/types';
import NextActionsSection from '@/components/dashboard/NextActionsSection';
import RecentCommunicationsSection from '@/components/dashboard/RecentCommunicationsSection';
import HomeActionChips from '@/components/dashboard/HomeActionChips';
import AttentionInboxBar from '@/components/layout/AttentionInboxBar';

// Keep in sync with native — include sent_provider so the «ανοιχτές προσφορές»
// count matches across web and native for the same account.
const OPEN_OFFER_STATUSES = new Set<string>(['draft', 'ready_to_send', 'sent_manually', 'sent_provider']);

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

function StatCard({
  label,
  value,
  href,
  icon,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
  /** Tailwind classes for the icon chip, e.g. 'bg-indigo-50 text-indigo-600'. */
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-3xl bg-white px-4 py-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:shadow-md hover:ring-indigo-200 active:scale-[0.98] dark:bg-[#17232f] dark:ring-white/10"
    >
      <div className="flex items-center justify-between">
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ${accent}`}>{icon}</span>
        <ChevronRight />
      </div>
      <div>
        <span
          className={`block text-3xl font-bold leading-none ${
            value > 0 ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-600'
          }`}
        >
          {value}
        </span>
        <span className="mt-1.5 block text-xs font-medium leading-snug text-zinc-600 dark:text-zinc-300">{label}</span>
      </div>
    </Link>
  );
}

// Small stat icon helper (keeps the 4-card grid declarations terse).
function StatIcon({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
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

      {/* Four KPI cards (2x2 on mobile) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Νέοι πελάτες"
          value={newCustomersThisMonth}
          href="/customers"
          accent="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          icon={<StatIcon path="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />}
        />
        <StatCard
          label="Να ξαναμιλήσω"
          value={followUpCount}
          href="/tasks"
          accent="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
          icon={<StatIcon path="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />}
        />
        <StatCard
          label="Προσφορές"
          value={openOffers.length}
          href="/offers"
          accent="bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          icon={<StatIcon path="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />}
        />
        <StatCard
          label="Ραντεβού"
          value={pendingApptTasks}
          href="/appointments"
          accent="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
          icon={<StatIcon path="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />}
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
