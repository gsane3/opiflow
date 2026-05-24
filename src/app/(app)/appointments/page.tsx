'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
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

function getResponseStatus(note: string): { label: string; cls: string } {
  if (note.includes('Αποδοχή ραντεβού από πελάτη:')) {
    return { label: 'Αποδεκτό', cls: 'bg-green-100 text-green-700' };
  }
  if (note.includes('Αδυναμία παρουσίας πελάτη:')) {
    return { label: 'Αδυναμία', cls: 'bg-amber-100 text-amber-700' };
  }
  if (note.includes('Πρόταση αλλαγής από πελάτη:')) {
    return { label: 'Εναλλακτική', cls: 'bg-indigo-100 text-indigo-700' };
  }
  return { label: 'Αναμονή απάντησης', cls: 'bg-zinc-100 text-zinc-500' };
}

function buildProposalEmailText(customer: Customer, date: string, time: string, taskId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const responseLink = `${origin}/appointment-response/${taskId}`;
  return [
    `Αγαπητέ/ή ${customer.name},`,
    '',
    'Σας προτείνουμε ραντεβού.',
    '',
    `Ημερομηνία: ${date}`,
    `Ώρα: ${time}`,
    '',
    'Παρακαλούμε επιβεβαιώστε ή προτείνετε εναλλακτική ημερομηνία μέσω του παρακάτω συνδέσμου:',
    responseLink,
    '',
    'Σημείωση: Ο σύνδεσμος επιτρέπει την απάντηση του πελάτη σε αυτό το ραντεβού.',
    '',
    'Με εκτίμηση',
  ].join('\n');
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

function buildCancellationEmailText(customer: Customer | null, task: Task): string {
  const name = customer?.name ?? 'πελάτη';
  const lines: string[] = [
    `Αγαπητέ/ή ${name},`,
    '',
    'Σας ενημερώνουμε ότι το ραντεβού που είχαμε ορίσει ακυρώθηκε.',
    '',
    `Ημερομηνία: ${formatDate(task.dueDate)}`,
  ];
  if (task.dueTime) lines.push(`Ώρα: ${task.dueTime}`);
  lines.push('');
  lines.push('Θα επικοινωνήσουμε μαζί σας για να ορίσουμε νέα ημερομηνία αν χρειαστεί.');
  lines.push('');
  lines.push('Με εκτίμηση');
  return lines.join('\n');
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

const inputCls = 'rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

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
  const [proposalCustomer, setProposalCustomer] = useState<Customer | null>(null);
  const [proposalDate, setProposalDate] = useState('');
  const [proposalTime, setProposalTime] = useState('');
  const [proposalEmailState, setProposalEmailState] = useState<'idle' | 'sending' | 'sent' | 'missing_config' | 'error'>('idle');
  const [proposalEmailCopied, setProposalEmailCopied] = useState(false);
  const [proposalEmailManualCopyVisible, setProposalEmailManualCopyVisible] = useState(false);

  // Cancellation state
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<{ task: Task; customer: Customer | null; isFuture: boolean } | null>(null);
  const [cancelEmailState, setCancelEmailState] = useState<'idle' | 'sending' | 'sent' | 'missing_config' | 'error'>('idle');
  const [cancelEmailCopied, setCancelEmailCopied] = useState(false);
  const [cancelEmailManualVisible, setCancelEmailManualVisible] = useState(false);

  const [selectedAppointment, setSelectedAppointment] = useState<Task | null>(null);

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
      setProposalCustomer(selectedCustomer);
      setProposalDate(apptDate);
      setProposalTime(apptTime);
      setProposalEmailState('idle');
      setProposalEmailCopied(false);
      setProposalEmailManualCopyVisible(false);
      setFormOpen(false);
      setCustomerSearch('');
      setSelectedCustomer(null);
      setApptDate(tomorrowDateStr());
      setApptTime('10:00');
      setApptNote('');
      setJustCreated(true);
    }
  }

  async function handleSendProposalEmail() {
    if (!proposalCustomer?.email || !proposalTaskId) return;
    setProposalEmailState('sending');
    const subject = 'Πρόταση ραντεβού';
    const text = buildProposalEmailText(proposalCustomer, proposalDate, proposalTime, proposalTaskId);
    try {
      const res = await fetch('/api/email/send-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: proposalCustomer.email, subject, text }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setProposalEmailState('sent');
      } else if (data.error === 'missing_email_config') {
        setProposalEmailState('missing_config');
      } else {
        setProposalEmailState('error');
      }
    } catch {
      setProposalEmailState('error');
    }
  }

  function handleCopyProposalEmail() {
    if (!proposalTaskId || !proposalCustomer) return;
    const text = buildProposalEmailText(proposalCustomer, proposalDate, proposalTime, proposalTaskId);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setProposalEmailCopied(true); setTimeout(() => setProposalEmailCopied(false), 2500); },
        () => setProposalEmailManualCopyVisible(true)
      );
    } else {
      setProposalEmailManualCopyVisible(true);
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
      setCancelEmailState('idle');
      setCancelEmailCopied(false);
      setCancelEmailManualVisible(false);
      setCancellingTaskId(null);
    }
  }

  async function handleSendCancellationEmail() {
    if (!cancelResult?.customer?.email) return;
    setCancelEmailState('sending');
    const text = buildCancellationEmailText(cancelResult.customer, cancelResult.task);
    try {
      const res = await fetch('/api/email/send-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cancelResult.customer.email, subject: 'Ακύρωση ραντεβού', text }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setCancelEmailState('sent');
      } else if (data.error === 'missing_email_config') {
        setCancelEmailState('missing_config');
      } else {
        setCancelEmailState('error');
      }
    } catch {
      setCancelEmailState('error');
    }
  }

  function handleCopyCancellationEmail() {
    if (!cancelResult) return;
    const text = buildCancellationEmailText(cancelResult.customer, cancelResult.task);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setCancelEmailCopied(true); setTimeout(() => setCancelEmailCopied(false), 2500); },
        () => setCancelEmailManualVisible(true)
      );
    } else {
      setCancelEmailManualVisible(true);
    }
  }

  function getAppointmentCustomer(task: Task): Customer | null {
    if (!task.customerId) return null;
    return customers.find((c) => c.id === task.customerId) ?? null;
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
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση ραντεβού...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------

  if (noSession) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Ραντεβού</h1>
        <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
          <p className="mb-4 text-sm text-zinc-600">Συνδέσου για να δεις τα ραντεβού.</p>
          <Link
            href="/login/backend"
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
      <div className="mx-auto max-w-2xl px-4 py-5">
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Ραντεβού</h1>
        <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
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

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Ραντεβού</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Πρόγραμμα ραντεβού και επισκέψεων πελατών.
          </p>
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
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-indigo-200 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800">Νέο ραντεβού</p>
            <button type="button" onClick={closeForm} className="text-xs text-zinc-400 hover:text-zinc-600 transition">
              Ακύρωση
            </button>
          </div>

          {/* Customer search */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600">Πελάτης</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-900 truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-xs text-zinc-500">{selectedCustomer.phone}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}
                  className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600 transition"
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
                  <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-md">
                    {searchResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                          className="flex w-full flex-col items-start px-3 py-2.5 text-left transition hover:bg-indigo-50"
                        >
                          <span className="text-sm font-semibold text-zinc-900">{c.name}</span>
                          {c.phone && <span className="text-xs text-zinc-500">{c.phone}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {customerSearch.trim() && searchResults.length === 0 && (
                  <p className="text-xs text-zinc-400">Δεν βρέθηκαν πελάτες.</p>
                )}
              </div>
            )}
            {selectedCustomer && !selectedCustomer.email && (
              <p className="text-xs text-zinc-400">
                Ο πελάτης δεν έχει email. Η αποστολή πρότασης θα χρειαστεί χειροκίνητη επικοινωνία.
              </p>
            )}
          </div>

          {/* Date + time */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="mb-1 block text-xs font-medium text-zinc-600">Ημερομηνία</label>
              <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className={`w-full ${inputCls}`} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Ώρα</label>
              <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Optional note */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Σημείωση <span className="font-normal text-zinc-400">(προαιρετικό)</span>
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

      {/* Success + proposal email section */}
      {justCreated && !formOpen && proposalTaskId && proposalCustomer && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-green-200 space-y-3">
          <div>
            <p className="text-sm font-medium text-green-800">Το ραντεβού δημιουργήθηκε.</p>
            <p className="text-xs text-zinc-500 mt-0.5">Ο πελάτης δεν έχει ειδοποιηθεί ακόμα.</p>
          </div>

          <div className="border-t border-zinc-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-600">Πρόταση ραντεβού στον πελάτη</p>

            {!proposalCustomer.email ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">
                  Δεν υπάρχει email πελάτη για αποστολή πρότασης. Αντέγραψε το κείμενο και στείλ&apos; το χειροκίνητα.
                </p>
                <textarea
                  readOnly
                  rows={6}
                  value={buildProposalEmailText(proposalCustomer, proposalDate, proposalTime, proposalTaskId)}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
                />
                <button
                  type="button"
                  onClick={handleCopyProposalEmail}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${proposalEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {proposalEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                </button>
              </div>
            ) : proposalEmailState === 'sent' ? (
              <p className="text-xs font-medium text-green-700">Στάλθηκε email πρότασης ραντεβού.</p>
            ) : (proposalEmailState === 'missing_config' || proposalEmailState === 'error') ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-700">
                  {proposalEmailState === 'missing_config'
                    ? 'Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το κείμενο και να το στείλεις χειροκίνητα.'
                    : 'Σφάλμα αποστολής. Αντέγραψε το κείμενο για χειροκίνητη αποστολή.'}
                </p>
                <textarea
                  readOnly
                  rows={6}
                  value={buildProposalEmailText(proposalCustomer, proposalDate, proposalTime, proposalTaskId)}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
                />
                <button
                  type="button"
                  onClick={handleCopyProposalEmail}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${proposalEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {proposalEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  Αν η αποστολή email είναι ρυθμισμένη στον server, αυτό θα στείλει πρόταση ραντεβού στον πελάτη ({proposalCustomer.email}).
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSendProposalEmail}
                    disabled={proposalEmailState === 'sending'}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {proposalEmailState === 'sending' ? 'Αποστολή...' : 'Αποστολή πρότασης'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyProposalEmail}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${proposalEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {proposalEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                  </button>
                </div>
                {proposalEmailManualCopyVisible && (
                  <textarea
                    readOnly
                    rows={6}
                    value={buildProposalEmailText(proposalCustomer, proposalDate, proposalTime, proposalTaskId)}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancellation result */}
      {cancelResult && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200 space-y-3">
          <p className="text-sm font-medium text-zinc-800">Το ραντεβού ακυρώθηκε.</p>
          {!cancelResult.isFuture ? (
            <p className="text-xs text-zinc-400">
              Το ραντεβού δεν ήταν μελλοντικό, οπότε δεν γίνεται αποστολή email ακύρωσης.
            </p>
          ) : !cancelResult.customer?.email ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Δεν υπάρχει email πελάτη για αποστολή ακύρωσης. Αντέγραψε το κείμενο και ενημέρωσε τον πελάτη χειροκίνητα.
              </p>
              <textarea
                readOnly
                rows={5}
                value={buildCancellationEmailText(cancelResult.customer, cancelResult.task)}
                className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
              />
              <button
                type="button"
                onClick={handleCopyCancellationEmail}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${cancelEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
              >
                {cancelEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
              </button>
            </div>
          ) : cancelEmailState === 'sent' ? (
            <p className="text-xs font-medium text-green-700">Στάλθηκε email ακύρωσης.</p>
          ) : (cancelEmailState === 'missing_config' || cancelEmailState === 'error') ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-700">
                {cancelEmailState === 'missing_config'
                  ? 'Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το κείμενο και να το στείλεις χειροκίνητα.'
                  : 'Σφάλμα αποστολής. Αντέγραψε το κείμενο για χειροκίνητη αποστολή.'}
              </p>
              <textarea
                readOnly
                rows={5}
                value={buildCancellationEmailText(cancelResult.customer, cancelResult.task)}
                className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
              />
              <button
                type="button"
                onClick={handleCopyCancellationEmail}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${cancelEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
              >
                {cancelEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">
                Αν η αποστολή email είναι ρυθμισμένη στον server, αυτό θα στείλει ειδοποίηση ακύρωσης στον πελάτη ({cancelResult.customer.email}).
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSendCancellationEmail}
                  disabled={cancelEmailState === 'sending'}
                  className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {cancelEmailState === 'sending' ? 'Αποστολή...' : 'Αποστολή email ακύρωσης'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyCancellationEmail}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${cancelEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {cancelEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                </button>
              </div>
              {cancelEmailManualVisible && (
                <textarea
                  readOnly
                  rows={5}
                  value={buildCancellationEmailText(cancelResult.customer, cancelResult.task)}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 font-mono leading-relaxed"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* No calendar integration notice */}
      <div className="rounded-xl bg-zinc-50 px-4 py-2.5 ring-1 ring-zinc-200">
        <p className="text-xs text-zinc-500">
          Εσωτερικό πρόγραμμα ραντεβού. Δεν έχει συνδεθεί εξωτερικό ημερολόγιο.
        </p>
      </div>

      {/* Empty state */}
      {!hasAny && (
        <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-600">
            Δεν υπάρχουν ακόμα ραντεβού. Δημιούργησε ένα ραντεβού για πελάτη ή άφησε το AI να προτείνει επόμενο βήμα μετά από κλήση.
          </p>
        </div>
      )}

      {/* Grouped agenda */}
      {hasAny && GROUP_ORDER.map((key) => {
        const group = groups[key];
        if (group.length === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <h2 className={`text-xs font-semibold uppercase tracking-wide ${key === 'overdue' ? 'text-red-600' : 'text-zinc-500'}`}>
              {GROUP_LABELS[key]}
            </h2>
            <ul className="space-y-2">
              {group.map((task) => {
                const customerName = task.customerId ? customerMap[task.customerId] : undefined;
                const status = getResponseStatus(task.note);

                return (
                  <li
                    key={task.id}
                    className={`rounded-2xl ring-1 ${key === 'overdue' ? 'bg-red-50 ring-red-200' : 'bg-white ring-zinc-100 shadow-sm'}`}
                  >
                    {cancellingTaskId === task.id ? (
                      <div className="p-4 space-y-3">
                        <p className="text-sm font-semibold text-zinc-800">Επιβεβαίωση ακύρωσης ραντεβού</p>
                        <p className="text-sm text-zinc-600">
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
                            className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                          >
                            Πίσω
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedAppointment(task)}
                          className="flex min-w-0 w-full flex-col gap-1 p-4 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-xs font-semibold ${key === 'overdue' ? 'text-red-700' : 'text-indigo-700'}`}>
                              {formatDate(task.dueDate)}
                              {task.dueTime && <span className="ml-1.5 font-normal text-zinc-500">{task.dueTime}</span>}
                            </p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>
                              {status.label}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-zinc-900 truncate">{task.title}</p>
                          {customerName && (
                            <p className="text-xs text-zinc-500 truncate">{customerName}</p>
                          )}
                        </button>
                        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-2">
                          <button
                            type="button"
                            onClick={() => setSelectedAppointment(task)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition"
                          >
                            Προβολή ραντεβού
                          </button>
                          {task.customerId && (
                            <Link href={`/customers/${task.customerId}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-700 transition">
                              Πελάτης
                            </Link>
                          )}
                          {task.offerId && (
                            <Link href={`/offers/${task.offerId}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-700 transition">
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

      {/* Appointment detail panel */}
      {selectedAppointment && (() => {
        const selCustomer = getAppointmentCustomer(selectedAppointment);
        return (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setSelectedAppointment(null)}
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white px-5 py-6 shadow-xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-base font-semibold text-zinc-900">Στοιχεία ραντεβού</p>
                <button
                  type="button"
                  onClick={() => setSelectedAppointment(null)}
                  className="shrink-0 text-sm text-zinc-400 transition hover:text-zinc-600"
                >
                  Κλείσιμο
                </button>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-zinc-900">{selectedAppointment.title}</p>
                <p className="text-sm text-zinc-600">
                  {formatDate(selectedAppointment.dueDate)}
                  {selectedAppointment.dueTime && <span className="ml-1.5">{selectedAppointment.dueTime}</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {APPT_TYPE_LABELS[selectedAppointment.type] ?? selectedAppointment.type}
                </p>
                {selCustomer && (
                  <p className="text-xs text-zinc-500">Πελάτης: {selCustomer.name}</p>
                )}
                {selectedAppointment.note && (
                  <p className="text-xs text-zinc-500 whitespace-pre-wrap">{selectedAppointment.note}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedAppointment(null)}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Κλείσιμο
                </button>
                {selectedAppointment.customerId && (
                  <Link
                    href={`/customers/${selectedAppointment.customerId}`}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Προφίλ πελάτη
                  </Link>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
