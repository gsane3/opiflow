'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { getEffectiveStatus } from '@/lib/types';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus, CommunicationRecord } from '@/lib/types';
import QuickAssistantInput from '@/components/dashboard/QuickAssistantInput';
import NextActionsSection from '@/components/dashboard/NextActionsSection';
import DataQualityWidget from '@/components/dashboard/DataQualityWidget';
import DashboardSmartCards from '@/components/dashboard/DashboardSmartCards';
import ActionSheet from '@/components/common/ActionSheet';

const LEAD_STATUSES = new Set<string>([
  'new_lead',
  'follow_up_needed',
  'offer_drafted',
  'offer_sent',
]);
const OPEN_OFFER_STATUSES = new Set<string>(['draft', 'ready_to_send', 'sent_manually']);

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

interface DashboardData {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
  calls: CallRecord[] | undefined;
  communications: CommunicationRecord[];
}

// Map backend offer response to local Offer type.
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

// Map backend task response to local Task type.
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

// Map backend customer response to local Customer type.
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

export default function DashboardPage() {
  // Start empty so server render and first client render match.
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-clear the undo banner after 8 seconds.
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

      setDashboardData({
        customers,
        tasks,
        offers,
        calls: undefined,
        communications: [],
      });
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

  // Stable loading shell - identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">
            Καλημέρα. Τι πρέπει να γίνει σήμερα;
          </h1>
        </div>
        <QuickAssistantInput />
        <p className="py-6 text-center text-sm text-zinc-400">Φόρτωση dashboard...</p>
      </div>
    );
  }

  const { customers, tasks, offers, calls } = dashboardData;

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
    if (!token) {
      setLastCompletedTask(null);
      return;
    }
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
        tasks: prev.tasks.map((t) =>
          t.id === lastCompletedTask.id ? restored : t
        ),
      }));
    } else {
      // Restore from in-memory snapshot on API failure.
      setDashboardData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === lastCompletedTask.id ? lastCompletedTask : t
        ),
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

    // Prevent duplicates using in-memory loaded tasks.
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
      setDashboardData((prev) => ({
        ...prev,
        tasks: [...prev.tasks, created],
      }));
    } else {
      setActionError('Αποτυχία δημιουργίας task. Δοκίμασε ξανά.');
    }
  }

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

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-xl bg-red-50 px-4 py-2.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Auth required notice */}
      {authRequired && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-sm text-amber-700">
            Συνδέσου για να φορτωθούν τα πραγματικά δεδομένα του dashboard.
          </p>
          <Link
            href="/login/backend"
            className="mt-2 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      )}

      {/* Header: greeting + menu icon */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-zinc-900">
          Καλημέρα. Τι πρέπει να γίνει σήμερα;
        </h1>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
          aria-label="Ρυθμίσεις και μενού"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>

      {/* Call-first value line */}
      <p className="text-sm text-zinc-400">
        Η περίληψη κάθε κλήσης καταχωρείται αυτόματα στο CRM μόλις ολοκληρωθεί η κλήση.
      </p>

      {/* 6-card control center */}
      <DashboardSmartCards
        urgentTasks={urgentTasks}
        leads={leads}
        openOffers={openOffers}
        customers={customers}
        calls={calls}
        customerMap={customerMap}
        onCompleteTask={handleCompleteTask}
      />

      <QuickAssistantInput />

      {/* SmsIntakeNotificationBar omitted: SMS intake is handled via Viber/public intake. */}

      <NextActionsSection
        customers={customers}
        tasks={tasks}
        offers={offers}
        onCompleteTask={handleCompleteTask}
        lastCompletedTaskTitle={lastCompletedTask?.title}
        onUndoCompleteTask={handleUndoCompleteTask}
        onMarkOfferSent={handleMarkOfferSent}
        onCreateOfferFollowUpTask={handleCreateOfferFollowUpTask}
      />

      {/* Data quality - secondary, shown only when needed */}
      <DataQualityWidget customers={customers} />

      {/* App menu */}
      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Μενού">
        <div className="space-y-2">
          {[
            { href: '/settings', label: 'Ρυθμίσεις', subtitle: 'Επιχείρηση, backup, ρυθμίσεις' },
          ].map(({ href, label, subtitle }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200"
            >
              <div>
                <p className="text-base font-semibold text-zinc-900">{label}</p>
                <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
              </div>
              <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ))}
        </div>
      </ActionSheet>

    </div>
  );
}
