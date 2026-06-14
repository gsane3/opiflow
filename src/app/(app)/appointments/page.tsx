'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Card, EmptyState } from '@/components/ui';
import type { Task, Customer, TaskBaseStatus, TaskType, TaskPriority } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type AppointmentResponseInfo = {
  kind: 'accepted' | 'declined' | 'time_change_requested' | 'time_change_approved' | 'time_change_rejected' | null;
  label: string;
  cls: string;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
  comment: string | null;
};

function getAppointmentResponseInfo(note: string): AppointmentResponseInfo {
  const isTimeChangeApproved = note.includes('Αποδοχή αλλαγής ώρας από επαγγελματία:');
  const isTimeChangeRejected = note.includes('Απόρριψη αλλαγής ώρας από επαγγελματία:');
  const isAccepted =
    note.includes('Αποδοχή ραντεβού από πελάτη:') ||
    note.includes('Απάντηση μέσω δημόσιου link: Αποδοχή ραντεβού');
  const isDeclined =
    note.includes('Αδυναμία παρουσίας πελάτη:') ||
    note.includes('Απάντηση μέσω δημόσιου link: Αδυναμία παρουσίας');
  const isTimeChange =
    note.includes('Πρόταση αλλαγής από πελάτη:') ||
    note.includes('Απάντηση μέσω δημόσιου link: Αίτημα αλλαγής ώρας');

  let kind: AppointmentResponseInfo['kind'] = null;
  let label = 'Αναμονή απάντησης';
  let cls = 'bg-zinc-100 text-zinc-500 dark:bg-[#1e2b38] dark:text-zinc-400';

  if (isTimeChangeApproved) {
    kind = 'time_change_approved';
    label = 'Αλλαγή εγκρίθηκε';
    cls = 'bg-green-100 text-green-700';
  } else if (isTimeChangeRejected) {
    kind = 'time_change_rejected';
    label = 'Αλλαγή απορρίφθηκε';
    cls = 'bg-amber-100 text-amber-700';
  } else if (isAccepted) {
    kind = 'accepted';
    label = 'Αποδεκτό';
    cls = 'bg-green-100 text-green-700';
  } else if (isDeclined) {
    kind = 'declined';
    label = 'Δεν μπορεί';
    cls = 'bg-amber-100 text-amber-700';
  } else if (isTimeChange) {
    kind = 'time_change_requested';
    label = 'Ζητά αλλαγή ώρας';
    cls = 'bg-indigo-100 text-indigo-700';
  }

  let requestedDueDate: string | null = null;
  let requestedDueTime: string | null = null;
  const proposalMatches = [...note.matchAll(/Νέα πρόταση: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/g)];
  const proposalMatch = proposalMatches[proposalMatches.length - 1];
  if (proposalMatch) {
    requestedDueDate = proposalMatch[1];
    requestedDueTime = proposalMatch[2];
  }

  let comment: string | null = null;
  const commentMatches = [...note.matchAll(/Σχόλιο:\s*([^\n]+)/g)];
  const commentMatch = commentMatches[commentMatches.length - 1];
  if (commentMatch) {
    const trimmed = commentMatch[1].trim();
    if (trimmed) comment = trimmed;
  }

  return { kind, label, cls, requestedDueDate, requestedDueTime, comment };
}

function getResponseStatus(note: string): { label: string; cls: string } {
  const info = getAppointmentResponseInfo(note);
  return { label: info.label, cls: info.cls };
}

function formatTimestamp(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isFutureAppointment(task: Task): boolean {
  const todayStr = new Date().toISOString().split('T')[0];
  if (task.dueDate > todayStr) return true;
  if (task.dueDate === todayStr) {
    if (!task.dueTime) return true;
    const nowTime = new Date().toTimeString().slice(0, 5);
    return task.dueTime > nowTime;
  }
  return false;
}

type GroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';
const GROUP_LABELS: Record<GroupKey, string> = {
  overdue: 'Εκπρόθεσμα',
  today: 'Σήμερα',
  tomorrow: 'Αύριο',
  week: 'Επόμενες 7 μέρες',
  later: 'Αργότερα',
};
const GROUP_ORDER: GroupKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later'];

function getGroupKey(dueDate: string, todayStr: string, tomorrowStr: string, weekStr: string): GroupKey {
  if (dueDate < todayStr) return 'overdue';
  if (dueDate === todayStr) return 'today';
  if (dueDate === tomorrowStr) return 'tomorrow';
  if (dueDate <= weekStr) return 'week';
  return 'later';
}

function sortAppointments(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return (a.dueTime ?? 'zz').localeCompare(b.dueTime ?? 'zz');
  });
}

function tomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

const inputCls = 'rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

const APPT_TYPE_LABELS: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη πελάτη',
};

// ---------------------------------------------------------------------------
// DTO types and mapping
// ---------------------------------------------------------------------------

interface TaskDto {
  id: string;
  customerId?: string | null;
  offerId?: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueTime?: string | null;
  note?: string | null;
  createdFromAi?: boolean | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerDto {
  id: string;
  crmNumber?: string | null;
  name?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  status?: string | null;
  preferredContactMethod?: string | null;
  needsSummary?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapTask(dto: TaskDto): Task {
  return {
    id: dto.id,
    customerId: dto.customerId ?? undefined,
    offerId: dto.offerId ?? undefined,
    title: dto.title,
    type: (dto.type as TaskType) ?? 'other',
    status: dto.status as TaskBaseStatus,
    priority: (dto.priority as TaskPriority) ?? 'normal',
    dueDate: dto.dueDate ?? new Date().toISOString().split('T')[0],
    dueTime: dto.dueTime ?? undefined,
    note: dto.note ?? '',
    createdFromAi: dto.createdFromAi ?? false,
    completedAt: dto.completedAt ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function mapCustomer(dto: CustomerDto): Customer {
  const now = new Date().toISOString();
  return {
    id: dto.id,
    name: dto.name ?? dto.companyName ?? dto.crmNumber ?? 'Πελάτης',
    companyName: dto.companyName ?? '',
    phone: dto.phone ?? '',
    email: dto.email ?? '',
    address: '',
    source: (dto.source as Customer['source']) ?? 'manual_entry',
    status: (dto.status as Customer['status']) ?? 'new_lead',
    preferredContactMethod:
      (dto.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: dto.needsSummary ?? '',
    notes: dto.notes ?? '',
    createdAt: dto.createdAt ?? now,
    updatedAt: dto.updatedAt ?? now,
    crmNumber: dto.crmNumber ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppointmentsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const tokenRef = useRef<string | null>(null);

  // New appointment form state
  const [formOpen, setFormOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [apptDate, setApptDate] = useState(tomorrowDateStr);
  const [apptTime, setApptTime] = useState('10:00');
  const [apptNote, setApptNote] = useState('');
  const [justCreated, setJustCreated] = useState(false);
  const [creating, setCreating] = useState(false);

  // Proposal details after creation
  const [proposalTaskId, setProposalTaskId] = useState('');

  // Cancellation state
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<{ task: Task; customer: Customer | null; isFuture: boolean } | null>(null);

  const [selectedAppointment, setSelectedAppointment] = useState<Task | null>(null);

  // Time-change approval state
  const [approvingTimeChangeId, setApprovingTimeChangeId] = useState<string | null>(null);
  const [approveTimeChangeError, setApproveTimeChangeError] = useState<string | null>(null);
  const [approveTimeChangeSuccess, setApproveTimeChangeSuccess] = useState<string | null>(null);

  // Time-change rejection state
  const [rejectingTimeChangeId, setRejectingTimeChangeId] = useState<string | null>(null);
  const [rejectTimeChangeError, setRejectTimeChangeError] = useState<string | null>(null);

  // Customer notification draft (set after approve or reject)
  const [notificationDraft, setNotificationDraft] = useState<string | null>(null);
  const [notificationDraftTaskId, setNotificationDraftTaskId] = useState<string | null>(null);
  const [notificationCopied, setNotificationCopied] = useState(false);
  const [notificationManualVisible, setNotificationManualVisible] = useState(false);

  // Delivery draft state (cleared on appointment switch)
  const [deliveryDraftLoading, setDeliveryDraftLoading] = useState(false);
  const [deliveryDraftError, setDeliveryDraftError] = useState<string | null>(null);
  const [deliveryDraftMessage, setDeliveryDraftMessage] = useState<string | null>(null);
  const [deliveryDraftCopied, setDeliveryDraftCopied] = useState(false);
  const [deliveryDraftManualVisible, setDeliveryDraftManualVisible] = useState(false);

  // Response refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  const loadData = useCallback(async (token: string) => {
    setFetchError(null);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [tasksResp, customersResp] = await Promise.all([
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
      ]);

      if (!tasksResp.ok || !customersResp.ok) {
        setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }

      const tasksData = await tasksResp.json();
      const customersData = await customersResp.json();

      const rawTasks: TaskDto[] = Array.isArray(tasksData)
        ? tasksData
        : (tasksData.tasks ?? []);
      const rawCustomers: CustomerDto[] = Array.isArray(customersData)
        ? customersData
        : (customersData.customers ?? []);

      // Appointments are book_appointment and visit_customer tasks that are open.
      const appts = sortAppointments(
        rawTasks
          .map(mapTask)
          .filter(
            (t) =>
              (t.type === 'book_appointment' || t.type === 'visit_customer') &&
              t.status === 'open'
          )
      );

      setAppointments(appts);
      setCustomers(rawCustomers.map(mapCustomer));
      setHydrated(true);
    } catch {
      setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
      setHydrated(true);
    }
  }, []);

  const refreshKeepingSelection = useCallback(async (keepId: string) => {
    const token = tokenRef.current;
    if (!token) return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshSuccess(false);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [tasksResp, customersResp] = await Promise.all([
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
      ]);
      if (!tasksResp.ok || !customersResp.ok) {
        setRefreshError('Δεν έγινε ανανέωση. Δοκίμασε ξανά.');
        return;
      }
      const tasksData = await tasksResp.json();
      const customersData = await customersResp.json();
      const rawTasks: TaskDto[] = Array.isArray(tasksData)
        ? tasksData
        : (tasksData.tasks ?? []);
      const rawCustomers: CustomerDto[] = Array.isArray(customersData)
        ? customersData
        : (customersData.customers ?? []);
      const appts = sortAppointments(
        rawTasks
          .map(mapTask)
          .filter(
            (t) =>
              (t.type === 'book_appointment' || t.type === 'visit_customer') &&
              t.status === 'open'
          )
      );
      setAppointments(appts);
      setCustomers(rawCustomers.map(mapCustomer));
      const freshTask = appts.find((t) => t.id === keepId) ?? null;
      if (freshTask) {
        setSelectedAppointment(freshTask);
        setRefreshSuccess(true);
        setTimeout(() => setRefreshSuccess(false), 2500);
      } else {
        // Appointment cancelled/completed externally: close detail.
        setSelectedAppointment(null);
      }
    } catch {
      setRefreshError('Δεν έγινε ανανέωση. Δοκίμασε ξανά.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const selectedId = selectedAppointment?.id;
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && selectedId) {
        void refreshKeepingSelection(selectedId);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [selectedAppointment?.id, refreshKeepingSelection]);

  useEffect(() => {
    async function init() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setNoSession(true);
          setHydrated(true);
          return;
        }
        tokenRef.current = session.access_token;
        await loadData(session.access_token);
      } catch {
        setFetchError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  function clearDeliveryDraftState() {
    setDeliveryDraftLoading(false);
    setDeliveryDraftError(null);
    setDeliveryDraftMessage(null);
    setDeliveryDraftCopied(false);
    setDeliveryDraftManualVisible(false);
  }

  const norm = (s: string) => s.toLowerCase().trim();
  const searchResults: Customer[] = customerSearch.trim()
    ? customers
        .filter((c) => {
          const q = norm(customerSearch);
          return (
            norm(c.name).includes(q) ||
            norm(c.phone ?? '').includes(q) ||
            norm(c.email ?? '').includes(q)
          );
        })
        .slice(0, 8)
    : [];

  async function handleCreate() {
    if (!selectedCustomer || !apptDate || !apptTime) return;
    const token = tokenRef.current;
    if (!token) return;

    setCreating(true);
    setCancelResult(null);

    const note = apptNote.trim() || 'Ραντεβού δημιουργήθηκε από το πρόγραμμα ραντεβού.';

    const resp = await fetch('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Ραντεβού με ${selectedCustomer.name}`,
        type: 'book_appointment',
        status: 'open',
        priority: 'normal',
        dueDate: apptDate,
        dueTime: apptTime,
        note,
        customerId: selectedCustomer.id,
      }),
    });

    setCreating(false);

    if (resp.ok) {
      const data = await resp.json();
      const task = mapTask(data.task);
      setAppointments((prev) => sortAppointments([...prev, task]));
      setProposalTaskId(task.id);
      setFormOpen(false);
      setCustomerSearch('');
      setSelectedCustomer(null);
      setApptDate(tomorrowDateStr());
      setApptTime('10:00');
      setApptNote('');
      setJustCreated(true);
    }
  }

  async function handleCancelConfirm(task: Task) {
    const token = tokenRef.current;
    if (!token) return;

    const customer = task.customerId
      ? customers.find((c) => c.id === task.customerId) ?? null
      : null;
    const isFuture = isFutureAppointment(task);
    const now = new Date().toISOString();
    const label = formatTimestamp(now);
    const noteAppend = `Ακύρωση ραντεβού: ${label}.`;
    const updatedNote = task.note ? `${task.note}\n${noteAppend}` : noteAppend;

    const resp = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', note: updatedNote }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const cancelled = mapTask(data.task);
      setAppointments((prev) => prev.filter((t) => t.id !== task.id));
      setCancelResult({ task: cancelled, customer, isFuture });
      setCancellingTaskId(null);
    }
  }

  function getAppointmentCustomer(task: Task): Customer | null {
    if (!task.customerId) return null;
    return customers.find((c) => c.id === task.customerId) ?? null;
  }

  async function handleApproveTimeChange(task: Task, info: AppointmentResponseInfo) {
    if (!info.requestedDueDate || !info.requestedDueTime) return;
    const token = tokenRef.current;
    if (!token) {
      setApproveTimeChangeError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
      return;
    }

    setApprovingTimeChangeId(task.id);
    setApproveTimeChangeError(null);
    setApproveTimeChangeSuccess(null);

    const noteAppend = `Αποδοχή αλλαγής ώρας από επαγγελματία: ${info.requestedDueDate} ${info.requestedDueTime}.`;
    const updatedNote = task.note ? `${task.note}\n${noteAppend}` : noteAppend;

    try {
      const resp = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dueDate: info.requestedDueDate,
          dueTime: info.requestedDueTime,
          note: updatedNote,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const updatedTask: Task = data.task
          ? mapTask(data.task as Parameters<typeof mapTask>[0])
          : {
              ...task,
              dueDate: info.requestedDueDate,
              dueTime: info.requestedDueTime,
              note: updatedNote,
            };
        setAppointments((prev) => sortAppointments(prev.map((t) => (t.id === task.id ? updatedTask : t))));
        setSelectedAppointment(updatedTask);
        setApproveTimeChangeSuccess('Η νέα ώρα αποθηκεύτηκε.');
        const approveCustomer = getAppointmentCustomer(task);
        const approveGreeting = approveCustomer ? `Καλησπέρα σας, ${approveCustomer.name}.` : 'Καλησπέρα σας.';
        const approveDraft = `${approveGreeting} Επιβεβαιώνουμε το ραντεβού για ${formatDate(info.requestedDueDate)} στις ${info.requestedDueTime}. Ευχαριστούμε.`;
        setNotificationDraft(approveDraft);
        setNotificationDraftTaskId(task.id);
        setNotificationCopied(false);
        setNotificationManualVisible(false);
      } else {
        setApproveTimeChangeError('Δεν αποθηκεύτηκε η νέα ώρα. Δοκίμασε ξανά.');
      }
    } catch {
      setApproveTimeChangeError('Δεν αποθηκεύτηκε η νέα ώρα. Δοκίμασε ξανά.');
    } finally {
      setApprovingTimeChangeId(null);
    }
  }

  async function handleRejectTimeChange(task: Task, info: AppointmentResponseInfo) {
    if (!info.requestedDueDate || !info.requestedDueTime) return;
    const token = tokenRef.current;
    if (!token) {
      setRejectTimeChangeError('Δεν υπάρχει ενεργή σύνδεση. Δοκίμασε ξανά.');
      return;
    }

    setRejectingTimeChangeId(task.id);
    setRejectTimeChangeError(null);

    const noteAppend = `Απόρριψη αλλαγής ώρας από επαγγελματία: ${info.requestedDueDate} ${info.requestedDueTime}.`;
    const updatedNote = task.note ? `${task.note}\n${noteAppend}` : noteAppend;

    try {
      const resp = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: updatedNote }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const updatedTask: Task = data.task
          ? mapTask(data.task as Parameters<typeof mapTask>[0])
          : { ...task, note: updatedNote };
        setAppointments((prev) => sortAppointments(prev.map((t) => (t.id === task.id ? updatedTask : t))));
        setSelectedAppointment(updatedTask);
        const rejectCustomer = getAppointmentCustomer(task);
        const rejectGreeting = rejectCustomer ? `Καλησπέρα σας, ${rejectCustomer.name}.` : 'Καλησπέρα σας.';
        const origDate = formatDate(task.dueDate);
        const origTime = task.dueTime ? ` στις ${task.dueTime}` : '';
        const rejectDraft = `${rejectGreeting} Δεν μπορούμε να αλλάξουμε το ραντεβού στη νέα ώρα που προτείνατε. Το αρχικό ραντεβού παραμένει για ${origDate}${origTime}. Αν δεν σας εξυπηρετεί, απαντήστε μας για να βρούμε άλλη λύση.`;
        setNotificationDraft(rejectDraft);
        setNotificationDraftTaskId(task.id);
        setNotificationCopied(false);
        setNotificationManualVisible(false);
      } else {
        setRejectTimeChangeError('Δεν αποθηκεύτηκε η απόρριψη. Δοκίμασε ξανά.');
      }
    } catch {
      setRejectTimeChangeError('Δεν αποθηκεύτηκε η απόρριψη. Δοκίμασε ξανά.');
    } finally {
      setRejectingTimeChangeId(null);
    }
  }

  async function handleGenerateDeliveryDraft() {
    const token = tokenRef.current;
    if (!token || !selectedAppointment) return;

    setDeliveryDraftLoading(true);
    setDeliveryDraftError(null);
    setDeliveryDraftMessage(null);
    setDeliveryDraftCopied(false);
    setDeliveryDraftManualVisible(false);

    try {
      const resp = await fetch('/api/appointment-notifications', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: selectedAppointment.id,
          kind: 'proposal',
          mode: 'draft',
        }),
      });

      const data = await resp.json() as { ok?: boolean; fallbackMessage?: string | null };
      if (data.ok && data.fallbackMessage) {
        setDeliveryDraftMessage(data.fallbackMessage);
      } else {
        setDeliveryDraftError('error');
      }
    } catch {
      setDeliveryDraftError('error');
    } finally {
      setDeliveryDraftLoading(false);
    }
  }

  function openForm() {
    setJustCreated(false);
    setCancellingTaskId(null);
    setCancelResult(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setCustomerSearch('');
    setSelectedCustomer(null);
    setApptDate(tomorrowDateStr());
    setApptTime('10:00');
    setApptNote('');
  }

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">Φόρτωση ραντεβού...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------

  if (noSession) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Ημερολόγιο</p>
        <h1 className="mb-5 text-xl font-bold text-zinc-900 dark:text-zinc-100">Ραντεβού</h1>
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">Συνδέσου για να δεις τα ραντεβού.</p>
          <Link
            href="/login"
            className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Fetch error
  // ---------------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Ημερολόγιο</p>
        <h1 className="mb-5 text-xl font-bold text-zinc-900 dark:text-zinc-100">Ραντεβού</h1>
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="mb-4 text-sm text-red-600">{fetchError}</p>
          <button
            type="button"
            onClick={() => {
              const token = tokenRef.current;
              if (token) {
                setHydrated(false);
                loadData(token);
              }
            }}
            className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekStr = week.toISOString().split('T')[0];

  const groups: Record<GroupKey, Task[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
  for (const t of appointments) {
    groups[getGroupKey(t.dueDate, todayStr, tomorrowStr, weekStr)].push(t);
  }

  const hasAny = appointments.length > 0;
  const canSave = !!selectedCustomer && !!apptDate && !!apptTime && !creating;

  if (selectedAppointment) {
    const selCustomer = getAppointmentCustomer(selectedAppointment);
    const selRespInfo = getAppointmentResponseInfo(selectedAppointment.note ?? '');
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
        <div>
          <button
            type="button"
            onClick={() => { clearDeliveryDraftState(); setSelectedAppointment(null); }}
            className="mb-3 text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            ← Πίσω στα ραντεβού
          </button>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Ραντεβού</p>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Στοιχεία ραντεβού</h1>
            </div>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => { void refreshKeepingSelection(selectedAppointment.id); }}
              className="shrink-0 rounded-xl border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
            >
              {refreshing ? 'Ανανέωση...' : refreshSuccess ? 'Ενημερώθηκε' : 'Ανανέωση απαντήσεων'}
            </button>
          </div>
          {refreshError && (
            <p className="mt-1 text-xs text-red-600">{refreshError}</p>
          )}
        </div>
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 space-y-3">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{selectedAppointment.title}</p>
          <div className="space-y-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {formatDate(selectedAppointment.dueDate)}
              {selectedAppointment.dueTime && <span className="ml-1.5">{selectedAppointment.dueTime}</span>}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {APPT_TYPE_LABELS[selectedAppointment.type] ?? selectedAppointment.type}
            </p>
            {selCustomer && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Πελάτης: {selCustomer.name}</p>
            )}
          </div>
        </div>
        {/* Customer response review */}
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Απάντηση από πελάτη</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selRespInfo.cls}`}>
              {selRespInfo.label}
            </span>
          </div>
          {selRespInfo.kind === null && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Δεν έχει καταγραφεί απάντηση πελάτη για αυτό το ραντεβού.</p>
          )}
          {selRespInfo.kind === 'accepted' && (
            <p className="text-xs text-zinc-700 dark:text-zinc-200">Ο πελάτης αποδέχτηκε το ραντεβού.</p>
          )}
          {selRespInfo.kind === 'declined' && (
            <p className="text-xs text-zinc-700 dark:text-zinc-200">Ο πελάτης δήλωσε ότι δεν μπορεί να παρευρεθεί.</p>
          )}
          {selRespInfo.kind === 'time_change_requested' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-700 dark:text-zinc-200">Ο πελάτης ζήτησε αλλαγή ώρας.</p>
              {selRespInfo.requestedDueDate && selRespInfo.requestedDueTime && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  Προτεινόμενη ώρα: {formatDate(selRespInfo.requestedDueDate)} {selRespInfo.requestedDueTime}
                </p>
              )}
              {selRespInfo.comment && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">Σχόλιο πελάτη: {selRespInfo.comment}</p>
              )}
              {selRespInfo.requestedDueDate && selRespInfo.requestedDueTime && (
                <div className="space-y-2 pt-1">
                  {(approveTimeChangeError ?? rejectTimeChangeError) && (
                    <p className="text-xs text-red-600">{approveTimeChangeError ?? rejectTimeChangeError}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={approvingTimeChangeId === selectedAppointment.id || rejectingTimeChangeId === selectedAppointment.id}
                      onClick={() => { void handleApproveTimeChange(selectedAppointment, selRespInfo); }}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {approvingTimeChangeId === selectedAppointment.id ? 'Αποθήκευση...' : 'Αποδοχή νέας ώρας'}
                    </button>
                    <button
                      type="button"
                      disabled={approvingTimeChangeId === selectedAppointment.id || rejectingTimeChangeId === selectedAppointment.id}
                      onClick={() => { void handleRejectTimeChange(selectedAppointment, selRespInfo); }}
                      className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
                    >
                      {rejectingTimeChangeId === selectedAppointment.id ? 'Αποθήκευση...' : 'Απόρριψη αλλαγής'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {selRespInfo.kind === 'time_change_approved' && (
            <p className="text-xs text-zinc-700 dark:text-zinc-200">
              {approveTimeChangeSuccess ?? 'Η νέα ώρα έχει εγκριθεί και αποθηκευτεί.'}
            </p>
          )}
          {selRespInfo.kind === 'time_change_rejected' && (
            <p className="text-xs text-zinc-700 dark:text-zinc-200">
              Η αλλαγή ώρας απορρίφθηκε. Το ραντεβού παραμένει στην αρχική ώρα.
            </p>
          )}
        </div>
        {/* Customer notification draft */}
        {notificationDraft && notificationDraftTaskId === selectedAppointment.id && (
          <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 space-y-3">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Ενημέρωση πελάτη</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Αντιγράψτε το παρακάτω μήνυμα και στείλτε το από το κανάλι που χρησιμοποιείτε.
            </p>
            <p className="rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-3 text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
              {notificationDraft}
            </p>
            {notificationManualVisible && (
              <textarea
                readOnly
                rows={4}
                value={notificationDraft}
                className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300"
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(notificationDraft).then(
                    () => { setNotificationCopied(true); setTimeout(() => setNotificationCopied(false), 2500); },
                    () => setNotificationManualVisible(true)
                  );
                } else {
                  setNotificationManualVisible(true);
                }
              }}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                notificationCopied
                  ? 'bg-green-100 text-green-700'
                  : 'border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5'
              }`}
            >
              {notificationCopied ? 'Αντιγράφηκε' : 'Αντιγραφή μηνύματος'}
            </button>
          </div>
        )}
        {/* Delivery draft card */}
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 space-y-3">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Αποστολή στον πελάτη</p>
          {deliveryDraftMessage ? (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Μήνυμα για αντιγραφή</p>
              <textarea
                readOnly
                rows={5}
                value={deliveryDraftMessage}
                className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200"
              />
              {deliveryDraftManualVisible && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Επιλέξτε το κείμενο παραπάνω για χειροκίνητη αντιγραφή.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(deliveryDraftMessage).then(
                      () => { setDeliveryDraftCopied(true); setTimeout(() => setDeliveryDraftCopied(false), 2500); },
                      () => setDeliveryDraftManualVisible(true)
                    );
                  } else {
                    setDeliveryDraftManualVisible(true);
                  }
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  deliveryDraftCopied
                    ? 'bg-green-100 text-green-700'
                    : 'border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
              >
                {deliveryDraftCopied ? 'Αντιγράφηκε' : 'Αντιγραφή μηνύματος'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Δημιουργεί μήνυμα για τον πελάτη. Δεν αποστέλλεται από την εφαρμογή.
              </p>
              {deliveryDraftError && (
                <p className="text-xs text-red-600">Δεν δημιουργήθηκε μήνυμα. Δοκίμασε ξανά.</p>
              )}
              <button
                type="button"
                disabled={deliveryDraftLoading}
                onClick={() => { void handleGenerateDeliveryDraft(); }}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {deliveryDraftLoading ? 'Δημιουργία...' : 'Δημιουργία μηνύματος'}
              </button>
            </>
          )}
        </div>

        {selectedAppointment.customerId && (
          <Link
            href={`/customers/${selectedAppointment.customerId}`}
            className="inline-block rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Προφίλ πελάτη
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Ημερολόγιο</p>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Ραντεβού</h1>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openForm}
            className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            + Νέο ραντεβού
          </button>
        )}
      </div>

      {/* Inline creation form */}
      {formOpen && (
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-indigo-200 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Νέο ραντεβού</p>
            <button type="button" onClick={closeForm} className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition">
              Ακύρωση
            </button>
          </div>

          {/* Customer search */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">Πελάτης</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-900 truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-xs text-zinc-500 dark:text-zinc-400">{selectedCustomer.phone}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}
                  className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
                >
                  Αλλαγή
                </button>
              </div>
            ) : (
              <div className="relative space-y-1">
                <input
                  type="search"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Αναζήτηση ονόματος, τηλεφώνου, email..."
                  className={`w-full ${inputCls}`}
                />
                {searchResults.length > 0 && (
                  <ul className="divide-y divide-zinc-100 dark:divide-white/10 overflow-hidden rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] shadow-md">
                    {searchResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                          className="flex w-full flex-col items-start px-3 py-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-white/5"
                        >
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.name}</span>
                          {c.phone && <span className="text-xs text-zinc-500 dark:text-zinc-400">{c.phone}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {customerSearch.trim() && searchResults.length === 0 && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">Δεν βρέθηκαν πελάτες.</p>
                )}
              </div>
            )}
            {selectedCustomer && !selectedCustomer.email && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Ο πελάτης δεν έχει email. Η αποστολή πρότασης θα χρειαστεί χειροκίνητη επικοινωνία.
              </p>
            )}
          </div>

          {/* Date + time */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Ημερομηνία</label>
              <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Ώρα</label>
              <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Optional note */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Σημείωση <span className="font-normal text-zinc-400 dark:text-zinc-500">(προαιρετικό)</span>
            </label>
            <textarea
              rows={2}
              value={apptNote}
              onChange={(e) => setApptNote(e.target.value)}
              placeholder="Εσωτερική σημείωση για αυτό το ραντεβού..."
              className={`w-full resize-none ${inputCls}`}
            />
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSave}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? 'Αποθήκευση...' : 'Δημιουργία ραντεβού'}
          </button>
        </div>
      )}

      {/* Creation success */}
      {justCreated && !formOpen && proposalTaskId && (
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-green-200 space-y-3">
          <p className="text-sm font-medium text-green-800">Το ραντεβού δημιουργήθηκε.</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Ο πελάτης δεν έχει ειδοποιηθεί ακόμα.</p>
          <button
            type="button"
            onClick={() => {
              const task = appointments.find((t) => t.id === proposalTaskId);
              if (task) { clearDeliveryDraftState(); setJustCreated(false); setSelectedAppointment(task); }
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Άνοιγμα ραντεβού
          </button>
        </div>
      )}

      {/* Cancellation result */}
      {cancelResult && (
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-200 dark:ring-white/10 space-y-2">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Το ραντεβού ακυρώθηκε.</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Ενημερώστε τον πελάτη χειροκίνητα αν χρειάζεται.</p>
        </div>
      )}

      {/* Empty state */}
      {!hasAny && (
        <Card padding="none">
          <EmptyState
            title="Δεν υπάρχουν ακόμα ραντεβού."
            description="Δημιούργησε ένα ραντεβού για πελάτη ή άφησε το AI να προτείνει επόμενο βήμα μετά από κλήση."
          />
        </Card>
      )}

      {/* Grouped agenda */}
      {hasAny && GROUP_ORDER.map((key) => {
        const group = groups[key];
        if (group.length === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <h2 className={`text-xs font-semibold uppercase tracking-wide ${key === 'overdue' ? 'text-red-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {GROUP_LABELS[key]}
            </h2>
            <ul className="space-y-2">
              {group.map((task) => {
                const customerName = task.customerId ? customerMap[task.customerId] : undefined;
                const status = getResponseStatus(task.note);

                return (
                  <li
                    key={task.id}
                    className="rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10"
                  >
                    {cancellingTaskId === task.id ? (
                      <div className="p-4 space-y-3">
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Επιβεβαίωση ακύρωσης ραντεβού</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">
                          {formatDate(task.dueDate)}{task.dueTime ? `, ${task.dueTime}` : ''}.
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => handleCancelConfirm(task)}
                            className="flex-1 rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
                          >
                            Ναι, ακύρωση
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancellingTaskId(null)}
                            className="rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                          >
                            Πίσω
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { clearDeliveryDraftState(); setSelectedAppointment(task); }}
                          className="flex min-w-0 w-full flex-col gap-1 p-4 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-xs font-semibold ${key === 'overdue' ? 'text-red-700' : 'text-indigo-700'}`}>
                              {formatDate(task.dueDate)}
                              {task.dueTime && <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">{task.dueTime}</span>}
                            </p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>
                              {status.label}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{task.title}</p>
                          {customerName && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{customerName}</p>
                          )}
                        </button>
                        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 dark:border-white/10 px-4 py-2">
                          <button
                            type="button"
                            onClick={() => { clearDeliveryDraftState(); setSelectedAppointment(task); }}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition"
                          >
                            Προβολή ραντεβού
                          </button>
                          {task.customerId && (
                            <Link href={`/customers/${task.customerId}`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition">
                              Πελάτης
                            </Link>
                          )}
                          {task.offerId && (
                            <Link href={`/offers/${task.offerId}`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition">
                              Προσφορά →
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => { setCancelResult(null); setCancellingTaskId(task.id); }}
                            className="ml-auto text-xs font-medium text-red-600 hover:text-red-700 transition"
                          >
                            Ακύρωση
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

    </div>
  );
}
