'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import OfferForm from '@/components/offers/OfferForm';
import { SendViaViberModal, executeViberSend } from '@/components/customers/SendViaViberModal';
import { SendChannelSheet } from '@/components/customers/SendChannelSheet';
import FileGallery, { type GalleryFile } from '@/components/customers/FileGallery';
import CustomerSummaryFromCalls from '@/components/customers/CustomerSummaryFromCalls';
import CollapsibleSection from '@/components/customers/CollapsibleSection';
import { BottomSheet, SheetRow, Button, EmptyState } from '@/components/ui';
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
  statusSummary: string | null;
  businessNotes: string | null;
  personalNotes: string | null;
  nextBestAction: string | null;
  memoryUpdatedAt: string | null;
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
  statusSummary: string | null;
  businessNotes: string | null;
  personalNotes: string | null;
  nextBestAction: string | null;
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

interface UploadSessionFileDto {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'photo' | 'video' | 'other';
}

interface UploadSessionDto {
  id: string;
  file_count: number;
  files: UploadSessionFileDto[];
  customer_comment: string | null;
  uploaded_at: string;
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
  new: 'Νέος',
  in_progress: 'Σε εξέλιξη',
  new_lead: 'Νέος',
  contacted: 'Μίλησα',
  follow_up_needed: 'Να ξαναμιλήσω',
  offer_drafted: 'Πρόχειρη προσφορά',
  offer_sent: 'Στάλθηκε προσφορά',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

const CONTACT_LABELS: Record<string, string> = {
  phone: 'Τηλέφωνο',
  email: 'Email',
  viber: 'Viber',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  call_back: 'Κλήση',
  send_offer: 'Αποστολή προσφοράς',
  follow_up_offer: 'Να ξαναμιλήσω για προσφορά',
  ask_for_photos_documents: 'Έγγραφα/φωτογραφίες',
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
  wait_for_reply: 'Αναμονή απάντησης',
  other: 'Άλλο',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  ai_draft: 'Πρόχειρο',
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
  draft: 'Πρόχειρη',
  ready_to_send: 'Έτοιμη για αποστολή',
  sent_manually: 'Στάλθηκε',
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
  if (status === 'new') return 'bg-indigo-50 text-indigo-700';
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700';
  if (status === 'won') return 'bg-green-100 text-green-700';
  if (status === 'lost') return 'bg-red-100 text-red-600';
  if (status === 'new_lead') return 'bg-blue-50 text-blue-700';
  if (status === 'contacted') return 'bg-sky-100 text-sky-700';
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

// --- Timeline communication helpers (#57: outbound message delivery status) ---
const COMM_CHANNEL_LABELS: Record<string, string> = {
  call: 'Κλήση',
  viber: 'Viber',
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
};
function commChannelLabel(channel: string): string {
  return COMM_CHANNEL_LABELS[channel] ?? channel;
}

const COMM_STATUS_LABELS: Record<string, string> = {
  started: 'Ξεκίνησε',
  sent: 'Εστάλη',
  delivered: 'Παραδόθηκε',
  seen: 'Διαβάστηκε',
  failed: 'Απέτυχε',
  completed: 'Ολοκληρώθηκε',
};
function commStatusLabel(status: string): string {
  return COMM_STATUS_LABELS[status] ?? status;
}

function commStatusBadgeClass(status: string): string {
  if (status === 'seen') return 'bg-green-100 text-green-700';
  if (status === 'delivered') return 'bg-blue-100 text-blue-700';
  if (status === 'failed') return 'bg-red-100 text-red-600';
  if (status === 'sent') return 'bg-zinc-100 text-zinc-600';
  return 'bg-zinc-100 text-zinc-500';
}

function commDotClass(channel: string): string {
  if (channel === 'call') return 'bg-indigo-500';
  if (channel === 'viber') return 'bg-violet-500';
  if (channel === 'email') return 'bg-amber-500';
  return 'bg-blue-500';
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
  if (task.status === 'ai_draft') return 'Πρόχειρο';
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
  const [uploadSessions, setUploadSessions] = useState<UploadSessionDto[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [editMode, setEditMode] = useState<'contact' | 'memory' | 'notes' | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft | null>(null);
  const [customerSaveState, setCustomerSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customerSaveError, setCustomerSaveError] = useState<string | null>(null);

  // Reject via multi-channel sheet (#5). The ref guards markRejectedLost so the
  // "lost" status + note are applied exactly once per open, no matter how many
  // channels the operator taps.
  const [rejectSheetOpen, setRejectSheetOpen] = useState(false);
  const rejectAppliedRef = useRef(false);

  // Manual file upload (#1b) + gallery viewer (#1c) state.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  type QuickModal = 'task' | 'appointment' | 'offer' | null;
  const [quickModal, setQuickModal] = useState<QuickModal>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(() => getLocalDateInputValue());
  const [taskNote, setTaskNote] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  // Task wizard step (1: τίτλος, 2: ημερομηνία, 3: σημείωση).
  const [taskStep, setTaskStep] = useState(1);

  const [apptTitle, setApptTitle] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [apptNote, setApptNote] = useState('');
  const [apptSaving, setApptSaving] = useState(false);
  const [apptError, setApptError] = useState<string | null>(null);
  // Appointment wizard step (1: τίτλος, 2: ημερομηνία, 3: ώρα, 4: αποστολή).
  const [apptStep, setApptStep] = useState(1);
  // True once the appointment has been saved (entering step 4) so we don't
  // re-create it if the operator stays on the send step.
  const [apptSaved, setApptSaved] = useState(false);
  // The appointment task created in step 4 (drives the Viber send wiring).
  const [createdApptTask, setCreatedApptTask] = useState<TaskDto | null>(null);

  // Prominent status control (under the hero). Reuses the customer PATCH path.
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [offerSaveError, setOfferSaveError] = useState<string | null>(null);

  interface OfferSendReview {
    offerId: string;
    offerNumber: string;
    responseUrl: string | null;
    message: string | null;
    recipient: string | null;
    loading: boolean;
    sending: boolean;
    sent: boolean;
    error: string | null;
    copied: boolean;
  }
  const [offerSendReview, setOfferSendReview] = useState<OfferSendReview | null>(null);

  interface IntakeSendReview {
    responseUrl: string | null;
    message: string | null;
    recipient: string | null;
    loading: boolean;
    sending: boolean;
    sent: boolean;
    sentChannel: 'viber' | 'email' | null;
    error: string | null;
    copied: boolean;
  }
  const [intakeSendReview, setIntakeSendReview] = useState<IntakeSendReview | null>(null);

  interface ApptLinkReview {
    taskId: string;
    responseUrl: string | null;
    message: string | null;
    recipient: string | null;
    loading: boolean;
    sending: boolean;
    sent: boolean;
    sentChannel: 'viber' | 'email' | null;
    error: string | null;
    copied: boolean;
    warning: string | null;
  }
  const [apptLinkReview, setApptLinkReview] = useState<ApptLinkReview | null>(null);

  interface UploadLinkReview {
    responseUrl: string | null;
    message: string | null;
    recipient: string | null;
    loading: boolean;
    sending: boolean;
    sent: boolean;
    sentChannel: 'viber' | 'email' | null;
    error: string | null;
    copied: boolean;
  }
  const [uploadLinkReview, setUploadLinkReview] = useState<UploadLinkReview | null>(null);

  const [selectedCall, setSelectedCall] = useState<CommunicationDto | null>(null);

  // --- Presentation: sticky-bar bottom sheets + collapsible reveal control ---
  // "Άλλα" sheet (mobile sticky bar overflow) and the "Αλλαγή κατάστασης" sheet.
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  // Controlled open-state for collapsible sections. Contact/summary default
  // expanded; the rest default collapsed. The "Άλλα" sheet can also reveal the
  // Notes / Summary / Files sections on demand.
  const [contactOpen, setContactOpen] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  // Reveal + scroll a section into view (used by the "Άλλα" sheet rows).
  function revealSection(id: string, setOpen?: (v: boolean) => void) {
    setOpen?.(true);
    setMoreSheetOpen(false);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

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
        const [customerRes, commRes, tasksRes, offersRes, sessionsResult] = await Promise.all([
          fetch(`/api/customers/${customerId}`, { headers }),
          fetch(`/api/communications?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
          fetch(`/api/tasks?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
          fetch(`/api/offers?customerId=${encodeURIComponent(customerId)}&limit=20`, { headers }),
          supabase
            .from('customer_upload_sessions')
            .select('id, file_count, files, customer_comment, uploaded_at')
            .eq('customer_id', customerId)
            .order('uploaded_at', { ascending: false })
            .limit(20),
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
        setUploadSessions((sessionsResult.data ?? []) as UploadSessionDto[]);
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

  // Best phone number for tel: links (digits only). Mobile preferred, then
  // landline, then the legacy `phone` field.
  const telHref = useMemo(() => {
    const raw = customer?.mobilePhone ?? customer?.landlinePhone ?? customer?.phone ?? '';
    const digits = raw.replace(/[^+\d]/g, '');
    return digits ? `tel:${digits}` : null;
  }, [customer?.mobilePhone, customer?.landlinePhone, customer?.phone]);

  const hasPhone = !!(customer?.mobilePhone || customer?.phone);

  // ---------------------------------------------------------------------------
  // Customer edit helpers
  // ---------------------------------------------------------------------------

  function buildCustomerDraft(c: CustomerDto): CustomerDraft {
    return {
      name: c.name,
      companyName: c.companyName,
      phone: c.phone,
      mobilePhone: c.mobilePhone,
      landlinePhone: c.landlinePhone,
      email: c.email,
      address: c.address,
      status: c.status,
      source: c.source,
      preferredContactMethod: c.preferredContactMethod,
      needsSummary: c.needsSummary,
      notes: c.notes,
      statusSummary: c.statusSummary ?? null,
      businessNotes: c.businessNotes ?? null,
      personalNotes: c.personalNotes ?? null,
      nextBestAction: c.nextBestAction ?? null,
    };
  }

  function startEditContact() {
    if (!customer) return;
    setCustomerDraft(buildCustomerDraft(customer));
    setEditMode('contact');
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  function startEditMemory() {
    if (!customer) return;
    setCustomerDraft(buildCustomerDraft(customer));
    setEditMode('memory');
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  function startEditNotes() {
    if (!customer) return;
    setCustomerDraft(buildCustomerDraft(customer));
    setEditMode('notes');
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  function cancelEdit() {
    setEditMode(null);
    setCustomerDraft(null);
    setCustomerSaveError(null);
    setCustomerSaveState('idle');
  }

  // Prominent status control: PATCH only the status field (same endpoint the
  // edit card used) and update the customer in place.
  async function updateCustomerStatus(nextStatus: string) {
    if (!customer || nextStatus === customer.status) return;
    setStatusSaving(nextStatus);
    setStatusError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatusError('Δεν αποθηκεύτηκε η αλλαγή. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json() as { ok?: boolean; customer?: CustomerDto; error?: string };
      if (res.ok && json.ok && json.customer) {
        setCustomer(json.customer);
      } else {
        setStatusError('Δεν αποθηκεύτηκε η αλλαγή. Δοκίμασε ξανά.');
      }
    } catch {
      setStatusError('Δεν αποθηκεύτηκε η αλλαγή. Δοκίμασε ξανά.');
    } finally {
      setStatusSaving(null);
    }
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
        setEditMode(null);
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

  // The polite default rejection message. Reused by the new multi-channel
  // reject sheet (#5) — kept exactly as before.
  function buildDefaultRejectMessage(): string {
    return 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';
  }

  // #5 — Mark the customer as lost and append the reject note ONCE. Reuses the
  // same PATCH contract as saveRejectWithoutSending (status:'lost' + notes
  // append). Guarded by rejectAppliedRef so reopening the sheet or tapping
  // several channels never duplicates the note.
  async function markRejectedLost() {
    if (rejectAppliedRef.current) return;
    rejectAppliedRef.current = true;
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const existingNotes = customer?.notes ?? '';
      const appendNote = `Απόρριψη πελάτη, draft χωρίς αποστολή:\n${buildDefaultRejectMessage()}`;
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
      }
    } catch {
      // Non-fatal: the operator can retry from the status sheet. Allow a retry
      // by clearing the guard so a later channel tap can attempt again.
      rejectAppliedRef.current = false;
    }
  }

  // Open the reject sheet. Marking-as-lost happens here (idempotent) so the
  // status reflects the intent the moment the operator commits to rejecting.
  function openRejectSheet() {
    rejectAppliedRef.current = false;
    setRejectSheetOpen(true);
    void markRejectedLost();
  }

  // ---------------------------------------------------------------------------
  // Files: manual upload (#1b) + gallery (#1c)
  // ---------------------------------------------------------------------------

  const ALLOWED_UPLOAD_MIME = useMemo(
    () => ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime'],
    []
  );
  const MAX_UPLOAD_BYTES = 52_428_800; // 50 MB — mirrors the public uploader.

  // Flattened gallery list across all upload sessions, in display order.
  const galleryFiles = useMemo<GalleryFile[]>(() => {
    const out: GalleryFile[] = [];
    for (const session of uploadSessions) {
      session.files.forEach((f, idx) => {
        out.push({
          sessionId: session.id,
          fileIndex: idx,
          name: f.name,
          kind: f.kind === 'photo' ? 'image' : f.kind === 'video' ? 'video' : 'file',
          mimeType: f.mimeType,
        });
      });
    }
    return out;
  }, [uploadSessions]);

  // Resolve a gallery file to a short-lived signed URL via the read endpoint.
  async function resolveGalleryUrl(file: GalleryFile): Promise<string | null> {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const res = await fetch(`/api/customers/${customerId}/files/signed-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sessionId: file.sessionId, fileIndex: file.fileIndex }),
      });
      const json = await res.json() as { ok?: boolean; signedUrl?: string };
      return json.ok && json.signedUrl ? json.signedUrl : null;
    } catch {
      return null;
    }
  }

  // Open the gallery at a given session/file (mapped to its flattened index).
  function openGalleryAt(sessionId: string, fileIndex: number) {
    const flatIndex = galleryFiles.findIndex(
      g => g.sessionId === sessionId && g.fileIndex === fileIndex
    );
    setGalleryIndex(flatIndex >= 0 ? flatIndex : 0);
    setGalleryOpen(true);
  }

  // Manual upload (+): for each picked file, get a signed upload URL (reusing
  // one uploadTokenId across the batch), PUT bytes to storage, then record one
  // session via /complete. Enforces the same client guards as the public
  // uploader before uploading.
  async function handleManualFilesSelected(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const all = Array.from(picked);

    // Client guards: image/video only, <=50MB each (mirrors public uploader).
    const tooBig = all.some(f => f.size > MAX_UPLOAD_BYTES);
    const wrongType = all.some(
      f => !(f.type.startsWith('image/') || f.type.startsWith('video/'))
    );
    if (wrongType) {
      setUploadError('Επιτρέπονται μόνο φωτογραφίες και βίντεο.');
      return;
    }
    if (tooBig) {
      setUploadError('Κάποια αρχεία ξεπερνούν το μέγιστο μέγεθος (50MB).');
      return;
    }

    setUploadingFiles(true);
    setUploadError(null);
    setUploadProgress('Ανεβαίνει...');

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUploadError('Δεν βρέθηκε σύνδεση. Δοκίμασε ξανά.');
        setUploadingFiles(false);
        setUploadProgress(null);
        return;
      }
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      };

      let uploadTokenId: string | null = null;
      const recorded: Array<{ path: string; name: string; sizeBytes: number; mimeType: string }> = [];

      for (let i = 0; i < all.length; i++) {
        const file = all[i];
        setUploadProgress(`Ανεβαίνει ${i + 1} από ${all.length}...`);

        const urlRes = await fetch(`/api/customers/${customerId}/files/upload-url`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            ...(uploadTokenId ? { uploadTokenId } : {}),
          }),
        });
        const urlJson = await urlRes.json() as {
          ok?: boolean; uploadUrl?: string; uploadPath?: string; token?: string; uploadTokenId?: string;
        };
        if (!urlRes.ok || !urlJson.ok || !urlJson.uploadPath || !urlJson.token || !urlJson.uploadTokenId) {
          setUploadError('Δεν ήταν δυνατή η προετοιμασία ανεβάσματος. Δοκίμασε ξανά.');
          setUploadingFiles(false);
          setUploadProgress(null);
          return;
        }
        uploadTokenId = urlJson.uploadTokenId;

        const { error: putError } = await supabase.storage
          .from('customer-uploads')
          .uploadToSignedUrl(urlJson.uploadPath, urlJson.token, file, {
            contentType: file.type,
            upsert: false,
          });
        if (putError) {
          setUploadError('Δεν ήταν δυνατό το ανέβασμα του αρχείου. Δοκίμασε ξανά.');
          setUploadingFiles(false);
          setUploadProgress(null);
          return;
        }

        recorded.push({
          path: urlJson.uploadPath,
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
        });
      }

      if (!uploadTokenId || recorded.length === 0) {
        setUploadError('Δεν ολοκληρώθηκε το ανέβασμα. Δοκίμασε ξανά.');
        setUploadingFiles(false);
        setUploadProgress(null);
        return;
      }

      setUploadProgress('Ολοκλήρωση...');
      const completeRes = await fetch(`/api/customers/${customerId}/files/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uploadTokenId, files: recorded }),
      });
      const completeJson = await completeRes.json() as { ok?: boolean };
      if (!completeRes.ok || !completeJson.ok) {
        setUploadError('Δεν ήταν δυνατή η ολοκλήρωση. Δοκίμασε ξανά.');
        setUploadingFiles(false);
        setUploadProgress(null);
        return;
      }

      setUploadingFiles(false);
      setUploadProgress(null);
      setFilesOpen(true);
      setRefreshTick(t => t + 1);
    } catch {
      setUploadError('Δεν ήταν δυνατό το ανέβασμα. Δοκίμασε ξανά.');
      setUploadingFiles(false);
      setUploadProgress(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Quick modal helpers
  // ---------------------------------------------------------------------------

  function closeQuickModal() {
    setQuickModal(null);
    setTaskTitle('');
    setTaskDate(getLocalDateInputValue());
    setTaskNote('');
    setTaskSaving(false);
    setTaskError(null);
    setTaskStep(1);
    setApptTitle('');
    setApptDate('');
    setApptTime('');
    setApptNote('');
    setApptSaving(false);
    setApptError(null);
    setApptStep(1);
    setApptSaved(false);
    setCreatedApptTask(null);
    setOfferSaveError(null);
  }

  function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Saves the appointment task and returns the created task (or null on
  // failure). Used by the wizard when entering step 4 ("Αποστολή"); the modal
  // stays open so the operator can pick Viber/Email. Validation is identical to
  // before; the wizard also guards each step, so reaching here means the three
  // required fields are present.
  async function saveAppointmentFromModal(): Promise<TaskDto | null> {
    if (!apptTitle.trim()) {
      setApptError('Συμπλήρωσε τίτλο ραντεβού.');
      return null;
    }
    if (!apptDate) {
      setApptError('Συμπλήρωσε ημερομηνία.');
      return null;
    }
    if (!apptTime) {
      setApptError('Συμπλήρωσε ώρα.');
      return null;
    }
    setApptSaving(true);
    setApptError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setApptSaving(false);
        setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
        return null;
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
      const json = await res.json() as { ok?: boolean; task?: TaskDto; error?: string };
      if (res.ok && json.ok && json.task) {
        setApptSaving(false);
        setApptSaved(true);
        setRefreshTick(t => t + 1);
        return json.task;
      } else {
        setApptSaving(false);
        setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
        return null;
      }
    } catch {
      setApptSaving(false);
      setApptError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
      return null;
    }
  }

  // Builds a mailto: link prefilled with the appointment title/date/time and,
  // when present, the customer's response link. Used by step 4 (Email option).
  function buildAppointmentMailto(responseUrl: string | null): string {
    const to = customer?.email ?? '';
    const subject = `Ραντεβού: ${apptTitle.trim()}`;
    const dt = apptTime ? `${apptDate} ${apptTime}` : apptDate;
    const lines = [
      'Καλησπέρα σας,',
      '',
      `Σας προτείνουμε ραντεβού με θέμα: ${apptTitle.trim()}.`,
      `Ημερομηνία και ώρα: ${dt}.`,
    ];
    if (responseUrl) {
      lines.push('', `Για επιβεβαίωση ή αλλαγή, χρησιμοποιήστε τον σύνδεσμο: ${responseUrl}`);
    }
    lines.push('', 'Ευχαριστούμε.');
    const body = lines.join('\n');
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // Wizard "Next" handler. When advancing into step 4, save the appointment
  // first (once) and, if the operator picked Viber later, the just-created task
  // drives the existing appointment-link send flow.
  async function appointmentWizardNext() {
    if (apptStep === 1) {
      if (!apptTitle.trim()) { setApptError('Συμπλήρωσε τίτλο ραντεβού.'); return; }
      setApptError(null);
      setApptStep(2);
      return;
    }
    if (apptStep === 2) {
      if (!apptDate) { setApptError('Συμπλήρωσε ημερομηνία.'); return; }
      setApptError(null);
      setApptStep(3);
      return;
    }
    if (apptStep === 3) {
      if (!apptTime) { setApptError('Συμπλήρωσε ώρα.'); return; }
      setApptError(null);
      // Save on entering the send step (only once).
      if (!apptSaved) {
        const created = await saveAppointmentFromModal();
        if (!created) return; // stay on step 3, error already shown
        setCreatedApptTask(created);
      }
      setApptStep(4);
    }
  }

  // Step 4 → Viber: close the wizard and open the existing appointment-link
  // review/send modal for the just-created appointment.
  function sendAppointmentViaViber() {
    if (!createdApptTask) return;
    const task = createdApptTask;
    closeQuickModal();
    void openApptLinkModal(task);
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
      const json = await res.json() as { ok?: boolean; error?: string; offer?: { id: string; offerNumber?: string } };
      if (res.ok && json.ok && json.offer?.id) {
        const savedOfferId = json.offer.id;
        const savedOfferNumber = json.offer.offerNumber ?? '';
        closeQuickModal();
        setRefreshTick(t => t + 1);

        // Always open the review modal immediately in loading state.
        setOfferSendReview({
          offerId: savedOfferId,
          offerNumber: savedOfferNumber,
          responseUrl: null,
          message: null,
          recipient: null,
          loading: true,
          sending: false,
          sent: false,
          error: null,
          copied: false,
        });

        // Fetch draft to populate responseUrl, message and recipient.
        try {
          const draftRes = await fetch(`/api/offers/${savedOfferId}/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ mode: 'draft' }),
          });
          const draftJson = await draftRes.json() as {
            ok?: boolean;
            responseUrl?: string;
            message?: string;
            recipient?: string | null;
          };
          if (draftRes.ok && draftJson.ok && draftJson.responseUrl && draftJson.message) {
            setOfferSendReview(prev => prev ? {
              ...prev,
              responseUrl: draftJson.responseUrl!,
              message: draftJson.message!,
              recipient: draftJson.recipient ?? null,
              loading: false,
              error: null,
            } : null);
          } else {
            setOfferSendReview(prev => prev ? {
              ...prev,
              loading: false,
              error: 'Η προσφορά αποθηκεύτηκε, αλλά δεν δημιουργήθηκε μήνυμα Viber.',
            } : null);
          }
        } catch {
          setOfferSendReview(prev => prev ? {
            ...prev,
            loading: false,
            error: 'Η προσφορά αποθηκεύτηκε, αλλά δεν δημιουργήθηκε μήνυμα Viber.',
          } : null);
        }
      } else {
        setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
      }
    } catch {
      setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
    }
  }

  async function openIntakeSendModal() {
    setActionError(null);
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setActionError('Δεν βρέθηκε σύνδεση. Δοκίμασε ξανά.');
      return;
    }

    setIntakeSendReview({
      responseUrl: null,
      message: null,
      recipient: null,
      loading: true,
      sending: false,
      sent: false,
      sentChannel: null,
      error: null,
      copied: false,
    });

    try {
      const draftRes = await fetch(`/api/customers/${customerId}/intake-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mode: 'draft' }),
      });
      const draftJson = await draftRes.json() as {
        ok?: boolean;
        responseUrl?: string;
        message?: string;
        recipient?: string | null;
      };
      if (draftRes.ok && draftJson.ok && draftJson.responseUrl && draftJson.message) {
        setIntakeSendReview(prev => prev ? {
          ...prev,
          responseUrl: draftJson.responseUrl!,
          message: draftJson.message!,
          recipient: draftJson.recipient ?? null,
          loading: false,
          error: null,
        } : null);
      } else {
        setIntakeSendReview(prev => prev ? {
          ...prev,
          loading: false,
          error: 'Δεν δημιουργήθηκε link στοιχείων. Δοκίμασε ξανά.',
        } : null);
      }
    } catch {
      setIntakeSendReview(prev => prev ? {
        ...prev,
        loading: false,
        error: 'Δεν δημιουργήθηκε link στοιχείων. Δοκίμασε ξανά.',
      } : null);
    }
  }

  async function openApptLinkModal(task: TaskDto) {
    setActionError(null);
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setActionError('Δεν βρέθηκε σύνδεση. Δοκίμασε ξανά.');
      return;
    }

    setApptLinkReview({
      taskId: task.id,
      responseUrl: null,
      message: null,
      recipient: null,
      loading: true,
      sending: false,
      sent: false,
      sentChannel: null,
      error: null,
      copied: false,
      warning: null,
    });

    try {
      const draftRes = await fetch(`/api/customers/${customerId}/appointment-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mode: 'draft', taskId: task.id }),
      });
      const draftJson = await draftRes.json() as {
        ok?: boolean;
        responseUrl?: string;
        message?: string;
        recipient?: string | null;
        warning?: string | null;
      };
      if (draftRes.ok && draftJson.ok && draftJson.responseUrl && draftJson.message) {
        setApptLinkReview(prev => prev ? {
          ...prev,
          responseUrl: draftJson.responseUrl!,
          message: draftJson.message!,
          recipient: draftJson.recipient ?? null,
          warning: draftJson.warning ?? null,
          loading: false,
          error: null,
        } : null);
      } else {
        setApptLinkReview(prev => prev ? {
          ...prev,
          loading: false,
          error: 'Δεν δημιουργήθηκε link ραντεβού. Δοκίμασε ξανά.',
        } : null);
      }
    } catch {
      setApptLinkReview(prev => prev ? {
        ...prev,
        loading: false,
        error: 'Δεν δημιουργήθηκε link ραντεβού. Δοκίμασε ξανά.',
      } : null);
    }
  }

  async function openUploadLinkModal() {
    setActionError(null);
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setActionError('Δεν βρέθηκε σύνδεση. Δοκίμασε ξανά.');
      return;
    }

    setUploadLinkReview({
      responseUrl: null,
      message: null,
      recipient: null,
      loading: true,
      sending: false,
      sent: false,
      sentChannel: null,
      error: null,
      copied: false,
    });

    try {
      const draftRes = await fetch(`/api/customers/${customerId}/upload-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mode: 'draft' }),
      });
      const draftJson = await draftRes.json() as {
        ok?: boolean;
        responseUrl?: string;
        message?: string;
        recipient?: string | null;
      };
      if (draftRes.ok && draftJson.ok && draftJson.responseUrl && draftJson.message) {
        setUploadLinkReview(prev => prev ? {
          ...prev,
          responseUrl: draftJson.responseUrl!,
          message: draftJson.message!,
          recipient: draftJson.recipient ?? null,
          loading: false,
          error: null,
        } : null);
      } else {
        setUploadLinkReview(prev => prev ? {
          ...prev,
          loading: false,
          error: 'Δεν δημιουργήθηκε link φωτογραφιών. Δοκίμασε ξανά.',
        } : null);
      }
    } catch {
      setUploadLinkReview(prev => prev ? {
        ...prev,
        loading: false,
        error: 'Δεν δημιουργήθηκε link φωτογραφιών. Δοκίμασε ξανά.',
      } : null);
    }
  }

  async function saveTaskFromModal() {
    if (!taskTitle.trim()) {
      setTaskError('Συμπλήρωσε τίτλο εργασίας.');
      return;
    }
    setTaskSaving(true);
    setTaskError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTaskSaving(false);
        setTaskError('Δεν αποθηκεύτηκε η εργασία. Δοκίμασε ξανά.');
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
        setTaskError('Δεν αποθηκεύτηκε η εργασία. Δοκίμασε ξανά.');
      }
    } catch {
      setTaskSaving(false);
      setTaskError('Δεν αποθηκεύτηκε η εργασία. Δοκίμασε ξανά.');
    }
  }

  // Task wizard "Next": validate the current step, then advance.
  function taskWizardNext() {
    if (taskStep === 1) {
      if (!taskTitle.trim()) { setTaskError('Συμπλήρωσε τι θέλετε να κάνετε.'); return; }
      setTaskError(null);
      setTaskStep(2);
      return;
    }
    if (taskStep === 2) {
      // Date is prefilled to today, but guard anyway.
      if (!taskDate) { setTaskError('Συμπλήρωσε ημερομηνία.'); return; }
      setTaskError(null);
      setTaskStep(3);
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
        <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">Φόρτωση καρτέλας πελάτη...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------
  if (pageState === 'no_session') {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:max-w-4xl">
        <div className="rounded-2xl bg-zinc-50 dark:bg-[#17232f] px-6 py-10 text-center ring-1 ring-zinc-100 dark:ring-white/10">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            Συνδέσου για να δεις την καρτέλα πελάτη.
          </p>
          <Link
            href="/login"
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
            className="mt-4 rounded-xl bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 ring-1 ring-zinc-200 dark:ring-white/10 transition hover:bg-zinc-50 dark:hover:bg-white/5"
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

  return (
    <div className="mx-auto w-full max-w-2xl md:max-w-4xl space-y-5 px-4 pt-5 pb-12">

      {/* Back nav */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/customers"
          className="font-medium text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Πελάτες
        </Link>
        <span className="text-zinc-300 dark:text-zinc-500">/</span>
        <span className="text-zinc-500 dark:text-zinc-400">{customer.crmNumber ?? customerTitle(customer)}</span>
      </div>

      {/* Hero card — name large, identifiers small, ONE status pill, tappable phone */}
      <section className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">
              {customerTitle(customer)}
            </h1>
            {customer.companyName && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{customer.companyName}</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(customer.status)}`}>
            {STATUS_LABELS[customer.status] ?? customer.status}
          </span>
        </div>
        {(customer.crmNumber || customer.source) && (
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {customer.crmNumber && <span>{customer.crmNumber}</span>}
            {customer.crmNumber && customer.source && <span> · </span>}
            {customer.source && <span>{SOURCE_LABELS[customer.source] ?? customer.source}</span>}
          </p>
        )}

        {/* Tappable phone (clearly visible) */}
        {hasPhone && telHref && (
          <a
            href={telHref}
            className="mt-3 inline-flex items-center gap-2 text-base font-semibold text-indigo-700 transition hover:text-indigo-800"
          >
            <span aria-hidden>📞</span>
            {customer.mobilePhone ?? customer.phone}
          </a>
        )}

        {customer.address && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{customer.address}</p>
        )}

        {/* Optional Χάρτης link — επεξεργασία γίνεται από την ενότητα «Στοιχεία επικοινωνίας» παρακάτω */}
        {editMode === null && customer.address && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              <span aria-hidden>📍</span>
              Χάρτης
            </a>
          </div>
        )}

        {/* #4 — Primary quick actions, immediately visible under the name.
            Replaces the old sticky bottom bar. 4-up grid, >=48px targets. */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {/* Κλήση */}
          {telHref ? (
            <a
              href={telHref}
              className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-indigo-600 px-2 py-2 text-white transition hover:bg-indigo-700 active:bg-indigo-800"
            >
              <span className="text-lg leading-none" aria-hidden>📞</span>
              <span className="text-xs font-semibold">Κλήση</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-zinc-100 dark:bg-[#1e2b38] px-2 py-2 text-zinc-400 dark:text-zinc-500"
            >
              <span className="text-lg leading-none opacity-60" aria-hidden>📞</span>
              <span className="text-xs font-semibold">Κλήση</span>
            </button>
          )}
          {/* Ραντεβού */}
          <button
            type="button"
            onClick={() => setQuickModal('appointment')}
            className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-indigo-50 px-2 py-2 text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200"
          >
            <span className="text-lg leading-none" aria-hidden>📅</span>
            <span className="text-xs font-semibold">Ραντεβού</span>
          </button>
          {/* Προσφορά */}
          <button
            type="button"
            onClick={() => setQuickModal('offer')}
            className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-indigo-50 px-2 py-2 text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200"
          >
            <span className="text-lg leading-none" aria-hidden>💶</span>
            <span className="text-xs font-semibold">Προσφορά</span>
          </button>
          {/* Άλλα */}
          <button
            type="button"
            onClick={() => setMoreSheetOpen(true)}
            className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-zinc-100 dark:bg-[#1e2b38] px-2 py-2 text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-200 active:bg-zinc-300 dark:hover:bg-white/5 dark:active:bg-white/5"
          >
            <span className="text-lg leading-none" aria-hidden>⋯</span>
            <span className="text-xs font-semibold">Άλλα</span>
          </button>
        </div>
      </section>

      {/* Next step — the main card of the page */}
      {(() => {
        // Reuse the existing next-best-action precedence to pick the single
        // primary CTA. draftTask -> openTasks -> pendingOffer -> openAppointment
        // -> missing info -> else "Νέα εργασία". A call-back is implied when the
        // active task type is call_back (or there is no pending offer/appt) and a
        // phone exists.
        const callImplied =
          hasPhone &&
          (draftTask?.type === 'call_back' ||
            (!draftTask &&
              openTasks.length > 0 &&
              (openTasks[0]?.type === 'call_back' || openTasks[0]?.type === 'follow_up_offer')));

        const hasMissingInfo = !customer.mobilePhone && !customer.phone;

        let ctaLabel = 'Νέα εργασία';
        let onCta: () => void = () => setQuickModal('task');
        let ctaHref: string | null = null;

        if (callImplied && telHref) {
          ctaLabel = 'Κλήση τώρα';
          ctaHref = telHref;
        } else if (pendingOffer) {
          ctaLabel = 'Στείλε προσφορά';
          onCta = () => setQuickModal('offer');
        } else if (openAppointment) {
          ctaLabel = 'Κλείσε ραντεβού';
          onCta = () => setQuickModal('appointment');
        } else if (hasMissingInfo) {
          ctaLabel = 'Ζήτησε στοιχεία';
          onCta = () => { void openIntakeSendModal(); };
        }

        const nothingPending =
          !draftTask && openTasks.length === 0 && !pendingOffer && !openAppointment;

        const tone = draftTask
          ? 'bg-amber-50 ring-1 ring-amber-200'
          : openTasks.length > 0
          ? 'bg-indigo-50 ring-1 ring-indigo-200'
          : 'bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10';

        return (
          <section className={`rounded-[28px] p-5 ${tone}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className={`text-sm font-semibold ${
                draftTask ? 'text-amber-700' : openTasks.length > 0 ? 'text-indigo-700' : 'text-zinc-700 dark:text-zinc-200'
              }`}>
                Επόμενο βήμα
              </h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                draftTask
                  ? 'bg-amber-100 text-amber-700'
                  : openTasks.length > 0
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-600 dark:text-zinc-300'
              }`}>
                {draftTask
                  ? 'Χρειάζεται έλεγχος'
                  : openTasks.length > 0
                  ? `${openTasks.length} ${openTasks.length === 1 ? 'ανοιχτή' : 'ανοιχτές'}`
                  : (pendingOffer || openAppointment)
                  ? 'Εκκρεμεί'
                  : 'Χωρίς εκκρεμότητες'}
              </span>
            </div>

            {draftTask ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    Πρόχειρο από AI
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
                  <p className="text-xs text-indigo-700">+{openTasks.length - 2} ακόμα...</p>
                )}
              </div>
            ) : pendingOffer ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Προσφορά</p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{pendingOffer.offerNumber}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  {OFFER_STATUS_LABELS[pendingOffer.status] ?? pendingOffer.status}
                  {' · '}
                  {formatMoney(pendingOffer.total)}
                </p>
              </div>
            ) : openAppointment ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Ραντεβού</p>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{openAppointment.title}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  {openAppointment.dueDate}
                  {openAppointment.dueTime ? ` ${openAppointment.dueTime}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">Δεν υπάρχει επείγουσα ενέργεια.</p>
            )}

            {(customer.statusSummary || customer.nextBestAction) && (
              <div className="mt-3 space-y-1 border-t border-zinc-200/70 dark:border-white/10 pt-3">
                {customer.statusSummary && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">{truncate(customer.statusSummary, 160)}</p>
                )}
                {customer.nextBestAction && (
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{truncate(customer.nextBestAction, 120)}</p>
                )}
              </div>
            )}

            {/* ONE primary CTA */}
            <div className="mt-4">
              {ctaHref ? (
                <a
                  href={ctaHref}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-5 text-base font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                  {ctaLabel}
                </a>
              ) : (
                <Button size="lg" fullWidth onClick={onCta}>
                  {ctaLabel}
                </Button>
              )}
              {nothingPending && (
                <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Όλα τακτοποιημένα για τώρα.
                </p>
              )}
            </div>
          </section>
        );
      })()}

      {/* Status line + change-status button (opens the status sheet) */}
      <section className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Κατάσταση</p>
            <p className="mt-0.5 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {STATUS_LABELS[customer.status] ?? customer.status}
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setStatusSheetOpen(true)}
            disabled={statusSaving !== null || editMode !== null}
          >
            Αλλαγή κατάστασης
          </Button>
        </div>
        {statusSaving && (
          <p className="mt-2 text-xs font-medium text-indigo-600">Αποθήκευση...</p>
        )}
        {editMode !== null && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Ολοκλήρωσε πρώτα την επεξεργασία στοιχείων για να αλλάξεις κατάσταση.</p>
        )}
        {statusError && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
            {statusError}
          </p>
        )}
      </section>

      {/* Action error (raised by intake/upload/appointment-link draft flows) */}
      {actionError && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-100">
          {actionError}
        </p>
      )}

      {/* Στοιχεία επικοινωνίας — default expanded; forced open while editing */}
      <CollapsibleSection
        title="Στοιχεία επικοινωνίας"
        open={editMode === 'contact' ? true : contactOpen}
        onToggle={setContactOpen}
      >
        <div className="px-4 py-4">
          {editMode === null && (
            <div className="mb-3 flex justify-start">
              <Button variant="secondary" size="sm" onClick={startEditContact}>
                Επεξεργασία
              </Button>
            </div>
          )}

          {customerSaveState === 'saved' && editMode === null && (
            <p className="mb-2 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 ring-1 ring-green-100">
              Αποθηκεύτηκε
            </p>
          )}

          {editMode === 'contact' && customerDraft ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Ονοματεπώνυμο</label>
                <input
                  type="text"
                  value={customerDraft.name ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, name: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Ονοματεπώνυμο"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Εταιρεία</label>
                <input
                  type="text"
                  value={customerDraft.companyName ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, companyName: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Εταιρεία"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Κινητό</label>
                <input
                  type="tel"
                  value={customerDraft.mobilePhone ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, mobilePhone: e.target.value || null, phone: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Κινητό"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Σταθερό</label>
                <input
                  type="tel"
                  value={customerDraft.landlinePhone ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, landlinePhone: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Σταθερό"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Email</label>
                <input
                  type="email"
                  value={customerDraft.email ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, email: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Email"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Διεύθυνση</label>
                <input
                  type="text"
                  value={customerDraft.address ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, address: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Διεύθυνση"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Προτιμώμενο κανάλι</label>
                <select
                  value={customerDraft.preferredContactMethod}
                  onChange={e => setCustomerDraft(d => d ? { ...d, preferredContactMethod: e.target.value } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {Object.entries(CONTACT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Πηγή</label>
                <select
                  value={customerDraft.source ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, source: e.target.value || null } : d)}
                  className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value=""> - Χωρίς πηγή - </option>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Ανάγκες πελάτη</label>
                <textarea
                  rows={3}
                  value={customerDraft.needsSummary ?? ''}
                  onChange={e => setCustomerDraft(d => d ? { ...d, needsSummary: e.target.value || null } : d)}
                  className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Ανάγκες πελάτη"
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
                  onClick={cancelEdit}
                  disabled={customerSaveState === 'saving'}
                  className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              {(customer.mobilePhone || customer.phone) && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Κινητό</dt>
                  <dd className="font-medium text-zinc-800 dark:text-zinc-200">{customer.mobilePhone ?? customer.phone}</dd>
                </div>
              )}
              {customer.landlinePhone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Σταθερό</dt>
                  <dd className="font-medium text-zinc-800 dark:text-zinc-200">{customer.landlinePhone}</dd>
                </div>
              )}
              {customer.email && (
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-zinc-400 dark:text-zinc-500">Email</dt>
                  <dd className="break-all font-medium text-zinc-800 dark:text-zinc-200">{customer.email}</dd>
                </div>
              )}
              {customer.address && (
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-zinc-400 dark:text-zinc-500">Διεύθυνση</dt>
                  <dd className="text-zinc-700 dark:text-zinc-200">{customer.address}</dd>
                </div>
              )}
              {customer.lastContactAt && (
                <div className="flex justify-between gap-2 border-t border-zinc-50 dark:border-white/10 pt-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Τελευταία επαφή</dt>
                  <dd className="text-zinc-600 dark:text-zinc-300">{formatDateShort(customer.lastContactAt)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400 dark:text-zinc-500">Δημιουργία</dt>
                <dd className="text-zinc-500 dark:text-zinc-400">{formatDateFull(customer.createdAt)}</dd>
              </div>
            </dl>
          )}
        </div>
      </CollapsibleSection>

      {/* Σύνοψη πελάτη (μνήμη + Πρόταση επόμενης κίνησης) — expanded if content */}
      <CollapsibleSection
        id="ws-memory"
        title="Σύνοψη πελάτη"
        description="Χειροκίνητες σημειώσεις για καλύτερη κατανόηση του πελάτη."
        open={editMode === 'memory' ? true : summaryOpen}
        onToggle={setSummaryOpen}
        headerAction={editMode === null ? (
          <Button variant="secondary" size="sm" onClick={startEditMemory}>
            Επεξεργασία
          </Button>
        ) : undefined}
      >
        {editMode === 'memory' && customerDraft ? (
          <div className="space-y-4 px-4 py-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Τρέχουσα κατάσταση</label>
              <textarea
                rows={2}
                value={customerDraft.statusSummary ?? ''}
                onChange={(e) => setCustomerDraft({ ...customerDraft, statusSummary: e.target.value || null })}
                placeholder="Σύντομη περιγραφή της τρέχουσας κατάστασης του πελάτη."
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Επαγγελματικές σημειώσεις</label>
              <textarea
                rows={3}
                value={customerDraft.businessNotes ?? ''}
                onChange={(e) => setCustomerDraft({ ...customerDraft, businessNotes: e.target.value || null })}
                placeholder="Πληροφορίες για την επαγγελματική δραστηριότητα, ανάγκες, προτιμήσεις."
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Προσωπικά που αξίζει να θυμόμαστε</label>
              <textarea
                rows={2}
                value={customerDraft.personalNotes ?? ''}
                onChange={(e) => setCustomerDraft({ ...customerDraft, personalNotes: e.target.value || null })}
                placeholder="Κράτα εδώ ανθρώπινες λεπτομέρειες που βοηθούν στη σχέση με τον πελάτη. Όχι ευαίσθητα δεδομένα χωρίς λόγο."
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition resize-none"
              />
              <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">Κράτα εδώ ανθρώπινες λεπτομέρειες που βοηθούν στη σχέση με τον πελάτη. Όχι ευαίσθητα δεδομένα χωρίς λόγο.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Επόμενη ενέργεια</label>
              <textarea
                rows={2}
                value={customerDraft.nextBestAction ?? ''}
                onChange={(e) => setCustomerDraft({ ...customerDraft, nextBestAction: e.target.value || null })}
                placeholder="Σύντομη υπενθύμιση για την επόμενη ενέργεια."
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition resize-none"
              />
              <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">Σύντομη υπενθύμιση. Για προθεσμία, χρησιμοποίησε εργασία.</p>
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
                onClick={cancelEdit}
                disabled={customerSaveState === 'saving'}
                className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {!customer.statusSummary && !customer.businessNotes && !customer.personalNotes && !customer.nextBestAction ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Δεν έχει συμπληρωθεί μνήμη πελάτη ακόμα.</p>
            ) : (
              <>
                {customer.statusSummary && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">Τρέχουσα κατάσταση</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{customer.statusSummary}</p>
                  </div>
                )}
                {customer.businessNotes && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">Επαγγελματικές σημειώσεις</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{customer.businessNotes}</p>
                  </div>
                )}
                {customer.personalNotes && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">Προσωπικά που αξίζει να θυμόμαστε</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{customer.personalNotes}</p>
                  </div>
                )}
                {customer.nextBestAction && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-0.5">Επόμενη ενέργεια</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{customer.nextBestAction}</p>
                  </div>
                )}
              </>
            )}
            {customer.memoryUpdatedAt && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 pt-1">
                Τελευταία ενημέρωση: {new Date(customer.memoryUpdatedAt).toLocaleString('el-GR', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            )}
            <CustomerSummaryFromCalls customerId={customer.id} onApplied={(c) => setCustomer(c as CustomerDto)} />
          </div>
        )}
      </CollapsibleSection>

      {/* Ιστορικό (timeline) — default collapsed */}
      <CollapsibleSection
        id="ws-timeline"
        title="Ιστορικό"
        description="Σημαντικές ενέργειες, απαντήσεις πελατών και αλλαγές θα φαίνονται εδώ."
        badge={timeline.length > 0 ? (
          <span className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {timeline.length}
          </span>
        ) : undefined}
      >
        {timeline.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
            Δεν υπάρχει ιστορικό ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/10">
            {timeline.map(entry =>
              entry.kind === 'comm' ? (
                <li
                  key={`c-${entry.item.id}`}
                  role={entry.item.channel === 'call' ? 'button' : undefined}
                  tabIndex={entry.item.channel === 'call' ? 0 : undefined}
                  className={`flex items-start gap-3 px-4 py-3 ${entry.item.channel === 'call' ? 'cursor-pointer transition hover:bg-indigo-50/50 active:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400' : ''}`}
                  onClick={entry.item.channel === 'call' ? () => setSelectedCall(entry.item) : undefined}
                  onKeyDown={entry.item.channel === 'call' ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCall(entry.item); } } : undefined}
                >
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${commDotClass(entry.item.channel)}`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-xs font-semibold ${entry.item.channel === 'call' ? 'text-indigo-600' : 'text-zinc-600 dark:text-zinc-300'}`}>
                        {commChannelLabel(entry.item.channel)}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                        {formatDateShort(entry.item.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {entry.item.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'}
                      </span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${commStatusBadgeClass(entry.item.status)}`}>
                        {commStatusLabel(entry.item.status)}
                      </span>
                    </div>
                    {entry.item.summary && (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {truncate(entry.item.summary.replace(/^AI brief[:\s]*/i, ''), 180)}
                      </p>
                    )}
                  </div>
                </li>
              ) : (
                <li key={`t-${entry.item.id}`} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${taskToneDot(entry.item.status, entry.item.priority)}`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Εργασία</span>
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                        {formatDateShort(entry.item.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{entry.item.title}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
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
      </CollapsibleSection>

      {/* Επόμενες εργασίες — default expanded when there are open tasks */}
      <CollapsibleSection
        id="ws-tasks"
        title="Επόμενες εργασίες"
        description="Ανοιχτές εργασίες και να ξαναμιλήσω."
        defaultOpen={openTasks.length > 0 || !!focusTaskId}
        badge={sortedTasks.length > 0 ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            openTasks.length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400'
          }`}>
            {openTasks.length > 0 ? `${openTasks.length} ανοιχτές` : sortedTasks.length}
          </span>
        ) : undefined}
      >
        {focusTaskId && (
          <div className="flex items-center justify-between gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5">
            <p className="text-xs font-medium text-indigo-700">Άνοιξες εργασία από τις Εργασίες</p>
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
          <EmptyState
            title="Δεν έχεις ανοιχτές εργασίες για αυτόν τον πελάτη."
            action={
              <Button onClick={() => setQuickModal('task')}>Νέα εργασία</Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 dark:divide-white/10">
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
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">από AI</span>
                      )}
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {PRIORITY_LABELS[t.priority] ?? t.priority}
                      </span>
                    </div>
                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">{t.title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {TASK_TYPE_LABELS[t.type] ?? t.type} · {t.dueDate}
                      {t.dueTime ? ` ${t.dueTime}` : ''}
                    </p>
                    {t.note && (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{truncate(t.note, 160)}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditTask(t)}
                    className="shrink-0 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#1e2b38] px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    Επεξεργασία
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-zinc-100 dark:border-white/10 px-4 py-3">
              <Button variant="secondary" size="sm" onClick={() => setQuickModal('task')}>
                Νέα εργασία
              </Button>
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Ραντεβού — default collapsed */}
      <CollapsibleSection
        id="ws-appointments"
        title="Ραντεβού"
        description="Ραντεβού, απαντήσεις πελάτη και αλλαγές ώρας."
        badge={appointmentTasks.length > 0 ? (
          <span className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {appointmentTasks.length}
          </span>
        ) : undefined}
        headerAction={
          <button
            type="button"
            aria-label="Νέο ραντεβού"
            onClick={() => setQuickModal('appointment')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        }
      >
        {appointmentTasks.length === 0 ? (
          <EmptyState
            title="Δεν υπάρχουν ραντεβού ακόμα για αυτόν τον πελάτη."
            action={
              <Button onClick={() => setQuickModal('appointment')}>Νέο ραντεβού</Button>
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/10">
            {appointmentTasks.map(task => (
              <li key={task.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {TASK_TYPE_LABELS[task.type] ?? task.type}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>
                        {appointmentStatusLabel(task)}
                      </span>
                      {task.createdFromAi && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">από AI</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{task.title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {task.dueDate}{task.dueTime ? ` ${task.dueTime}` : ''}
                    </p>
                    {task.note && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">{truncate(task.note, 120)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditTask(task)}
                      className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#1e2b38] px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-100 dark:hover:bg-white/5"
                    >
                      Επεξεργασία
                    </button>
                    {task.status !== 'cancelled' && task.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => openApptLinkModal(task)}
                        disabled={!customer.mobilePhone && !customer.phone}
                        className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#1e2b38] px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-100 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-50 dark:disabled:hover:bg-[#1e2b38]"
                      >
                        Αποστολή link ραντεβού
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* Προσφορές — default collapsed */}
      <CollapsibleSection
        id="ws-offers"
        title="Προσφορές"
        description="Προσφορές, κατάσταση και να ξαναμιλήσω."
        badge={sortedOffers.length > 0 ? (
          <span className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {sortedOffers.length}
          </span>
        ) : undefined}
        headerAction={
          <button
            type="button"
            aria-label="Νέα προσφορά"
            onClick={() => setQuickModal('offer')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        }
      >
        {editOfferError && !editingOffer && (
          <p className="px-4 pt-3 text-xs font-medium text-red-600">{editOfferError}</p>
        )}
        {sortedOffers.length === 0 ? (
          <EmptyState
            title="Δεν έχει σταλεί προσφορά ακόμα."
            action={
              <Button onClick={() => setQuickModal('offer')}>Νέα προσφορά</Button>
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/10">
            {sortedOffers.map(offer => (
              <li key={offer.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{offer.offerNumber}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${offerStatusBadgeClass(offer.status)}`}>
                        {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
                      </span>
                      {offer.createdFromAi && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">από AI</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {offer.offerDate ?? ''}
                      {offer.offerDate && offer.validUntil ? ' · ' : ''}
                      {offer.validUntil ? `Ισχύει έως ${offer.validUntil}` : ''}
                    </p>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{formatMoney(offer.total)}</p>
                    {offer.notes && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">{truncate(offer.notes, 120)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditOffer(offer.id)}
                      disabled={editingOfferLoading === offer.id}
                      className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#1e2b38] px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-100 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#1e2b38] px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-100 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Αντέγραψε το link χειροκίνητα:</p>
                    <textarea
                      readOnly
                      rows={2}
                      value={offerLinkManualCopyUrl}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0f1923] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 outline-none"
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
      </CollapsibleSection>

      {/* D. Notes: backend-backed section, comes before placeholders */}
      <CollapsibleSection
        id="ws-notes"
        title="Σημειώσεις"
        description="Εσωτερικές σημειώσεις και ιστορικό."
        open={editMode === 'notes' ? true : notesOpen}
        onToggle={setNotesOpen}
        headerAction={editMode === null ? (
          <Button variant="secondary" size="sm" onClick={startEditNotes}>
            Επεξεργασία
          </Button>
        ) : undefined}
      >
        {editMode === 'notes' && customerDraft ? (
          <div className="px-4 py-4 space-y-3">
            <textarea
              rows={6}
              value={customerDraft.notes ?? ''}
              onChange={e => setCustomerDraft(d => d ? { ...d, notes: e.target.value || null } : d)}
              className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="Σημειώσεις"
            />
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
                onClick={cancelEdit}
                disabled={customerSaveState === 'saving'}
                className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        ) : (
          <>
            {customer.notes ? (
              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                {customer.notes}
              </p>
            ) : (
              <p className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
                Δεν υπάρχουν σημειώσεις ακόμα.
              </p>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* Αρχεία — default collapsed; manual upload (+) and gallery viewer */}
      <CollapsibleSection
        id="ws-files"
        title="Αρχεία"
        description="Φωτογραφίες και βίντεο που ανέβασε ο πελάτης."
        open={filesOpen}
        onToggle={setFilesOpen}
        badge={uploadSessions.length > 0 ? (
          <span className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {uploadSessions.length}
          </span>
        ) : undefined}
        headerAction={
          <button
            type="button"
            aria-label="Προσθήκη αρχείων"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        }
      >
        {/* Hidden input shared by the (+) header action and the inner button. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_UPLOAD_MIME.join(',')}
          className="hidden"
          onChange={(e) => { void handleManualFilesSelected(e.target.files); }}
        />

        {/* Upload affordance + progress/error */}
        <div className="border-b border-zinc-100 dark:border-white/10 px-4 py-3 space-y-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            loading={uploadingFiles}
            disabled={uploadingFiles}
          >
            {uploadingFiles ? 'Ανεβαίνει...' : 'Προσθήκη φωτογραφιών / αρχείων'}
          </Button>
          {uploadProgress ? (
            <p className="text-xs font-medium text-indigo-600">{uploadProgress}</p>
          ) : null}
          {uploadError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
              {uploadError}
            </p>
          ) : null}
        </div>

        {uploadSessions.length > 0 ? (
          <div className="divide-y divide-zinc-100 dark:divide-white/10">
            {uploadSessions.map(session => (
              <div key={session.id} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {formatDateShort(session.uploaded_at)}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {session.file_count} {session.file_count === 1 ? 'αρχείο' : 'αρχεία'}
                  </span>
                </div>
                {/* Thumbnail grid — tap opens the FileGallery at that file. */}
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {session.files.map((f, idx) => (
                    <FileThumb
                      key={idx}
                      file={f}
                      onOpen={() => openGalleryAt(session.id, idx)}
                      resolveUrl={
                        f.kind === 'photo'
                          ? () => resolveGalleryUrl({ sessionId: session.id, fileIndex: idx, name: f.name, kind: 'image', mimeType: f.mimeType })
                          : null
                      }
                    />
                  ))}
                </div>
                {session.customer_comment ? (
                  <p className="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
                    &ldquo;{session.customer_comment}&rdquo;
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Δεν υπάρχουν αρχεία ακόμα. Πρόσθεσε φωτογραφίες/αρχεία ή στείλε link φωτογραφιών στον πελάτη.
            </p>
          </div>
        )}
      </CollapsibleSection>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setRefreshTick(t => t + 1)}
          className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-xs font-medium text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-50 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Ανανέωση σελίδας
        </button>
      </div>

      {/* Απόρριψη πελάτη (#5): one danger button → multi-channel send sheet.
          The customer is marked «Χάθηκε» on open; the polite message is shown
          ready to send via Viber / WhatsApp / Email (nothing is auto-sent). */}
      <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Απόρριψη πελάτη</h2>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Ο πελάτης θα μαρκαριστεί ως «Χάθηκε» και θα ετοιμαστεί ευγενικό μήνυμα για αποστολή.
        </p>
        <Button
          variant="danger"
          size="md"
          onClick={openRejectSheet}
          className="mt-3"
        >
          Απόρριψη πελάτη
        </Button>
      </section>

      {/* Call details modal */}
      {selectedCall !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={() => setSelectedCall(null)}
        >
          <div
            className="mx-4 my-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Περίληψη κλήσης</h2>
              <button
                type="button"
                onClick={() => setSelectedCall(null)}
                aria-label="Κλείσιμο"
                className="rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{selectedCall.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'}</span>
              {selectedCall.createdAt && (
                <span>{formatDateFull(selectedCall.createdAt)}</span>
              )}
            </div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">Περίληψη κλήσης</p>
            {selectedCall.summary ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                {selectedCall.summary.replace(/^AI brief[:\s]*/i, '')}
              </p>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">Δεν υπάρχει διαθέσιμη περίληψη για αυτή την κλήση.</p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCall(null)}
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
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
            className="mx-4 w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] bg-white dark:bg-[#17232f] shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[28px] bg-white dark:bg-[#17232f] px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-white/10">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Η αποστολή στον πελάτη θα γίνει σε επόμενο βήμα.
              </p>
              <button
                type="button"
                onClick={closeQuickModal}
                aria-label="Κλείσιμο"
                className="shrink-0 rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
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

      {/* Offer send review modal */}
      {offerSendReview !== null && (
        <SendViaViberModal
          title={
            offerSendReview.offerNumber
              ? `Αποστολή προσφοράς ${offerSendReview.offerNumber}`
              : 'Αποστολή προσφοράς'
          }
          loadingText="Δημιουργία link απάντησης..."
          successText="Η προσφορά στάλθηκε με Viber."
          openLabel="Άνοιγμα link"
          loading={offerSendReview.loading}
          message={offerSendReview.message}
          recipient={offerSendReview.recipient}
          responseUrl={offerSendReview.responseUrl}
          sending={offerSendReview.sending}
          sent={offerSendReview.sent}
          error={offerSendReview.error}
          copied={offerSendReview.copied}
          onClose={() => { setOfferSendReview(null); setRefreshTick(t => t + 1); }}
          onSend={() =>
            executeViberSend({
              endpoint: `/api/offers/${offerSendReview.offerId}/notify`,
              body: { responseUrl: offerSendReview.responseUrl },
              update: (patch) => setOfferSendReview((prev) => (prev ? { ...prev, ...patch } : null)),
              providerUnavailableMsg:
                'Το Viber δεν είναι διαθέσιμο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα και να το στείλεις χειροκίνητα.',
              defaultFallbackMsg: 'Δεν έγινε αποστολή Viber. Δοκίμασε ξανά ή αντέγραψε το μήνυμα.',
            })
          }
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(offerSendReview.message ?? '');
              setOfferSendReview((prev) => (prev ? { ...prev, copied: true } : null));
            } catch {
              // clipboard unavailable
            }
          }}
        />
      )}

      {/* Appointment send review — multi-channel (Viber / Email αυτόματα, ή WhatsApp/SMS) */}
      <SendChannelSheet
        open={apptLinkReview !== null}
        onClose={() => { setApptLinkReview(null); setRefreshTick(t => t + 1); }}
        title="Επιβεβαίωση ραντεβού"
        subtitle={
          apptLinkReview?.warning === 'missing_appointment_time'
            ? 'Η ώρα/ημερομηνία ραντεβού δεν έχει συμπληρωθεί — το μήνυμα δεν θα περιέχει ώρα.'
            : 'Διάλεξε τρόπο: Viber, WhatsApp ή Email.'
        }
        loading={apptLinkReview?.loading}
        loadingText="Ετοιμάζεται το link ραντεβού..."
        message={apptLinkReview?.message ?? null}
        link={apptLinkReview?.responseUrl ?? null}
        recipientPhone={customer.mobilePhone ?? customer.phone}
        recipientEmail={customer.email}
        emailSubject="Επιβεβαίωση ραντεβού"
        viber={{
          kind: 'backend',
          onSend: () =>
            executeViberSend({
              endpoint: `/api/customers/${customerId}/appointment-link`,
              body: { taskId: apptLinkReview?.taskId, responseUrl: apptLinkReview?.responseUrl },
              update: (patch) => setApptLinkReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'viber' as const } : {}) } : null)),
              providerUnavailableMsg: 'Το Viber δεν είναι διαθέσιμο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
              defaultFallbackMsg: 'Δεν έγινε αποστολή. Μπορείς να αντιγράψεις το μήνυμα και να το στείλεις χειροκίνητα.',
            }),
          sending: apptLinkReview?.sending && apptLinkReview?.sentChannel === 'viber',
          sent: apptLinkReview?.sent && apptLinkReview?.sentChannel === 'viber',
          error: apptLinkReview?.sentChannel === 'viber' ? apptLinkReview?.error : null,
        }}
        email={
          customer.email
            ? {
                kind: 'backend',
                onSend: () =>
                  executeViberSend({
                    endpoint: `/api/customers/${customerId}/appointment-link`,
                    body: { taskId: apptLinkReview?.taskId, responseUrl: apptLinkReview?.responseUrl, channel: 'email' },
                    update: (patch) => setApptLinkReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'email' as const } : {}) } : null)),
                    providerUnavailableMsg: 'Το email δεν είναι ρυθμισμένο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
                    defaultFallbackMsg: 'Δεν έγινε αποστολή με email. Μπορείς να αντιγράψεις το μήνυμα.',
                  }),
                sending: apptLinkReview?.sending && apptLinkReview?.sentChannel === 'email',
                sent: apptLinkReview?.sent && apptLinkReview?.sentChannel === 'email',
                error: apptLinkReview?.sentChannel === 'email' ? apptLinkReview?.error : null,
              }
            : null
        }
      />

      {/* Upload link review — multi-channel (Viber / Email αυτόματα, ή WhatsApp/SMS) */}
      <SendChannelSheet
        open={uploadLinkReview !== null}
        onClose={() => { setUploadLinkReview(null); setRefreshTick(t => t + 1); }}
        title="Αίτημα φωτογραφιών"
        subtitle="Διάλεξε τρόπο: Viber, WhatsApp ή Email."
        loading={uploadLinkReview?.loading}
        loadingText="Ετοιμάζεται το link φωτογραφιών..."
        message={uploadLinkReview?.message ?? null}
        link={uploadLinkReview?.responseUrl ?? null}
        recipientPhone={customer.mobilePhone ?? customer.phone}
        recipientEmail={customer.email}
        emailSubject="Αποστολή φωτογραφιών"
        viber={{
          kind: 'backend',
          onSend: () =>
            executeViberSend({
              endpoint: `/api/customers/${customerId}/upload-link`,
              body: { responseUrl: uploadLinkReview?.responseUrl },
              update: (patch) => setUploadLinkReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'viber' as const } : {}) } : null)),
              providerUnavailableMsg: 'Το Viber δεν είναι διαθέσιμο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
              defaultFallbackMsg: 'Δεν έγινε αποστολή. Μπορείς να αντιγράψεις το μήνυμα και να το στείλεις χειροκίνητα.',
            }),
          sending: uploadLinkReview?.sending && uploadLinkReview?.sentChannel === 'viber',
          sent: uploadLinkReview?.sent && uploadLinkReview?.sentChannel === 'viber',
          error: uploadLinkReview?.sentChannel === 'viber' ? uploadLinkReview?.error : null,
        }}
        email={
          customer.email
            ? {
                kind: 'backend',
                onSend: () =>
                  executeViberSend({
                    endpoint: `/api/customers/${customerId}/upload-link`,
                    body: { responseUrl: uploadLinkReview?.responseUrl, channel: 'email' },
                    update: (patch) => setUploadLinkReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'email' as const } : {}) } : null)),
                    providerUnavailableMsg: 'Το email δεν είναι ρυθμισμένο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
                    defaultFallbackMsg: 'Δεν έγινε αποστολή με email. Μπορείς να αντιγράψεις το μήνυμα.',
                  }),
                sending: uploadLinkReview?.sending && uploadLinkReview?.sentChannel === 'email',
                sent: uploadLinkReview?.sent && uploadLinkReview?.sentChannel === 'email',
                error: uploadLinkReview?.sentChannel === 'email' ? uploadLinkReview?.error : null,
              }
            : null
        }
      />

      {/* Quick action modals */}
      {quickModal !== null && quickModal !== 'offer' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={closeQuickModal}
        >
          <div
            className="mx-4 my-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >

            {/* Task wizard */}
            {quickModal === 'task' && (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Νέα εργασία</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Step indicator */}
                <div className="mb-4 flex items-center gap-2">
                  <p className="text-xs font-medium text-indigo-600">Βήμα {taskStep}/3</p>
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3].map(n => (
                      <span
                        key={n}
                        className={`h-1.5 flex-1 rounded-full ${n <= taskStep ? 'bg-indigo-500' : 'bg-zinc-200 dark:bg-[#1e2b38]'}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Step 1: τίτλος */}
                {taskStep === 1 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Τι θέλετε να κάνετε;</label>
                    <input
                      autoFocus
                      type="text"
                      value={taskTitle}
                      onChange={e => setTaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && taskTitle.trim()) { e.preventDefault(); taskWizardNext(); } }}
                      placeholder="π.χ. Να καλέσω για επιβεβαίωση."
                      className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Το επόμενο βήμα που θέλετε να θυμάστε.</p>
                  </div>
                )}

                {/* Step 2: ημερομηνία (deadline) */}
                {taskStep === 2 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Ημερομηνία (deadline)</label>
                    <input
                      type="date"
                      value={taskDate}
                      onChange={e => setTaskDate(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Προκαθορισμένη ημερομηνία: σήμερα.</p>
                  </div>
                )}

                {/* Step 3: σημείωση */}
                {taskStep === 3 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Σημείωση</label>
                    <textarea
                      rows={4}
                      value={taskNote}
                      onChange={e => setTaskNote(e.target.value)}
                      placeholder="Προαιρετική σημείωση."
                      className="w-full resize-none rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Προαιρετικό.</p>
                  </div>
                )}

                {taskError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{taskError}</p>
                )}

                {/* Wizard nav */}
                <div className="mt-5 flex gap-2">
                  {taskStep > 1 && (
                    <button
                      type="button"
                      onClick={() => { setTaskError(null); setTaskStep(s => Math.max(1, s - 1)); }}
                      disabled={taskSaving}
                      className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
                    >
                      Πίσω
                    </button>
                  )}
                  {taskStep < 3 ? (
                    <button
                      type="button"
                      onClick={taskWizardNext}
                      disabled={taskStep === 1 && !taskTitle.trim()}
                      className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Επόμενο
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={saveTaskFromModal}
                      disabled={!taskTitle.trim() || taskSaving}
                      className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {taskSaving ? 'Αποθηκεύεται...' : 'Αποθήκευση'}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Appointment wizard */}
            {quickModal === 'appointment' && (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Ραντεβού</h2>
                  <button
                    type="button"
                    onClick={closeQuickModal}
                    aria-label="Κλείσιμο"
                    className="rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Step indicator */}
                <div className="mb-4 flex items-center gap-2">
                  <p className="text-xs font-medium text-indigo-600">Βήμα {apptStep}/4</p>
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3, 4].map(n => (
                      <span
                        key={n}
                        className={`h-1.5 flex-1 rounded-full ${n <= apptStep ? 'bg-indigo-500' : 'bg-zinc-200 dark:bg-[#1e2b38]'}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Step 1: τίτλος ραντεβού (η αιτία) */}
                {apptStep === 1 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Τίτλος ραντεβού</label>
                    <input
                      autoFocus
                      type="text"
                      value={apptTitle}
                      onChange={e => setApptTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && apptTitle.trim()) { e.preventDefault(); void appointmentWizardNext(); } }}
                      placeholder="π.χ. Συνάντηση αξιολόγησης"
                      className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Η αιτία του ραντεβού.</p>
                  </div>
                )}

                {/* Step 2: ημερομηνία */}
                {apptStep === 2 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Ημερομηνία</label>
                    <input
                      autoFocus
                      type="date"
                      value={apptDate}
                      onChange={e => setApptDate(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                )}

                {/* Step 3: ώρα */}
                {apptStep === 3 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Ώρα</label>
                    <input
                      autoFocus
                      type="time"
                      value={apptTime}
                      onChange={e => setApptTime(e.target.value)}
                      className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                )}

                {/* Step 4: αποστολή ραντεβού */}
                {apptStep === 4 && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-100 dark:ring-white/10">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{apptTitle.trim()}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{apptTime ? `${apptDate} · ${apptTime}` : apptDate}</p>
                    </div>
                    {apptSaving ? (
                      <div className="flex items-center gap-3 py-2">
                        <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-200 dark:border-white/10 border-t-indigo-500" />
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">Αποθήκευση ραντεβού...</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Αποστολή ραντεβού</p>
                        <div className="grid grid-cols-2 gap-3">
                          {/* Viber */}
                          <button
                            type="button"
                            onClick={sendAppointmentViaViber}
                            disabled={!createdApptTask}
                            className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-[#7360F2] px-3 py-4 text-center transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M12.01 2C6.74 2 3 5.3 3 10.06c0 2.13.77 4.02 2.2 5.46.27.27.4.65.36 1.03l-.2 2.07c-.05.5.46.87.92.66l2.3-1.05c.27-.12.57-.14.86-.06.78.2 1.6.31 2.47.31 5.27 0 9.01-3.3 9.01-8.06C20.99 5.3 17.27 2 12.01 2z" />
                            </svg>
                            <span className="text-xs font-semibold text-white">Viber</span>
                          </button>
                          {/* Email */}
                          {customer.email ? (
                            <a
                              href={buildAppointmentMailto(null)}
                              className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-3 py-4 text-center transition hover:bg-indigo-700"
                            >
                              <svg className="h-7 w-7 text-white" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                              </svg>
                              <span className="text-xs font-semibold text-white">Email</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              title="Ο πελάτης δεν έχει email"
                              className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-zinc-100 dark:bg-[#1e2b38] px-3 py-4 text-center cursor-not-allowed"
                            >
                              <svg className="h-7 w-7 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                              </svg>
                              <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">Email</span>
                            </button>
                          )}
                        </div>
                        {!customer.email && (
                          <p className="text-xs text-zinc-400 dark:text-zinc-500">Ο πελάτης δεν έχει email. Πρόσθεσέ το από τα στοιχεία επικοινωνίας για αποστολή με email.</p>
                        )}
                        <p className="text-xs text-green-600">Το ραντεβού αποθηκεύτηκε. Διάλεξε τρόπο αποστολής ή κλείσε.</p>
                      </>
                    )}
                  </div>
                )}

                {apptError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{apptError}</p>
                )}

                {/* Wizard nav */}
                <div className="mt-5 flex gap-2">
                  {apptStep > 1 && apptStep < 4 && (
                    <button
                      type="button"
                      onClick={() => { setApptError(null); setApptStep(s => Math.max(1, s - 1)); }}
                      disabled={apptSaving}
                      className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
                    >
                      Πίσω
                    </button>
                  )}
                  {apptStep < 4 ? (
                    <button
                      type="button"
                      onClick={appointmentWizardNext}
                      disabled={
                        apptSaving ||
                        (apptStep === 1 && !apptTitle.trim()) ||
                        (apptStep === 2 && !apptDate) ||
                        (apptStep === 3 && !apptTime)
                      }
                      className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {apptStep === 3 ? (apptSaving ? 'Αποθηκεύεται...' : 'Επόμενο') : 'Επόμενο'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={closeQuickModal}
                      className="flex-1 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                    >
                      Κλείσιμο
                    </button>
                  )}
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
            className="mx-4 w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] bg-white dark:bg-[#17232f] shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[28px] bg-white dark:bg-[#17232f] px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-white/10">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Επεξεργασία προσφοράς</h2>
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                  Η αποστολή στον πελάτη γίνεται μόνο από ξεχωριστό βήμα.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditOffer}
                aria-label="Κλείσιμο"
                className="shrink-0 rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
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
            className="mx-4 w-full max-w-lg rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {editingTask.type === 'book_appointment' || editingTask.type === 'visit_customer'
                  ? 'Επεξεργασία ραντεβού'
                  : 'Επεξεργασία εργασίας'}
              </h2>
              <button
                type="button"
                onClick={closeEditTask}
                aria-label="Κλείσιμο"
                className="rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Τίτλος</label>
                <input
                  type="text"
                  value={editTaskTitle}
                  onChange={e => setEditTaskTitle(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Ημερομηνία</label>
                <input
                  type="date"
                  value={editTaskDate}
                  onChange={e => setEditTaskDate(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Ώρα</label>
                <input
                  type="time"
                  value={editTaskTime}
                  onChange={e => setEditTaskTime(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">Σημείωση</label>
                <textarea
                  rows={3}
                  value={editTaskNote}
                  onChange={e => setEditTaskNote(e.target.value)}
                  className="w-full resize-none rounded-2xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File gallery (#1c) — full-screen photo/video lightbox */}
      <FileGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        files={galleryFiles}
        initialIndex={galleryIndex}
        resolveUrl={resolveGalleryUrl}
      />

      {/* Απόρριψη πελάτη — multi-channel send sheet (#5) */}
      <SendChannelSheet
        open={rejectSheetOpen}
        onClose={() => setRejectSheetOpen(false)}
        title="Απόρριψη πελάτη"
        subtitle="Ο πελάτης θα μαρκαριστεί ως «Χάθηκε». Δεν στέλνεται τίποτα μέχρι να επιλέξεις τρόπο."
        message={buildDefaultRejectMessage()}
        recipientPhone={customer.mobilePhone ?? customer.phone}
        recipientEmail={customer.email}
        viber={{ kind: 'forward' }}
        onChannelUse={markRejectedLost}
      />

      {/* Αποστολή link στοιχείων — multi-channel send sheet (#6) */}
      <SendChannelSheet
        open={intakeSendReview != null}
        onClose={() => { setIntakeSendReview(null); setRefreshTick(t => t + 1); }}
        title="Αίτημα στοιχείων"
        subtitle="Διάλεξε τρόπο: Viber, WhatsApp ή Email."
        loading={intakeSendReview?.loading}
        loadingText="Ετοιμάζεται το μήνυμα..."
        message={intakeSendReview?.message ?? null}
        link={intakeSendReview?.responseUrl ?? null}
        recipientPhone={customer.mobilePhone ?? customer.phone}
        recipientEmail={customer.email}
        emailSubject="Στοιχεία επικοινωνίας"
        viber={{
          kind: 'backend',
          onSend: () =>
            executeViberSend({
              endpoint: `/api/customers/${customerId}/intake-link`,
              body: { responseUrl: intakeSendReview?.responseUrl },
              update: (patch) => setIntakeSendReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'viber' as const } : {}) } : null)),
              providerUnavailableMsg: 'Το Viber δεν είναι διαθέσιμο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
              defaultFallbackMsg: 'Δεν έγινε αποστολή. Μπορείς να αντιγράψεις το μήνυμα και να το στείλεις χειροκίνητα.',
            }),
          sending: intakeSendReview?.sending && intakeSendReview?.sentChannel === 'viber',
          sent: intakeSendReview?.sent && intakeSendReview?.sentChannel === 'viber',
          error: intakeSendReview?.sentChannel === 'viber' ? intakeSendReview?.error : null,
        }}
        email={
          customer.email
            ? {
                kind: 'backend',
                onSend: () =>
                  executeViberSend({
                    endpoint: `/api/customers/${customerId}/intake-link`,
                    body: { responseUrl: intakeSendReview?.responseUrl, channel: 'email' },
                    update: (patch) => setIntakeSendReview((prev) => (prev ? { ...prev, ...patch, ...((patch.sending || patch.sent) ? { sentChannel: 'email' as const } : {}) } : null)),
                    providerUnavailableMsg: 'Το email δεν είναι ρυθμισμένο αυτή τη στιγμή. Μπορείς να αντιγράψεις το μήνυμα.',
                    defaultFallbackMsg: 'Δεν έγινε αποστολή με email. Μπορείς να αντιγράψεις το μήνυμα.',
                  }),
                sending: intakeSendReview?.sending && intakeSendReview?.sentChannel === 'email',
                sent: intakeSendReview?.sent && intakeSendReview?.sentChannel === 'email',
                error: intakeSendReview?.sentChannel === 'email' ? intakeSendReview?.error : null,
              }
            : null
        }
      />

      {/* "Άλλα" bottom sheet (overflow for the hero quick-action row) */}
      <BottomSheet
        open={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title="Άλλες ενέργειες"
        description="Διάλεξε τι θέλεις να κάνεις."
      >
        <div className="space-y-0.5">
          <SheetRow
            icon={<span aria-hidden>📝</span>}
            label="Σημείωση"
            description="Πρόσθεσε εσωτερική σημείωση"
            disabled={editMode !== null}
            onClick={() => { setMoreSheetOpen(false); startEditNotes(); }}
          />
          <SheetRow
            icon={<span aria-hidden>📋</span>}
            label="Αίτημα στοιχείων"
            description={hasPhone ? undefined : 'Χρειάζεται τηλέφωνο'}
            disabled={!hasPhone}
            onClick={() => { setMoreSheetOpen(false); void openIntakeSendModal(); }}
          />
          <SheetRow
            icon={<span aria-hidden>📷</span>}
            label="Αίτημα φωτογραφιών"
            description={hasPhone ? undefined : 'Χρειάζεται τηλέφωνο'}
            disabled={!hasPhone}
            onClick={() => { setMoreSheetOpen(false); void openUploadLinkModal(); }}
          />
          <SheetRow
            icon={<span aria-hidden>✨</span>}
            label="Σύνοψη κλήσεων με AI"
            description="Πρόταση επόμενης κίνησης"
            onClick={() => revealSection('ws-memory', setSummaryOpen)}
          />
          {customer.address && (
            <SheetRow
              icon={<span aria-hidden>📍</span>}
              label="Χάρτης"
              description="Άνοιγμα διεύθυνσης στους χάρτες"
              onClick={() => {
                setMoreSheetOpen(false);
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address!)}`,
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
            />
          )}
        </div>
      </BottomSheet>

      {/* Status bottom sheet — lists the 7 statuses; highlights the current */}
      <BottomSheet
        open={statusSheetOpen}
        onClose={() => setStatusSheetOpen(false)}
        title="Αλλαγή κατάστασης"
        description="Διάλεξε την τρέχουσα κατάσταση του πελάτη."
      >
        <div className="space-y-0.5">
          {Object.entries(STATUS_LABELS).map(([key, label]) => {
            const active = customer.status === key;
            return (
              <SheetRow
                key={key}
                label={label}
                onClick={() => { setStatusSheetOpen(false); void updateCustomerStatus(key); }}
                trailing={active ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    Τρέχουσα
                  </span>
                ) : undefined}
              />
            );
          })}
        </div>
      </BottomSheet>

    </div>
  );
}

// ---------------------------------------------------------------------------
// FileThumb — a single tappable thumbnail in the Files grid (#1c).
// Images lazily resolve a signed URL (once visible) and render a small <img>;
// videos/other files show a glyph and never fetch. Tapping opens the gallery.
// ---------------------------------------------------------------------------
function FileThumb({
  file,
  onOpen,
  resolveUrl,
}: {
  file: UploadSessionFileDto;
  onOpen: () => void;
  resolveUrl: (() => Promise<string | null>) | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!resolveUrl || url) return;
    const el = ref.current;
    let cancelled = false;
    const run = () => {
      void resolveUrl().then((u) => { if (!cancelled && u) setUrl(u); });
    };
    if (!el || typeof IntersectionObserver === 'undefined') {
      run();
      return () => { cancelled = true; };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [resolveUrl, url]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={file.name}
      className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-[#1e2b38] ring-1 ring-zinc-200/60 dark:ring-white/10 transition hover:ring-indigo-300 active:ring-indigo-400"
    >
      {file.kind === 'photo' && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="text-2xl leading-none" aria-hidden>
          {file.kind === 'photo' ? '📷' : file.kind === 'video' ? '🎥' : '📄'}
        </span>
      )}
      {file.kind === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      )}
    </button>
  );
}
