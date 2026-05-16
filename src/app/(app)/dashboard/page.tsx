'use client';

import { useState, useEffect } from 'react';
import { loadState, updateTask, updateOffer, addTask, updateCustomer, deleteCustomer, saveCustomers, advanceSmsIntakeStatuses, addCommunicationRecord } from '@/lib/storage';
import { getSmsPhone } from '@/lib/phone';
import { getEffectiveStatus } from '@/lib/types';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus, CommunicationRecord } from '@/lib/types';
import QuickAssistantInput from '@/components/dashboard/QuickAssistantInput';
import MissedCallsSection from '@/components/dashboard/MissedCallsSection';
import LeadsSection from '@/components/dashboard/LeadsSection';
import TodayTasksSection from '@/components/dashboard/TodayTasksSection';
import OpenOffersSection from '@/components/dashboard/OpenOffersSection';
import RecentCallsSection from '@/components/dashboard/RecentCallsSection';
import RecentCommunicationsSection from '@/components/dashboard/RecentCommunicationsSection';
import NextActionsSection from '@/components/dashboard/NextActionsSection';
import SmsIntakeNotificationBar from '@/components/dashboard/SmsIntakeNotificationBar';
import DataQualityWidget from '@/components/dashboard/DataQualityWidget';
import LocalAnalyticsWidget from '@/components/dashboard/LocalAnalyticsWidget';
import RecentResponsesSection from '@/components/dashboard/RecentResponsesSection';

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

export default function DashboardPage() {
  // Start empty so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    customers: [],
    tasks: [],
    offers: [],
    calls: undefined,
    communications: [],
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
    const rawCustomers = state.customers ?? [];
    const advanced = advanceSmsIntakeStatuses(rawCustomers);
    const anyChanged = advanced.some((c, i) => c.intakeStatus !== rawCustomers[i]?.intakeStatus);
    if (anyChanged) saveCustomers(advanced);

    // Log reminder SMS for each waiting_sms -> reminder_sent transition.
    const now = new Date().toISOString();
    const reminderComms: CommunicationRecord[] = [];
    advanced.forEach((after, i) => {
      const before = rawCustomers[i];
      if (before?.intakeStatus === 'waiting_sms' && after.intakeStatus === 'reminder_sent') {
        const phone = getSmsPhone(after) ?? undefined;
        const rec: CommunicationRecord = {
          id: crypto.randomUUID(),
          customerId: after.id,
          channel: 'sms',
          direction: 'outbound',
          status: 'sent',
          phone,
          summary: 'Αποστολή δεύτερου SMS υπενθύμισης για στοιχεία πελάτη.',
          createdAt: now,
          isMock: true,
        };
        addCommunicationRecord(rec);
        reminderComms.push(rec);
      }
    });

    const nextData: DashboardData = {
      customers: anyChanged ? advanced : rawCustomers,
      tasks: state.tasks ?? [],
      offers: state.offers ?? [],
      calls: state.calls,
      communications: [...(state.communications ?? []), ...reminderComms],
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

  const { customers, tasks, offers, calls, communications } = dashboardData;

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

  function handleDeleteSmsIntakeCustomer(customerId: string) {
    deleteCustomer(customerId);
    setDashboardData((prev) => ({
      ...prev,
      customers: prev.customers.filter((c) => c.id !== customerId),
    }));
  }

  function handleCreateSmsIntakeFollowUp(customerId: string) {
    const now = new Date().toISOString();
    const customer = dashboardData.customers.find((c) => c.id === customerId);
    if (!customer) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const task: Task = {
      id: crypto.randomUUID(),
      customerId,
      title: 'Follow-up για στοιχεία πελάτη',
      type: 'other',
      status: 'open',
      priority: 'normal',
      dueDate: tomorrow.toISOString().split('T')[0],
      note: 'Ο πελάτης δεν απάντησε στο SMS στοιχείων.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    const updated = { ...customer, intakeStatus: 'kept_draft' as const, updatedAt: now };
    updateCustomer(updated);
    setDashboardData((prev) => ({
      ...prev,
      tasks: [...prev.tasks, task],
      customers: prev.customers.map((c) => (c.id === customerId ? updated : c)),
    }));
  }

  function handleKeepSmsIntakeDraft(customerId: string) {
    const now = new Date().toISOString();
    const customer = dashboardData.customers.find((c) => c.id === customerId);
    if (!customer) return;
    const updated = {
      ...customer,
      intakeStatus: 'kept_draft' as const,
      notes: customer.notes
        ? `${customer.notes}\nΚρατήθηκε ως πρόχειρη καρτέλα.`
        : 'Κρατήθηκε ως πρόχειρη καρτέλα.',
      updatedAt: now,
    };
    updateCustomer(updated);
    setDashboardData((prev) => ({
      ...prev,
      customers: prev.customers.map((c) => (c.id === customerId ? updated : c)),
    }));
  }

  function handleCreateOfferFollowUpTask(offerId: string) {
    const offer = dashboardData.offers.find((o) => o.id === offerId);
    if (!offer || !offer.customerId) return; // orphan offers cannot link task to customer

    // Prevent duplicates: skip if an open follow-up task already exists for this offer.
    const alreadyExists = dashboardData.tasks.some(
      (t) =>
        t.type === 'follow_up_offer' &&
        t.status === 'open' &&
        t.customerId === offer.customerId &&
        (t.offerId === offer.id || t.title === `Follow-up προσφοράς ${offer.offerNumber}`)
    );
    if (alreadyExists) return;

    const now = new Date().toISOString();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const task: Task = {
      id: crypto.randomUUID(),
      customerId: offer.customerId,
      offerId: offer.id,
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

      <SmsIntakeNotificationBar
        customers={customers}
        onDeleteCustomer={handleDeleteSmsIntakeCustomer}
        onCreateFollowUp={handleCreateSmsIntakeFollowUp}
        onKeepDraft={handleKeepSmsIntakeDraft}
      />

      <DataQualityWidget customers={customers} />

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
      <RecentResponsesSection offers={offers} customerMap={customerMap} tasks={tasks} />
      <RecentCommunicationsSection communications={communications} customerMap={customerMap} />
      <RecentCallsSection callRecords={calls} customerMap={customerMap} />
      <LocalAnalyticsWidget customers={customers} tasks={tasks} offers={offers} />
    </div>
  );
}
