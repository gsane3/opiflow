'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState, saveState, updateTask, updateOffer, addTask, updateCustomer, deleteCustomer, saveCustomers, advanceSmsIntakeStatuses, addCommunicationRecord } from '@/lib/storage';
import { generateDemoTasks } from '@/lib/demo-data';
import { getSmsPhone } from '@/lib/phone';
import { getEffectiveStatus } from '@/lib/types';
import type { Customer, Task, Offer, CallRecord, TaskBaseStatus, CommunicationRecord } from '@/lib/types';
import QuickAssistantInput from '@/components/dashboard/QuickAssistantInput';
import NextActionsSection from '@/components/dashboard/NextActionsSection';
import SmsIntakeNotificationBar from '@/components/dashboard/SmsIntakeNotificationBar';
import DataQualityWidget from '@/components/dashboard/DataQualityWidget';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';
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

  // Undo state - must be declared before any conditional return.
  const [lastCompletedTask, setLastCompletedTask] = useState<Task | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

    let tasks: Task[];
    if (state.tasks === undefined) {
      const seeded = generateDemoTasks();
      saveState({ tasks: seeded });
      tasks = seeded;
    } else {
      tasks = state.tasks;
    }

    const nextData: DashboardData = {
      customers: anyChanged ? advanced : rawCustomers,
      tasks,
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

  function handleCompleteTask(taskId: string) {
    const now = new Date().toISOString();
    const task = dashboardData.tasks.find((t) => t.id === taskId);
    if (!task) return;
    setLastCompletedTask(task);
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
    if (!offer || !offer.customerId) return;

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
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <DemoStepBanner
        step="dashboard"
        stepNum={1}
        title="Dashboard - εκκρεμότητες της ημέρας"
        body="Κοίτα tasks εκπρόθεσμα, ανοιχτές προσφορές και τοπική εικόνα στο κάτω μέρος."
        watchLabel="Αν δεν βλέπεις στοιχεία, γύρνα στο Mission 1 και επαναφέρε Rich demo."
        actionLabel="Επόμενο: AI review"
        actionHref="/ai-review?demoStep=review"
      />
      <GuidedDemoBanner
        step="dashboard"
        stepNum={1}
        title="Dashboard - κέντρο ελέγχου"
        whatYouSee="Εκκρεμότητες ημέρας: tasks εκπρόθεσμα, ανοιχτές προσφορές, πρόσφατες απαντήσεις, local analytics."
        whatToDo="Πάτα ένα εικονίδιο για να δεις λεπτομέρειες χωρίς να φύγεις από την Αρχική."
        whyItMatters="Στο τελικό προϊόν, εδώ θα βλέπεις τι χρειάζεται follow-up μετά από κλήσεις, SMS, Viber ή email. Στο MVP: τοπικά δεδομένα μόνο."
        canManualComplete={true}
      />

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

      <SmsIntakeNotificationBar
        customers={customers}
        onDeleteCustomer={handleDeleteSmsIntakeCustomer}
        onCreateFollowUp={handleCreateSmsIntakeFollowUp}
        onKeepDraft={handleKeepSmsIntakeDraft}
      />

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

      {/* Data quality — secondary, shown only when needed */}
      <DataQualityWidget customers={customers} />

      {/* App menu */}
      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Μενού">
        <div className="space-y-2">
          {[
            { href: '/settings', label: 'Ρυθμίσεις', subtitle: 'Επιχείρηση, backup, demo δεδομένα' },
            { href: '/demo', label: 'Demo', subtitle: 'Guided demo και πληροφορίες pilot' },
            { href: '/demo/privacy', label: 'Απόρρητο demo', subtitle: 'Τι αποθηκεύεται και τι όχι' },
            { href: '/demo/production-readiness', label: 'Τεχνική ετοιμότητα', subtitle: 'Checklist πριν το Vercel' },
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
