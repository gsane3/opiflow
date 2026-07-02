'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  isDictationSupported,
  startDictation,
  transcribeAudioBlob,
  type DictationSession,
} from '@/lib/speech';
import type { Task, Customer, BusinessProfile, TaskType, TaskPriority, Offer } from '@/lib/types';
import type { CmdReviewResult } from '@/lib/ai/cmd-schema';

// ---------------------------------------------------------------------------
// Backend DTOs (read context only)
// ---------------------------------------------------------------------------

interface BackendBusinessDto {
  id: string;
  name: string | null;
  type: string | null;
  default_vat_rate: number | null;
  default_offer_terms: string | null;
  default_acceptance_text: string | null;
}

interface BackendCustomerDto {
  id: string;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
  source: string | null;
  preferredContactMethod: string | null;
  needsSummary: string | null;
  notes: string | null;
  crmNumber: string | null;
  createdAt: string;
  updatedAt: string;
  lastContactAt: string | null;
}

interface BackendTaskDto {
  id: string;
  customerId: string | null;
  offerId: string | null;
  title: string;
  type: string | null;
  status: string | null;
  priority: string | null;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  createdFromAi: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BackendOfferDto {
  id: string;
  customerId: string | null;
  relatedTaskId: string | null;
  offerNumber: string;
  status: string | null;
  offerDate: string | null;
  validUntil: string | null;
  items: { id?: string; description: string; quantity: number; unitPrice: number }[] | null;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptanceText: string | null;
  createdFromAi: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapBackendBusiness(dto: BackendBusinessDto): Partial<BusinessProfile> {
  return {
    id: dto.id,
    businessName: dto.name ?? '',
    businessType: (dto.type ?? 'other') as BusinessProfile['businessType'],
    defaultVatRate: dto.default_vat_rate ?? 24,
    defaultOfferTerms: dto.default_offer_terms ?? '',
    defaultAcceptanceText: dto.default_acceptance_text ?? 'Αποδέχομαι τους παραπάνω όρους.',
  };
}

function mapBackendCustomer(dto: BackendCustomerDto): Customer {
  return {
    id: dto.id,
    name: dto.name ?? dto.companyName ?? dto.crmNumber ?? '',
    companyName: dto.companyName ?? '',
    phone: dto.phone ?? '',
    mobilePhone: dto.mobilePhone ?? '',
    landlinePhone: dto.landlinePhone ?? '',
    email: dto.email ?? '',
    address: dto.address ?? '',
    status: (dto.status ?? 'new_lead') as Customer['status'],
    source: (dto.source ?? 'manual_entry') as Customer['source'],
    preferredContactMethod: dto.preferredContactMethod ?? 'phone',
    needsSummary: dto.needsSummary ?? '',
    notes: dto.notes ?? '',
    crmNumber: dto.crmNumber ?? '',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  } as unknown as Customer;
}

function mapBackendTask(dto: BackendTaskDto): Task {
  return {
    id: dto.id,
    customerId: dto.customerId ?? undefined,
    offerId: dto.offerId ?? undefined,
    title: dto.title,
    type: (dto.type ?? 'other') as TaskType,
    status: (dto.status ?? 'open') as Task['status'],
    priority: (dto.priority ?? 'normal') as TaskPriority,
    dueDate: dto.dueDate,
    dueTime: dto.dueTime ?? undefined,
    note: dto.note ?? '',
    createdFromAi: dto.createdFromAi,
    completedAt: dto.completedAt ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  } as unknown as Task;
}

function mapBackendOffer(dto: BackendOfferDto): Offer {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: dto.id,
    customerId: dto.customerId ?? undefined,
    offerNumber: dto.offerNumber,
    status: (dto.status ?? 'draft') as Offer['status'],
    offerDate: dto.offerDate ?? today,
    validUntil: dto.validUntil ?? dto.offerDate ?? today,
    items: Array.isArray(dto.items) ? dto.items : [],
    subtotal: dto.subtotal ?? 0,
    vatRate: dto.vatRate ?? 24,
    vatAmount: dto.vatAmount ?? 0,
    total: dto.total ?? 0,
    notes: dto.notes ?? '',
    terms: dto.terms ?? '',
    acceptanceText: dto.acceptanceText ?? '',
    createdFromAi: dto.createdFromAi,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  } as unknown as Offer;
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Χαμηλή',
  normal: 'Κανονική',
  high: 'Υψηλή',
};

const APPT_TYPE_LABELS: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη σε πελάτη',
};

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findCustomerCandidates(name: string | undefined, customers: Customer[]): Customer[] {
  if (!name?.trim()) return [];
  const q = normalizeText(name.trim());
  return customers.filter((c) => normalizeText(c.name).includes(q));
}

function CustomerCandidatePicker({
  candidates,
  selectedId,
  onSelect,
  onContinueWithout,
}: {
  candidates: Customer[];
  selectedId?: string;
  onSelect: (c: Customer) => void;
  onContinueWithout: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Βρέθηκαν πολλοί πελάτες. Διάλεξε τον σωστό:</p>
      <div className="space-y-1.5">
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
              c.id === selectedId
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-zinc-200 bg-white hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-[#17232f] dark:hover:bg-white/5'
            }`}
          >
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">{c.name}</p>
            {(c.mobilePhone || c.phone) && <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.mobilePhone || c.phone}</p>}
            {c.email && <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.email}</p>}
            {c.address && <p className="text-xs text-zinc-400 dark:text-zinc-500">{c.address}</p>}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onContinueWithout}
        className="text-xs text-zinc-400 hover:text-zinc-600 transition dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        Συνέχεια χωρίς σύνδεση πελάτη
      </button>
    </div>
  );
}

function fmtEur(n: number): string {
  return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

const CMD_EXAMPLES = [
  'Ποια ραντεβού έχω σήμερα;',
  'Ξεκίνα έργο για τον Παπαδόπουλο, ανακαίνιση κουζίνας',
  'Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10',
  'Στείλε προσφορά στον Αλεξάνδρου, υλικά 3500 ευρώ, εργατικά 500',
  'Δημιούργησε task να καλέσω τον Δημητρίου αύριο',
  'Ακύρωσε το ραντεβού με τον Καραγιάννη αύριο',
];

function computeApptCandidates(
  params: { dueDate?: string; dueTime?: string; appointmentType?: string },
  customerId: string | null,
  filterByCustomer: boolean,
  allTasks: Task[],
  customerMap: Record<string, string>
): (Task & { customerName?: string })[] {
  let pool = allTasks.filter(
    (t) => (t.type === 'book_appointment' || t.type === 'visit_customer') && t.status === 'open'
  );
  if (filterByCustomer && customerId) {
    pool = pool.filter((t) => t.customerId === customerId);
  }
  if (params.dueDate) {
    pool = pool.filter((t) => t.dueDate === params.dueDate);
  }
  if (params.dueTime) {
    pool = pool.filter((t) => t.dueTime === params.dueTime);
  }
  if (params.appointmentType) {
    pool = pool.filter((t) => (t.type as string) === params.appointmentType);
  }
  return pool.map((t) => ({
    ...t,
    customerName: t.customerId ? customerMap[t.customerId] : undefined,
  }));
}

function filterByRange(tasks: Task[], range: string): Task[] {
  const today = todayStr();
  const tomorrow = addDaysStr(1);
  const week = addDaysStr(7);
  return tasks.filter((t) => {
    if (t.type !== 'book_appointment' && t.type !== 'visit_customer') return false;
    if (t.status !== 'open') return false;
    if (range === 'today') return t.dueDate === today;
    if (range === 'tomorrow') return t.dueDate === tomorrow;
    if (range === 'week') return t.dueDate >= today && t.dueDate <= week;
    return true; // 'all'
  });
}

export default function CmdPage() {
  const [cmdInput, setCmdInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cmdError, setCmdError] = useState('');
  const [result, setResult] = useState<CmdReviewResult | null>(null);
  const [savedResult, setSavedResult] = useState(false);

  const [queryAppointments, setQueryAppointments] = useState<(Task & { customerName?: string })[]>([]);
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [noCustomerMatch, setNoCustomerMatch] = useState(false);
  const [customerCandidates, setCustomerCandidates] = useState<Customer[]>([]);
  const [customerMatchResolved, setCustomerMatchResolved] = useState(false);

  const [appointmentCandidates, setAppointmentCandidates] = useState<(Task & { customerName?: string })[]>([]);
  const [confirmingCancelApptId, setConfirmingCancelApptId] = useState<string | null>(null);
  const [cancelApptSuccess, setCancelApptSuccess] = useState(false);
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<string | null>(null);
  const [cancelAppointmentError, setCancelAppointmentError] = useState<string | null>(null);

  const [offerPreviewData, setOfferPreviewData] = useState<{
    validItems: { description: string; quantity: number; unitPrice: number }[];
    subtotal: number;
    vatAmount: number;
    total: number;
    vatRate: number;
  } | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<Partial<BusinessProfile> | null>(null);

  const [backendCustomers, setBackendCustomers] = useState<Customer[]>([]);
  const [backendTasks, setBackendTasks] = useState<Task[]>([]);
  const [backendOffers, setBackendOffers] = useState<Offer[]>([]);
  const [backendContextState, setBackendContextState] = useState<'loading' | 'ready' | 'no_session' | 'error'>('loading');
  const [backendContextError, setBackendContextError] = useState<string | null>(null);

  const [isSavingTask, setIsSavingTask] = useState(false);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);

  const [isSavingAppointment, setIsSavingAppointment] = useState(false);
  const [appointmentSaveError, setAppointmentSaveError] = useState<string | null>(null);

  const [isSavingOffer, setIsSavingOffer] = useState(false);
  const [offerSaveError, setOfferSaveError] = useState<string | null>(null);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [invoiceSaveError, setInvoiceSaveError] = useState<string | null>(null);
  const [issuedInvoiceMark, setIssuedInvoiceMark] = useState<string | null>(null);
  const [offerSaveWarning, setOfferSaveWarning] = useState<string | null>(null);

  // create_project + the «πώς να ονομάσω το έργο;» popup for appointments/offers.
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [createdProjectCustomerId, setCreatedProjectCustomerId] = useState<string | null>(null);
  const [projectTitleInput, setProjectTitleInput] = useState('');
  // When set, the project-name popup is open for an appointment/offer that is
  // ready to be filed into a (to-be-named) project. null = popup closed.
  const [projectModalKind, setProjectModalKind] = useState<'appointment' | 'offer' | null>(null);
  // (#5) When the matched customer already has open projects, offer to file into
  // one instead of always creating a new project.
  const [folderPicker, setFolderPicker] = useState<{ kind: 'appointment' | 'offer'; folders: Array<{ id: string; title: string; status: string }> } | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);

  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const dictationRef = useRef<DictationSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const detected = isDictationSupported();

    async function loadBackendContext() {
      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) {
          setBackendContextState('error');
          setBackendContextError('Το backend δεν είναι ρυθμισμένο.');
          setBusinessProfile(null);
          setBackendCustomers([]);
          setBackendTasks([]);
          setBackendOffers([]);
          setSpeechSupported(detected);
          setHydrated(true);
        }
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) {
            setBackendContextState('no_session');
            setBusinessProfile(null);
            setBackendCustomers([]);
            setBackendTasks([]);
            setBackendOffers([]);
            setSpeechSupported(detected);
            setHydrated(true);
          }
          return;
        }

        const headers = { Authorization: `Bearer ${session.access_token}` };
        const [bizRes, custRes, tasksRes, offersRes] = await Promise.all([
          fetch('/api/businesses/me', { headers }),
          fetch('/api/customers?limit=100', { headers }),
          fetch('/api/tasks?limit=100', { headers }),
          fetch('/api/offers?limit=100', { headers }),
        ]);

        if (cancelled) return;

        let bp: Partial<BusinessProfile> | null = null;
        try {
          if (bizRes.ok) {
            const bizJson = await bizRes.json() as { business?: BackendBusinessDto };
            if (bizJson.business) bp = mapBackendBusiness(bizJson.business);
          }
        } catch { /* non-fatal */ }

        let customers: Customer[] = [];
        try {
          if (custRes.ok) {
            const custJson = await custRes.json() as { ok?: boolean; customers?: BackendCustomerDto[] };
            customers = (custJson.customers ?? []).map(mapBackendCustomer);
          }
        } catch { /* non-fatal */ }

        let tasks: Task[] = [];
        try {
          if (tasksRes.ok) {
            const tasksJson = await tasksRes.json() as { ok?: boolean; tasks?: BackendTaskDto[] };
            tasks = (tasksJson.tasks ?? []).map(mapBackendTask);
          }
        } catch { /* non-fatal */ }

        let offers: Offer[] = [];
        try {
          if (offersRes.ok) {
            const offersJson = await offersRes.json() as { ok?: boolean; offers?: BackendOfferDto[] };
            offers = (offersJson.offers ?? []).map(mapBackendOffer);
          }
        } catch { /* non-fatal */ }

        if (!cancelled) {
          setBusinessProfile(bp);
          setBackendCustomers(customers);
          setBackendTasks(tasks);
          setBackendOffers(offers);
          setBackendContextState('ready');
        }
      } catch {
        if (!cancelled) {
          setBackendContextState('error');
        }
      } finally {
        if (!cancelled) {
          setSpeechSupported(detected);
          setHydrated(true);
        }
      }
    }

    loadBackendContext();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      dictationRef.current?.cancel();
    };
  }, []);

  // Deep-link «Σημείωση κλήσης» (Base home card): /cmd?dictate=1 auto-starts
  // the dictation once the page is ready — same behaviour as the native /cmd.
  // window.location instead of useSearchParams: no Suspense boundary needed.
  const autoDictatedRef = useRef(false);
  useEffect(() => {
    if (autoDictatedRef.current || !hydrated || !speechSupported) return;
    if (!new URLSearchParams(window.location.search).has('dictate')) return;
    autoDictatedRef.current = true;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, speechSupported]);

  async function startListening() {
    setCmdError('');
    setInterimText('');
    const session = await startDictation({
      onBlob: (blob) => {
        // Recording finished → transcribe server-side and append to the box.
        setIsListening(false);
        setInterimText('Μεταγραφή…');
        void transcribeAudioBlob(blob)
          .then((text) => {
            setCmdInput((prev) => {
              const t = prev.trim();
              return t ? t + ' ' + text : text;
            });
          })
          .catch(() => {
            setCmdError('Η μεταγραφή απέτυχε. Δοκίμασε ξανά ή γράψε την εντολή.');
          })
          .finally(() => setInterimText(''));
      },
      onError: (kind) => {
        setIsListening(false);
        setInterimText('');
        setCmdError(
          kind === 'denied'
            ? 'Δεν δόθηκε πρόσβαση στο μικρόφωνο.'
            : 'Η ηχογράφηση απέτυχε. Γράψε την εντολή.',
        );
      },
    });
    if (session) {
      dictationRef.current = session;
      setIsListening(true);
    }
  }

  function stopListening() {
    dictationRef.current?.stop();
    dictationRef.current = null;
  }

  async function handleSubmit() {
    const text = cmdInput.trim();
    if (!text) return;
    setIsLoading(true);
    setCmdError('');
    setResult(null);
    setSavedResult(false);
    setIsSavingTask(false);
    setTaskSaveError(null);
    setIsSavingAppointment(false);
    setAppointmentSaveError(null);
    setIsSavingOffer(false);
    setOfferSaveError(null);
    setOfferSaveWarning(null);
    setQueryAppointments([]);
    setMatchedCustomer(null);
    setNoCustomerMatch(false);
    setCustomerCandidates([]);
    setCustomerMatchResolved(false);
    setAppointmentCandidates([]);
    setConfirmingCancelApptId(null);
    setCancelApptSuccess(false);
    setCancellingAppointmentId(null);
    setCancelAppointmentError(null);
    setOfferPreviewData(null);

    try {
      let authHeader: Record<string, string> = {};
      try {
        const supabase = createBrowserSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session) authHeader = { Authorization: `Bearer ${session.access_token}` };
      } catch {
        // Fall through; the route returns 401 and we surface the standard error.
      }
      const res = await fetch('/api/ai/cmd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          inputText: text,
          businessType: businessProfile?.businessType,
          businessName: businessProfile?.businessName,
        }),
      });
      const data = (await res.json()) as { ok: boolean; result?: CmdReviewResult; error?: string };

      if (!data.ok || !data.result) {
        setCmdError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
        return;
      }

      const r = data.result;
      setResult(r);

      const customers = backendCustomers;
      const tasks = backendTasks;
      const customerMap: Record<string, string> = Object.fromEntries(
        customers.map((c) => [c.id, c.name])
      );

      if (r.intent === 'query_appointments') {
        const filtered = filterByRange(tasks, r.params.dateRange ?? 'today').map((t) => ({
          ...t,
          customerName: t.customerId ? customerMap[t.customerId] : undefined,
        }));
        setQueryAppointments(filtered);
      }

      let localMatchedCustomer: Customer | null = null;
      let localCustomerResolved = false;
      if (r.intent === 'create_task' || r.intent === 'create_project' || r.intent === 'create_appointment' || r.intent === 'create_offer' || r.intent === 'create_invoice' || r.intent === 'cancel_appointment') {
        const hasName = !!r.params.customerName?.trim();
        const candidates = findCustomerCandidates(r.params.customerName, customers);
        if (!hasName) {
          setCustomerCandidates([]);
          setMatchedCustomer(null);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(true);
          localCustomerResolved = true;
        } else if (candidates.length === 0) {
          setCustomerCandidates([]);
          setMatchedCustomer(null);
          setNoCustomerMatch(true);
          setCustomerMatchResolved(true);
          localCustomerResolved = true;
        } else if (candidates.length === 1) {
          setCustomerCandidates([]);
          setMatchedCustomer(candidates[0]);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(true);
          localMatchedCustomer = candidates[0];
          localCustomerResolved = true;
        } else {
          setCustomerCandidates(candidates);
          setMatchedCustomer(null);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(false);
        }
      }

      if (r.intent === 'cancel_appointment') {
        if (localCustomerResolved) {
          const filterByCustomer = !!r.params.customerName?.trim() && !!localMatchedCustomer;
          const cMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
          setAppointmentCandidates(computeApptCandidates(
            { dueDate: r.params.dueDate, dueTime: r.params.dueTime, appointmentType: r.params.appointmentType },
            localMatchedCustomer?.id ?? null, filterByCustomer, tasks, cMap
          ));
        }
      }

      if (r.intent === 'create_offer') {
        const items = (r.params.offerItems ?? []).filter((i) => i.description.trim());
        const vat = businessProfile?.defaultVatRate ?? 24;
        const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vatAmt = Number((sub * vat / 100).toFixed(2));
        setOfferPreviewData({ validItems: items, subtotal: sub, vatAmount: vatAmt, total: Number((sub + vatAmt).toFixed(2)), vatRate: vat });
      }
    } catch {
      setCmdError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveTask() {
    if (!result) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    setIsSavingTask(true);
    setTaskSaveError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTaskSaveError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customerId: matchedCustomer?.id ?? null,
          title: result.params.title?.trim() || 'Νέο task',
          type: 'other',
          status: 'open',
          priority: result.params.priority ?? 'normal',
          dueDate: result.params.dueDate || todayStr(),
          dueTime: result.params.dueTime || null,
          note: result.params.note || null,
        }),
      });
      const json = await res.json() as { ok?: boolean; task?: BackendTaskDto; error?: string };
      if (res.ok && json.ok && json.task) {
        setBackendTasks((prev) => [...prev, mapBackendTask(json.task!)]);
        setTaskSaveError(null);
        setSavedResult(true);
      } else {
        setTaskSaveError('Δεν αποθηκεύτηκε το task. Δοκίμασε ξανά.');
      }
    } catch {
      setTaskSaveError('Δεν αποθηκεύτηκε το task. Δοκίμασε ξανά.');
    } finally {
      setIsSavingTask(false);
    }
  }

  // When workFolderId is set, the appointment is filed into that project and the
  // customer is auto-notified with the portal link (the existing project flow) —
  // i.e. the appointment is actually "booked" with the customer. Without it, the
  // appointment stays internal (no customer notification).
  async function handleSaveAppointment(workFolderId?: string) {
    if (!result) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    const defaultTitle = matchedCustomer
      ? `Ραντεβού με ${matchedCustomer.name}`
      : 'Νέο ραντεβού';
    setIsSavingAppointment(true);
    setAppointmentSaveError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAppointmentSaveError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
        return false;
      }
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customerId: matchedCustomer?.id ?? null,
          title: result.params.title?.trim() || defaultTitle,
          type: result.params.appointmentType ?? 'book_appointment',
          status: 'open',
          priority: result.params.priority ?? 'normal',
          dueDate: result.params.dueDate || todayStr(),
          dueTime: result.params.dueTime || null,
          note: result.params.note || null,
          ...(workFolderId ? { workFolderId } : {}),
        }),
      });
      const json = await res.json() as { ok?: boolean; task?: BackendTaskDto; error?: string };
      if (res.ok && json.ok && json.task) {
        setBackendTasks((prev) => [...prev, mapBackendTask(json.task!)]);
        setAppointmentSaveError(null);
        setSavedResult(true);
        return true;
      }
      setAppointmentSaveError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
      return false;
    } catch {
      setAppointmentSaveError('Δεν αποθηκεύτηκε το ραντεβού. Δοκίμασε ξανά.');
      return false;
    } finally {
      setIsSavingAppointment(false);
    }
  }

  // With workFolderId: the offer is filed into that project as `ready_to_send`,
  // which (via the offers API) notifies the customer with the portal link — the
  // actual "send". Without it: a `draft` is created plus a «review & send»
  // follow-up task (the original draft-only behaviour, kept for the no-project path).
  // (#6) Fill in a missing price (unitPrice 0) and recompute the totals live.
  function updateOfferItemPrice(idx: number, price: number) {
    setOfferPreviewData((prev) => {
      if (!prev) return prev;
      const items = prev.validItems.map((it, i) => (i === idx ? { ...it, unitPrice: price } : it));
      const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const vatAmount = Number((subtotal * prev.vatRate / 100).toFixed(2));
      return { ...prev, validItems: items, subtotal, vatAmount, total: Number((subtotal + vatAmount).toFixed(2)) };
    });
    setOfferSaveError(null);
  }

  async function handleSaveOffer(workFolderId?: string) {
    if (!result || !offerPreviewData || offerPreviewData.validItems.length === 0) return false;
    if (customerCandidates.length > 1 && !customerMatchResolved) return false;
    // (#6) Every line must have a price before the offer can be saved/sent.
    const missing = offerPreviewData.validItems.filter((i) => !(i.unitPrice > 0));
    if (missing.length > 0) {
      setOfferSaveError(`Βάλε τιμή σε όλα τα είδη: ${missing.map((i) => i.description).join(', ')}`);
      return false;
    }
    const { validItems, vatRate } = offerPreviewData;
    const intoProject = !!workFolderId;
    setIsSavingOffer(true);
    setOfferSaveError(null);
    setOfferSaveWarning(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setOfferSaveError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
        return false;
      }
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      };
      // Create offer (backend generates offerNumber and calculates totals)
      const offerRes = await fetch('/api/offers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerId: matchedCustomer?.id ?? null,
          status: intoProject ? 'ready_to_send' : 'draft',
          items: validItems.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
          vatRate,
          notes: result.params.offerNotes || null,
          terms: result.params.offerTerms || businessProfile?.defaultOfferTerms || null,
          acceptanceText: businessProfile?.defaultAcceptanceText ?? 'Αποδέχομαι τους παραπάνω όρους.',
          createdFromAi: true,
          ...(workFolderId ? { workFolderId } : {}),
        }),
      });
      const offerJson = await offerRes.json() as { ok?: boolean; offer?: BackendOfferDto; error?: string };
      if (!offerRes.ok || !offerJson.ok || !offerJson.offer) {
        setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
        return false;
      }
      const createdOffer = offerJson.offer;
      setBackendOffers((prev) => [...prev, mapBackendOffer(createdOffer)]);
      // No-project path: add a «review & send» follow-up task (non-fatal).
      // Project path: the offer was already sent into the project, so no task.
      if (!intoProject) {
        try {
          const taskRes = await fetch('/api/tasks', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              customerId: matchedCustomer?.id ?? null,
              offerId: createdOffer.id,
              title: 'Έλεγχος και αποστολή προσφοράς',
              type: 'send_offer',
              status: 'open',
              priority: 'normal',
              dueDate: todayStr(),
              dueTime: null,
              note: 'Δημιουργήθηκε από AI εντολή. Έλεγξε την προσφορά πριν τη στείλεις.',
            }),
          });
          const taskJson = await taskRes.json() as { ok?: boolean; task?: BackendTaskDto; error?: string };
          if (taskRes.ok && taskJson.ok && taskJson.task) {
            setBackendTasks((prev) => [...prev, mapBackendTask(taskJson.task!)]);
            setOfferSaveWarning(null);
          } else {
            setOfferSaveWarning('Η προσφορά δημιουργήθηκε, αλλά δεν δημιουργήθηκε task follow-up.');
          }
        } catch {
          setOfferSaveWarning('Η προσφορά δημιουργήθηκε, αλλά δεν δημιουργήθηκε task follow-up.');
        }
      }
      setSavedResult(true);
      return true;
    } catch {
      setOfferSaveError('Δεν αποθηκεύτηκε η προσφορά. Δοκίμασε ξανά.');
      return false;
    } finally {
      setIsSavingOffer(false);
    }
  }

  // create_invoice: issue an official myDATA document via /api/invoicing/issue.
  // Fully gated server-side (503 when the provider isn't configured / 409 when the
  // tenant hasn't activated). Customer is optional (no ΑΦΜ → B2C retail receipt).
  async function handleSaveInvoice() {
    if (!result) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    const amount = result.params.invoiceAmount;
    if (!amount || amount <= 0) {
      setInvoiceSaveError('Δεν αναγνωρίστηκε ποσό για το τιμολόγιο.');
      return;
    }
    setIsSavingInvoice(true);
    setInvoiceSaveError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setInvoiceSaveError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
        return;
      }
      const res = await fetch('/api/invoicing/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          amount,
          description: result.params.invoiceDescription?.trim() || 'Παροχή υπηρεσιών',
          vatRate: result.params.invoiceVatRate ?? (businessProfile?.defaultVatRate ?? 24),
          ...(matchedCustomer?.id ? { customerId: matchedCustomer.id } : {}),
        }),
      });
      if (res.status === 503) {
        setInvoiceSaveError('Η τιμολόγηση μέσω εφαρμογής δεν είναι ενεργοποιημένη ακόμη.');
        return;
      }
      const json = await res.json() as { ok?: boolean; invoice?: { status?: string; mark?: string | null; error?: string | null }; error?: string };
      if (res.ok && json.ok && json.invoice) {
        if (json.invoice.status === 'issued' && json.invoice.mark) {
          setIssuedInvoiceMark(json.invoice.mark);
          setSavedResult(true);
        } else {
          setInvoiceSaveError(json.invoice.error || 'Το τιμολόγιο δεν εκδόθηκε. Δοκίμασε ξανά.');
        }
      } else {
        const code = json.error;
        setInvoiceSaveError(
          code === 'invoicing_not_enabled' ? 'Ενεργοποίησε πρώτα την τιμολόγηση από τις Ρυθμίσεις.'
            : code === 'issuer_vat_missing' ? 'Συμπλήρωσε το ΑΦΜ έκδοσης στις Ρυθμίσεις τιμολόγησης.'
              : 'Το τιμολόγιο δεν εκδόθηκε. Δοκίμασε ξανά.',
        );
      }
    } catch {
      setInvoiceSaveError('Το τιμολόγιο δεν εκδόθηκε. Δοκίμασε ξανά.');
    } finally {
      setIsSavingInvoice(false);
    }
  }

  // A sensible default name for the «πώς να ονομάσω το έργο;» popup.
  function suggestProjectTitle(): string {
    const fromAi = result?.params.projectTitle?.trim();
    if (fromAi) return fromAi;
    const fromTitle = result?.params.title?.trim();
    if (fromTitle) return fromTitle;
    // Το έργο ζει ήδη κάτω από τον πελάτη — ΔΕΝ βάζουμε το όνομά του στον τίτλο
    // (κατέληγε ως «… — Όνομα» και στη δημόσια σελίδα του τελικού πελάτη).
    return 'Νέο έργο';
  }

  // POST a work folder under the matched customer; returns its id or null.
  async function createFolderForCustomer(customerId: string, title: string): Promise<string | null> {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const res = await fetch(`/api/customers/${customerId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ title: title.trim() || 'Νέο έργο' }),
      });
      const json = await res.json() as { ok?: boolean; folder?: { id: string }; error?: string };
      if (res.ok && json.ok && json.folder?.id) return json.folder.id;
      return null;
    } catch {
      return null;
    }
  }

  // create_project: open a new Έργο for the matched customer.
  async function handleSaveProject() {
    if (!result || !matchedCustomer) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    setIsSavingProject(true);
    setProjectSaveError(null);
    const folderId = await createFolderForCustomer(matchedCustomer.id, projectTitleInput || suggestProjectTitle());
    setIsSavingProject(false);
    if (folderId) {
      setCreatedProjectCustomerId(matchedCustomer.id);
      setSavedResult(true);
    } else {
      setProjectSaveError('Δεν δημιουργήθηκε το έργο. Δοκίμασε ξανά.');
    }
  }

  // Open the project-name popup for an appointment/offer (only when a customer is
  // matched — a project needs a customer). Prefills the AI-suggested name.
  function openProjectModal(kind: 'appointment' | 'offer') {
    setProjectSaveError(null);
    setProjectTitleInput(suggestProjectTitle());
    setProjectModalKind(kind);
  }

  // (#5) Before creating a NEW project, check if the customer already has open
  // ones — if so let the user pick (file into it) or create new. No open folders
  // → straight to the new-project popup (unchanged behaviour).
  async function startFiling(kind: 'appointment' | 'offer') {
    if (!matchedCustomer) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    if (kind === 'offer' && offerNeedsPrice) return;
    setLoadingFolders(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const res = await fetch(`/api/customers/${matchedCustomer.id}/folders`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json() as { ok?: boolean; folders?: Array<{ id: string; title: string; status: string }> };
        const open = (json.folders ?? []).filter((f) => f.status !== 'completed' && f.status !== 'cancelled' && f.status !== 'lost');
        if (open.length > 0) {
          setFolderPicker({ kind, folders: open });
          setLoadingFolders(false);
          return;
        }
      }
    } catch {
      // fall through to new-project popup
    }
    setLoadingFolders(false);
    openProjectModal(kind);
  }

  // (#5) File the action into an EXISTING project the user picked.
  async function fileIntoExistingFolder(folderId: string) {
    if (!folderPicker) return;
    const kind = folderPicker.kind;
    setFolderPicker(null);
    setIsSavingProject(true);
    const ok = kind === 'appointment' ? await handleSaveAppointment(folderId) : await handleSaveOffer(folderId);
    setIsSavingProject(false);
    if (ok && matchedCustomer) setCreatedProjectCustomerId(matchedCustomer.id);
  }

  // Popup confirm: create the named project, then file the appointment/offer into
  // it (which notifies the customer = the actual book/send).
  async function confirmProjectModal() {
    if (!result || !matchedCustomer || !projectModalKind) return;
    const kind = projectModalKind;
    setIsSavingProject(true);
    setProjectSaveError(null);
    const folderId = await createFolderForCustomer(matchedCustomer.id, projectTitleInput || suggestProjectTitle());
    if (!folderId) {
      setIsSavingProject(false);
      setProjectSaveError('Δεν δημιουργήθηκε το έργο. Δοκίμασε ξανά.');
      return;
    }
    const ok = kind === 'appointment'
      ? await handleSaveAppointment(folderId)
      : await handleSaveOffer(folderId);
    setIsSavingProject(false);
    if (ok) {
      setCreatedProjectCustomerId(matchedCustomer.id);
      setProjectModalKind(null);
    } else {
      setProjectSaveError('Το έργο δημιουργήθηκε, αλλά η ενέργεια απέτυχε. Δες την καρτέλα του πελάτη.');
    }
  }

  // Create a brand-new customer from the spoken name when none matched, so the
  // assistant can still start a project / file the action.
  async function handleCreateCustomer() {
    const name = result?.params.customerName?.trim();
    if (!name) return;
    setIsCreatingCustomer(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setIsCreatingCustomer(false); return; }
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ name }),
      });
      const json = await res.json() as { ok?: boolean; customer?: BackendCustomerDto; error?: string };
      if (res.ok && json.ok && json.customer) {
        const mapped = mapBackendCustomer(json.customer);
        setBackendCustomers((prev) => [...prev, mapped]);
        setMatchedCustomer(mapped);
        setNoCustomerMatch(false);
        setCustomerCandidates([]);
        setCustomerMatchResolved(true);
      }
    } catch {
      /* non-fatal — the no-match UI stays visible */
    } finally {
      setIsCreatingCustomer(false);
    }
  }

  async function handleConfirmCancelAppt(appt: Task & { customerName?: string }) {
    const now = new Date().toISOString();
    const label = new Date(now).toLocaleDateString('el-GR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const noteAppend = `Ακύρωση ραντεβού: ${label}.`;
    const updatedNote = appt.note ? `${appt.note}\n${noteAppend}` : noteAppend;

    setCancellingAppointmentId(appt.id);
    setCancelAppointmentError(null);

    try {
      let token: string | null = null;
      try {
        const supabase = createBrowserSupabaseClient();
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token ?? null;
      } catch {
        // client creation failure treated as no session
      }

      if (!token) {
        setCancelAppointmentError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
        return;
      }

      let res: Response;
      try {
        res = await fetch(`/api/tasks/${appt.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'cancelled', note: updatedNote }),
        });
      } catch {
        setCancelAppointmentError('Δεν ακυρώθηκε το ραντεβού. Δοκίμασε ξανά.');
        return;
      }

      if (!res.ok) {
        setCancelAppointmentError('Δεν ακυρώθηκε το ραντεβού. Δοκίμασε ξανά.');
        return;
      }

      let json: { ok?: boolean; task?: BackendTaskDto; error?: string };
      try {
        json = (await res.json()) as { ok?: boolean; task?: BackendTaskDto; error?: string };
      } catch {
        setCancelAppointmentError('Δεν ακυρώθηκε το ραντεβού. Δοκίμασε ξανά.');
        return;
      }

      if (!json.ok || !json.task || json.task.status !== 'cancelled') {
        setCancelAppointmentError('Δεν ακυρώθηκε το ραντεβού. Δοκίμασε ξανά.');
        return;
      }

      const mapped = mapBackendTask(json.task) as unknown as Task;
      setBackendTasks((prev) => prev.map((t) => (t.id === appt.id ? mapped : t)));
      setAppointmentCandidates((prev) => prev.filter((t) => t.id !== appt.id));
      setConfirmingCancelApptId(null);
      setCancelAppointmentError(null);
      setCancelApptSuccess(true);
    } finally {
      setCancellingAppointmentId(null);
    }
  }

  function reset() {
    setCmdInput('');
    setResult(null);
    setSavedResult(false);
    setCmdError('');
    setQueryAppointments([]);
    setMatchedCustomer(null);
    setNoCustomerMatch(false);
    setCustomerCandidates([]);
    setCustomerMatchResolved(false);
    setAppointmentCandidates([]);
    setConfirmingCancelApptId(null);
    setCancelApptSuccess(false);
    setCancellingAppointmentId(null);
    setCancelAppointmentError(null);
    setOfferPreviewData(null);
    setIsSavingTask(false);
    setTaskSaveError(null);
    setIsSavingAppointment(false);
    setAppointmentSaveError(null);
    setIsSavingOffer(false);
    setOfferSaveError(null);
    setOfferSaveWarning(null);
    setIsSavingProject(false);
    setProjectSaveError(null);
    setCreatedProjectCustomerId(null);
    setProjectTitleInput('');
    setProjectModalKind(null);
    setIsCreatingCustomer(false);
  }

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">Φόρτωση...</p>
        </div>
      </div>
    );
  }

  // (#6) An offer cannot be saved/sent while any line is missing a price.
  const offerNeedsPrice = !!offerPreviewData && offerPreviewData.validItems.some((i) => !(i.unitPrice > 0));

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
      {/* Header */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Βοηθός</p>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">AI εντολές</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Γράψε ή υπαγόρευσε τι θέλεις να οργανώσεις. Θα δεις πρώτα έλεγχο πριν αποθηκευτεί κάτι.
        </p>
      </div>

      {/* Backend context status */}
      {backendContextState === 'loading' && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση δεδομένων assistant...</p>
      )}
      {backendContextState === 'no_session' && (
        <p className="text-xs text-amber-600">Συνδέσου για να χρησιμοποιήσεις το AI Assistant με δεδομένα από το CRM σου.</p>
      )}
      {backendContextState === 'error' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {backendContextError ?? 'Δεν φορτώθηκαν όλα τα δεδομένα από το CRM. Μπορείς να δοκιμάσεις ξανά.'}
        </p>
      )}
      {backendContextState === 'ready' && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Δεδομένα CRM: {backendCustomers.length} πελάτες, {backendTasks.length} tasks, {backendOffers.length} προσφορές.
        </p>
      )}

      {/* Input card */}
      <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-3 dark:bg-[#17232f] dark:ring-white/10">
        <textarea
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="Π.χ. Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10"
          rows={2}
          disabled={isListening}
          className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100 dark:placeholder-zinc-500"
        />

        {(isListening || interimText) && (
          <p className="min-h-[1.25rem] text-xs italic text-zinc-400 dark:text-zinc-500">
            {isListening ? 'Ακούω… πάτα «Σταμάτημα» όταν τελειώσεις.' : interimText}
          </p>
        )}

        {!cmdInput.trim() && !isListening && !isLoading && (
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Παραδείγματα:</p>
            <div className="flex flex-wrap gap-1.5">
              {CMD_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setCmdInput(example);
                    setResult(null);
                    setSavedResult(false);
                    setCmdError('');
                  }}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-left text-xs text-zinc-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-white/10 dark:bg-[#1e2b38] dark:text-zinc-300"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {speechSupported && (
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              disabled={isLoading}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                isListening
                  ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-[#1e2b38] dark:text-zinc-200 dark:hover:bg-white/5'
              }`}
            >
              {isListening ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  Σταμάτημα
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                  Υπαγόρευση
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={isLoading || isListening || !cmdInput.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? 'Ανάλυση...' : 'Ανάλυση εντολής'}
          </button>
        </div>

        {cmdError && <p className="text-xs text-red-600">{cmdError}</p>}
      </div>

      {/* Result section */}
      {result && !isLoading && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200 dark:bg-[#1e2b38] dark:ring-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Ανάλυση</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{result.summary}</p>
          </div>

          {/* unknown */}
          {result.intent === 'unknown' && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <p className="text-sm text-amber-700">
                Αυτή η εντολή δεν υποστηρίζεται ακόμα ή χρειάζεται ξεχωριστή επιβεβαίωση.
              </p>
            </div>
          )}

          {/* query_appointments */}
          {result.intent === 'query_appointments' && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-3 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Ραντεβού</p>
              {queryAppointments.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">Δεν βρέθηκαν ραντεβού για αυτό το διάστημα.</p>
              ) : (
                <ul className="space-y-2">
                  {queryAppointments.map((appt) => (
                    <li key={appt.id} className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100 dark:bg-[#1e2b38] dark:ring-white/10">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{appt.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {appt.dueDate}
                        {appt.dueTime ? ` ${appt.dueTime}` : ''}
                        {appt.customerName ? ` · ${appt.customerName}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/appointments" className="inline-block text-xs text-indigo-600 hover:text-indigo-700">
                Όλα τα ραντεβού →
              </Link>
            </div>
          )}

          {/* create_task */}
          {result.intent === 'create_task' && !savedResult && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Νέο task (προεπισκόπηση)
              </p>
              <div className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                <p><span className="font-medium">Τίτλος:</span> {result.params.title || 'Νέο task'}</p>
                {matchedCustomer && (
                  <div className="flex items-center gap-2">
                    <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                    {customerCandidates.length > 1 && customerMatchResolved && (
                      <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                    )}
                  </div>
                )}
                {customerCandidates.length > 1 && !customerMatchResolved && (
                  <CustomerCandidatePicker
                    candidates={customerCandidates}
                    selectedId={matchedCustomer?.id}
                    onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                    onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                  />
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                <p>
                  <span className="font-medium">Ημερομηνία:</span>{' '}
                  {result.params.dueDate
                    ? result.params.dueDate + (result.params.dueTime ? ` ${result.params.dueTime}` : '')
                    : 'Σήμερα (προεπιλογή)'}
                </p>
                <p>
                  <span className="font-medium">Προτεραιότητα:</span>{' '}
                  {PRIORITY_LABELS[result.params.priority ?? 'normal'] ?? 'Κανονική'}
                </p>
                {result.params.note && (
                  <p><span className="font-medium">Σημείωση:</span> {result.params.note}</p>
                )}
              </div>
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
              )}
              {taskSaveError && (
                <p className="text-xs text-red-600">{taskSaveError}</p>
              )}
              <button
                type="button"
                onClick={() => { void handleSaveTask(); }}
                disabled={(customerCandidates.length > 1 && !customerMatchResolved) || isSavingTask}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSavingTask ? 'Αποθήκευση...' : 'Δημιουργία task'}
              </button>
            </div>
          )}

          {result.intent === 'create_task' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
              <p className="text-sm font-medium text-green-700">Το task δημιουργήθηκε.</p>
              <button type="button" onClick={() => window.location.assign('/tasks')} className="inline-block text-left text-xs text-indigo-600 hover:text-indigo-700">
                Δες τα tasks →
              </button>
            </div>
          )}

          {/* create_project */}
          {result.intent === 'create_project' && !savedResult && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Νέο έργο (προεπισκόπηση)
              </p>
              {matchedCustomer && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200"><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                  {customerCandidates.length > 1 && customerMatchResolved && (
                    <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                  )}
                </div>
              )}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                  onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                />
              )}
              {!matchedCustomer && customerCandidates.length === 0 && (
                <div className="space-y-2 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                  <p className="text-xs text-amber-700">
                    {result.params.customerName
                      ? `Δεν βρέθηκε πελάτης «${result.params.customerName}». Το έργο χρειάζεται πελάτη.`
                      : 'Πες σε ποιον πελάτη ανήκει το έργο (π.χ. «ξεκίνα έργο για τον Νίκο, ανακαίνιση»).'}
                  </p>
                  {result.params.customerName && (
                    <button
                      type="button"
                      onClick={() => { void handleCreateCustomer(); }}
                      disabled={isCreatingCustomer}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isCreatingCustomer ? 'Δημιουργία...' : `Δημιουργία πελάτη «${result.params.customerName}»`}
                    </button>
                  )}
                </div>
              )}
              {matchedCustomer && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Όνομα έργου</span>
                  <input
                    type="text"
                    value={projectTitleInput || suggestProjectTitle()}
                    onChange={(e) => setProjectTitleInput(e.target.value)}
                    placeholder="Π.χ. Ανακαίνιση κουζίνας"
                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100"
                  />
                </label>
              )}
              {projectSaveError && <p className="text-xs text-red-600">{projectSaveError}</p>}
              {matchedCustomer && (
                <button
                  type="button"
                  onClick={() => { void handleSaveProject(); }}
                  disabled={isSavingProject || (customerCandidates.length > 1 && !customerMatchResolved)}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSavingProject ? 'Δημιουργία...' : 'Δημιουργία έργου'}
                </button>
              )}
            </div>
          )}

          {result.intent === 'create_project' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
              <p className="text-sm font-medium text-green-700">Το έργο δημιουργήθηκε.</p>
              {createdProjectCustomerId && (
                <button type="button" onClick={() => window.location.assign(`/customers/${createdProjectCustomerId}`)} className="inline-block text-left text-xs text-indigo-600 hover:text-indigo-700">
                  Άνοιξε την καρτέλα του πελάτη →
                </button>
              )}
            </div>
          )}

          {/* create_appointment */}
          {result.intent === 'create_appointment' && !savedResult && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Νέο ραντεβού (προεπισκόπηση)
              </p>
              <div className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                <p>
                  <span className="font-medium">Τίτλος:</span>{' '}
                  {result.params.title?.trim() ||
                    (matchedCustomer ? `Ραντεβού με ${matchedCustomer.name}` : 'Νέο ραντεβού')}
                </p>
                {matchedCustomer && (
                  <div className="flex items-center gap-2">
                    <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                    {customerCandidates.length > 1 && customerMatchResolved && (
                      <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                    )}
                  </div>
                )}
                {customerCandidates.length > 1 && !customerMatchResolved && (
                  <CustomerCandidatePicker
                    candidates={customerCandidates}
                    selectedId={matchedCustomer?.id}
                    onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                    onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                  />
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                <p>
                  <span className="font-medium">Ημερομηνία:</span>{' '}
                  {result.params.dueDate
                    ? result.params.dueDate + (result.params.dueTime ? ` ${result.params.dueTime}` : '')
                    : 'Σήμερα (προεπιλογή)'}
                </p>
                <p>
                  <span className="font-medium">Τύπος:</span>{' '}
                  {APPT_TYPE_LABELS[result.params.appointmentType ?? 'book_appointment'] ?? 'Ραντεβού'}
                </p>
                {result.params.note && (
                  <p><span className="font-medium">Σημείωση:</span> {result.params.note}</p>
                )}
              </div>
              {noCustomerMatch && !matchedCustomer && result.params.customerName && (
                <button
                  type="button"
                  onClick={() => { void handleCreateCustomer(); }}
                  disabled={isCreatingCustomer}
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-[#1e2b38] dark:text-zinc-200"
                >
                  {isCreatingCustomer ? 'Δημιουργία...' : `Δημιουργία πελάτη «${result.params.customerName}»`}
                </button>
              )}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
              )}
              {appointmentSaveError && (
                <p className="text-xs text-red-600">{appointmentSaveError}</p>
              )}
              {matchedCustomer ? (
                <>
                  <button
                    type="button"
                    onClick={() => { void startFiling('appointment'); }}
                    disabled={(customerCandidates.length > 1 && !customerMatchResolved) || isSavingAppointment || loadingFolders}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Δημιουργία ραντεβού
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleSaveAppointment(); }}
                    disabled={isSavingAppointment}
                    className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 transition dark:text-zinc-500 dark:hover:text-zinc-300"
                  >
                    {isSavingAppointment ? 'Αποθήκευση...' : 'Ραντεβού χωρίς έργο (εσωτερικό, χωρίς ειδοποίηση πελάτη)'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { void handleSaveAppointment(); }}
                  disabled={(customerCandidates.length > 1 && !customerMatchResolved) || isSavingAppointment}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSavingAppointment ? 'Αποθήκευση...' : 'Δημιουργία ραντεβού'}
                </button>
              )}
            </div>
          )}

          {result.intent === 'create_appointment' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
              <p className="text-sm font-medium text-green-700">
                {createdProjectCustomerId ? 'Το ραντεβού μπήκε στο έργο και ειδοποιήθηκε ο πελάτης.' : 'Το ραντεβού δημιουργήθηκε στο CRM.'}
              </p>
              {!createdProjectCustomerId && (
                <div className="rounded-lg bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200">
                  <p className="text-xs text-amber-700">
                    Εσωτερικό ραντεβού. Δεν στάλθηκε ειδοποίηση στον πελάτη.
                  </p>
                </div>
              )}
              <button type="button" onClick={() => window.location.assign('/appointments')} className="inline-block text-left text-xs text-indigo-600 hover:text-indigo-700">
                Δες τα ραντεβού →
              </button>
            </div>
          )}

          {/* create_offer */}
          {result.intent === 'create_offer' && !savedResult && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Πρόχειρη προσφορά (προεπισκόπηση)
              </p>
              {matchedCustomer && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200"><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                  {customerCandidates.length > 1 && customerMatchResolved && (
                    <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                  )}
                </div>
              )}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                  onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                />
              )}
              {noCustomerMatch && (
                <p className="text-xs text-amber-600">
                  Δεν βρέθηκε πελάτης, η προσφορά θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                </p>
              )}
              {!offerPreviewData || offerPreviewData.validItems.length === 0 ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
                  <p className="text-sm text-amber-700">
                    Δεν βρέθηκαν γραμμές προσφοράς στην εντολή. Δοκίμασε να γράψεις ποσά και περιγραφές.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400 dark:border-white/10 dark:text-zinc-500">
                          <th className="pb-1.5 font-medium">Περιγραφή</th>
                          <th className="pb-1.5 font-medium text-right">Ποσ.</th>
                          <th className="pb-1.5 font-medium text-right">Τιμή</th>
                          <th className="pb-1.5 font-medium text-right">Σύνολο</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50 dark:divide-white/10">
                        {offerPreviewData.validItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 text-zinc-800 dark:text-zinc-200">{item.description}</td>
                            <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-300">{item.quantity}</td>
                            <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-300">
                              {item.unitPrice > 0 ? (
                                fmtEur(item.unitPrice)
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  placeholder="Τιμή €"
                                  onChange={(e) => updateOfferItemPrice(idx, parseFloat(e.target.value) || 0)}
                                  className="w-20 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-right text-amber-900 outline-none focus:ring-2 focus:ring-amber-200"
                                />
                              )}
                            </td>
                            <td className="py-1.5 text-right text-zinc-800 dark:text-zinc-200">{item.unitPrice > 0 ? fmtEur(item.quantity * item.unitPrice) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-2.5 text-sm space-y-1 dark:bg-[#1e2b38]">
                    <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                      <span>Καθαρή αξία</span>
                      <span>{fmtEur(offerPreviewData.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                      <span>ΦΠΑ {offerPreviewData.vatRate}%</span>
                      <span>{fmtEur(offerPreviewData.vatAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold text-zinc-900 dark:border-white/10 dark:text-zinc-100">
                      <span>Σύνολο</span>
                      <span>{fmtEur(offerPreviewData.total)}</span>
                    </div>
                  </div>
                  {result.params.offerNotes && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300"><span className="font-medium">Σημειώσεις:</span> {result.params.offerNotes}</p>
                  )}
                  {result.params.offerTerms && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300"><span className="font-medium">Όροι:</span> {result.params.offerTerms}</p>
                  )}
                  {noCustomerMatch && !matchedCustomer && result.params.customerName && (
                    <button
                      type="button"
                      onClick={() => { void handleCreateCustomer(); }}
                      disabled={isCreatingCustomer}
                      className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-[#1e2b38] dark:text-zinc-200"
                    >
                      {isCreatingCustomer ? 'Δημιουργία...' : `Δημιουργία πελάτη «${result.params.customerName}»`}
                    </button>
                  )}
                  {customerCandidates.length > 1 && !customerMatchResolved && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
                  )}
                  {offerNeedsPrice && (
                    <p className="text-xs text-amber-600">Βάλε τιμή σε όλα τα είδη για να σταλεί η προσφορά.</p>
                  )}
                  {offerSaveError && (
                    <p className="text-xs text-red-600">{offerSaveError}</p>
                  )}
                  {matchedCustomer ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { void startFiling('offer'); }}
                        disabled={(customerCandidates.length > 1 && !customerMatchResolved) || isSavingOffer || offerNeedsPrice || loadingFolders}
                        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Στείλε προσφορά
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleSaveOffer(); }}
                        disabled={isSavingOffer || offerNeedsPrice}
                        className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 transition dark:text-zinc-500 dark:hover:text-zinc-300 disabled:opacity-50"
                      >
                        {isSavingOffer ? 'Αποθήκευση...' : 'Μόνο πρόχειρη προσφορά (χωρίς αποστολή)'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void handleSaveOffer(); }}
                      disabled={(customerCandidates.length > 1 && !customerMatchResolved) || isSavingOffer || offerNeedsPrice}
                      className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isSavingOffer ? 'Αποθήκευση...' : 'Δημιουργία πρόχειρης προσφοράς'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {result.intent === 'create_offer' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1.5">
              <p className="text-sm font-medium text-green-700">
                {createdProjectCustomerId ? 'Η προσφορά μπήκε στο έργο και στάλθηκε στον πελάτη.' : 'Η πρόχειρη προσφορά δημιουργήθηκε.'}
              </p>
              {!createdProjectCustomerId && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">Δημιουργήθηκε και task για έλεγχο και αποστολή.</p>
              )}
              {offerSaveWarning && (
                <p className="text-xs text-amber-600">{offerSaveWarning}</p>
              )}
              <button type="button" onClick={() => window.location.assign('/offers')} className="inline-block text-left text-xs text-indigo-600 hover:text-indigo-700">
                Δες τις προσφορές →
              </button>
            </div>
          )}

          {/* create_invoice */}
          {result.intent === 'create_invoice' && !savedResult && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Έκδοση τιμολογίου
              </p>
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                  onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                />
              )}
              {customerMatchResolved && (
                <>
                  <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
                    <p><span className="text-zinc-400">Πελάτης:</span> {matchedCustomer?.name ?? (result.params.customerName || '— (απόδειξη λιανικής)')}</p>
                    <p><span className="text-zinc-400">Ποσό (με ΦΠΑ):</span> {result.params.invoiceAmount ? `${result.params.invoiceAmount}€` : '—'}</p>
                    <p><span className="text-zinc-400">Περιγραφή:</span> {result.params.invoiceDescription || 'Παροχή υπηρεσιών'}</p>
                  </div>
                  {invoiceSaveError && <p className="text-xs text-red-600">{invoiceSaveError}</p>}
                  <button
                    type="button"
                    disabled={isSavingInvoice || !result.params.invoiceAmount}
                    onClick={() => { void handleSaveInvoice(); }}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {isSavingInvoice ? 'Έκδοση...' : 'Έκδοση τιμολογίου'}
                  </button>
                </>
              )}
            </div>
          )}
          {result.intent === 'create_invoice' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1.5">
              <p className="text-sm font-medium text-green-700">Το τιμολόγιο εκδόθηκε.</p>
              {issuedInvoiceMark && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">ΜΑΡΚ: {issuedInvoiceMark}</p>
              )}
            </div>
          )}

          {/* cancel_appointment */}
          {result.intent === 'cancel_appointment' && (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Ακύρωση ραντεβού
              </p>

              {/* Customer disambiguation for cancel */}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => {
                    setMatchedCustomer(c);
                    setCustomerMatchResolved(true);
                    const cMap = Object.fromEntries(backendCustomers.map((cu) => [cu.id, cu.name]));
                    setAppointmentCandidates(computeApptCandidates(
                      { dueDate: result.params.dueDate, dueTime: result.params.dueTime, appointmentType: result.params.appointmentType },
                      c.id, true, backendTasks, cMap
                    ));
                  }}
                  onContinueWithout={() => {
                    setMatchedCustomer(null);
                    setCustomerMatchResolved(true);
                    const cMap = Object.fromEntries(backendCustomers.map((cu) => [cu.id, cu.name]));
                    setAppointmentCandidates(computeApptCandidates(
                      { dueDate: result.params.dueDate, dueTime: result.params.dueTime, appointmentType: result.params.appointmentType },
                      null, false, backendTasks, cMap
                    ));
                  }}
                />
              )}

              {customerMatchResolved && (
                <>
                  {cancelApptSuccess ? (
                    <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
                      <p className="text-sm font-medium text-green-700">Το ραντεβού ακυρώθηκε.</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Δεν γίνεται αποστολή ενημέρωσης στον πελάτη από αυτή την εντολή.</p>
                    </div>
                  ) : appointmentCandidates.length === 0 ? (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">Δεν βρέθηκαν ανοιχτά ραντεβού με αυτά τα κριτήρια.</p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {appointmentCandidates.map((appt) => (
                          <li key={appt.id} className="rounded-xl bg-zinc-50 ring-1 ring-zinc-100 dark:bg-[#1e2b38] dark:ring-white/10">
                            {confirmingCancelApptId === appt.id ? (
                              <div className="p-3 space-y-2">
                                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Επιβεβαίωση ακύρωσης ραντεβού</p>
                                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                                  {appt.title}{appt.customerName ? ` · ${appt.customerName}` : ''}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {appt.dueDate}{appt.dueTime ? ` ${appt.dueTime}` : ''}
                                </p>
                                {cancelAppointmentError && (
                                  <p className="text-xs text-red-600">{cancelAppointmentError}</p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={cancellingAppointmentId === appt.id}
                                    onClick={() => { void handleConfirmCancelAppt(appt); }}
                                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
                                  >
                                    {cancellingAppointmentId === appt.id ? 'Ακύρωση...' : 'Ναι, ακύρωση'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingCancelApptId(null)}
                                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                                  >
                                    Πίσω
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3">
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{appt.title}</p>
                                <p className="text-xs text-zinc-500 mt-0.5 dark:text-zinc-400">
                                  {appt.dueDate}{appt.dueTime ? ` ${appt.dueTime}` : ''}
                                  {appt.customerName ? ` · ${appt.customerName}` : ''}
                                </p>
                                <p className="text-xs text-zinc-400 dark:text-zinc-500">{APPT_TYPE_LABELS[appt.type] ?? appt.type}</p>
                                <button
                                  type="button"
                                  onClick={() => { setCancelApptSuccess(false); setCancelAppointmentError(null); setConfirmingCancelApptId(appt.id); }}
                                  className="mt-2 text-xs font-medium text-red-600 hover:text-red-700 transition"
                                >
                                  Ακύρωση ραντεβού
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">Δεν γίνεται αποστολή ενημέρωσης στον πελάτη από αυτή την εντολή.</p>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Reset */}
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            Νέα εντολή
          </button>
        </div>
      )}

      {/* «Πώς να ονομάσω το έργο;» — the project-name popup for appointments/offers. */}
      {/* (#5) Pick an existing open project, or create a new one. */}
      {folderPicker && matchedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 pt-20 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl ring-1 ring-zinc-200 dark:bg-[#17232f] dark:ring-white/10">
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">Σε ποιο έργο;</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ο/Η {matchedCustomer.name} έχει ανοιχτά έργα. Διάλεξε ένα ή δημιούργησε νέο.
            </p>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {folderPicker.folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { void fileIntoExistingFolder(f.id); }}
                  disabled={isSavingProject || isSavingOffer || isSavingAppointment}
                  className="block w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#0f1923] dark:hover:bg-white/5"
                >
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{f.title}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{f.status}</p>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => { const k = folderPicker.kind; setFolderPicker(null); openProjectModal(k); }}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                + Δημιουργία νέου έργου
              </button>
              <button
                type="button"
                onClick={() => setFolderPicker(null)}
                className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500"
              >
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      )}

      {projectModalKind && matchedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 pt-20 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl ring-1 ring-zinc-200 dark:bg-[#17232f] dark:ring-white/10">
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">Πώς να ονομάσω το έργο;</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {projectModalKind === 'offer'
                ? `Θα δημιουργηθεί το έργο για τον/την ${matchedCustomer.name} και θα σταλεί η προσφορά με τον σύνδεσμο.`
                : `Θα δημιουργηθεί το έργο για τον/την ${matchedCustomer.name} και θα κλειστεί το ραντεβού. Ο πελάτης θα ειδοποιηθεί με τον σύνδεσμο.`}
            </p>
            <input
              type="text"
              autoFocus
              value={projectTitleInput}
              onChange={(e) => setProjectTitleInput(e.target.value)}
              placeholder="Π.χ. Ανακαίνιση κουζίνας"
              className="mt-3 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100"
            />
            {projectSaveError && <p className="mt-2 text-xs text-red-600">{projectSaveError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setProjectModalKind(null); setProjectSaveError(null); }}
                disabled={isSavingProject || isSavingAppointment || isSavingOffer}
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                Πίσω
              </button>
              <button
                type="button"
                onClick={() => { void confirmProjectModal(); }}
                disabled={isSavingProject || isSavingAppointment || isSavingOffer || !projectTitleInput.trim()}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {(isSavingProject || isSavingAppointment || isSavingOffer)
                  ? 'Δημιουργία...'
                  : projectModalKind === 'offer' ? 'Δημιουργία & αποστολή' : 'Δημιουργία & κλείσιμο'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
