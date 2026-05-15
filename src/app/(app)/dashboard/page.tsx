'use client';

import { useState, useEffect } from 'react';
import { loadState, updateTask, updateOffer, addTask } from '@/lib/storage';
import { getEffectiveStatus } from '@/lib/types';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus } from '@/lib/types';
import QuickAssistantInput from '@/components/dashboard/QuickAssistantInput';
import MissedCallsSection from '@/components/dashboard/MissedCallsSection';
import LeadsSection from '@/components/dashboard/LeadsSection';
import TodayTasksSection from '@/components/dashboard/TodayTasksSection';
import OpenOffersSection from '@/components/dashboard/OpenOffersSection';
import RecentCallsSection from '@/components/dashboard/RecentCallsSection';
import NextActionsSection from '@/components/dashboard/NextActionsSection';

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
}

export default function DashboardPage() {
  // Start empty so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    customers: [],
    tasks: [],
    offers: [],
    calls: undefined,
  });

  // Undo state for dashboard task completion — must be declared before any conditional return.
  const [lastCompletedTask, setLastCompletedTask] = useState<Task | null>(null);

  // Auto-clear the undo banner after 8 seconds.
  useEffect(() => {
    if (!lastCompletedTask) return;
    const timer = setTimeout(() => setLastCompletedTask(null), 8000);
    return () => clearTimeout(timer);
  }, [lastCompletedTask]);

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    const nextData: DashboardData = {
      customers: state.customers ?? [],
      tasks: state.tasks ?? [],
      offers: state.offers ?? [],
      calls: state.calls,
    };
    const timer = window.setTimeout(() => {
      setDashboardData(nextData);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
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

  function handleCompleteTask(taskId: string) {
    const now = new Date().toISOString();
    const task = dashboardData.tasks.find((t) => t.id === taskId);
    if (!task) return;
    setLastCompletedTask(task); // save for undo before overwriting
    const completed: Task = {
      ...task,
      status: 'completed' as TaskBaseStatus,
      completedAt: now,
      updatedAt: now,
    };
    updateTask(completed);
    setDashboardData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === taskId ? completed : t)),
    }));
  }

  function handleUndoCompleteTask() {
    if (!lastCompletedTask) return;
    updateTask(lastCompletedTask);
    setDashboardData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id === lastCompletedTask.id ? lastCompletedTask : t
      ),
    }));
    setLastCompletedTask(null);
  }

  function handleMarkOfferSent(offerId: string) {
    const offer = dashboardData.offers.find((o) => o.id === offerId);
    if (!offer) return;
    const updated = { ...offer, status: 'sent_manually' as const, updatedAt: new Date().toISOString() };
    updateOffer(updated);
    setDashboardData((prev) => ({
      ...prev,
      offers: prev.offers.map((o) => (o.id === offerId ? updated : o)),
    }));
  }

  function handleCreateOfferFollowUpTask(offerId: string) {
    const offer = dashboardData.offers.find((o) => o.id === offerId);
    if (!offer) return;
    const now = new Date().toISOString();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const task: Task = {
      id: crypto.randomUUID(),
      customerId: offer.customerId,
      title: `Follow-up προσφοράς ${offer.offerNumber}`,
      type: 'follow_up_offer',
      status: 'open',
      priority: 'normal',
      dueDate: dueDate.toISOString().split('T')[0],
      note: 'Follow-up μετά την αποστολή της προσφοράς.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    setDashboardData((prev) => ({
      ...prev,
      tasks: [...prev.tasks, task],
    }));
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
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">
          Καλημέρα. Τι πρέπει να γίνει σήμερα;
        </h1>
      </div>

      <QuickAssistantInput />

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

      <MissedCallsSection callRecords={calls} customerMap={customerMap} />
      <LeadsSection leads={leads} />
      <TodayTasksSection tasks={urgentTasks} customerMap={customerMap} />
      <OpenOffersSection offers={openOffers} customerMap={customerMap} />
      <RecentCallsSection callRecords={calls} customerMap={customerMap} />
    </div>
  );
}
