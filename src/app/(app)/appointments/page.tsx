'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState, addTask, updateTask } from '@/lib/storage';
import type { Task, Offer, Customer } from '@/lib/types';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';

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
    'Σημείωση: Ο σύνδεσμος λειτουργεί μόνο στον browser όπου δημιουργήθηκε η πρόταση. Τα δεδομένα αποθηκεύονται τοπικά.',
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

export default function AppointmentsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [appointments, setAppointments] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({});
  const [offerMap, setOfferMap] = useState<Record<string, Offer>>({});

  // New appointment form state
  const [formOpen, setFormOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [apptDate, setApptDate] = useState(tomorrowDateStr);
  const [apptTime, setApptTime] = useState('10:00');
  const [apptNote, setApptNote] = useState('');
  const [justCreated, setJustCreated] = useState(false);

  // Proposal details after creation (for email/copy section)
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

  useEffect(() => {
    const state = loadState();
    const tasks = (state.tasks ?? [])
      .filter((t) => (t.type === 'book_appointment' || t.type === 'visit_customer') && t.status === 'open');
    const cList = state.customers ?? [];
    const cMap: Record<string, string> = Object.fromEntries(cList.map((c) => [c.id, c.name]));
    const oMap: Record<string, Offer> = Object.fromEntries((state.offers ?? []).map((o) => [o.id, o]));
    const timer = window.setTimeout(() => {
      setAppointments(sortAppointments(tasks));
      setCustomers(cList);
      setCustomerMap(cMap);
      setOfferMap(oMap);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const norm = (s: string) => s.toLowerCase().trim();
  const searchResults: Customer[] = customerSearch.trim()
    ? customers.filter((c) => {
        const q = norm(customerSearch);
        return (
          norm(c.name).includes(q) ||
          norm(c.phone ?? '').includes(q) ||
          norm(c.email ?? '').includes(q)
        );
      }).slice(0, 8)
    : [];

  function handleCreate() {
    if (!selectedCustomer || !apptDate || !apptTime) return;
    setCancelResult(null);
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    const task: Task = {
      id: taskId,
      customerId: selectedCustomer.id,
      title: `Ραντεβού με ${selectedCustomer.name}`,
      type: 'book_appointment',
      status: 'open',
      priority: 'normal',
      dueDate: apptDate,
      dueTime: apptTime,
      note: apptNote.trim() || 'Ραντεβού δημιουργήθηκε από το πρόγραμμα ραντεβού.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    setAppointments((prev) => sortAppointments([...prev, task]));
    setCustomerMap((prev) => ({ ...prev, [selectedCustomer.id]: selectedCustomer.name }));
    // Store proposal details before resetting form
    setProposalTaskId(taskId);
    setProposalCustomer(selectedCustomer);
    setProposalDate(apptDate);
    setProposalTime(apptTime);
    setProposalEmailState('idle');
    setProposalEmailCopied(false);
    setProposalEmailManualCopyVisible(false);
    // Reset form
    setFormOpen(false);
    setCustomerSearch('');
    setSelectedCustomer(null);
    setApptDate(tomorrowDateStr());
    setApptTime('10:00');
    setApptNote('');
    setJustCreated(true);
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

  function handleCancelConfirm(task: Task) {
    const customer = task.customerId ? customers.find((c) => c.id === task.customerId) ?? null : null;
    const isFuture = isFutureAppointment(task);
    const now = new Date().toISOString();
    const label = formatTimestamp(now);
    const noteAppend = `Ακύρωση ραντεβού: ${label}.`;
    const updatedNote = task.note ? `${task.note}\n${noteAppend}` : noteAppend;
    const updated: Task = { ...task, status: 'cancelled' as Task['status'], updatedAt: now, note: updatedNote };
    updateTask(updated);
    setAppointments((prev) => prev.filter((t) => t.id !== task.id));
    setCancelResult({ task: updated, customer, isFuture });
    setCancelEmailState('idle');
    setCancelEmailCopied(false);
    setCancelEmailManualVisible(false);
    setCancellingTaskId(null);
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

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση ραντεβού...</p>
      </div>
    );
  }

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
  const canSave = !!selectedCustomer && !!apptDate && !!apptTime;

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
      <GuidedDemoBanner
        step="appointments"
        stepNum={5}
        title="Δες τα ραντεβού"
        whatYouSee="Εσωτερικό πρόγραμμα ραντεβού με book_appointment και visit_customer tasks ταξινομημένα χρονολογικά."
        whatToDo="Κοίτα τα demo ραντεβού και δοκίμασε την inline ακύρωση αν θέλεις."
        whyItMatters="Είναι πρόγραμμα CRM μέσα στο MVP. Δεν συνδέεται με εξωτερικό ημερολόγιο."
        canManualComplete={true}
      />
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
            Δημιουργία ραντεβού
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

      {/* Disclaimer */}
      <div className="rounded-xl bg-amber-50 px-4 py-2.5 ring-1 ring-amber-200">
        <p className="text-xs text-amber-700">
          Τοπικό πρόγραμμα CRM. Τα ραντεβού αποθηκεύονται μόνο σε αυτόν τον browser και δεν έχει συνδεθεί εξωτερικό ημερολόγιο.
        </p>
      </div>

      {/* Empty state */}
      {!hasAny && (
        <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-600">Δεν υπάρχουν ραντεβού ακόμα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Πάτα «+ Νέο ραντεβού» ή ορίσε ραντεβού από μια αποδεκτή προσφορά.
          </p>
          <Link
            href="/offers"
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Προσφορές →
          </Link>
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
                const offer = task.offerId ? offerMap[task.offerId] : undefined;
                const primaryHref = task.customerId
                  ? `/customers/${task.customerId}?focusAppointment=${task.id}`
                  : `/tasks?taskId=${task.id}`;
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
                        <Link href={primaryHref} className="flex min-w-0 flex-1 flex-col gap-1 p-4">
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
                          {(customerName || offer) && (
                            <p className="text-xs text-zinc-500 truncate">
                              {customerName && <span>{customerName}</span>}
                              {customerName && offer && <span className="mx-1">·</span>}
                              {offer && <span>{offer.offerNumber}</span>}
                            </p>
                          )}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-2">
                          <Link href={`/tasks?taskId=${task.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition">
                            Άνοιγμα task →
                          </Link>
                          {offer && (
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
    </div>
  );
}
