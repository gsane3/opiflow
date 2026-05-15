'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadState, updateCustomer, deleteCustomer } from '@/lib/storage';
import { buildMapsUrl } from '@/lib/maps';
import type { Customer, Task, Offer } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import OfferStatusBadge from '@/components/offers/OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';
import CustomerStatusBadge, { STATUS_LABELS } from './CustomerStatusBadge';
import { SOURCE_LABELS } from './CustomerCard';
import CustomerForm from './CustomerForm';
import { TASK_TYPE_LABELS } from '@/components/tasks/TaskStatusBadge';

const CONTACT_LABELS: Record<string, string> = {
  viber: 'Viber',
  email: 'Email',
  phone: 'Τηλέφωνο',
};

function DisabledAction({ label, note }: { label: string; note?: string }) {
  return (
    <button
      disabled
      className="flex w-full flex-col items-center gap-1 rounded-2xl bg-zinc-50 px-2 py-3 text-xs font-medium text-zinc-400 cursor-not-allowed"
      title={note ? `Σύντομα — ${note}` : 'Σύντομα'}
    >
      <span className="text-center leading-tight">{label}</span>
      <span className="text-zinc-300 text-[10px]">Σύντομα</span>
    </button>
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
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const [customerOffers, setCustomerOffers] = useState<Offer[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    const foundCustomer = (state.customers ?? []).find((c) => c.id === customerId) ?? null;
    const foundTasks = (state.tasks ?? []).filter(
      (t) => t.customerId === customerId && t.status === 'open'
    );
    const foundOffers = (state.offers ?? []).filter((o) => o.customerId === customerId);
    const timer = window.setTimeout(() => {
      setCustomer(foundCustomer);
      setOpenTasks(foundTasks);
      setCustomerOffers(foundOffers);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [customerId]);

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 space-y-5">
      {/* Back */}
      <button
        type="button"
        onClick={() => router.push('/customers')}
        className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← Πελάτες
      </button>

      {/* Header */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-lg font-bold text-zinc-900">{customer.name}</h1>
              {customer.isDemo && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">
                  Demo
                </span>
              )}
            </div>
            {customer.companyName && (
              <p className="mt-0.5 text-sm text-zinc-500">{customer.companyName}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CustomerStatusBadge status={customer.status} />
              {customer.opportunityValue && (
                <span className="text-sm font-semibold text-zinc-700">
                  €{customer.opportunityValue.toLocaleString('el-GR')}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="shrink-0 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Επεξεργασία
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Γρήγορες ενέργειες
        </p>
        {/* 3-column grid — all items fully visible, no scroll */}
        <div className="grid grid-cols-3 gap-2">
          {/* Call — stub */}
          <DisabledAction label="Κλήση" />

          {/* Maps — real */}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full flex-col items-center gap-1 rounded-2xl bg-indigo-50 px-2 py-3 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              <span>Maps</span>
            </a>
          ) : (
            <button
              disabled
              className="flex w-full flex-col items-center gap-1 rounded-2xl bg-zinc-50 px-2 py-3 text-xs font-medium text-zinc-400 cursor-not-allowed"
              title="Δεν υπάρχει διεύθυνση"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              <span>Maps</span>
            </button>
          )}

          <Link
            href="/tasks"
            className="flex w-full flex-col items-center gap-1 rounded-2xl bg-indigo-50 px-2 py-3 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>Tasks</span>
          </Link>
          <Link
            href="/offers"
            className="flex w-full flex-col items-center gap-1 rounded-2xl bg-indigo-50 px-2 py-3 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span>Προσφορά</span>
          </Link>
          <DisabledAction label="Viber" />
          <DisabledAction label="Email draft" />
        </div>
      </div>

      {/* Contact info */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Στοιχεία επικοινωνίας
        </h2>
        {customer.phone ? (
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
            </svg>
            <span className="min-w-0 flex-1 break-all text-sm text-zinc-800">{customer.phone}</span>
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
        {!customer.phone && !customer.email && !customer.address && (
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

      {/* Open tasks */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Ανοιχτά tasks
          </h2>
          <Link href="/tasks" className="text-xs text-indigo-600 hover:text-indigo-700">
            Διαχείριση →
          </Link>
        </div>
        {openTasks.length === 0 ? (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν ανοιχτά tasks.</p>
        ) : (
          <ul className="space-y-2">
            {openTasks.map((task) => {
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
                  {isOverdue && (
                    <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Εκπρόθεσμο
                    </span>
                  )}
                  {isToday && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Σήμερα
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Offers & files */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Προσφορές &amp; αρχεία πελάτη
          </h2>
          <Link href="/offers" className="text-xs text-indigo-600 hover:text-indigo-700">
            Διαχείριση →
          </Link>
        </div>

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

          {/* Disabled upload placeholder */}
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-zinc-400">Ανέβασμα αρχείου</p>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                Σύντομα
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Στο MVP τα αρχεία δεν ανεβαίνουν σε server. Μπορείς να αποθηκεύσεις την προσφορά ως PDF και να τη στείλεις χειροκίνητα.
            </p>
          </div>
        </div>
      </section>

      {/* Summaries placeholder */}
      <section className="rounded-2xl border-2 border-dashed border-zinc-200 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Περιλήψεις συνομιλιών
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Εμφανίζονται μετά από κλήση ή υπαγόρευση.
        </p>
      </section>

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
