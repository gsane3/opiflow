'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadState, updateCustomer, deleteCustomer, updateTask, addTask, addOffer, addCallRecord, addCommunicationRecord } from '@/lib/storage';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';
import { buildMapsUrl } from '@/lib/maps';
import { isLikelyMobile, getCallPhone, getSmsPhone, getLandlinePhone } from '@/lib/phone';
import { buildCallHref, buildSmsHref } from '@/lib/communications';
import type { Customer, Task, Offer, CallRecord, CommunicationRecord } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import OfferStatusBadge from '@/components/offers/OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';
import CustomerStatusBadge, { STATUS_LABELS } from './CustomerStatusBadge';
import { SOURCE_LABELS } from './CustomerCard';
import CustomerForm from './CustomerForm';
import { TASK_TYPE_LABELS } from '@/components/tasks/TaskStatusBadge';
import CustomerFilesSection from './CustomerFilesSection';
import CustomerTimeline from './CustomerTimeline';
import CustomerNextActionPanel from './CustomerNextActionPanel';
import TaskForm from '@/components/tasks/TaskForm';
import OfferForm from '@/components/offers/OfferForm';
import { isIncompleteCustomer, getMissingFields } from './CustomerDataQualityPanel';

const CONTACT_LABELS: Record<string, string> = {
  viber: 'Viber',
  email: 'Email',
  phone: 'Τηλέφωνο',
};

function ActivitySummaryCard({
  customerCalls,
  customerCommunications,
  openTasks,
  customerOffers,
}: {
  customerCalls: CallRecord[];
  customerCommunications: CommunicationRecord[];
  openTasks: Task[];
  customerOffers: Offer[];
}) {
  const lastCall = [...customerCalls]
    .sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt))[0];

  const lastSms = [...customerCommunications]
    .filter((c) => c.channel === 'sms')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const openOffersCount = customerOffers.filter((o) =>
    ['draft', 'ready_to_send', 'sent_manually'].includes(o.status)
  ).length;

  const openTasksCount = openTasks.length;

  const hasAny = lastCall || lastSms || openTasksCount > 0 || openOffersCount > 0;
  if (!hasAny) return null;

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Σύνοψη δραστηριότητας
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {openTasksCount > 0 && (
          <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-center ring-1 ring-amber-100">
            <p className="text-lg font-bold text-amber-800">{openTasksCount}</p>
            <p className="text-xs text-amber-600">Ανοιχτά tasks</p>
          </div>
        )}
        {openOffersCount > 0 && (
          <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-center ring-1 ring-indigo-100">
            <p className="text-lg font-bold text-indigo-800">{openOffersCount}</p>
            <p className="text-xs text-indigo-600">Ανοιχτές προσφορές</p>
          </div>
        )}
        {lastCall && (
          <div className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100">
            <p className="text-xs font-medium text-zinc-500">Τελευταία κλήση</p>
            <p className="text-xs text-zinc-700">{fmtDate(lastCall.startedAt || lastCall.createdAt)}</p>
          </div>
        )}
        {lastSms && (
          <div className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100">
            <p className="text-xs font-medium text-zinc-500">Τελευταίο SMS</p>
            <p className="text-xs text-zinc-700">{fmtDate(lastSms.createdAt)}</p>
          </div>
        )}
      </div>
    </section>
  );
}


function DisabledAction({ label, note }: { label: string; note?: string }) {
  return (
    <div
      className="flex w-full flex-col items-center gap-1.5 rounded-2xl bg-zinc-50 px-2 py-4 ring-1 ring-zinc-200 cursor-not-allowed select-none"
      title={note ?? label}
    >
      <span className="text-sm font-medium text-zinc-400 text-center leading-tight">{label}</span>
      {note && (
        <span className="text-[11px] text-zinc-400 text-center leading-snug">{note}</span>
      )}
    </div>
  );
}

interface Props {
  customerId: string;
}

export default function CustomerProfile({ customerId }: Props) {
  const router = useRouter();

  // Start with null/[] so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // All tasks for this customer (not just open) — used for timeline and open tasks section.
  const [customerTasks, setCustomerTasks] = useState<Task[]>([]);
  const [customerOffers, setCustomerOffers] = useState<Offer[]>([]);
  const [customerCalls, setCustomerCalls] = useState<CallRecord[]>([]);
  const [customerCommunications, setCustomerCommunications] = useState<CommunicationRecord[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [lastCompletedTask, setLastCompletedTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTaskInitial, setNewTaskInitial] = useState<Task | null>(null);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerFormNumber, setOfferFormNumber] = useState('#001');
  const [offerFormInitial, setOfferFormInitial] = useState<Offer | null>(null);
  const [showBriefForm, setShowBriefForm] = useState(false);
  const [briefText, setBriefText] = useState('');
  const [briefNextStep, setBriefNextStep] = useState('');
  const [briefCreateFollowUp, setBriefCreateFollowUp] = useState(false);
  const [showAiDemoPanel, setShowAiDemoPanel] = useState(false);
  const [aiTranscriptionText, setAiTranscriptionText] = useState('');
  const [summaryCopied, setSummaryCopied] = useState(false);
  // Refs for scroll-to-section when quick action buttons are tapped
  const appointmentsSectionRef = useRef<HTMLDivElement>(null);
  const tasksSectionRef = useRef<HTMLDivElement>(null);
  const offersSectionRef = useRef<HTMLDivElement>(null);
  // Highlight banners shown near sections after tapping quick action
  const [taskHighlight, setTaskHighlight] = useState(false);
  const [offerHighlight, setOfferHighlight] = useState(false);
  // Email draft copy
  const [emailDraftCopied, setEmailDraftCopied] = useState(false);

  // Auto-clear undo banner after 8 seconds.
  useEffect(() => {
    if (!lastCompletedTask) return;
    const timer = window.setTimeout(() => setLastCompletedTask(null), 8000);
    return () => window.clearTimeout(timer);
  }, [lastCompletedTask]);

  // Open tasks derived from all customer tasks (used in the open tasks section).
  const openTasks = useMemo(
    () => customerTasks.filter((t) => t.status === 'open'),
    [customerTasks]
  );

  const appointmentTasks = useMemo(
    () => openTasks.filter((t) => t.type === 'book_appointment' || t.type === 'visit_customer'),
    [openTasks]
  );

  const internalTasks = useMemo(
    () => openTasks.filter((t) => t.type !== 'book_appointment' && t.type !== 'visit_customer'),
    [openTasks]
  );

  // Call records that have a manual brief summary.
  const callBriefs = useMemo(
    () =>
      [...customerCalls]
        .filter((c) => c.summary)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [customerCalls]
  );

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    const foundCustomer = (state.customers ?? []).find((c) => c.id === customerId) ?? null;
    const foundTasks = (state.tasks ?? []).filter((t) => t.customerId === customerId);
    const foundOffers = (state.offers ?? []).filter((o) => o.customerId === customerId);
    const foundCalls = (state.calls ?? []).filter((c) => c.customerId === customerId);
    const foundComms = (state.communications ?? []).filter((c) => c.customerId === customerId);
    const timer = window.setTimeout(() => {
      setCustomer(foundCustomer);
      setCustomerTasks(foundTasks);
      setCustomerOffers(foundOffers);
      setCustomerCalls(foundCalls);
      setCustomerCommunications(foundComms);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [customerId]);

  function openBriefForm() {
    setShowAiDemoPanel(false);
    setBriefText('');
    setBriefNextStep('');
    setBriefCreateFollowUp(false);
    setShowBriefForm(true);
  }

  function handleCancelBriefForm() {
    setShowBriefForm(false);
  }

  function openAiDemoPanel() {
    setShowBriefForm(false);
    setAiTranscriptionText(
      `Καλημέρα σας, μιλάω με ${customer?.name ?? 'τον πελάτη'}. Ο πελάτης ανέφερε ότι ενδιαφέρεται για τις υπηρεσίες μας και χρειάζεται προσφορά. Ζήτησε επίσης επιβεβαίωση στοιχείων και χρόνου παράδοσης. Συμφωνήσαμε να επικοινωνήσουμε εκ νέου μέσα στις επόμενες ημέρες.`
    );
    setShowAiDemoPanel(true);
  }

  function handleCancelAiDemo() {
    setShowAiDemoPanel(false);
  }

  function handleGenerateBrief() {
    const sentences = aiTranscriptionText
      .trim()
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    const excerpt = sentences.slice(0, 2).join('. ');
    const generated =
      `Ο πελάτης περιέγραψε το αίτημα και χρειάζεται συνέχεια από την επιχείρηση.` +
      (excerpt ? ` ${excerpt}.` : '');
    setBriefText(generated);
    setBriefNextStep('Follow-up με προσφορά ή επιβεβαίωση στοιχείων.');
    setBriefCreateFollowUp(true);
    setShowAiDemoPanel(false);
    setShowBriefForm(true);
  }

  function handleSaveBrief() {
    if (!briefText.trim()) return;
    const now = new Date().toISOString();
    const record: CallRecord = {
      id: crypto.randomUUID(),
      customerId: customer?.id,
      callType: 'outbound_existing_customer',
      direction: 'outbound',
      status: 'completed',
      startedAt: now,
      durationSeconds: 0,
      isMock: true,
      summary: briefText.trim(),
      nextStep: briefNextStep.trim() || undefined,
      createdAt: now,
    };
    addCallRecord(record);
    setCustomerCalls((prev) => [...prev, record]);

    if (briefCreateFollowUp) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const noteLines = [`Brief: ${briefText.trim()}`];
      if (briefNextStep.trim()) noteLines.push(`Επόμενο βήμα: ${briefNextStep.trim()}`);
      const task: Task = {
        id: crypto.randomUUID(),
        customerId: customer?.id,
        title: 'Follow-up μετά από κλήση',
        type: 'other',
        status: 'open',
        priority: 'normal',
        dueDate: tomorrow.toISOString().split('T')[0],
        note: noteLines.join('\n'),
        createdFromAi: false,
        createdAt: now,
        updatedAt: now,
      };
      addTask(task);
      setCustomerTasks((prev) => [...prev, task]);
    }

    setShowBriefForm(false);
  }

  function openOfferForm() {
    const now = new Date().toISOString();
    const allOffers = loadState().offers ?? [];
    const maxNum =
      allOffers.length === 0
        ? 0
        : Math.max(
            ...allOffers.map((o) => {
              const match = o.offerNumber.match(/(\d+)$/);
              return match ? parseInt(match[1]) : 0;
            })
          );
    const nextNum = `#${String(maxNum + 1).padStart(3, '0')}`;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);
    setOfferFormNumber(nextNum);
    setOfferFormInitial({
      id: crypto.randomUUID(),
      customerId: customer?.id,
      offerNumber: nextNum,
      status: 'draft',
      offerDate: now.split('T')[0],
      validUntil: validUntil.toISOString().split('T')[0],
      items: [],
      subtotal: 0,
      vatRate: 24,
      vatAmount: 0,
      total: 0,
      notes: '',
      terms: '',
      acceptanceText: '',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    });
    setShowOfferForm(true);
  }

  function handleSaveNewOffer(offer: Offer) {
    addOffer(offer);
    setCustomerOffers((prev) => [...prev, offer]);
    setShowOfferForm(false);
    setOfferFormInitial(null);
  }

  function handleCancelOfferForm() {
    setShowOfferForm(false);
    setOfferFormInitial(null);
  }

  function openNewTaskForm() {
    const now = new Date().toISOString();
    setNewTaskInitial({
      id: crypto.randomUUID(),
      customerId: customer?.id,
      title: '',
      type: 'other',
      status: 'open',
      priority: 'normal',
      dueDate: now.split('T')[0],
      note: '',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    });
    setShowTaskForm(true);
  }

  function handleSaveNewTask(task: Task) {
    addTask(task);
    setCustomerTasks((prev) => [...prev, task]);
    setShowTaskForm(false);
    setNewTaskInitial(null);
  }

  // ── Quick action: scroll to existing task form ───────────────────────────────
  function handleQuickNewTask() {
    openNewTaskForm();
    setTaskHighlight(true);
    window.setTimeout(() => {
      tasksSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    window.setTimeout(() => setTaskHighlight(false), 5000);
  }

  // ── Quick action: scroll to existing offer form ───────────────────────────────
  function handleQuickNewOffer() {
    openOfferForm();
    setOfferHighlight(true);
    window.setTimeout(() => {
      offersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    window.setTimeout(() => setOfferHighlight(false), 5000);
  }

  // ── Email draft copy (customer-specific) ──────────────────────────────────────
  function handleCopyEmailDraft() {
    if (!customer?.email) return;
    const draft = `Καλησπέρα ${customer.name},\n\nΣας γράφω σχετικά με την επικοινωνία μας.\n\nΜε εκτίμηση`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(draft).then(
        () => { setEmailDraftCopied(true); setTimeout(() => setEmailDraftCopied(false), 2500); },
        () => { setEmailDraftCopied(true); setTimeout(() => setEmailDraftCopied(false), 2500); }
      );
    } else {
      setEmailDraftCopied(true);
      setTimeout(() => setEmailDraftCopied(false), 2500);
    }
  }

  function handleCancelNewTask() {
    setShowTaskForm(false);
    setNewTaskInitial(null);
  }

  function handleCompleteTask(taskId: string) {
    const now = new Date().toISOString();
    const task = customerTasks.find((t) => t.id === taskId);
    if (!task) return;
    const completed = { ...task, status: 'completed' as const, completedAt: now, updatedAt: now };
    updateTask(completed);
    setCustomerTasks((prev) => prev.map((t) => (t.id === taskId ? completed : t)));
    setLastCompletedTask(completed);
  }

  function handleUndoCompleteTask() {
    if (!lastCompletedTask) return;
    const undone = { ...lastCompletedTask, status: 'open' as const, completedAt: undefined, updatedAt: new Date().toISOString() };
    updateTask(undone);
    setCustomerTasks((prev) => prev.map((t) => (t.id === undone.id ? undone : t)));
    setLastCompletedTask(null);
  }

  function handleSave(updated: Customer) {
    updateCustomer(updated);
    setCustomer(updated);
    setIsEditing(false);
  }

  function handleDelete() {
    if (!window.confirm(`Διαγραφή πελάτη "${customer?.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) {
      return;
    }
    deleteCustomer(customerId);
    router.push('/customers');
  }

  function handleCopySummary() {
    if (!customer) return;
    const lines: string[] = [];
    lines.push(customer.name);
    if (customer.crmNumber) lines.push(`Πελάτης ${customer.crmNumber}`);
    const phone = customer.mobilePhone || customer.phone;
    if (phone) lines.push(`Κιν.: ${phone}`);
    if (customer.landlinePhone) lines.push(`Σταθ.: ${customer.landlinePhone}`);
    if (customer.email) lines.push(`Email: ${customer.email}`);
    if ((customer as { needsSummary?: string }).needsSummary) lines.push(`Ανάγκες: ${(customer as { needsSummary?: string }).needsSummary}`);
    if (openTasks.length > 0) lines.push(`Ανοιχτά tasks: ${openTasks.length}`);
    const openOffers = customerOffers.filter((o) =>
      ['draft', 'ready_to_send', 'sent_manually'].includes(o.status)
    );
    if (openOffers.length > 0) lines.push(`Ανοιχτές προσφορές: ${openOffers.length}`);
    const allCommEvents = [
      ...customerCommunications.map((c) => ({ createdAt: c.createdAt })),
      ...customerCalls.map((c) => ({ createdAt: c.startedAt || c.createdAt })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const lastComm = allCommEvents[0];
    if (lastComm) {
      lines.push(
        `Τελευταία επικοινωνία: ${new Date(lastComm.createdAt).toLocaleDateString('el-GR')}`
      );
    }
    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setSummaryCopied(true);
        setTimeout(() => setSummaryCopied(false), 2500);
      });
    }
  }

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση πελάτη...</p>
      </div>
    );
  }

  if (customer === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm font-medium text-zinc-700">Ο πελάτης δεν βρέθηκε.</p>
        <button
          type="button"
          onClick={() => router.push('/customers')}
          className="mt-4 text-sm text-indigo-600 hover:text-indigo-700"
        >
          ← Πίσω στους πελάτες
        </button>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="mb-4 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← Ακύρωση επεξεργασίας
        </button>
        <CustomerForm
          initial={customer}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  const mapsUrl = customer.address ? buildMapsUrl(customer.address) : null;
  const callPhone = getCallPhone(customer);
  const smsPhone = getSmsPhone(customer);
  const hasLandlineOnly = !smsPhone && !!getLandlinePhone(customer);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 space-y-5">
      {/* Step 165: Demo mission banner */}
      <DemoStepBanner
        step="customer"
        stepNum={4}
        title="Καρτέλα πελάτη -- ιστορικό και επόμενες ενέργειες"
        body="Κοίτα τη σύνοψη, τα ανοιχτά tasks και το timeline. Δες πώς συνδέεται με τις προσφορές."
        watchLabel="Timeline κάτω, ανοιχτά tasks, σύνοψη δραστηριότητας."
        actionLabel="Επόμενο: Προσφορά"
        actionHref="/offers/demo-offer-1?demoStep=offer"
      />
      <GuidedDemoBanner
        step="customer"
        stepNum={3}
        title="Καρτέλα πελάτη — ιστορικό και επόμενες ενέργειες"
        whatYouSee="Σύνοψη κλήσης, ανάγκες πελάτη, ανοιχτά tasks, timeline επικοινωνιών και προσφορών."
        whatToDo="Κάνε scroll ως κάτω και δες activity summary, tasks, timeline."
        whyItMatters="Όλο το ιστορικό κάθε πελάτη σε ένα μέρος μετά από κάθε κλήση, SMS ή email. Στο MVP: demo δεδομένα τοπικά μόνο."
        canManualComplete={true}
      />
      {/* Back */}
      <button
        type="button"
        onClick={() => router.push('/customers')}
        className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← Πελάτες
      </button>

      {/* Header — stacked for mobile readability */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-3">
        {/* Name — full width, never truncated */}
        <div>
          <h1 className="text-xl font-bold text-zinc-900 leading-tight">{customer.name}</h1>
          {customer.companyName && (
            <p className="mt-0.5 text-sm text-zinc-500">{customer.companyName}</p>
          )}
          {/* Badges row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {customer.crmNumber && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500">
                Πελάτης {customer.crmNumber}
              </span>
            )}
            {customer.isDemo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">
                Demo
              </span>
            )}
            {customer.intakeStatus && customer.intakeStatus !== 'none' && customer.intakeStatus !== 'completed' && (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                customer.intakeStatus === 'no_response'
                  ? 'bg-red-100 text-red-600'
                  : customer.intakeStatus === 'reminder_sent'
                  ? 'bg-amber-100 text-amber-700'
                  : customer.intakeStatus === 'kept_draft'
                  ? 'bg-zinc-100 text-zinc-500'
                  : 'bg-blue-50 text-blue-600'
              }`}>
                {customer.intakeStatus === 'waiting_sms' ? 'Αναμονή SMS στοιχείων'
                  : customer.intakeStatus === 'reminder_sent' ? 'Στάλθηκε υπενθύμιση SMS'
                  : customer.intakeStatus === 'no_response' ? 'Δεν απάντησε στο SMS'
                  : 'Πρόχειρη καρτέλα'}
              </span>
            )}
          </div>
          {/* Status + value */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CustomerStatusBadge status={customer.status} />
            {customer.opportunityValue && (
              <span className="text-sm font-semibold text-zinc-700">
                €{customer.opportunityValue.toLocaleString('el-GR')}
              </span>
            )}
          </div>
        </div>
        {/* Action buttons — separate row, never compete with name */}
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
          <button
            type="button"
            onClick={handleCopySummary}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition min-h-[40px] ${
              summaryCopied
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {summaryCopied ? '✓ Αντιγράφηκε' : 'Αντιγραφή σύνοψης'}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[40px]"
          >
            Επεξεργασία
          </button>
        </div>
      </div>

      {/* Data quality summary */}
      {isIncompleteCustomer(customer) && (() => {
        const missing = getMissingFields(customer);
        const intakeLabels: Record<string, string> = {
          waiting_sms: 'Αναμονή SMS στοιχείων',
          reminder_sent: 'Στάλθηκε υπενθύμιση',
          no_response: 'Δεν απάντησε στο SMS',
          kept_draft: 'Πρόχειρη καρτέλα',
        };
        const intakeLabel = customer.intakeStatus ? intakeLabels[customer.intakeStatus] : null;
        return (
          <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 space-y-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Η καρτέλα θέλει συμπλήρωση</p>
              <p className="text-xs text-amber-700">
                Λείπουν στοιχεία που βοηθούν στην επικοινωνία και στις προσφορές.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((f) => (
                <span
                  key={f}
                  className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                >
                  {f}
                </span>
              ))}
              {intakeLabel && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {intakeLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-50"
            >
              Επεξεργασία στοιχείων
            </button>
          </div>
        );
      })()}

      {/* Activity summary */}
      <ActivitySummaryCard
        customerCalls={customerCalls}
        customerCommunications={customerCommunications}
        openTasks={openTasks}
        customerOffers={customerOffers}
      />

      {/* Next action recommendation */}
      <CustomerNextActionPanel
        customer={customer}
        tasks={customerTasks}
        offers={customerOffers}
      />

      {/* Quick actions — customer-specific */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Γρήγορες ενέργειες
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Οι ενέργειες αφορούν τον πελάτη: <span className="font-semibold text-zinc-700">{customer.name}</span>
          </p>
        </div>

        {/* 2-column grid — larger tap targets, mobile-friendly */}
        <div className="grid grid-cols-2 gap-2.5">

          {/* Κλήση */}
          {callPhone ? (
            <a
              href={buildCallHref(callPhone)}
              onClick={() => {
                const rec: CommunicationRecord = {
                  id: crypto.randomUUID(),
                  customerId: customer.id,
                  channel: 'call',
                  direction: 'outbound',
                  status: 'started',
                  phone: callPhone,
                  summary: 'Έναρξη κλήσης από καρτέλα πελάτη.',
                  createdAt: new Date().toISOString(),
                  isMock: true,
                };
                addCommunicationRecord(rec);
                setCustomerCommunications((prev) => [...prev, rec]);
              }}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-50 px-3 py-4 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 min-h-[72px]"
            >
              <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
              </svg>
              <span>Κλήση</span>
              <span className="text-[10px] font-normal text-indigo-500 text-center leading-tight">Ανοίγει συσκευή · όχι VoIP</span>
            </a>
          ) : (
            <DisabledAction label="Κλήση" note="Δεν υπάρχει τηλέφωνο" />
          )}

          {/* SMS */}
          {smsPhone ? (
            <a
              href={buildSmsHref(smsPhone)}
              onClick={() => {
                const rec: CommunicationRecord = {
                  id: crypto.randomUUID(),
                  customerId: customer.id,
                  channel: 'sms',
                  direction: 'outbound',
                  status: 'sent',
                  phone: smsPhone,
                  summary: 'Άνοιγμα SMS από καρτέλα πελάτη.',
                  createdAt: new Date().toISOString(),
                  isMock: true,
                };
                addCommunicationRecord(rec);
                setCustomerCommunications((prev) => [...prev, rec]);
              }}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-50 px-3 py-4 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 min-h-[72px]"
            >
              <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              <span>SMS</span>
              <span className="text-[10px] font-normal text-indigo-500 text-center leading-tight">Ανοίγει συσκευή · δεν αποστέλλεται αυτ.</span>
            </a>
          ) : (
            <DisabledAction
              label="SMS"
              note={hasLandlineOnly ? 'Δεν υπάρχει κινητό για SMS' : 'Δεν υπάρχει κινητό'}
            />
          )}

          {/* Tasks — scrolls to and opens full TaskForm for this customer */}
          <button
            type="button"
            onClick={handleQuickNewTask}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-50 px-3 py-4 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 min-h-[72px]"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>+ Νέο task</span>
            <span className="text-[10px] font-normal text-indigo-500 text-center leading-tight">Ανοίγει φόρμα παρακάτω</span>
          </button>

          {/* Προσφορά — scrolls to and opens full OfferForm for this customer */}
          <button
            type="button"
            onClick={handleQuickNewOffer}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-50 px-3 py-4 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 min-h-[72px]"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span>+ Προσφορά</span>
            <span className="text-[10px] font-normal text-indigo-500 text-center leading-tight">Ανοίγει φόρμα παρακάτω</span>
          </button>

          {/* Maps */}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-indigo-50 px-3 py-4 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 min-h-[72px]"
            >
              <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              <span>Maps</span>
              <span className="text-[10px] font-normal text-indigo-500 text-center leading-tight truncate max-w-full">{customer.address?.slice(0, 28)}</span>
            </a>
          ) : (
            <DisabledAction label="Maps" note="Δεν υπάρχει διεύθυνση" />
          )}

          {/* Email draft */}
          {customer.email ? (
            <button
              type="button"
              onClick={handleCopyEmailDraft}
              className={`flex flex-col items-center gap-1.5 rounded-2xl px-3 py-4 text-sm font-semibold ring-1 transition min-h-[72px] ${
                emailDraftCopied
                  ? 'bg-green-50 text-green-700 ring-green-200'
                  : 'bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100'
              }`}
            >
              <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <span>{emailDraftCopied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή email'}</span>
              <span className="text-[10px] font-normal text-center leading-tight opacity-70">Draft · δεν αποστέλλεται</span>
            </button>
          ) : (
            <DisabledAction label="Email draft" note="Δεν υπάρχει email" />
          )}
        </div>
      </div>

      {/*__DEAD_START__
        {quickTaskSuccess ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-green-50 px-4 py-3 ring-1 ring-green-200 text-center">
              <p className="text-sm font-semibold text-green-800">Το task δημιουργήθηκε για τον πελάτη.</p>
              <p className="mt-0.5 text-xs text-green-700">Εμφανίζεται παρακάτω στα Ανοιχτά tasks.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowQuickTaskSheet(false)}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Κλείσιμο
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Τίτλος task</label>
              <input
                type="text"
                value={quickTaskTitle}
                onChange={(e) => setQuickTaskTitle(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder={`Follow-up με ${customer.name}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Ημερομηνία</label>
              <input
                type="date"
                value={quickTaskDueDate}
                onChange={(e) => setQuickTaskDueDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Προτεραιότητα</label>
              <select
                value={quickTaskPriority}
                onChange={(e) => setQuickTaskPriority(e.target.value as 'high' | 'normal' | 'low')}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="high">Υψηλή</option>
                <option value="normal">Κανονική</option>
                <option value="low">Χαμηλή</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Σημείωση <span className="text-zinc-400 font-normal">(προαιρετικό)</span></label>
              <textarea
                value={quickTaskNote}
                onChange={(e) => setQuickTaskNote(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                placeholder="Τι πρέπει να γίνει..."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveQuickTask}
                disabled={!quickTaskTitle.trim() && !customer.name}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Αποθήκευση task
              </button>
              <button
                type="button"
                onClick={() => setShowQuickTaskSheet(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        )}
      </ActionSheet>

      offer sheet section also dead
      ActionSheet-removed
        open={showQuickOfferSheet}
        onClose={() => setShowQuickOfferSheet(false)}
        title={`Νέα προσφορά για ${customer.name}`}
        subtitle="Δημιουργία draft προσφοράς για αυτόν τον πελάτη"
      >
        {quickOfferSuccess ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-green-50 px-4 py-3 ring-1 ring-green-200 text-center">
              <p className="text-sm font-semibold text-green-800">Η προσφορά δημιουργήθηκε για τον πελάτη.</p>
              <p className="mt-0.5 text-xs text-green-700">Εμφανίζεται παρακάτω στις προσφορές.</p>
            </div>
            <div className="flex gap-2">
              {quickOfferNewId && (
                <Link
                  href={`/offers/${quickOfferNewId}`}
                  onClick={() => setShowQuickOfferSheet(false)}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Άνοιγμα προσφοράς →
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowQuickOfferSheet(false)}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Κλείσιμο
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Περιγραφή υπηρεσίας / προϊόντος</label>
              <input
                type="text"
                value={quickOfferDesc}
                onChange={(e) => setQuickOfferDesc(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="π.χ. Εγκατάσταση κλιματισμού"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Ποσότητα</label>
                <input
                  type="number"
                  value={quickOfferQty}
                  onChange={(e) => setQuickOfferQty(e.target.value)}
                  min="0.01"
                  step="0.01"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Τιμή μονάδας (€)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quickOfferPrice}
                  onChange={(e) => setQuickOfferPrice(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">ΦΠΑ (%)</label>
              <select
                value={quickOfferVat}
                onChange={(e) => setQuickOfferVat(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="24">24%</option>
                <option value="13">13%</option>
                <option value="6">6%</option>
                <option value="0">0%</option>
              </select>
            </div>
            {quickOfferPrice && (
              <div className="rounded-xl bg-zinc-50 px-4 py-2.5 ring-1 ring-zinc-200 text-xs text-zinc-600 space-y-1">
                {(() => {
                  const q = parseFloat(quickOfferQty) || 1;
                  const p = parseFloat(quickOfferPrice.replace(',', '.')) || 0;
                  const v = parseFloat(quickOfferVat) || 24;
                  const { subtotal, vatAmount, total } = calculateTotals([{ id: '', description: '', quantity: q, unitPrice: p }], v);
                  return (
                    <>
                      <div className="flex justify-between"><span>Υποσύνολο</span><span>{fmtEur(subtotal)}</span></div>
                      <div className="flex justify-between"><span>ΦΠΑ {v}%</span><span>{fmtEur(vatAmount)}</span></div>
                      <div className="flex justify-between font-semibold text-zinc-800 border-t border-zinc-200 pt-1"><span>Σύνολο</span><span>{fmtEur(total)}</span></div>
                    </>
                  );
                })()}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Σημειώσεις <span className="text-zinc-400 font-normal">(προαιρετικό)</span></label>
              <textarea
                value={quickOfferNotes}
                onChange={(e) => setQuickOfferNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                placeholder="Όροι, εξαιρέσεις..."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveQuickOffer}
                disabled={!quickOfferDesc.trim()}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Αποθήκευση προσφοράς
              </button>
              <button
                type="button"
                onClick={() => setShowQuickOfferSheet(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
      __DEAD_END__*/}

      {/* Contact info */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Στοιχεία επικοινωνίας
        </h2>
        {(customer.mobilePhone || (customer.phone && isLikelyMobile(customer.phone))) ? (
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
            </svg>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-xs text-zinc-400">Κιν.</span>
              <span className="min-w-0 flex-1 break-all text-sm text-zinc-800">{customer.mobilePhone || customer.phone}</span>
            </div>
          </div>
        ) : null}
        {(customer.landlinePhone || (customer.phone && !isLikelyMobile(customer.phone) && !customer.mobilePhone)) ? (
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
            </svg>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-xs text-zinc-400">Σταθ.</span>
              <span className="min-w-0 flex-1 break-all text-sm text-zinc-800">{customer.landlinePhone || customer.phone}</span>
            </div>
          </div>
        ) : null}
        {customer.email ? (
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
            <span className="min-w-0 flex-1 break-all text-sm text-zinc-800">{customer.email}</span>
          </div>
        ) : null}
        {customer.address ? (
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-sm text-zinc-800">{customer.address}</span>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  ↗ Maps
                </a>
              )}
            </div>
          </div>
        ) : null}
        {!customer.phone && !customer.mobilePhone && !customer.landlinePhone && !customer.email && !customer.address && (
          <p className="text-sm text-zinc-400">Δεν έχουν καταχωρηθεί στοιχεία επικοινωνίας.</p>
        )}
      </section>

      {/* Source + preferred contact */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Πηγή και επικοινωνία
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-zinc-700">
          <div>
            <span className="text-xs text-zinc-400">Πηγή</span>
            <p className="font-medium">{SOURCE_LABELS[customer.source] ?? customer.source}</p>
          </div>
          <div>
            <span className="text-xs text-zinc-400">Προτιμώμενη επικοινωνία</span>
            <p className="font-medium">
              {CONTACT_LABELS[customer.preferredContactMethod] ?? customer.preferredContactMethod}
            </p>
          </div>
          <div>
            <span className="text-xs text-zinc-400">Status</span>
            <p className="font-medium">{STATUS_LABELS[customer.status]}</p>
          </div>
        </div>
      </section>

      {/* Next best action placeholder */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Επόμενη ενέργεια
        </h2>
        <p className="text-sm text-zinc-400 italic">
          Η επόμενη ενέργεια δημιουργείται αυτόματα από το AI μετά από κλήση ή υπαγόρευση.
        </p>
      </section>

      {/* Appointments */}
      <section ref={appointmentsSectionRef} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Ραντεβού
          </h2>
          <Link href="/appointments" className="text-xs text-indigo-600 hover:text-indigo-700">
            Διαχείριση →
          </Link>
        </div>
        {appointmentTasks.length === 0 ? (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν ανοιχτά ραντεβού.</p>
        ) : (
          <ul className="space-y-2">
            {appointmentTasks.map((task) => {
              const eff = getEffectiveStatus(task);
              const isOverdue = eff === 'overdue';
              const isToday = eff === 'due_today';
              const note = task.note ?? '';
              const responseBadge: { label: string; className: string } = note.includes('Αποδοχή ραντεβού από πελάτη:')
                ? { label: 'Αποδεκτό', className: 'bg-green-100 text-green-700' }
                : note.includes('Αδυναμία παρουσίας πελάτη:')
                ? { label: 'Αδυναμία', className: 'bg-amber-100 text-amber-700' }
                : note.includes('Πρόταση αλλαγής από πελάτη:')
                ? { label: 'Εναλλακτική', className: 'bg-indigo-100 text-indigo-700' }
                : { label: 'Αναμονή', className: 'bg-zinc-100 text-zinc-500' };
              return (
                <li
                  key={task.id}
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm ${
                    isOverdue
                      ? 'bg-red-50 ring-1 ring-red-200'
                      : isToday
                      ? 'bg-amber-50 ring-1 ring-amber-200'
                      : 'bg-zinc-50 ring-1 ring-zinc-100'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${isOverdue ? 'text-red-900' : 'text-zinc-800'}`}>
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {task.dueDate}
                      {task.dueTime ? ` ${task.dueTime}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${responseBadge.className}`}>
                      {responseBadge.label}
                    </span>
                    {isOverdue && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Εκπρόθεσμο
                      </span>
                    )}
                    {isToday && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Σήμερα
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Open tasks */}
      <section ref={tasksSectionRef} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        {taskHighlight && (
          <div className="mb-3 rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
            <p className="text-xs font-semibold text-indigo-700">
              Άνοιξε φόρμα task για τον πελάτη — {customer.name}
            </p>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Ανοιχτά tasks
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={showTaskForm ? handleCancelNewTask : openNewTaskForm}
              className={`text-xs font-medium transition ${
                showTaskForm
                  ? 'text-zinc-400 hover:text-zinc-600'
                  : 'text-indigo-600 hover:text-indigo-700'
              }`}
            >
              {showTaskForm ? 'Ακύρωση' : '+ Νέο task'}
            </button>
            <Link href="/tasks" className="text-xs text-indigo-600 hover:text-indigo-700">
              Διαχείριση →
            </Link>
          </div>
        </div>
        {showTaskForm && newTaskInitial && (
          <div className="mb-4">
            <TaskForm
              initial={newTaskInitial}
              customers={customer ? [customer] : []}
              onSave={handleSaveNewTask}
              onCancel={handleCancelNewTask}
            />
          </div>
        )}
        {lastCompletedTask && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-green-50 px-3 py-2 ring-1 ring-green-200">
            <p className="min-w-0 truncate text-xs text-green-700">
              Ολοκληρώθηκε: <span className="font-medium">{lastCompletedTask.title}</span>
            </p>
            <button
              type="button"
              onClick={handleUndoCompleteTask}
              className="shrink-0 rounded-lg border border-green-200 bg-white px-2.5 py-1 text-xs font-medium text-green-700 transition hover:bg-green-50"
            >
              Αναίρεση
            </button>
          </div>
        )}
        {internalTasks.length === 0 ? (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν ανοιχτά tasks.</p>
        ) : (
          <ul className="space-y-2">
            {internalTasks.map((task) => {
              const eff = getEffectiveStatus(task);
              const isOverdue = eff === 'overdue';
              const isToday = eff === 'due_today';
              return (
                <li
                  key={task.id}
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm ${
                    isOverdue
                      ? 'bg-red-50 ring-1 ring-red-200'
                      : isToday
                      ? 'bg-amber-50 ring-1 ring-amber-200'
                      : 'bg-zinc-50 ring-1 ring-zinc-100'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${isOverdue ? 'text-red-900' : 'text-zinc-800'}`}>
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {TASK_TYPE_LABELS[task.type]} · {task.dueDate}
                      {task.dueTime ? ` ${task.dueTime}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isOverdue && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Εκπρόθεσμο
                      </span>
                    )}
                    {isToday && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Σήμερα
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCompleteTask(task.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                    >
                      <svg className="h-3 w-3" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      Ολοκλήρωση
                    </button>
                    <Link
                      href={`/tasks?taskId=${task.id}`}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      Άνοιγμα task
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Offers & files */}
      <section ref={offersSectionRef} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        {offerHighlight && (
          <div className="mb-3 rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
            <p className="text-xs font-semibold text-indigo-700">
              Άνοιξε φόρμα προσφοράς για τον πελάτη — {customer.name}
            </p>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Προσφορές &amp; αρχεία πελάτη
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={showOfferForm ? handleCancelOfferForm : openOfferForm}
              className={`text-xs font-medium transition ${
                showOfferForm
                  ? 'text-zinc-400 hover:text-zinc-600'
                  : 'text-indigo-600 hover:text-indigo-700'
              }`}
            >
              {showOfferForm ? 'Ακύρωση' : '+ Νέα προσφορά'}
            </button>
            <Link href="/offers" className="text-xs text-indigo-600 hover:text-indigo-700">
              Διαχείριση →
            </Link>
          </div>
        </div>
        {showOfferForm && offerFormInitial && customer && (
          <div className="mb-4">
            <OfferForm
              initial={offerFormInitial}
              customers={[customer]}
              nextOfferNumber={offerFormNumber}
              onSave={handleSaveNewOffer}
              onCancel={handleCancelOfferForm}
            />
          </div>
        )}

        {/* Offer list */}
        {customerOffers.length === 0 ? (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν προσφορές.</p>
        ) : (
          <ul className="space-y-2">
            {customerOffers.map((offer) => (
              <li key={offer.id}>
                <Link
                  href={`/offers/${offer.id}`}
                  className="flex items-start justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm transition hover:bg-zinc-100 ring-1 ring-zinc-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-zinc-800">{offer.offerNumber}</span>
                      <span className="font-semibold text-zinc-700">{fmtEur(offer.total)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Ισχύει μέχρι {offer.validUntil}
                    </p>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <OfferStatusBadge status={offer.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Files subsection */}
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Αρχεία πελάτη
          </p>

          {/* Offer PDF file rows */}
          {customerOffers.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {customerOffers.map((offer) => (
                <li key={offer.id}>
                  <Link
                    href={`/offers/${offer.id}`}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-zinc-50 ring-1 ring-zinc-100"
                  >
                    {/* PDF icon */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 ring-1 ring-red-100">
                      <svg className="h-4 w-4 text-red-500" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800">
                        Προσφορά {offer.offerNumber}
                      </p>
                      <p className="text-xs text-zinc-400">PDF / Προσφορά</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <OfferStatusBadge status={offer.status} />
                      <span className="text-xs text-indigo-600">Άνοιγμα</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Local media files (IndexedDB) */}
          <CustomerFilesSection customerId={customerId} />
        </div>
      </section>

      {/* Call briefs */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Περιλήψεις συνομιλιών
          </h2>
          <div className="flex items-center gap-3">
            {!showBriefForm && (
              <button
                type="button"
                onClick={showAiDemoPanel ? handleCancelAiDemo : openAiDemoPanel}
                className="text-xs font-medium text-zinc-500 transition hover:text-zinc-700"
              >
                {showAiDemoPanel ? 'Ακύρωση' : 'Demo AI brief'}
              </button>
            )}
            {!showAiDemoPanel && (
              <button
                type="button"
                onClick={showBriefForm ? handleCancelBriefForm : openBriefForm}
                className={`text-xs font-medium transition ${
                  showBriefForm
                    ? 'text-zinc-400 hover:text-zinc-600'
                    : 'text-indigo-600 hover:text-indigo-700'
                }`}
              >
                {showBriefForm ? 'Ακύρωση' : '+ Νέο brief'}
              </button>
            )}
          </div>
        </div>

        {showAiDemoPanel && (
          <div className="mb-4 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-100 space-y-3">
            <div>
              <p className="text-xs font-semibold text-indigo-700">Demo AI brief από transcription</p>
              <p className="mt-0.5 text-xs text-indigo-400">
                Demo χωρίς πραγματικό transcription. Στο cloud θα δημιουργείται αυτόματα από την κλήση.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Transcription κλήσης
              </label>
              <textarea
                rows={4}
                value={aiTranscriptionText}
                onChange={(e) => setAiTranscriptionText(e.target.value)}
                className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelAiDemo}
                className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                Ακύρωση
              </button>
              <button
                type="button"
                onClick={handleGenerateBrief}
                disabled={!aiTranscriptionText.trim()}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Δημιουργία brief
              </button>
            </div>
          </div>
        )}

        {showBriefForm && (
          <div className="mb-4 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-100 space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Τι συζητήθηκε; *
              </label>
              <textarea
                rows={3}
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder="Περίληψη κλήσης ή συνομιλίας..."
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Επόμενο βήμα{' '}
                <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
              </label>
              <input
                type="text"
                value={briefNextStep}
                onChange={(e) => setBriefNextStep(e.target.value)}
                placeholder="π.χ. Αποστολή προσφοράς εντός 2 ημερών"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={briefCreateFollowUp}
                onChange={(e) => setBriefCreateFollowUp(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
              />
              <span className="text-sm text-zinc-700">Δημιουργία task follow-up (αύριο)</span>
            </label>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleCancelBriefForm}
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
              >
                Ακύρωση
              </button>
              <button
                type="button"
                onClick={handleSaveBrief}
                disabled={!briefText.trim()}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Αποθήκευση
              </button>
            </div>
          </div>
        )}

        {callBriefs.length === 0 && !showBriefForm ? (
          <p className="text-sm text-zinc-400 italic">
            Εμφανίζονται μετά από κλήση ή υπαγόρευση.
          </p>
        ) : (
          <ul className="space-y-3">
            {callBriefs.map((rec) => (
              <li key={rec.id} className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-100 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-500">
                    {new Date(rec.createdAt).toLocaleDateString('el-GR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <p className="text-sm text-zinc-800 whitespace-pre-wrap">{rec.summary}</p>
                {rec.nextStep && (
                  <p className="text-xs text-indigo-700">
                    <span className="font-medium">Επόμενο βήμα:</span> {rec.nextStep}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity timeline */}
      <CustomerTimeline
        customerId={customerId}
        tasks={customerTasks}
        offers={customerOffers}
        calls={customerCalls}
        communications={customerCommunications}
      />

      {/* Notes */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Σημειώσεις
        </h2>
        {customer.notes ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-700">{customer.notes}</p>
        ) : (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν σημειώσεις.</p>
        )}
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-3 text-xs text-indigo-600 hover:text-indigo-700"
        >
          Επεξεργασία σημειώσεων
        </button>
      </section>

      {/* Delete */}
      <section className="rounded-2xl border border-red-100 bg-red-50 p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400">
          Ζώνη κινδύνου
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Η διαγραφή πελάτη αφαιρεί μόνο τα τοπικά δεδομένα.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
        >
          Διαγραφή πελάτη
        </button>
      </section>
    </div>
  );
}
