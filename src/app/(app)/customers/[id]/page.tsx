'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import OfferForm from '@/components/offers/OfferForm';
import type { Offer, Customer } from '@/lib/types';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

interface CustomerDto {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  needsSummary: string | null;
  notes: string | null;
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommunicationDto {
  id: string;
  customerId: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  createdAt: string;
}

interface TaskDto {
  id: string;
  customerId: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  createdFromAi: boolean;
  sourceBriefId?: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerDraft {
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  source: string | null;
  preferredContactMethod: string;
  needsSummary: string | null;
  notes: string | null;
}

interface OfferDto {
  id: string;
  customerId: string | null;
  offerNumber: string;
  status: string;
  offerDate: string | null;
  validUntil: string | null;
  total: number;
  notes: string | null;
  createdFromAi: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  website_form: 'Φόρμα ιστοσελίδας',
  referral: 'Σύσταση',
  inbound_call: 'Εισερχόμενη κλήση',
  missed_call: 'Χαμένη κλήση',
  manual_entry: 'Χειροκίνητη εισαγωγή',
  other: 'Άλλο',
};

const STATUS_LABELS: Record<string, string> = {
  new_lead: 'Νέος',
  contacted: 'Επικοινωνία',
  follow_up_needed: 'Follow-up',
  offer_drafted: 'Προσφορά (draft)',
  offer_sent: 'Προσφορά εστάλη',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

const INTAKE_LABELS: Record<string, string> = {
  none: '',
  pending: 'Εκκρεμεί',
  sent: 'Viber εστάλη',
  opened: 'Άνοιξε link',
  submitted: 'Υπέβαλε στοιχεία',
  completed: 'Ολοκληρώθηκε',
  expired: 'Έληξε',
  revoked: 'Ανακλήθηκε',
};

const CONTACT_LABELS: Record<string, string> = {
  phone: 'Τηλέφωνο',
  email: 'Email',
  viber: 'Viber',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  call_back: 'Κλήση',
  send_offer: 'Αποστολή προσφοράς',
  follow_up_offer: 'Follow-up προσφοράς',
  ask_for_photos_documents: 'Έγγραφα/φωτογραφίες',
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
  wait_for_reply: 'Αναμονή απάντησης',
  other: 'Άλλο',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  ai_draft: 'AI draft',
  open: 'Ανοιχτό',
  completed: 'Ολοκληρωμένο',
  cancelled: 'Ακυρωμένο',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'Υψηλή',
  normal: 'Κανονική',
  low: 'Χαμηλή',
};

const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ready_to_send: 'Έτοιμη για αποστολή',
  sent_manually: 'Στάλθηκε χειροκίνητα',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function customerTitle(c: CustomerDto): string {
  return c.name ?? c.companyName ?? c.crmNumber ?? 'Νέος πελάτης';
}

function formatDateFull(value: string | null): string {
  if (!value) return 'Άγνωστη ημερομηνία';
  try {
    return new Date(value).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatDateShort(value: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '...';
}

function statusBadgeClass(status: string): string {
  if (status === 'won') return 'bg-green-100 text-green-700';
  if (status === 'lost') return 'bg-red-100 text-red-600';
  if (status === 'new_lead') return 'bg-blue-50 text-blue-700';
  if (status === 'contacted') return 'bg-emerald-100 text-emerald-700';
  if (status === 'follow_up_needed') return 'bg-amber-100 text-amber-700';
  if (status === 'offer_drafted') return 'bg-purple-100 text-purple-700';
  if (status === 'offer_sent') return 'bg-blue-100 text-blue-700';
  return 'bg-indigo-50 text-indigo-700';
}

function taskStatusClass(status: string): string {
  if (status === 'ai_draft') return 'bg-amber-100 text-amber-700';
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'cancelled') return 'bg-zinc-100 text-zinc-500';
  return 'bg-indigo-50 text-indigo-700';
}

function offerStatusBadgeClass(status: string): string {
  if (status === 'accepted') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-600';
  if (status === 'ready_to_send') return 'bg-indigo-100 text-indigo-700';
  if (status === 'sent_manually' || status === 'sent_provider') return 'bg-blue-100 text-blue-700';
  if (status === 'expired' || status === 'cancelled') return 'bg-zinc-100 text-zinc-500';
  return 'bg-amber-100 text-amber-700';
}

function taskToneDot(status: string, priority: string): string {
  if (status === 'ai_draft') return 'bg-amber-500';
  if (status === 'completed') return 'bg-green-400';
  if (status === 'cancelled') return 'bg-zinc-300';
  if (priority === 'high') return 'bg-red-500';
  return 'bg-indigo-500';
}

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

function appointmentStatusLabel(task: TaskDto): string {
  if (task.status === 'completed') return 'Ολοκληρωμένο';
  if (task.status === 'cancelled') return 'Ακυρωμένο';
  if (task.status === 'ai_draft') return 'AI draft';
  return 'Ανοιχτό';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'no_session' | 'error' | 'loaded';

type TimelineItem =
  | { kind: 'comm'; item: CommunicationDto; date: string }
  | { kind: 'task'; item: TaskDto; date: string };

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const searchParams = useSearchParams();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => searchParams.get('focusTask'));
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [communications, setCommunications] = useState<CommunicationDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [offers, setOffers] = useState<OfferDto[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft | null>(null);
  const [customerSaveState, setCustomerSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customerSaveError, setCustomerSaveError] = useState<string | null>(null);

  const [isRejectPanelOpen, setIsRejectPanelOpen] = useState(false);
  const [rejectDraftText, setRejectDraftText] = useState('');
  const [rejectSaveState, setRejectSaveState] = useState<'idle' | 'copying' | 'saving' | 'saved' | 'error'>('idle');
  const [rejectSaveError, setRejectSaveError] = useState<string | null>(null);
  const [rejectCopyMessage, setRejectCopyMessage] = useState<string | null>(null);

  type QuickModal = 'message' | 'file' | 'task' | 'appointment' | 'offer' | null;
  const [quickModal, setQuickModal] = useState<QuickModal>(null);
  const [msgDraft, setMsgDraft] = useState('');
  const [msgCopied, setMsgCopied] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [apptTitle, setApptTitle] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [apptNote, setApptNote] = useState('');
  const [apptSaving, setApptSaving] = useState(false);
  const [apptError, setApptError] = useState<string | null>(null);

  const [offerSaveError, setOfferSaveError] = useState<string | null>(null);

  const [selectedCall, setSelectedCall] = useState<CommunicationDto | null>(null);

  const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDate, setEditTaskDate] = useState('');
  const [editTaskTime, setEditTaskTime] = useState('');
  const [editTaskNote, setEditTaskNote] = useState('');
  const [editTaskSaving, setEditTaskSaving] = useState(false);
  const [editTaskError, setEditTaskError] = useState<string | null>(null);

  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [editingOfferLoading, setEditingOfferLoading] = useState<string | null>(null);
  const [editOfferError, setEditOfferError] = useState<string | null>(null);

  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);

  // Response link generation state for customer workspace offer rows.
  const [offerLinkGeneratingId, setOfferLinkGeneratingId] = useState<string | null>(null);
  const [offerLinkCopiedId, setOfferLinkCopiedId] = useState<string | null>(null);
  const [offerLinkManualCopyOfferId, setOfferLinkManualCopyOfferId] = useState<string | null>(null);
  const [offerLinkManualCopyUrl, setOfferLinkManualCopyUrl] = useState('');
  const [offerLinkErrorId, setOfferLinkErrorId] = useState<string | null>(null);
  const [offerLinkErrorMsg, setOfferLinkErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPageState('loading');

      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) setPageState('error');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setPageState('no_session');
        return;
      }

      const headers = { Authorization: `Bearer ${session.access_token}` };

      try {
        const [customerRes, commRes, tasksRes, offersRes] = await Promise.all([
          fetch(`/api/customers/${customerId}`, { headers }),
          fetch(`/api/communications?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
          fetch(`/api/tasks?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
          fetch(`/api/offers?customerId=${encodeURIComponent(customerId)}&limit=20`, { headers }),
        ]);

        const customerJson = await customerRes.json() as {
          ok?: boolean; customer?: CustomerDto; error?: string;
        };
        const commJson = await commRes.json() as {
          ok?: boolean; communications?: CommunicationDto[]; error?: string;
        };
        const tasksJson = await tasksRes.json() as {
          ok?: boolean; tasks?: TaskDto[]; error?: string;
        };
        const offersJson = await offersRes.json() as {
          ok?: boolean; offers?: OfferDto[]; error?: string;
        };

        if (cancelled) return;

        if (!customerJson.ok || !customerJson.customer) {
          setPageState('error');
          return;
        }

        setCustomer(customerJson.customer);
        setCommunications(commJson.ok ? (commJson.communications ?? []) : []);
        setTasks(tasksJson.ok ? (tasksJson.tasks ?? []) : []);
        setOffers(offersJson.ok ? (offersJson.offers ?? []) : []);
        setPageState('loaded');
      } catch {
        if (!cancelled) setPageState('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, [customerId, refreshTick]);

  // Scroll to focused task after data loads.
  useEffect(() => {
    if (pageState !== 'loaded' || !focusTaskId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`task-${focusTaskId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [pageState, focusTaskId]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const draftTask = useMemo(
    () => tasks.find(t => t.status === 'ai_draft') ?? null,
    [tasks]
  );

  const openTasks = useMemo(
    () => tasks.filter(t => t.status === 'open'),
    [tasks]
  );

  const callComms = useMemo(
    () =>
      [...communications]
        .filter(c => c.channel === 'call')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [communications]
  );

  const latestCallWithBrief = useMemo(
    () => callComms.find(c => c.summary && c.summary.trim().length > 0) ?? null,
    [callComms]
  );

  const timeline = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [
      ...communications.map(c => ({ kind: 'comm' as const, item: c, date: c.createdAt })),
      ...tasks.map(t => ({ kind: 'task' as const, item: t, date: t.createdAt })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [communications, tasks]);

  const sortedTasks = useMemo(() =>
    [...tasks].sort((a, b) => {
      if (a.status === 'ai_draft' && b.status !== 'ai_draft') return -1;
      if (b.status === 'ai_draft' && a.status !== 'ai_draft') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    }),
    [tasks]
  );

  const sortedOffers = useMemo(() =>
    [...offers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [offers]
  );

  const appointmentTasks = useMemo(() =>
    tasks
      .filter(t => t.type === 'book_appointment' || t.type === 'visit_customer')
      .sort((a, b) => {
        const dateCmp = a.dueDate.localeCompare(b.dueDate);
        if (dateCmp !== 0) return dateCmp;
        return (a.dueTime ?? '').localeCompare(b.dueTime ?? '');
      }),
    [tasks]
  );

  const pendingOffer = useMemo(
    () => sortedOffers.find(o =>
      ['draft', 'ready_to_send', 'sent_manually', 'sent_provider'].includes(o.status)
    ) ?? null,
    [sortedOffers]
  );

  const openAppointment = useMemo(
    () => appointmentTasks.find(t => t.status === 'open') ?? null,
    [appointmentTasks]
  );

  // ---------------------------------------------------------------------------
  // Customer edit helpers
  // ---------------------------------------------------------------------------

  function startEditCustomer() {
    if (!customer) return;
    setCustomerDraft({
      name: customer.name,
      companyName: customer.companyName,
      phone: customer.phone,
      mobilePhone: customer.mobilePhone,
      landlinePhone: customer.landlinePhone,
      email: customer.email,
      address: customer.address,
      status: customer.status,
      source: customer.source,
      preferredContactMethod: customer.preferredContactMethod,
      needsSummary: customer.needsSummary,
      notes: customer.notes,
    });
    setIsEditingCustomer(true);
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  function cancelEditCustomer() {
    setIsEditingCustomer(false);
    setCustomerDraft(null);
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  async function saveCustomerDraft() {
    if (!customerDraft) return;
    setCustomerSaveState('saving');
    setCustomerSaveError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setCustomerSaveState('error');
        setCustomerSaveError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(customerDraft),
      });
      const json = await res.json() as { ok?: boolean; customer?: CustomerDto; error?: string };
      if (res.ok && json.ok && json.customer) {
        setCustomer(json.customer);
        setCustomerSaveState('saved');
        setIsEditingCustomer(false);
        setCustomerDraft(null);
        setTimeout(() => setCustomerSaveState('idle'), 2500);
      } else {
        setCustomerSaveState('error');
        setCustomerSaveError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
      }
    } catch {
      setCustomerSaveState('error');
      setCustomerSaveError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Reject client helpers
  // ---------------------------------------------------------------------------

  function buildDefaultRejectMessage(): string {
    return 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';
  }

  function startRejectClient() {
    setRejectDraftText(buildDefaultRejectMessage());
    setIsRejectPanelOpen(true);
    setRejectSaveError(null);
    setRejectCopyMessage(null);
    setRejectSaveState('idle');
  }

  function cancelRejectClient() {
    setIsRejectPanelOpen(false);
    setRejectSaveError(null);
    setRejectCopyMessage(null);
    setRejectSaveState('idle');
  }

  async function copyRejectDraft() {
    setRejectSaveState('copying');
    try {
      await navigator.clipboard.writeText(rejectDraftText);
      setRejectCopyMessage('Το κείμενο αντιγράφηκε. Αποστολή χειροκίνητα.');
    } catch {
      setRejectCopyMessage('Δεν έγινε αντιγραφή. Μπορείς να το επιλέξεις χειροκίνητα.');
    } finally {
      setRejectSaveState('idle');
    }
  }

  async function saveRejectWithoutSending() {
    setRejectSaveState('saving');
    setRejectSaveError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setRejectSaveState('error');
        setRejectSaveError('Δεν αποθηκεύτηκε η απόρριψη. Δοκίμασε ξανά.');
        return;
      }
      const existingNotes = customer?.notes ?? '';
      const appendNote = `Απόρριψη πελάτη, draft χωρίς αποστολή:\n${rejectDraftText}`;
      const updatedNotes = existingNotes ? `${existingNotes}\n\n${appendNote}` : appendNote;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: 'lost', notes: updatedNotes }),
      });
      const json = await res.json() as { ok?: boolean; customer?: CustomerDto; error?: string };
      if (res.ok && json.ok && json.customer) {
        setCustomer(json.customer);
        setRejectSaveState('saved');
        setRejectCopyMessage('Αποθηκεύτηκε ως χαμένος πελάτης. Δεν έχει σταλεί μήνυμα.');
      } else {
        setRejectSaveState('error');
        setRejectSaveError('Δεν αποθηκεύτηκε η απόρριψη. Δοκίμασε ξανά.');
      }
    } catch {
      setRejectSaveState('error');
      setRejectSaveError('Δεν αποθηκεύτηκε η απόρριψη. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Quick modal helpers
  // ---------------------------------------------------------------------------

  function closeQuickModal() {
    setQuickModal(null);
    setMsgDraft('');
    setMsgCopied(false);
    setTaskTitle('');
    setTaskDate('');
    setTaskNote('');
    setTaskSaving(false);
    setTaskError(null);
    setApptTitle('');
    setApptDate('');
    setApptTime('');
    setApptNote('');
    setApptSaving(false);
    setApptError(null);
    setOfferSaveError(null);
  }

  function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function saveAppointmentFromModal() {
    if (!apptTitle.trim()) {
      setApptError('Συμπλήρωσε τίτλο ραντεβού.');
      return;
    }
    if (!apptDate) {
      setApptError('Συμπλήρωσε ημερομηνία.');
      return;
    }
    if (!apptTime) {
      setApptError('Συμπλήρωσε ώρα.');
      return;
    }
    setApptSaving(true);
    setApptError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setApptSaving(false);
        setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customerId,
          title: apptTitle.trim(),
          type: 'book_appointment',
          status: 'open',
          priority: 'normal',
          dueDate: apptDate,
          dueTime: apptTime,
          note: apptNote.trim() || null,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        closeQuickModal();
        setRefreshTick(t => t + 1);
      } else {
        setApptSaving(false);
        setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
      }
    } catch {
      setApptSaving(false);
      setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
    }
  }

  async function saveOfferFromCustomerForm(offer: Offer) {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
        return;
      }
      const body: Record<string, unknown> = {
        status: 'draft',
        customerId,
        offerDate: offer.offerDate,
        validUntil: offer.validUntil || null,
        vatRate: offer.vatRate,
        items: offer.items.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          sortOrder: idx,
        })),
        notes: offer.notes,
        terms: offer.terms,
        acceptanceText: offer.acceptanceText,
        createdFromAi: offer.createdFromAi,
      };
      if (offer.offerNumber.trim()) {
        body.offerNumber = offer.offerNumber.trim();
      }
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        closeQuickModal();
        setRefreshTick(t => t + 1);
      } else {
        setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
      }
    } catch {
      setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
    }
  }

  async function copyMsgDraft() {
    try {
      await navigator.clipboard.writeText(msgDraft);
      setMsgCopied(true);
    } catch {
      setMsgCopied(false);
    }
  }

  async function saveTaskFromModal() {
    if (!taskTitle.trim()) {
      setTaskError('Συμπλήρωσε τίτλο task.');
      return;
    }
    setTaskSaving(true);
    setTaskError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTaskSaving(false);
        setTaskError('Δεν αποθηκεύτηκε το task. Δοκίμασε ξανά.');
        return;
      }
      const dueDate = taskDate || getLocalDateInputValue();
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customerId,
          title: taskTitle.trim(),
          type: 'other',
          status: 'open',
          priority: 'normal',
          dueDate,
          note: taskNote.trim() || null,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        closeQuickModal();
        setRefreshTick(t => t + 1);
      } else {
        setTaskSaving(false);
        setTaskError('Δεν αποθηκεύτηκε το task. Δοκίμασε ξανά.');
      }
    } catch {
      setTaskSaving(false);
      setTaskError('Δεν αποθηκεύτηκε το task. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Edit task/appointment helpers
  // ---------------------------------------------------------------------------

  function openEditTask(task: TaskDto) {
    setEditingTask(task);
    setEditTaskTitle(task.title);
    setEditTaskDate(task.dueDate);
    setEditTaskTime(task.dueTime ?? '');
    setEditTaskNote(task.note ?? '');
    setEditTaskError(null);
    setEditTaskSaving(false);
  }

  function closeEditTask() {
    setEditingTask(null);
    setEditTaskTitle('');
    setEditTaskDate('');
    setEditTaskTime('');
    setEditTaskNote('');
    setEditTaskError(null);
    setEditTaskSaving(false);
  }

  async function saveEditedTask() {
    if (!editingTask) return;
    if (!editTaskTitle.trim()) {
      setEditTaskError('Συμπλήρωσε τίτλο.');
      return;
    }
    if (!editTaskDate) {
      setEditTaskError('Συμπλήρωσε ημερομηνία.');
      return;
    }
    setEditTaskSaving(true);
    setEditTaskError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEditTaskSaving(false);
        setEditTaskError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          dueDate: editTaskDate,
          dueTime: editTaskTime.trim() || null,
          note: editTaskNote.trim() || null,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        closeEditTask();
        setRefreshTick(t => t + 1);
      } else {
        setEditTaskSaving(false);
        setEditTaskError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
      }
    } catch {
      setEditTaskSaving(false);
      setEditTaskError('Δεν αποθηκεύτηκαν οι αλλαγές. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Message copy helper
  // ---------------------------------------------------------------------------

  async function copyMessage(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageKey(key);
    } catch {
      setCopiedMessageKey(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Edit offer helpers
  // ---------------------------------------------------------------------------

  async function openEditOffer(offerId: string) {
    setEditingOfferLoading(offerId);
    setEditOfferError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEditingOfferLoading(null);
        setEditOfferError('Δεν φορτώθηκε η προσφορά. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/offers/${offerId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json() as { ok?: boolean; offer?: Offer; error?: string };
      if (res.ok && json.ok && json.offer) {
        setEditingOffer(json.offer);
        setEditingOfferLoading(null);
      } else {
        setEditingOfferLoading(null);
        setEditOfferError('Δεν φορτώθηκε η προσφορά. Δοκίμασε ξανά.');
      }
    } catch {
      setEditingOfferLoading(null);
      setEditOfferError('Δεν φορτώθηκε η προσφορά. Δοκίμασε ξανά.');
    }
  }

  function closeEditOffer() {
    setEditingOffer(null);
    setEditingOfferLoading(null);
    setEditOfferError(null);
  }

  async function saveEditedOffer(offer: Offer) {
    if (!editingOffer) return;
    setEditOfferError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEditOfferError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/offers/${editingOffer.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          offerNumber: offer.offerNumber,
          status: offer.status,
          customerId,
          offerDate: offer.offerDate,
          validUntil: offer.validUntil || null,
          vatRate: offer.vatRate,
          items: offer.items.map((item, idx) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            sortOrder: idx,
          })),
          notes: offer.notes,
          terms: offer.terms,
          acceptanceText: offer.acceptanceText,
          createdFromAi: offer.createdFromAi,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        closeEditOffer();
        setRefreshTick(t => t + 1);
      } else {
        setEditOfferError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
      }
    } catch {
      setEditOfferError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Generate response link (customer workspace offer rows)
  // ---------------------------------------------------------------------------

  async function generateResponseLink(offerId: string) {
    setOfferLinkGeneratingId(offerId);
    setOfferLinkCopiedId(null);
    setOfferLinkManualCopyOfferId(null);
    setOfferLinkManualCopyUrl('');
    setOfferLinkErrorId(null);
    setOfferLinkErrorMsg('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setOfferLinkGeneratingId(null);
        setOfferLinkErrorId(offerId);
        setOfferLinkErrorMsg('Δεν βρέθηκε σύνδεση. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/offers/${offerId}/response-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json() as { ok?: boolean; responseUrl?: string; error?: string };
      setOfferLinkGeneratingId(null);
      if (!res.ok || !json.ok || !json.responseUrl) {
        setOfferLinkErrorId(offerId);
        setOfferLinkErrorMsg('Αποτυχία δημιουργίας link. Δοκίμασε ξανά.');
        return;
      }
      const url = json.responseUrl;
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url);
          setOfferLinkCopiedId(offerId);
          setTimeout(() => setOfferLinkCopiedId(null), 2500);
        } catch {
          setOfferLinkManualCopyOfferId(offerId);
          setOfferLinkManualCopyUrl(url);
        }
      } else {
        setOfferLinkManualCopyOfferId(offerId);
        setOfferLinkManualCopyUrl(url);
      }
    } catch {
      setOfferLinkGeneratingId(null);
      setOfferLinkErrorId(offerId);
      setOfferLinkErrorMsg('Αποτυχία δημιουργίας link. Δοκίμασε ξανά.');
    }
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (pageState === 'loading') {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:max-w-4xl">
        <p className="text-center text-sm text-zinc-400">Φόρτωση καρτέλας πελάτη...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------
  if (pageState === 'no_session') {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:max-w-4xl">
        <div className="rounded-2xl bg-zinc-50 px-6 py-10 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-600">
            Συνδέσου για να δεις την καρτέλα πελάτη.
          </p>
          <Link
            href="/login/backend"
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------
  if (pageState === 'error' || !customer) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:max-w-4xl">
        <div className="rounded-2xl bg-red-50 px-6 py-8 text-center ring-1 ring-red-100">
          <p className="text-sm font-medium text-red-700">
            Αδυναμία φόρτωσης καρτέλας. Έλεγξε τη σύνδεση ή ανανέωσε.
          </p>
          <button
            type="button"
            onClick={() => setRefreshTick(t => t + 1)}
            className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loaded: full CRM detail
  // ---------------------------------------------------------------------------
  const intakeLabel = INTAKE_LABELS[customer.intakeStatus] ?? '';

  const currentCustomerForOfferForm: Customer = {
    id: customer.id,
    name: customer.name ?? customer.companyName ?? '',
    companyName: customer.companyName ?? '',
    phone: customer.phone ?? customer.mobilePhone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    source: (customer.source ?? 'other') as Customer['source'],
    status: customer.status as Customer['status'],
    preferredContactMethod: customer.preferredContactMethod as Customer['preferredContactMethod'],
    needsSummary: customer.needsSummary ?? '',
    notes: customer.notes ?? '',
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };

  const msgPhoneText = 'Γεια σας, επικοινωνώ σχετικά με το αίτημά σας.';
  const msgEmailText = 'Καλημέρα σας, σας επικοινωνώ σχετικά με το αίτημά σας.';
  const prefCh = customer.preferredContactMethod;
  const messageDrafts: Array<{ key: string; channelLabel: string; draftText: string }> = [
    {
      key: `pref-${prefCh}`,
      channelLabel: CONTACT_LABELS[prefCh] ?? prefCh,
      draftText: prefCh === 'email' ? msgEmailText : msgPhoneText,
    },
  ];
  if ((customer.phone || customer.mobilePhone) && prefCh !== 'phone' && prefCh !== 'viber') {
    messageDrafts.push({ key: 'phone', channelLabel: 'Viber / SMS', draftText: msgPhoneText });
  }
  if (customer.email && prefCh !== 'email') {
    messageDrafts.push({ key: 'email', channelLabel: 'Email', draftText: msgEmailText });
  }

  return (
    <div className="mx-auto w-full max-w-2xl md:max-w-4xl space-y-5 px-4 py-5">

      {/* Back nav */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/customers"
          className="font-medium text-zinc-400 transition hover:text-zinc-700"
        >
          Πελάτες
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="text-zinc-500">{customer.crmNumber ?? customerTitle(customer)}</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-zinc-900 leading-tight">
            {customerTitle(customer)}
          </h1>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={startRejectClient}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              Απόρριψη πελάτη
            </button>
            <button
              type="button"
              onClick={() => setRefreshTick(t => t + 1)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Ανανέωση
            </button>
          </div>
        </div>
        {customer.companyName && customer.name && (
          <p className="mt-0.5 text-sm text-zinc-500">{customer.companyName}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {customer.source && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {SOURCE_LABELS[customer.source] ?? customer.source}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(customer.status)}`}>
            {STATUS_LABELS[customer.status] ?? customer.status}
          </span>
          {intakeLabel && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              customer.intakeStatus === 'submitted' || customer.intakeStatus === 'completed'
                ? 'bg-green-50 text-green-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {intakeLabel}
            </span>
          )}
          {customer.preferredContactMethod && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
              {CONTACT_LABELS[customer.preferredContactMethod] ?? customer.preferredContactMethod}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-400">Κέντρο εργασίας πελάτη</p>
      </div>

      {/* Reject panel */}
      {isRejectPanelOpen && (
        <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200 space-y-3">
          <div>
            <p className="text-sm font-semibold text-red-800">Απόρριψη πελάτη</p>
            <p className="mt-0.5 text-xs text-red-600">Review-first draft. Δεν αποστέλλεται μήνυμα χωρίς χειροκίνητη ενέργεια.</p>
          </div>
          <textarea
            rows={5}
            value={rejectDraftText}
            onChange={e => setRejectDraftText(e.target.value)}
            className="w-full resize-none rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
          {rejectCopyMessage && (
            <p className="text-xs text-zinc-600">{rejectCopyMessage}</p>
          )}
          {rejectSaveError && (
            <p className="text-xs font-medium text-red-700">{rejectSaveError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyRejectDraft}
              disabled={rejectSaveState === 'saving' || rejectSaveState === 'copying'}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              Αντιγραφή
            </button>
            <button
              type="button"
              onClick={saveRejectWithoutSending}
              disabled={rejectSaveState === 'saving' || rejectSaveState === 'copying' || rejectSaveState === 'saved'}
              className="rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
            >
              {rejectSaveState === 'saving' ? 'Αποθήκευση...' : 'Αποθήκευση χωρίς αποστολή'}
            </button>
            <button
              type="button"
              onClick={cancelRejectClient}
              disabled={rejectSaveState === 'saving'}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              Ακύρωση
            </button>
          </div>
        </div>
      )}

      {/* Workspace section navigation chips */}
      <nav aria-label="Ενότητες καρτέλας" className="flex flex-wrap gap-1.5">
        {[
          { label: 'Timeline', href: '#ws-timeline' },
          { label: 'Κλήσεις', href: '#ws-calls' },
          { label: 'Tasks', href: '#ws-tasks' },
          { label: 'Ραντεβού', href: '#ws-appointments' },
          { label: 'Προσφορές', href: '#ws-offers' },
          { label: 'Σημειώσεις', href: '#ws-notes' },
          { label: 'Μηνύματα', href: '#ws-messages' },
          { label: 'Αρχεία', href: '#ws-files' },
        ].map((chip) => (
          <a
            key={chip.href}
            href={chip.href}
            className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-800"
          >
            {chip.label}
          </a>
        ))}
      </nav>

      {/* Top summary grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Customer info card */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Στοιχεία επικοινωνίας
            </h2>
            {!isEditingCustomer && (
              <button
                type="button"
                onClick={startEditCustomer}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
              >
                Επεξεργασία
              </button>
            )}
          </div>

          {customerSaveState === 'saved' && !isEditingCustomer && (
            <p className="mb-2 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 ring-1 ring-green-100">
              Αποθηκεύτηκε
            </p>
          )}

          {isEditingCustomer && customerDraft ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Ονοματεπώνυμο</label>
                <input
                  type="text"
                  value={customerDraft.name ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, name: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Ονοματεπώνυμο"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Εταιρεία</label>
                <input
                  type="text"
                  value={customerDraft.companyName ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, companyName: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Εταιρεία"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Τηλέφωνο</label>
                <input
                  type="tel"
                  value={customerDraft.phone ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, phone: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Τηλέφωνο"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Κινητό</label>
                <input
                  type="tel"
                  value={customerDraft.mobilePhone ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, mobilePhone: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Κινητό"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Σταθερό</label>
                <input
                  type="tel"
                  value={customerDraft.landlinePhone ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, landlinePhone: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Σταθερό"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Email</label>
                <input
                  type="email"
                  value={customerDraft.email ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, email: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Email"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Διεύθυνση</label>
                <input
                  type="text"
                  value={customerDraft.address ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, address: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Διεύθυνση"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Προτιμώμενο κανάλι</label>
                <select
                  value={customerDraft.preferredContactMethod}
                  onChange={e => setCustomerDraft(d => d ? { ...d, preferredContactMethod: e.target.value } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {Object.entries(CONTACT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Status</label>
                <select
                  value={customerDraft.status}
                  onChange={e => setCustomerDraft(d => d ? { ...d, status: e.target.value } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Πηγή</label>
                <select
                  value={customerDraft.source ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, source: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value=""> - Χωρίς πηγή - </option>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Ανάγκες πελάτη</label>
                <textarea
                  rows={3}
                  value={customerDraft.needsSummary ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, needsSummary: e.target.value || null } : d)}
                  className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Ανάγκες πελάτη"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Σημειώσεις</label>
                <textarea
                  rows={3}
                  value={customerDraft.notes ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, notes: e.target.value || null } : d)}
                  className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Σημειώσεις"
                />
              </div>
              {customerSaveError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
                  {customerSaveError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={saveCustomerDraft}
                  disabled={customerSaveState === 'saving'}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  {customerSaveState === 'saving' ? 'Αποθήκευση...' : 'Αποθήκευση'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditCustomer}
                  disabled={customerSaveState === 'saving'}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              {customer.phone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Τηλέφωνο</dt>
                  <dd className="font-medium text-zinc-800">{customer.phone}</dd>
                </div>
              )}
              {customer.mobilePhone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Κινητό</dt>
                  <dd className="font-medium text-zinc-800">{customer.mobilePhone}</dd>
                </div>
              )}
              {customer.landlinePhone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Σταθερό</dt>
                  <dd className="font-medium text-zinc-800">{customer.landlinePhone}</dd>
                </div>
              )}
              {customer.email && (
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-zinc-400">Email</dt>
                  <dd className="break-all font-medium text-zinc-800">{customer.email}</dd>
                </div>
              )}
              {customer.address && (
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-zinc-400">Διεύθυνση</dt>
                  <dd className="text-zinc-700">{customer.address}</dd>
                </div>
              )}
              {customer.lastContactAt && (
                <div className="flex justify-between gap-2 border-t border-zinc-50 pt-2">
                  <dt className="text-zinc-400">Τελευταία επαφή</dt>
                  <dd className="text-zinc-600">{formatDateShort(customer.lastContactAt)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Δημιουργία</dt>
                <dd className="text-zinc-500">{formatDateFull(customer.createdAt)}</dd>
              </div>
            </dl>
          )}
        </section>

        {/* Latest call brief card, only shown when a call summary exists */}
        {latestCallWithBrief && (
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">Τελευταία κλήση</h2>
              <span className="text-xs text-zinc-400">{formatDateShort(latestCallWithBrief.createdAt)}</span>
            </div>
            <p className="mb-1.5 text-xs text-zinc-500">
              {latestCallWithBrief.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
              {(latestCallWithBrief.summary ?? '').replace(/^AI brief[:\s]*/i, '')}
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setSelectedCall(latestCallWithBrief)}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                Άνοιγμα κλήσης
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Next best action card */}
      <section className={`rounded-2xl p-4 ${
        draftTask
          ? 'bg-amber-50 ring-1 ring-amber-200'
          : openTasks.length > 0
          ? 'bg-indigo-50 ring-1 ring-indigo-200'
          : 'bg-white shadow-sm ring-1 ring-zinc-100'
      }`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className={`text-xs font-semibold uppercase tracking-wide ${
            draftTask ? 'text-amber-600' : openTasks.length > 0 ? 'text-indigo-600' : 'text-zinc-400'
          }`}>
            Επόμενο βήμα
          </h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            draftTask
              ? 'bg-amber-100 text-amber-700'
              : openTasks.length > 0
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-zinc-100 text-zinc-500'
          }`}>
            {draftTask ? 'Χρειάζεται έλεγχος' : openTasks.length > 0 ? `${openTasks.length} ανοιχτά` : (pendingOffer || openAppointment) ? 'Εκκρεμεί' : 'Χωρίς εκκρεμότητες'}
          </span>
        </div>
        {draftTask ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Draft task από AI
              </span>
              <span className="text-xs text-amber-700">
                {TASK_TYPE_LABELS[draftTask.type] ?? draftTask.type}
              </span>
              <span className="text-xs text-amber-700">{draftTask.dueDate}</span>
            </div>
            <p className="font-semibold text-amber-900">{draftTask.title}</p>
            {draftTask.note && (
              <p className="text-sm text-amber-700">{truncate(draftTask.note, 200)}</p>
            )}
          </div>
        ) : openTasks.length > 0 ? (
          <div className="space-y-2">
            {openTasks.slice(0, 2).map(t => (
              <div key={t.id} className="flex items-start gap-2.5">
                <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${taskToneDot(t.status, t.priority)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-indigo-900">{t.title}</p>
                  <p className="text-xs text-indigo-700">{TASK_TYPE_LABELS[t.type] ?? t.type} · {t.dueDate}</p>
                </div>
              </div>
            ))}
            {openTasks.length > 2 && (
              <p className="text-xs text-indigo-600">+{openTasks.length - 2} ακόμα...</p>
            )}
          </div>
        ) : pendingOffer ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-400">Προσφορά</p>
            <p className="text-sm font-semibold text-zinc-800">{pendingOffer.offerNumber}</p>
            <p className="text-xs text-zinc-500">
              {OFFER_STATUS_LABELS[pendingOffer.status] ?? pendingOffer.status}
              {' · '}
              {formatMoney(pendingOffer.total)}
            </p>
          </div>
        ) : openAppointment ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-400">Ραντεβού</p>
            <p className="text-sm font-semibold text-zinc-800">{openAppointment.title}</p>
            <p className="text-xs text-zinc-500">
              {openAppointment.dueDate}
              {openAppointment.dueTime ? ` ${openAppointment.dueTime}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">Δεν υπάρχει επείγουσα ενέργεια.</p>
        )}
      </section>

      {/* Quick actions */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Γρήγορες ενέργειες
        </h2>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          <button
            type="button"
            onClick={() => setQuickModal('task')}
            className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
          >
            Νέο task
          </button>
          <button
            type="button"
            onClick={() => setQuickModal('appointment')}
            className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
          >
            Ραντεβού
          </button>
          <button
            type="button"
            onClick={() => setQuickModal('offer')}
            className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
          >
            Προσφορά
          </button>
          <button
            type="button"
            onClick={() => setQuickModal('message')}
            className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
          >
            Μήνυμα
          </button>
          {(customer.phone || customer.mobilePhone || customer.landlinePhone) ? (
            <a
              href={`tel:${customer.phone || customer.mobilePhone || customer.landlinePhone}`}
              className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
            >
              Κλήση
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-300 ring-1 ring-zinc-200/40 cursor-not-allowed"
            >
              Κλήση
            </button>
          )}
          <button
            type="button"
            onClick={() => setQuickModal('file')}
            className="rounded-xl bg-zinc-50 px-2 py-4 text-center text-sm font-medium text-zinc-700 ring-1 ring-zinc-200/60 transition hover:bg-zinc-100 active:bg-zinc-200"
          >
            Αρχείο
          </button>
        </div>
      </section>

      {/* A. Timeline */}
      <section id="ws-timeline" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Timeline</h2>
            {timeline.length > 0 && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                {timeline.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">Σημαντικές ενέργειες, απαντήσεις πελατών και αλλαγές θα φαίνονται εδώ.</p>
        </div>
        {timeline.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχει ιστορικό ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {timeline.map(entry =>
              entry.kind === 'comm' ? (
                <li
                  key={`c-${entry.item.id}`}
                  className={`flex items-start gap-3 px-4 py-3 ${entry.item.channel === 'call' ? 'cursor-pointer transition hover:bg-indigo-50/50 active:bg-indigo-50' : ''}`}
                  onClick={entry.item.channel === 'call' ? () => setSelectedCall(entry.item) : undefined}
                >
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                    entry.item.channel === 'call' ? 'bg-indigo-500' : 'bg-blue-500'
                  }`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-xs font-semibold ${entry.item.channel === 'call' ? 'text-indigo-600' : 'text-blue-600'}`}>
                        {entry.item.channel === 'call' ? 'Κλήση' : entry.item.channel}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {formatDateShort(entry.item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      {entry.item.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'} · {entry.item.status}
                    </p>
                    {entry.item.summary && (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-500">
                        {truncate(entry.item.summary.replace(/^AI brief[:\s]*/i, ''), 180)}
                      </p>
                    )}
                    {entry.item.channel === 'call' && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setSelectedCall(entry.item); }}
                        className="mt-0.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 transition hover:bg-indigo-100"
                      >
                        Περίληψη
                      </button>
                    )}
                  </div>
                </li>
              ) : (
                <li key={`t-${entry.item.id}`} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${taskToneDot(entry.item.status, entry.item.priority)}`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-zinc-500">Task</span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {formatDateShort(entry.item.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-700">{entry.item.title}</p>
                    <p className="text-xs text-zinc-400">
                      {TASK_STATUS_LABELS[entry.item.status] ?? entry.item.status}
                      {' · '}
                      {TASK_TYPE_LABELS[entry.item.type] ?? entry.item.type}
                      {' · '}
                      {entry.item.dueDate}
                    </p>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      {/* B. Calls */}
      <section id="ws-calls" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">Κλήσεις</h2>
                {callComms.length > 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                    {callComms.length}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">Κλήσεις, περιλήψεις και επόμενα βήματα.</p>
            </div>
            <Link
              href="/calls"
              className="shrink-0 rounded-xl border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Άνοιγμα κλήσεων
            </Link>
          </div>
        </div>
        {callComms.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν καταγεγραμμένες κλήσεις ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {callComms.map(c => (
              <li
                key={c.id}
                className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-indigo-50/50 active:bg-indigo-50"
                onClick={() => setSelectedCall(c)}
              >
                <span className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-full ${c.direction === 'inbound' ? 'bg-green-500' : 'bg-blue-500'}`} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-700">
                      {c.direction === 'inbound' ? 'Εισερχόμενη κλήση' : 'Εξερχόμενη κλήση'}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {formatDateShort(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">{c.status}</p>
                  {c.summary && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
                      {truncate(c.summary.replace(/^AI brief[:\s]*/i, ''), 160)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setSelectedCall(c); }}
                  className="shrink-0 self-center rounded-xl border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
                >
                  Περίληψη
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C. Tasks */}
      <section id="ws-tasks" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">Tasks</h2>
                {sortedTasks.length > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    openTasks.length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-500'
                  }`}>
                    {openTasks.length > 0 ? `${openTasks.length} ανοιχτά` : sortedTasks.length}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">Ανοιχτές εργασίες και follow-up.</p>
            </div>
            <Link
              href="/tasks"
              className="shrink-0 rounded-xl border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Άνοιγμα tasks
            </Link>
          </div>
        </div>
        {focusTaskId && (
          <div className="flex items-center justify-between gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5">
            <p className="text-xs font-medium text-indigo-700">Άνοιξες task από τα Tasks</p>
            <button
              type="button"
              onClick={() => setFocusTaskId(null)}
              className="shrink-0 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
            >
              Κλείσιμο
            </button>
          </div>
        )}
        {sortedTasks.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν tasks ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sortedTasks.map(t => (
              <li
                key={t.id}
                id={`task-${t.id}`}
                className={`flex items-start gap-3 px-4 py-3 transition-colors${
                  t.id === focusTaskId ? ' bg-indigo-50/60 ring-2 ring-inset ring-indigo-200' : ''
                }`}
              >
                <span className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-full ${taskToneDot(t.status, t.priority)}`} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${taskStatusClass(t.status)}`}>
                      {TASK_STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    {t.createdFromAi && (
                      <span className="text-xs text-zinc-400">από AI</span>
                    )}
                    <span className="text-xs text-zinc-400">
                      {PRIORITY_LABELS[t.priority] ?? t.priority}
                    </span>
                  </div>
                  <p className="font-semibold text-zinc-800">{t.title}</p>
                  <p className="text-xs text-zinc-400">
                    {TASK_TYPE_LABELS[t.type] ?? t.type} · {t.dueDate}
                    {t.dueTime ? ` ${t.dueTime}` : ''}
                  </p>
                  {t.note && (
                    <p className="text-sm text-zinc-500">{truncate(t.note, 160)}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openEditTask(t)}
                  className="shrink-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                >
                  Επεξεργασία
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Appointments */}
      <section id="ws-appointments" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">Ραντεβού</h2>
                {appointmentTasks.length > 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                    {appointmentTasks.length}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">Ραντεβού, απαντήσεις πελάτη και αλλαγές ώρας.</p>
            </div>
            <Link
              href="/appointments"
              className="shrink-0 rounded-xl border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Άνοιγμα ραντεβού
            </Link>
          </div>
        </div>
        {appointmentTasks.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν ραντεβού ακόμα για αυτόν τον πελάτη.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {appointmentTasks.map(task => (
              <li key={task.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-500">
                        {TASK_TYPE_LABELS[task.type] ?? task.type}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>
                        {appointmentStatusLabel(task)}
                      </span>
                      {task.createdFromAi && (
                        <span className="text-xs text-zinc-400">από AI</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-zinc-800">{task.title}</p>
                    <p className="text-xs text-zinc-500">
                      {task.dueDate}{task.dueTime ? ` ${task.dueTime}` : ''}
                    </p>
                    {task.note && (
                      <p className="text-xs text-zinc-400">{truncate(task.note, 120)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditTask(task)}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                    >
                      Επεξεργασία
                    </button>
                    <Link
                      href={`/appointments?focusAppointment=${task.id}`}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-center text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                    >
                      Άνοιγμα
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Offers */}
      <section id="ws-offers" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">Προσφορές</h2>
                {sortedOffers.length > 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                    {sortedOffers.length}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">Προσφορές, κατάσταση και follow-up.</p>
            </div>
            <Link
              href="/offers"
              className="shrink-0 rounded-xl border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Άνοιγμα προσφορών
            </Link>
          </div>
        </div>
        {editOfferError && !editingOffer && (
          <p className="px-4 pt-3 text-xs font-medium text-red-600">{editOfferError}</p>
        )}
        {sortedOffers.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν προσφορές ακόμα για αυτόν τον πελάτη.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sortedOffers.map(offer => (
              <li key={offer.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{offer.offerNumber}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${offerStatusBadgeClass(offer.status)}`}>
                        {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
                      </span>
                      {offer.createdFromAi && (
                        <span className="text-xs text-zinc-400">από AI</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {offer.offerDate ?? ''}
                      {offer.offerDate && offer.validUntil ? ' · ' : ''}
                      {offer.validUntil ? `Ισχύει έως ${offer.validUntil}` : ''}
                    </p>
                    <p className="text-sm font-semibold text-zinc-800">{formatMoney(offer.total)}</p>
                    {offer.notes && (
                      <p className="text-xs text-zinc-400">{truncate(offer.notes, 120)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditOffer(offer.id)}
                      disabled={editingOfferLoading === offer.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {editingOfferLoading === offer.id ? 'Φόρτωση...' : 'Επεξεργασία'}
                    </button>
                    <Link
                      href={`/offers/${offer.id}`}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-center text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                    >
                      Άνοιγμα
                    </Link>
                    <button
                      type="button"
                      onClick={() => { void generateResponseLink(offer.id); }}
                      disabled={offerLinkGeneratingId === offer.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {offerLinkGeneratingId === offer.id
                        ? 'Δημιουργία...'
                        : offerLinkCopiedId === offer.id
                        ? 'Αντιγράφηκε'
                        : 'Link αποδοχής'}
                    </button>
                  </div>
                </div>
                {offerLinkManualCopyOfferId === offer.id && offerLinkManualCopyUrl && (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">Αντέγραψε το link χειροκίνητα:</p>
                    <textarea
                      readOnly
                      rows={2}
                      value={offerLinkManualCopyUrl}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-700 outline-none"
                    />
                  </div>
                )}
                {offerLinkErrorId === offer.id && (
                  <p className="text-xs text-red-600">{offerLinkErrorMsg}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* D. Notes: backend-backed section, comes before placeholders */}
      <section id="ws-notes" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Σημειώσεις</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Εσωτερικές σημειώσεις και ιστορικό.</p>
        </div>
        {customer.notes ? (
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-zinc-700">
            {customer.notes}
          </p>
        ) : (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν σημειώσεις ακόμα.
          </p>
        )}
      </section>

      {/* Messages section */}
      <section id="ws-messages" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Μηνύματα</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Πρόχειρα και ιστορικό επικοινωνίας με τον πελάτη.</p>
        </div>
        <div className="divide-y divide-zinc-100">
          {messageDrafts.map(draft => (
            <div key={draft.key} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700">{draft.channelLabel}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                    Πρόχειρο
                  </span>
                </div>
                <p className="text-sm text-zinc-600">{draft.draftText}</p>
                <p className="text-[11px] text-zinc-400">Δεν έχει σταλεί.</p>
              </div>
              <button
                type="button"
                onClick={() => copyMessage(draft.key, draft.draftText)}
                className="shrink-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
              >
                {copiedMessageKey === draft.key ? 'Αντιγράφηκε' : 'Αντιγραφή'}
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-100 px-4 py-3">
          <p className="text-xs text-zinc-400">Δημιουργία νέου μηνύματος θα συνδεθεί με provider σε επόμενο βήμα.</p>
        </div>
      </section>

      {/* Files section */}
      <section id="ws-files" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Αρχεία</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Φωτογραφίες, βίντεο και έγγραφα του πελάτη.</p>
        </div>
        <div className="divide-y divide-zinc-100">
          {(
            [
              { key: 'photos', label: 'Φωτογραφίες εργασίας', desc: 'Για εικόνες από τον χώρο ή την εργασία.' },
              { key: 'videos', label: 'Βίντεο', desc: 'Για σύντομα βίντεο από βλάβη, χώρο ή εγκατάσταση.' },
              { key: 'docs', label: 'Έγγραφα', desc: 'Για προσφορές, τιμολόγια, έντυπα και σημειώσεις.' },
            ] as const
          ).map(cat => (
            <div key={cat.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-800">{cat.label}</p>
                <p className="text-xs text-zinc-400">{cat.desc}</p>
              </div>
              <button
                type="button"
                disabled
                title="Θα ενεργοποιηθεί όταν συνδεθεί το ασφαλές storage."
                className="shrink-0 cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-400"
              >
                Προσθήκη
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-100 px-4 py-3">
          <p className="text-xs text-zinc-400">Θα ενεργοποιηθεί όταν συνδεθεί το ασφαλές storage.</p>
        </div>
      </section>

      {/* Απόρριψη πελάτη: review-first, neutral styling until user initiates */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">Απόρριψη πελάτη</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
            Review-first
          </span>
        </div>
        <p className="text-xs text-zinc-400">
          Δημιουργεί ευγενικό draft για review πριν σταλεί. Χρειάζεται έγκριση.
        </p>
        <button
          type="button"
          onClick={startRejectClient}
          className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
        >
          Προετοιμασία draft
        </button>
      </section>

      {/* Call details modal */}
      {selectedCall !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={() => setSelectedCall(null)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-zinc-200/60"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">Περίληψη κλήσης</h2>
              <button
                type="button"
                onClick={() => setSelectedCall(null)}
                aria-label="Κλείσιμο"
                className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <span>{selectedCall.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'}</span>
              {selectedCall.createdAt && (
                <span>{formatDateFull(selectedCall.createdAt)}</span>
              )}
            </div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Περίληψη κλήσης</p>
            {selectedCall.summary ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                {selectedCall.summary.replace(/^AI brief[:\s]*/i, '')}
              </p>
            ) : (
              <p className="text-sm text-zinc-400">Δεν υπάρχει διαθέσιμη περίληψη για αυτή την κλήση.</p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCall(null)}
                className="rounded-2xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Κλείσιμο
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offer modal, large centered, full OfferForm */}
      {quickModal === 'offer' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={closeQuickModal}
        >
          <div
            className="mx-4 w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] bg-white shadow-2xl ring-1 ring-zinc-200/60"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[28px] bg-white px-5 pt-5 pb-3 border-b border-zinc-100">
              <p className="text-xs text-zinc-400">
                Η αποστολή στον πελάτη θα γίνει σε επόμενο βήμα.
              </p>
              <button
                type="button"
                onClick={closeQuickModal}
                aria-label="Κλείσιμο"
                className="shrink-0 rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {offerSaveError && (
              <p className="mx-5 mt-3 text-xs font-medium text-red-600">{offerSaveError}</p>
            )}
            <div className="p-5">
              <OfferForm
                customers={[currentCustomerForOfferForm]}
                initialCustomerId={customerId}
                lockCustomer
                requireOfferNumber={false}
                nextOfferNumber=""
                onSave={saveOfferFromCustomerForm}
                onCancel={closeQuickModal}
              />
            </div>
          </div>
        </div>
      )}

      {/* Quick action modals */}
      {quickModal !== null && quickModal !== 'offer' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={closeQuickModal}
        >
          <div
            className="mx-4 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-zinc-200/60"
            onClick={e => e.stopPropagation()}
          >

            {/* Message modal */}
            {quickModal === 'message' && (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Μήνυμα</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-600">
                  Μήνυμα
                </label>
                <textarea
                  rows={5}
                  value={msgDraft}
                  onChange={e => { setMsgDraft(e.target.value); setMsgCopied(false); }}
                  placeholder="Γράψε το μήνυμα εδώ..."
                  className="w-full resize-none rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                {msgCopied && (
                  <p className="mt-1.5 text-xs text-zinc-500">Αντιγράφηκε.</p>
                )}
                <p className="mt-2 text-xs text-zinc-400">
                  Δεν στάλθηκε μήνυμα από την εφαρμογή.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={copyMsgDraft}
                    disabled={!msgDraft.trim()}
                    className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Αντιγραφή
                  </button>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Κλείσιμο
                  </button>
                </div>
              </>
            )}

            {/* File modal */}
            {quickModal === 'file' && (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Αρχεία πελάτη</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mb-4 text-sm text-zinc-500">
                  Τα αρχεία θα αποθηκεύονται όταν συνδεθεί χώρος αποθήκευσης.
                </p>
                <div className="space-y-2">
                  {(['Φωτογραφίες', 'Βίντεο', 'Έγγραφα'] as const).map((label) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/60"
                    >
                      <span className="flex-1 text-sm font-medium text-zinc-600">{label}</span>
                      <span className="text-xs text-zinc-400">0</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    className="rounded-2xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Κλείσιμο
                  </button>
                </div>
              </>
            )}

            {/* Task modal */}
            {quickModal === 'task' && (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Νέο task</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Τίτλος</label>
                    <input
                      type="text"
                      value={taskTitle}
                      onChange={e => setTaskTitle(e.target.value)}
                      placeholder="Γράψε τι πρέπει να γίνει."
                      className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Ημερομηνία</label>
                    <input
                      type="date"
                      value={taskDate}
                      onChange={e => setTaskDate(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Σημείωση</label>
                    <textarea
                      rows={3}
                      value={taskNote}
                      onChange={e => setTaskNote(e.target.value)}
                      className="w-full resize-none rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>
                {taskError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{taskError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={saveTaskFromModal}
                    disabled={!taskTitle.trim() || taskSaving}
                    className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {taskSaving ? 'Αποθηκεύεται...' : 'Αποθήκευση'}
                  </button>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Κλείσιμο
                  </button>
                </div>
              </>
            )}

            {/* Appointment modal */}
            {quickModal === 'appointment' && (
              <>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Ραντεβού</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Τίτλος</label>
                    <input
                      type="text"
                      value={apptTitle}
                      onChange={e => setApptTitle(e.target.value)}
                      placeholder="π.χ. Συνάντηση αξιολόγησης"
                      className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Ημερομηνία</label>
                    <input
                      type="date"
                      value={apptDate}
                      onChange={e => setApptDate(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Ώρα</label>
                    <input
                      type="time"
                      value={apptTime}
                      onChange={e => setApptTime(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600">Σημείωση</label>
                    <textarea
                      rows={3}
                      value={apptNote}
                      onChange={e => setApptNote(e.target.value)}
                      className="w-full resize-none rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs text-zinc-400">
                  Η αποστολή στον πελάτη θα γίνει σε επόμενο βήμα.
                </p>
                {apptError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{apptError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={saveAppointmentFromModal}
                    disabled={!apptTitle.trim() || !apptDate || !apptTime || apptSaving}
                    className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {apptSaving ? 'Αποθηκεύεται...' : 'Αποθήκευση'}
                  </button>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Κλείσιμο
                  </button>
                </div>
              </>
            )}


          </div>
        </div>
      )}

      {/* Edit offer modal, large centered, full OfferForm */}
      {editingOffer !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={closeEditOffer}
        >
          <div
            className="mx-4 w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] bg-white shadow-2xl ring-1 ring-zinc-200/60"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[28px] bg-white px-5 pt-5 pb-3 border-b border-zinc-100">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Επεξεργασία προσφοράς</h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Η αποστολή στον πελάτη γίνεται μόνο από ξεχωριστό βήμα.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditOffer}
                aria-label="Κλείσιμο"
                className="shrink-0 rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {editOfferError && (
              <p className="mx-5 mt-3 text-xs font-medium text-red-600">{editOfferError}</p>
            )}
            <div className="p-5">
              <OfferForm
                initial={editingOffer}
                customers={[currentCustomerForOfferForm]}
                initialCustomerId={customerId}
                lockCustomer
                requireOfferNumber
                nextOfferNumber={editingOffer.offerNumber}
                onSave={saveEditedOffer}
                onCancel={closeEditOffer}
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit task/appointment modal */}
      {editingTask !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={closeEditTask}
        >
          <div
            className="mx-4 w-full max-w-lg rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-zinc-200/60"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                {editingTask.type === 'book_appointment' || editingTask.type === 'visit_customer'
                  ? 'Επεξεργασία ραντεβού'
                  : 'Επεξεργασία task'}
              </h2>
              <button
                type="button"
                onClick={closeEditTask}
                aria-label="Κλείσιμο"
                className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600">Τίτλος</label>
                <input
                  type="text"
                  value={editTaskTitle}
                  onChange={e => setEditTaskTitle(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600">Ημερομηνία</label>
                <input
                  type="date"
                  value={editTaskDate}
                  onChange={e => setEditTaskDate(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600">Ώρα</label>
                <input
                  type="time"
                  value={editTaskTime}
                  onChange={e => setEditTaskTime(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600">Σημείωση</label>
                <textarea
                  rows={3}
                  value={editTaskNote}
                  onChange={e => setEditTaskNote(e.target.value)}
                  className="w-full resize-none rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>
            {editTaskError && (
              <p className="mt-2 text-xs font-medium text-red-600">{editTaskError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={saveEditedTask}
                disabled={editTaskSaving}
                className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editTaskSaving ? 'Αποθηκεύεται...' : 'Αποθήκευση'}
              </button>
              <button
                type="button"
                onClick={closeEditTask}
                disabled={editTaskSaving}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
