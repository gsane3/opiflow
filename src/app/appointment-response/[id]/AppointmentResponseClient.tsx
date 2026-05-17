'use client';

import { useState, useEffect } from 'react';
import { loadState, updateTask, addCommunicationRecord } from '@/lib/storage';
import type { Task, Customer, Offer } from '@/lib/types';

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

type ResponseAction =
  | 'idle'
  | 'confirming_accept'
  | 'confirming_decline'
  | 'suggesting_alternative'
  | 'accepted'
  | 'declined'
  | 'alternative_sent';

interface Props {
  taskId: string;
}

export default function AppointmentResponseClient({ taskId }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [action, setAction] = useState<ResponseAction>('idle');
  const [alternativeNote, setAlternativeNote] = useState('');

  useEffect(() => {
    const state = loadState();
    const foundTask = (state.tasks ?? []).find(
      (t) => t.id === taskId && t.type === 'book_appointment'
    ) ?? null;
    const foundCustomer = foundTask?.customerId
      ? (state.customers ?? []).find((c) => c.id === foundTask.customerId) ?? null
      : null;
    const foundOffer = foundTask?.offerId
      ? (state.offers ?? []).find((o) => o.id === foundTask.offerId) ?? null
      : null;
    const timer = window.setTimeout(() => {
      setTask(foundTask);
      setCustomer(foundCustomer);
      setOffer(foundOffer);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [taskId]);

  function handleAccept() {
    if (!task) return;
    const now = new Date().toISOString();
    const label = formatTimestamp(now);
    const updatedNote = task.note
      ? `${task.note}\nΑποδοχή ραντεβού από πελάτη: ${label}.`
      : `Αποδοχή ραντεβού από πελάτη: ${label}.`;
    const updated: Task = { ...task, note: updatedNote, updatedAt: now };
    updateTask(updated);
    addCommunicationRecord({
      id: crypto.randomUUID(),
      customerId: task.customerId,
      channel: 'sms',
      direction: 'inbound',
      status: 'completed',
      summary: `Αποδοχή ραντεβού από πελάτη μέσω demo link. Προτεινόμενη ώρα: ${task.dueDate} ${task.dueTime ?? ''}.`,
      createdAt: now,
      isMock: true,
    });
    setTask(updated);
    setAction('accepted');
  }

  function handleDecline() {
    if (!task) return;
    const now = new Date().toISOString();
    const label = formatTimestamp(now);
    const updatedNote = task.note
      ? `${task.note}\nΑδυναμία παρουσίας πελάτη: ${label}.`
      : `Αδυναμία παρουσίας πελάτη: ${label}.`;
    const updated: Task = { ...task, note: updatedNote, updatedAt: now };
    updateTask(updated);
    addCommunicationRecord({
      id: crypto.randomUUID(),
      customerId: task.customerId,
      channel: 'sms',
      direction: 'inbound',
      status: 'completed',
      summary: `Αδυναμία παρουσίας πελάτη για το ραντεβού ${task.dueDate} ${task.dueTime ?? ''} μέσω demo link.`,
      createdAt: now,
      isMock: true,
    });
    setTask(updated);
    setAction('declined');
  }

  function handleSendAlternative() {
    if (!task || !alternativeNote.trim()) return;
    const now = new Date().toISOString();
    const label = formatTimestamp(now);
    const updatedNote = task.note
      ? `${task.note}\nΠρόταση αλλαγής από πελάτη: ${alternativeNote.trim()}. ${label}.`
      : `Πρόταση αλλαγής από πελάτη: ${alternativeNote.trim()}. ${label}.`;
    const updated: Task = { ...task, note: updatedNote, updatedAt: now };
    updateTask(updated);
    addCommunicationRecord({
      id: crypto.randomUUID(),
      customerId: task.customerId,
      channel: 'sms',
      direction: 'inbound',
      status: 'completed',
      summary: `Πρόταση αλλαγής ραντεβού από πελάτη: ${alternativeNote.trim()}.`,
      createdAt: now,
      isMock: true,
    });
    setTask(updated);
    setAction('alternative_sent');
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-400">Φόρτωση ραντεβού...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
        <p className="text-base font-medium text-zinc-600">Το ραντεβού δεν βρέθηκε σε αυτόν τον browser.</p>
        <p className="max-w-xs text-sm text-zinc-400">
          Ο σύνδεσμος αυτός λειτουργεί μόνο στον browser όπου δημιουργήθηκε η πρόταση ραντεβού.
          Τα δεδομένα αποθηκεύονται τοπικά.
        </p>
        <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-xs text-amber-700">
            Demo μόνο. Δεν έχει συνδεθεί πραγματικό ημερολόγιο ή βάση δεδομένων.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-8">
      <div className="mx-auto max-w-lg space-y-5 px-4">

        {/* Demo disclaimer */}
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 ring-1 ring-amber-200 text-center">
          <p className="text-xs font-medium text-amber-700">
            Demo μόνο. Τοπική αποθήκευση. Δεν έχει συνδεθεί πραγματικό ημερολόγιο.
          </p>
        </div>

        {/* Appointment card */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <h1 className="text-xl font-bold text-zinc-900">Απάντηση ραντεβού</h1>

          {/* Appointment details */}
          <div className="rounded-xl bg-zinc-50 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-zinc-500">Ημερομηνία</span>
              <span className="font-semibold text-zinc-900">{formatDate(task.dueDate)}</span>
            </div>
            {task.dueTime && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Ώρα</span>
                <span className="font-semibold text-zinc-900">{task.dueTime}</span>
              </div>
            )}
            {customer && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Πελάτης</span>
                <span className="text-zinc-700">{customer.name}</span>
              </div>
            )}
            {offer && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Προσφορά</span>
                <span className="text-zinc-700">{offer.offerNumber}</span>
              </div>
            )}
          </div>

          {/* Response section */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">Απάντησή σας</h2>

            {/* Accepted */}
            {action === 'accepted' && (
              <div className="rounded-xl bg-green-50 px-4 py-4 ring-1 ring-green-200 text-center space-y-1">
                <p className="text-base font-bold text-green-700">Το ραντεβού επιβεβαιώθηκε.</p>
                <p className="text-sm text-green-600">
                  Η επιχείρηση θα δει την αποδοχή σας στο CRM.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Declined */}
            {action === 'declined' && (
              <div className="rounded-xl bg-amber-50 px-4 py-4 ring-1 ring-amber-200 text-center space-y-1">
                <p className="text-base font-bold text-amber-700">Η απάντησή σας καταγράφηκε.</p>
                <p className="text-sm text-amber-600">
                  Η επιχείρηση θα επικοινωνήσει μαζί σας για νέο ραντεβού.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Alternative sent */}
            {action === 'alternative_sent' && (
              <div className="rounded-xl bg-indigo-50 px-4 py-4 ring-1 ring-indigo-200 text-center space-y-1">
                <p className="text-base font-bold text-indigo-700">Η πρότασή σας στάλθηκε.</p>
                <p className="text-sm text-indigo-600">
                  Η επιχείρηση θα δει την εναλλακτική πρότασή σας στο CRM.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Confirming accept */}
            {action === 'confirming_accept' && (
              <div className="rounded-xl bg-green-50 p-4 ring-1 ring-green-200 space-y-3">
                <p className="text-sm font-semibold text-green-800">Επιβεβαίωση αποδοχής</p>
                <p className="text-sm text-green-700">
                  Επιβεβαιώνετε ότι θα παρευρεθείτε στο ραντεβού την{' '}
                  <span className="font-semibold">{formatDate(task.dueDate)}</span>
                  {task.dueTime ? ` στις ${task.dueTime}` : ''}.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleAccept}
                    className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700"
                  >
                    Ναι, επιβεβαιώνω
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Confirming decline */}
            {action === 'confirming_decline' && (
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
                <p className="text-sm font-semibold text-zinc-800">Επιβεβαίωση αδυναμίας</p>
                <p className="text-sm text-zinc-600">
                  Η επιχείρηση θα ενημερωθεί ότι δεν μπορείτε να παρευρεθείτε.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleDecline}
                    className="flex-1 rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
                  >
                    Ναι, δεν μπορώ
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Suggesting alternative */}
            {action === 'suggesting_alternative' && (
              <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-200 space-y-3">
                <p className="text-sm font-semibold text-indigo-800">Πρόταση εναλλακτικής ώρας</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">
                    Σχόλιο ή εναλλακτική ημερομηνία/ώρα{' '}
                    <span className="text-zinc-400">(υποχρεωτικό)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={alternativeNote}
                    onChange={(e) => setAlternativeNote(e.target.value)}
                    placeholder="π.χ. Μπορούμε Παρασκευή απόγευμα 15:00;"
                    className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleSendAlternative}
                    disabled={!alternativeNote.trim()}
                    className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Αποστολή πρότασης
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Idle: action buttons */}
            {action === 'idle' && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setAction('confirming_accept')}
                  className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  Ναι, το επιβεβαιώνω
                </button>
                <button
                  type="button"
                  onClick={() => setAction('confirming_decline')}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                >
                  Δεν μπορώ αυτή την ώρα
                </button>
                <button
                  type="button"
                  onClick={() => setAction('suggesting_alternative')}
                  className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
                >
                  Προτείνω άλλη ώρα
                </button>
              </div>
            )}
          </div>
        </div>

        {/* E-signature disclaimer */}
        <p className="text-center text-xs text-zinc-400">
          Demo μόνο. Δεν αποτελεί νόμιμη ηλεκτρονική υπογραφή ούτε δέσμευση μέσω εξωτερικού ημερολογίου.
        </p>
        <p className="text-center text-xs text-zinc-400">
          yorgos.ai MVP, τοπική αποθήκευση μόνο
        </p>
      </div>
    </div>
  );
}
