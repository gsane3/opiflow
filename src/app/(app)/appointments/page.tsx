'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState, addTask } from '@/lib/storage';
import type { Task, Offer, Customer } from '@/lib/types';

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
    // Reset form
    setFormOpen(false);
    setCustomerSearch('');
    setSelectedCustomer(null);
    setApptDate(tomorrowDateStr());
    setApptTime('10:00');
    setApptNote('');
    setJustCreated(true);
  }

  function openForm() {
    setJustCreated(false);
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
            <button
              type="button"
              onClick={closeForm}
              className="text-xs text-zinc-400 hover:text-zinc-600 transition"
            >
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
                  {selectedCustomer.phone && (
                    <p className="text-xs text-zinc-500">{selectedCustomer.phone}</p>
                  )}
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
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
              <input
                type="date"
                value={apptDate}
                onChange={(e) => setApptDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Ώρα</label>
              <input
                type="time"
                value={apptTime}
                onChange={(e) => setApptTime(e.target.value)}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          {/* Optional note */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Σημείωση{' '}
              <span className="font-normal text-zinc-400">(προαιρετικό)</span>
            </label>
            <textarea
              rows={2}
              value={apptNote}
              onChange={(e) => setApptNote(e.target.value)}
              placeholder="Εσωτερική σημείωση για αυτό το ραντεβού..."
              className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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

      {/* Success banner */}
      {justCreated && !formOpen && (
        <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
          <p className="text-sm font-medium text-green-800">Το ραντεβού δημιουργήθηκε.</p>
          <p className="text-xs text-zinc-500">
            Ο πελάτης δεν έχει ειδοποιηθεί ακόμα. Η αποστολή πρότασης θα προστεθεί στο επόμενο βήμα.
          </p>
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
                  ? `/customers/${task.customerId}`
                  : `/tasks?taskId=${task.id}`;
                const status = getResponseStatus(task.note);

                return (
                  <li
                    key={task.id}
                    className={`rounded-2xl ring-1 ${key === 'overdue' ? 'bg-red-50 ring-red-200' : 'bg-white ring-zinc-100 shadow-sm'}`}
                  >
                    <Link href={primaryHref} className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-xs font-semibold ${key === 'overdue' ? 'text-red-700' : 'text-indigo-700'}`}>
                          {formatDate(task.dueDate)}
                          {task.dueTime && (
                            <span className="ml-1.5 font-normal text-zinc-500">{task.dueTime}</span>
                          )}
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
                    <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-2">
                      <Link href={`/tasks?taskId=${task.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition">
                        Άνοιγμα task →
                      </Link>
                      {offer && (
                        <Link href={`/offers/${task.offerId}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-700 transition">
                          Προσφορά →
                        </Link>
                      )}
                    </div>
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
