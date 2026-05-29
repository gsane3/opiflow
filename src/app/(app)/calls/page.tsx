'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { norm } from '@/lib/search';
import type { Customer } from '@/lib/types';
import BrowserPhone, { type CallEndedEvent } from '@/components/phone/BrowserPhone';
import { findCustomerByPhone, phonesMatch } from '@/lib/phone';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'recent' | 'customers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'recent', label: 'Πρόσφατες' },
  { id: 'customers', label: 'Πελάτες' },
];

const CALL_DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Εισερχόμενη',
  outbound: 'Εξερχόμενη',
};

interface BackendCallCustomer {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
}

interface BackendCall {
  id: string;
  customerId: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  createdAt: string;
  customer: BackendCallCustomer | null;
}

type BusinessMeResponse = {
  ok?: boolean;
  business?: {
    business_phone_number?: string | null;
  };
  phoneAssigned?: boolean;
  error?: string;
};

// SIP browser-token state. sipPassword lives only here; never rendered.
type PhoneTokenState = {
  loading: boolean;
  ready: boolean;
  wssUrl?: string;
  sipUsername?: string;
  sipPassword?: string;
  sipRealm?: string;
  message?: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function mapCustomer(d: Record<string, unknown>): Customer {
  const now = new Date().toISOString();
  return {
    id: d.id as string,
    name:
      (d.name as string | null) ??
      (d.companyName as string | null) ??
      (d.crmNumber as string | null) ??
      'Πελάτης',
    companyName: (d.companyName as string | null) ?? '',
    phone: (d.phone as string | null) ?? '',
    mobilePhone: (d.mobilePhone as string | null) ?? undefined,
    landlinePhone: (d.landlinePhone as string | null) ?? undefined,
    email: (d.email as string | null) ?? '',
    address: (d.address as string | null) ?? '',
    source: (d.source as Customer['source']) ?? 'manual_entry',
    status: (d.status as Customer['status']) ?? 'new_lead',
    preferredContactMethod:
      (d.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: (d.needsSummary as string | null) ?? '',
    notes: (d.notes as string | null) ?? '',
    createdAt: (d.createdAt as string) ?? now,
    updatedAt: (d.updatedAt as string) ?? now,
    crmNumber: (d.crmNumber as string | null) ?? undefined,
  };
}

function extractAiBrief(summary: string | null): string | null {
  if (!summary) return null;
  if (!summary.startsWith('AI brief')) return null;
  const withoutMeta = summary.split('\n\n---')[0];
  const text = withoutMeta.replace(/^AI brief [^:\n]+:\s*/, '').trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-5 w-5'}
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Call action sheet (iPhone-style bottom sheet)
// ---------------------------------------------------------------------------

function CallActionSheet({
  call,
  calls,
  customers,
  getAuthToken,
  onClose,
  onDeleted,
  onContactAdded,
  onCallLinked,
}: {
  call: BackendCall;
  calls: BackendCall[];
  customers: Customer[];
  getAuthToken: () => string | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onContactAdded: (customer: Customer) => void;
  onCallLinked: (callId: string, customer: Customer) => void;
}) {
  // 'actions' shows the main list; 'add_contact' shows the mini form; 'bulk_confirm' shows the bulk link prompt; 'create_task' shows the task form.
  const [view, setView] = useState<'actions' | 'add_contact' | 'bulk_confirm' | 'create_task'>('actions');
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // Bulk link state: candidates and customer set after a successful single link.
  const [pendingBulkCalls, setPendingBulkCalls] = useState<BackendCall[]>([]);
  const [bulkCustomer, setBulkCustomer] = useState<Customer | null>(null);
  const [bulkResult, setBulkResult] = useState<{ linked: number; failed: number } | null>(null);
  // Form fields for the add-contact view.
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // Form fields for the create-task view.
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState('call_back');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [taskError, setTaskError] = useState<string | null>(null);

  // Customer found by normalized phone match in the loaded customer list.
  // Checks customer.phone, customer.mobilePhone, and customer.landlinePhone.
  const phoneMatchCustomer =
    call.phone
      ? findCustomerByPhone(customers, call.phone) ?? null
      : null;

  const directionLabel = CALL_DIRECTION_LABEL[call.direction] ?? call.direction;
  const contextLine =
    call.status === 'failed'
      ? `Αποτυχημένη ${directionLabel.toLowerCase()}`
      : call.status === 'missed'
      ? 'Αναπάντητη'
      : directionLabel;
  const actionSheetBrief = extractAiBrief(call.summary);

  async function handleDelete() {
    const token = getAuthToken();
    if (!token) return;
    setBusy(true);
    setSheetError(null);
    try {
      const resp = await fetch(`/api/communications?id=${encodeURIComponent(call.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await resp.json();
      if (json.ok) {
        onDeleted(call.id);
        onClose();
      } else {
        setSheetError('Αδύνατη η διαγραφή. Δοκίμασε ξανά.');
      }
    } catch {
      setSheetError('Αδύνατη η διαγραφή. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLinkToExisting(customer: Customer) {
    const token = getAuthToken();
    if (!token) return;
    setBusy(true);
    setSheetError(null);
    try {
      const resp = await fetch(
        `/api/communications?id=${encodeURIComponent(call.id)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ customerId: customer.id }),
        }
      );
      const json = await resp.json();
      if (json.ok) {
        onCallLinked(call.id, customer);
        // Find other loaded unlinked calls from the same normalized phone number.
        const candidates = calls.filter(
          (c) =>
            c.id !== call.id &&
            c.customerId === null &&
            c.phone !== null &&
            call.phone !== null &&
            phonesMatch(c.phone, call.phone)
        );
        if (candidates.length > 0) {
          setPendingBulkCalls(candidates);
          setBulkCustomer(customer);
          setBulkResult(null);
          setView('bulk_confirm');
        } else {
          onClose();
        }
      } else {
        setSheetError('Αδύνατη η σύνδεση. Δοκίμασε ξανά.');
      }
    } catch {
      setSheetError('Αδύνατη η σύνδεση. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkLink() {
    const token = getAuthToken();
    const customer = bulkCustomer;
    if (!token || !customer) {
      setSheetError('Αδύνατη η σύνδεση. Δοκίμασε ξανά.');
      return;
    }
    setBusy(true);
    setSheetError(null);
    let linked = 0;
    let failed = 0;
    for (const c of pendingBulkCalls) {
      try {
        const resp = await fetch(
          `/api/communications?id=${encodeURIComponent(c.id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ customerId: customer.id }),
          }
        );
        const json = await resp.json();
        if (json.ok) {
          onCallLinked(c.id, customer);
          linked++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (failed === 0) {
      onClose();
    } else {
      setBulkResult({ linked, failed });
    }
  }

  function openTaskForm() {
    const today = new Date().toLocaleDateString('sv');
    setTaskError(null);
    setTaskDueDate(today);
    setTaskNote('');
    if (call.direction === 'inbound' && (call.status === 'missed' || call.status === 'failed')) {
      setTaskTitle('Κλήση πίσω');
      setTaskType('call_back');
    } else if (call.direction === 'inbound' && call.status === 'completed') {
      setTaskTitle('Follow-up εισερχόμενης κλήσης');
      setTaskType('other');
    } else {
      setTaskTitle('Follow-up κλήσης');
      setTaskType('other');
    }
    setView('create_task');
  }

  async function handleCreateTask() {
    const title = taskTitle.trim();
    if (!title) {
      setTaskError('Συμπλήρωσε τίτλο.');
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setBusy(true);
    setTaskError(null);
    try {
      const taskBody: Record<string, unknown> = {
        title,
        type: taskType,
        dueDate: taskDueDate,
      };
      if (call.customerId) taskBody.customerId = call.customerId;
      const note = taskNote.trim();
      if (note) taskBody.note = note;
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(taskBody),
      });
      const json = await resp.json();
      if (json.ok) {
        onClose();
      } else {
        setTaskError('Αδύνατη η αποθήκευση. Δοκίμασε ξανά.');
      }
    } catch {
      setTaskError('Αδύνατη η αποθήκευση. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveContact() {
    const name = contactName.trim();
    const company = contactCompany.trim();
    const email = contactEmail.trim();
    if (!name && !company) {
      setFormError('Συμπλήρωσε όνομα ή εταιρεία.');
      return;
    }
    // Guard: if a normalized phone match already exists, do not create a duplicate.
    if (call.phone && findCustomerByPhone(customers, call.phone)) {
      setFormError('Βρέθηκε ήδη επαφή με αυτόν τον αριθμό. Χρησιμοποίησε τη σύνδεση υπάρχουσας επαφής.');
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setBusy(true);
    setFormError(null);
    try {
      // Step 1: create customer.
      const customerBody: Record<string, unknown> = {
        name: name || company || 'Νέα επαφή',
        phone: call.phone,
      };
      if (company) customerBody.companyName = company;
      if (email) customerBody.email = email;
      const customerResp = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(customerBody),
      });
      const customerJson = await customerResp.json();
      if (!customerJson.ok || !customerJson.customer) {
        setFormError('Αδύνατη η προσθήκη επαφής. Δοκίμασε ξανά.');
        return;
      }

      const newCustomer = mapCustomer(customerJson.customer as Record<string, unknown>);

      // Step 2: link the communication row to the new customer (best-effort).
      let linked = false;
      try {
        const patchResp = await fetch(
          `/api/communications?id=${encodeURIComponent(call.id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ customerId: newCustomer.id }),
          }
        );
        const patchJson = await patchResp.json();
        linked = patchJson.ok === true;
      } catch {
        // Network error on PATCH; customer was still created.
      }

      if (linked) {
        onCallLinked(call.id, newCustomer);
        onContactAdded(newCustomer);
        onClose();
      } else {
        // Customer created but link failed. Keep the customer in state,
        // show a non-blocking message and leave the sheet open.
        onContactAdded(newCustomer);
        setFormError('Η επαφή δημιουργήθηκε, αλλά δεν συνδέθηκε με την κλήση.');
      }
    } catch {
      setFormError('Αδύνατη η προσθήκη επαφής. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-[28px] bg-white pb-8 shadow-2xl ring-1 ring-zinc-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-zinc-300" />
        </div>

        {view === 'actions' ? (
          <>
            {/* Header info */}
            <div className="px-5 pb-4 pt-1 text-center">
              {call.phone ? (
                <p className="text-xl font-bold tracking-wide text-zinc-900">{call.phone}</p>
              ) : (
                <p className="text-xl font-bold text-zinc-400">Αγνωστος αριθμός</p>
              )}
              <p className="mt-1 text-xs text-zinc-400">
                {contextLine}
                {' · '}
                {fmtDate(call.createdAt)}
              </p>
              {call.customer?.name && (
                <p className="mt-0.5 text-xs font-medium text-indigo-600">{call.customer.name}</p>
              )}
              {sheetError && (
                <p className="mt-2 text-xs text-red-500">{sheetError}</p>
              )}
            </div>

            {actionSheetBrief && (
              <div className="mx-5 mb-3 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-100">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  Περίληψη κλήσης
                </p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600">{actionSheetBrief}</p>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2.5 px-4">
              {/* Delete call - destructive */}
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="w-full rounded-2xl bg-red-50 py-3.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 active:bg-red-200 disabled:opacity-50"
              >
                Διαγραφή κλήσης
              </button>

              {/* Contact action: view linked, link existing match, open form, or no phone */}
              {call.customerId ? (
                <Link
                  href={`/customers/${call.customerId}`}
                  onClick={onClose}
                  className="flex w-full items-center justify-center rounded-2xl bg-zinc-50 py-3.5 text-sm font-medium text-indigo-600 ring-1 ring-zinc-200 transition hover:bg-indigo-50"
                >
                  Προβολή επαφής
                </Link>
              ) : phoneMatchCustomer ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleLinkToExisting(phoneMatchCustomer)}
                    disabled={busy}
                    className="w-full rounded-2xl bg-indigo-50 py-3.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-100 active:bg-indigo-200 disabled:opacity-50"
                  >
                    Σύνδεση με υπάρχουσα επαφή
                  </button>
                  <p className="px-1 text-center text-xs text-zinc-400">
                    {phoneMatchCustomer.name}
                  </p>
                </div>
              ) : call.phone ? (
                <button
                  type="button"
                  onClick={() => { setSheetError(null); setView('add_contact'); }}
                  disabled={busy}
                  className="w-full rounded-2xl bg-indigo-50 py-3.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-100 active:bg-indigo-200 disabled:opacity-50"
                >
                  Προσθήκη επαφής
                </button>
              ) : (
                <div className="w-full rounded-2xl bg-zinc-50 py-3.5 text-center text-sm font-medium text-zinc-400 ring-1 ring-zinc-200">
                  Προσθήκη επαφής
                </div>
              )}

              {/* Create task */}
              <button
                type="button"
                onClick={openTaskForm}
                disabled={busy}
                className="w-full rounded-2xl bg-zinc-50 py-3.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50"
              >
                Δημιουργία task
              </button>

              {/* Cancel */}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300"
              >
                Ακύρωση
              </button>
            </div>
          </>
        ) : view === 'add_contact' ? (
          <>
            {/* Add contact form */}
            <div className="px-5 pb-3 pt-1 text-center">
              <p className="text-base font-semibold text-zinc-900">Νέα επαφή</p>
              {call.phone && (
                <p className="mt-0.5 text-sm text-zinc-500">{call.phone}</p>
              )}
            </div>

            <div className="space-y-3 px-4 pb-2">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Όνομα
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => { setContactName(e.target.value); setFormError(null); }}
                  placeholder="Γιώργης Παπαδόπουλος"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {/* Company */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Εταιρεία
                </label>
                <input
                  type="text"
                  value={contactCompany}
                  onChange={(e) => { setContactCompany(e.target.value); setFormError(null); }}
                  placeholder="Προαιρετικό"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {/* Email */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => { setContactEmail(e.target.value); setFormError(null); }}
                  placeholder="Προαιρετικό"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {formError && (
                <p className="text-xs text-red-500">{formError}</p>
              )}
            </div>

            <div className="space-y-2.5 px-4 pt-1">
              {/* Save */}
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={busy}
                className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
              >
                Αποθήκευση επαφής
              </button>

              {/* Back */}
              <button
                type="button"
                onClick={() => { setFormError(null); setView('actions'); }}
                disabled={busy}
                className="w-full rounded-2xl bg-zinc-50 py-3.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                Πίσω
              </button>

              {/* Cancel */}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300"
              >
                Ακύρωση
              </button>
            </div>
          </>
        ) : view === 'bulk_confirm' ? (
          <>
            {/* Bulk link confirmation */}
            <div className="px-5 pb-4 pt-1 text-center">
              <p className="text-base font-semibold text-zinc-900">
                Βρέθηκαν {pendingBulkCalls.length} παλιότερες κλήσεις από τον ίδιο αριθμό. Να συνδεθούν με την ίδια επαφή;
              </p>
              {bulkCustomer?.name && (
                <p className="mt-1 text-sm font-medium text-indigo-600">{bulkCustomer.name}</p>
              )}
              {bulkResult && bulkResult.failed > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  {bulkResult.linked} συνδέθηκαν, {bulkResult.failed} απέτυχαν. Μπορείς να δοκιμάσεις ξανά αργότερα.
                </p>
              )}
              {sheetError && (
                <p className="mt-2 text-xs text-red-500">{sheetError}</p>
              )}
            </div>
            <div className="space-y-2.5 px-4">
              {bulkResult && bulkResult.failed > 0 ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300"
                >
                  Κλείσιμο
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleBulkLink}
                    disabled={busy}
                    className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
                  >
                    Ναι, σύνδεση όλων
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-50"
                  >
                    Παράλειψη
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Create task form */}
            <div className="px-5 pb-3 pt-1 text-center">
              <p className="text-base font-semibold text-zinc-900">Δημιουργία task</p>
              {call.customerId && call.customer?.name && (
                <p className="mt-0.5 text-xs text-zinc-500">
                  Θα συνδεθεί με {call.customer.name}
                </p>
              )}
            </div>

            <div className="space-y-3 px-4 pb-2">
              {/* Title */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Τίτλος
                </label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => { setTaskTitle(e.target.value); setTaskError(null); }}
                  placeholder="Κλήση πίσω"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {/* Type */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Τύπος
                </label>
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="call_back">Κλήση πίσω</option>
                  <option value="send_offer">Αποστολή προσφοράς</option>
                  <option value="follow_up_offer">Follow-up προσφοράς</option>
                  <option value="ask_for_photos_documents">Αίτηση φωτογραφιών</option>
                  <option value="book_appointment">Κλείσιμο ραντεβού</option>
                  <option value="visit_customer">Επίσκεψη πελάτη</option>
                  <option value="wait_for_reply">Αναμονή απάντησης</option>
                  <option value="other">Άλλο</option>
                </select>
              </div>

              {/* Due date */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Ημερομηνία
                </label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {/* Note */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Σημείωση
                </label>
                <textarea
                  rows={2}
                  value={taskNote}
                  onChange={(e) => setTaskNote(e.target.value)}
                  placeholder="Προαιρετικό"
                  className="w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {taskError && (
                <p className="text-xs text-red-500">{taskError}</p>
              )}
            </div>

            <div className="space-y-2.5 px-4 pt-1">
              {/* Save */}
              <button
                type="button"
                onClick={handleCreateTask}
                disabled={busy}
                className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
              >
                Αποθήκευση task
              </button>

              {/* Back */}
              <button
                type="button"
                onClick={() => { setTaskError(null); setView('actions'); }}
                disabled={busy}
                className="w-full rounded-2xl bg-zinc-50 py-3.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                Πίσω
              </button>

              {/* Cancel */}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300"
              >
                Ακύρωση
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Tab, clean iPhone-style call cards
// ---------------------------------------------------------------------------

function RecentTab({
  calls,
  onSelect,
}: {
  calls: BackendCall[];
  onSelect: (call: BackendCall) => void;
}) {
  const sorted = [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);

  if (sorted.length === 0) {
    return (
      <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
          <PhoneIcon className="h-6 w-6 text-indigo-400" />
        </div>
        <p className="text-sm font-medium text-zinc-700">Δεν υπάρχουν κλήσεις ακόμα.</p>
        <p className="mt-1.5 text-sm text-zinc-400">
          Όταν συνδεθεί το τηλεφωνικό σύστημα, οι κλήσεις θα εμφανίζονται εδώ.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sorted.map((call) => {
        const linkedCustomer = call.customer;
        const displayName =
          linkedCustomer?.name ??
          linkedCustomer?.companyName ??
          call.phone ??
          'Αγνωστος';
        const isMissed = call.status === 'missed';
        const isUnknown = !linkedCustomer?.name && !linkedCustomer?.companyName;
        const initial = displayName.charAt(0).toUpperCase();
        const aiBrief = extractAiBrief(call.summary);

        return (
          <li key={call.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(call)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(call);
              }}
              className="flex w-full cursor-pointer items-start gap-3 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:bg-zinc-50/60 active:bg-zinc-100/60"
            >
              {/* Avatar */}
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">
                {isUnknown ? (
                  <PhoneIcon className="h-4 w-4 text-indigo-500" />
                ) : (
                  initial
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[15px] font-semibold leading-snug text-zinc-900">
                    {displayName}
                  </p>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-zinc-400">
                    {fmtDate(call.createdAt)}
                  </span>
                </div>

                {linkedCustomer?.companyName && linkedCustomer.companyName !== displayName && (
                  <p className="truncate text-xs text-zinc-400">{linkedCustomer.companyName}</p>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-400">
                    {CALL_DIRECTION_LABEL[call.direction] ?? call.direction}
                  </span>
                  {isMissed && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                      Αναπάντητη
                    </span>
                  )}
                </div>

                {aiBrief && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-400">
                    {aiBrief}
                  </p>
                )}

                {/* Discreet signal + customer link */}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {linkedCustomer && (
                    <span className="text-[10px] text-zinc-300">Έχει συνδεδεμένο πελάτη</span>
                  )}
                  {call.customerId && (
                    <Link
                      href={`/customers/${call.customerId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[10px] font-medium text-indigo-600 transition hover:bg-indigo-100"
                    >
                      Άνοιγμα πελάτη
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Customers Tab
// ---------------------------------------------------------------------------

function CustomersTab({
  customers,
}: {
  customers: Customer[];
}) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? customers.filter((c) => {
        const q = norm(search.trim());
        return (
          norm(c.name).includes(q) ||
          norm(c.companyName ?? '').includes(q) ||
          norm(c.phone ?? '').includes(q) ||
          norm(c.email ?? '').includes(q)
        );
      })
    : customers;

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="flex items-center gap-3 rounded-[28px] bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200/60">
        <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Αναζήτηση ονόματος, τηλεφώνου, email..."
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[28px] bg-white px-5 py-8 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-500">
            {search.trim() ? 'Δεν βρέθηκαν αποτελέσματα.' : 'Δεν υπάρχουν πελάτες ακόμα.'}
          </p>
          {!search.trim() && (
            <Link
              href="/customers"
              className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Πήγαινε στους Πελάτες
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.slice(0, 20).map((c) => {
            const initial = c.name.charAt(0).toUpperCase();
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-zinc-900">{c.name}</p>
                  <p className="truncate text-xs text-zinc-400">
                    {[c.companyName, c.phone].filter(Boolean).join(' · ') || 'Χωρίς στοιχεία'}
                  </p>
                </div>
                <Link
                  href={`/customers/${c.id}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-zinc-100"
                  title="Άνοιγμα"
                >
                  <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numpad panel, centered modal, not bottom sheet
// ---------------------------------------------------------------------------

const DIAL_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

function NumpadPanel({
  open,
  onClose,
  onDial,
  inline,
}: {
  open: boolean;
  onClose: () => void;
  onDial: (number: string) => void;
  inline?: boolean;
}) {
  const [dialNumber, setDialNumber] = useState('');

  function closePanel() {
    setDialNumber('');
    onClose();
  }

  function press(key: string) {
    setDialNumber((n) => (n.length < 20 ? n + key : n));
  }

  function backspace() {
    setDialNumber((n) => n.slice(0, -1));
  }

  function handleDial() {
    const n = dialNumber.trim();
    if (!n) return;
    onDial(n);
    closePanel();
  }

  if (!open) return null;

  if (inline) {
    return (
      <div className="rounded-[28px] bg-white px-5 pb-6 pt-5 shadow-sm ring-1 ring-zinc-200/60">
        <div className="mb-4">
          <p className="text-base font-bold text-zinc-900">Πληκτρολόγιο</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Πληκτρολόγησε αριθμό και πάτησε Κλήση.
          </p>
        </div>
        {/* Number display */}
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
          <span className="min-h-[2rem] flex-1 text-center text-2xl font-light tracking-widest text-zinc-900">
            {dialNumber || (
              <span className="text-base font-normal text-zinc-400">Αριθμός</span>
            )}
          </span>
          {dialNumber && (
            <button
              type="button"
              onClick={backspace}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200"
              aria-label="Διαγραφή"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z" />
              </svg>
            </button>
          )}
        </div>
        {/* Key grid */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          {DIAL_KEYS.flat().map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="flex h-14 items-center justify-center rounded-2xl bg-zinc-50 text-xl font-medium text-zinc-800 ring-1 ring-zinc-200 transition hover:bg-zinc-100 active:bg-zinc-200"
            >
              {key}
            </button>
          ))}
        </div>
        {/* Actions */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleDial}
            disabled={!dialNumber.trim()}
            className="w-full rounded-[28px] bg-green-600 py-3.5 text-sm font-semibold text-white transition hover:bg-green-700 active:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Κλήση
          </button>
          {dialNumber && (
            <button
              type="button"
              onClick={() => setDialNumber('')}
              className="w-full rounded-[28px] border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Καθαρισμός
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={closePanel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-[28px] bg-white px-5 pb-6 pt-5 shadow-2xl ring-1 ring-zinc-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-900">Πληκτρολόγιο</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Πληκτρολόγησε αριθμό και πάτησε Κλήση.
            </p>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
            aria-label="Κλείσιμο"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Number display */}
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
          <span className="min-h-[2rem] flex-1 text-center text-2xl font-light tracking-widest text-zinc-900">
            {dialNumber || (
              <span className="text-base font-normal text-zinc-400">Αριθμός</span>
            )}
          </span>
          {dialNumber && (
            <button
              type="button"
              onClick={backspace}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200"
              aria-label="Διαγραφή"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z" />
              </svg>
            </button>
          )}
        </div>

        {/* Key grid */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          {DIAL_KEYS.flat().map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="flex h-14 items-center justify-center rounded-2xl bg-zinc-50 text-xl font-medium text-zinc-800 ring-1 ring-zinc-200 transition hover:bg-zinc-100 active:bg-zinc-200"
            >
              {key}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleDial}
            disabled={!dialNumber.trim()}
            className="w-full rounded-[28px] bg-green-600 py-3.5 text-sm font-semibold text-white transition hover:bg-green-700 active:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Κλήση
          </button>
          <div className="flex gap-2">
            {dialNumber && (
              <button
                type="button"
                onClick={() => setDialNumber('')}
                className="flex-1 rounded-[28px] border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Καθαρισμός
              </button>
            )}
            <button
              type="button"
              onClick={closePanel}
              className="flex-1 rounded-[28px] bg-zinc-100 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200"
            >
              Κλείσιμο
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// After-call review modal
// ---------------------------------------------------------------------------

function CallReviewModal({
  event,
  busy,
  error,
  onSave,
  onSkip,
}: {
  event: CallEndedEvent;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onSkip: () => void;
}) {
  const dirLabel = CALL_DIRECTION_LABEL[event.direction] ?? event.direction;
  const statusLabel = event.status === 'completed' ? 'Ολοκληρώθηκε' : 'Αποτυχημένη';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30"
      onClick={onSkip}
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-[28px] bg-white pb-8 shadow-2xl ring-1 ring-zinc-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-zinc-300" />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 pt-1 text-center">
          <p className="text-base font-semibold text-zinc-900">Η κλήση ολοκληρώθηκε.</p>
          <p className="mt-1 text-sm text-zinc-500">Να εισαχθεί στο CRM;</p>
          <p className="mt-2 text-xs text-zinc-400">
            {dirLabel}
            {' · '}
            {statusLabel}
            {event.phone ? ` · ${event.phone}` : ''}
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-500">
              Αδύνατη η αποθήκευση. Δοκίμασε ξανά.
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="space-y-2.5 px-4">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
          >
            Ναι, εισαγωγή
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-50"
          >
            Όχι
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CallsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('recent');
  const [calls, setCalls] = useState<BackendCall[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [selectedCall, setSelectedCall] = useState<BackendCall | null>(null);

  const tokenRef = useRef<string | null>(null);
  const [phoneInfo, setPhoneInfo] = useState<BusinessMeResponse | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [micState, setMicState] = useState<'unknown' | 'checking' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [micError, setMicError] = useState<string | null>(null);
  const [phoneToken, setPhoneToken] = useState<PhoneTokenState>({ loading: true, ready: false });
  const [pendingCallReview, setPendingCallReview] = useState<CallEndedEvent | null>(null);
  const [callReviewBusy, setCallReviewBusy] = useState(false);
  const [callReviewError, setCallReviewError] = useState<string | null>(null);
  const [pendingDialTarget, setPendingDialTarget] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const loadData = useCallback(async (token: string) => {
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const [commsResp, customersResp, phoneResp, tokenResp] = await Promise.all([
        fetch('/api/communications?channel=call&limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
        fetch('/api/businesses/me', { headers }),
        fetch('/api/phone/browser-token', { headers }),
      ]);

      if (!commsResp.ok || !customersResp.ok) {
        setActionError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
        setPhoneLoading(false);
        setPhoneToken({ loading: false, ready: false, error: 'phone_token_unavailable' });
        setHydrated(true);
        return;
      }

      const [commsData, customersData] = await Promise.all([
        commsResp.json(),
        customersResp.json(),
      ]);

      const rawComms: BackendCall[] = Array.isArray(commsData)
        ? commsData
        : (commsData.communications ?? []);

      const rawCustomers: Record<string, unknown>[] = Array.isArray(customersData)
        ? customersData
        : (customersData.customers ?? []);

      // Phone line status, independent of calls/customers
      if (phoneResp.ok) {
        try {
          const phoneData: BusinessMeResponse = await phoneResp.json();
          setPhoneInfo(phoneData);
        } catch {
          setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
        }
      } else {
        setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
      }
      setPhoneLoading(false);

      // SIP browser token. Credentials stored in React state only; never rendered.
      try {
        if (tokenResp.ok) {
          const tokenData = await tokenResp.json();
          if (tokenData?.ready === true) {
            setPhoneToken({
              loading: false,
              ready: true,
              wssUrl: tokenData.wssUrl ?? undefined,
              sipUsername: tokenData.sipUsername ?? undefined,
              sipPassword: tokenData.sipPassword ?? undefined,
              sipRealm: tokenData.sipRealm ?? undefined,
            });
          } else {
            setPhoneToken({
              loading: false,
              ready: false,
              message: tokenData?.message ?? undefined,
            });
          }
        } else {
          setPhoneToken({ loading: false, ready: false, error: 'phone_token_unavailable' });
        }
      } catch {
        setPhoneToken({ loading: false, ready: false, error: 'phone_token_parse_failed' });
      }

      setCalls(rawComms);
      setCustomers(rawCustomers.map(mapCustomer));
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
      setPhoneLoading(false);
      setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
      setPhoneToken({ loading: false, ready: false, error: 'phone_token_unavailable' });
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
          setAuthRequired(true);
          setPhoneLoading(false);
          setPhoneToken({ loading: false, ready: false });
          setHydrated(true);
          return;
        }
        tokenRef.current = session.access_token;
        await loadData(session.access_token);
      } catch {
        setActionError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  function handleCallDeleted(id: string) {
    setCalls((prev) => prev.filter((c) => c.id !== id));
  }

  function handleContactAdded(newCustomer: Customer) {
    setCustomers((prev) => [newCustomer, ...prev]);
  }

  function handleCallLinkedToCustomer(callId: string, customer: Customer) {
    const callCustomer: BackendCallCustomer = {
      id: customer.id,
      crmNumber: customer.crmNumber ?? null,
      name: customer.name,
      companyName: customer.companyName || null,
      phone: customer.phone || null,
      source: customer.source,
      status: customer.status,
    };
    setCalls((prev) =>
      prev.map((c) =>
        c.id === callId
          ? { ...c, customerId: customer.id, customer: callCustomer }
          : c
      )
    );
  }

  // Saves the browser call to /api/communications after the user confirms.
  // Uses the same payload as the previous automatic save.
  async function saveReviewedCall(event: CallEndedEvent) {
    const token = tokenRef.current;
    if (!token) return;

    const customer =
      event.phone
        ? findCustomerByPhone(customers, event.phone) ?? null
        : null;
    const customerId = customer?.id ?? null;

    const summary =
      event.direction === 'inbound'
        ? event.status === 'completed'
          ? 'Εισερχόμενη κλήση'
          : 'Αποτυχημένη εισερχόμενη κλήση'
        : event.status === 'completed'
        ? 'Εξερχόμενη κλήση'
        : 'Αποτυχημένη εξερχόμενη κλήση';

    setCallReviewBusy(true);
    setCallReviewError(null);
    try {
      const resp = await fetch('/api/communications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel: 'call',
          direction: event.direction,
          status: event.status,
          phone: event.phone,
          customerId,
          summary,
        }),
      });
      const json = await resp.json();
      if (json.ok === true) {
        setPendingCallReview(null);
        setCallReviewError(null);
      } else {
        setCallReviewError('save_failed');
      }
    } catch {
      setCallReviewError('save_failed');
    } finally {
      setCallReviewBusy(false);
    }
  }

  async function handleSaveReviewedCall() {
    if (!pendingCallReview) return;
    await saveReviewedCall(pendingCallReview);
  }

  function handleSkipReviewedCall() {
    setPendingCallReview(null);
    setCallReviewError(null);
  }

  // Shows the after-call review modal instead of immediately saving.
  const handleCallEnded = useCallback(
    (event: CallEndedEvent) => {
      setCallReviewError(null);
      setPendingCallReview(event);
    },
    []
  );

  async function checkMicrophonePermission() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setMicState('unsupported');
      return;
    }
    setMicState('checking');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicState('granted');
    } catch {
      setMicState('denied');
      setMicError('Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την από τον browser για να μπορείς να απαντάς κλήσεις μέσα από το app.');
    }
  }

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-3xl md:px-8">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Φόρτωση...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-3xl md:px-8">

      {/* Error banner */}
      {actionError && (
        <div className="rounded-[28px] bg-red-50 px-5 py-3.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Auth required notice */}
      {authRequired && (
        <div className="rounded-[28px] bg-amber-50 px-5 py-4 ring-1 ring-amber-200">
          <p className="text-sm text-amber-700">
            Συνδέσου για να φορτωθούν οι κλήσεις και οι πελάτες.
          </p>
          <Link
            href="/login/backend"
            className="mt-2 inline-block rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Κλήσεις</h1>
      </div>

      {/* Phone line card - hidden when browser phone is ready */}
      {!phoneToken.ready && (phoneLoading ? (
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Έλεγχος γραμμής...</p>
        </div>
      ) : phoneError ? (
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-red-600">{phoneError}</p>
        </div>
      ) : phoneInfo ? (
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50">
              <PhoneIcon className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-500">Ο αριθμός σου</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  phoneInfo.phoneAssigned
                    ? 'bg-green-50 text-green-700 ring-green-200'
                    : 'bg-amber-50 text-amber-700 ring-amber-200'
                }`}>
                  {phoneInfo.phoneAssigned ? 'Ενεργός' : 'Σε αναμονή'}
                </span>
              </div>
              {phoneInfo.business?.business_phone_number ? (
                <>
                  <p className="mt-0.5 text-base font-semibold text-zinc-900">
                    {phoneInfo.business.business_phone_number}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Οι εισερχόμενες κλήσεις θα εμφανίζονται εδώ όταν καταγραφούν από το τηλεφωνικό σύστημα.
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-zinc-400">
                  Ο αριθμός σου ετοιμάζεται. Δεν χρειάζεται να ρυθμίσεις κάτι.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null)}

      {/* Browser phone */}
      <div>
        {phoneToken.loading ? (
          <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-sm text-zinc-400">Φόρτωση...</p>
          </div>
        ) : (
          <BrowserPhone
            ready={phoneToken.ready}
            wssUrl={phoneToken.wssUrl}
            sipUsername={phoneToken.sipUsername}
            sipPassword={phoneToken.sipPassword}
            sipRealm={phoneToken.sipRealm}
            disabledReason={phoneToken.ready ? undefined : 'Το browser τηλέφωνο δεν είναι έτοιμο ακόμα.'}
            onCallEnded={handleCallEnded}
            pendingDialTarget={pendingDialTarget}
            onDialConsumed={() => setPendingDialTarget(null)}
            externalDialer
          />
        )}
      </div>

      {/* Inline numpad - visible immediately when browser phone token is ready */}
      {!phoneToken.loading && phoneToken.ready && (
        <NumpadPanel
          inline
          open
          onClose={() => {}}
          onDial={(number) => setPendingDialTarget(number)}
        />
      )}

      {/* Microphone check - shown below dialer when mic permission is needed */}
      {micState !== 'granted' && (
      <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            micState === 'denied' ? 'bg-amber-50' : micState === 'unsupported' ? 'bg-zinc-100' : 'bg-indigo-50'
          }`}>
            <svg
              className={`h-5 w-5 ${
                micState === 'denied' ? 'text-amber-500' : micState === 'unsupported' ? 'text-zinc-400' : 'text-indigo-500'
              }`}
              fill="none"
              strokeWidth={1.5}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-zinc-500">Μικρόφωνο</p>
              {micState === 'denied' && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                  Χρειάζεται άδεια
                </span>
              )}
              {micState === 'unsupported' && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 ring-1 ring-zinc-200">
                  Δεν υποστηρίζεται
                </span>
              )}
            </div>
            {micState === 'unknown' && (
              <>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Χρειάζεται άδεια μικροφώνου για κλήσεις μέσα από την εφαρμογή.
                </p>
                <button
                  type="button"
                  onClick={checkMicrophonePermission}
                  className="mt-2 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Έλεγχος μικροφώνου
                </button>
              </>
            )}
            {micState === 'checking' && (
              <button
                type="button"
                disabled
                className="mt-2 rounded-full bg-indigo-300 px-3 py-1.5 text-xs font-semibold text-white cursor-not-allowed"
              >
                Έλεγχος...
              </button>
            )}
            {micState === 'denied' && (
              <>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {micError ?? 'Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την από τον browser.'}
                </p>
                <button
                  type="button"
                  onClick={checkMicrophonePermission}
                  className="mt-2 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Δοκιμή ξανά
                </button>
              </>
            )}
            {micState === 'unsupported' && (
              <p className="mt-0.5 text-xs text-zinc-400">
                Ο browser δεν υποστηρίζει έλεγχο μικροφώνου εδώ. Δοκίμασε από Chrome ή Edge.
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* History toggle */}
      <button
        type="button"
        onClick={() => setDetailsOpen((o) => !o)}
        className="w-full rounded-[28px] border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
      >
        {detailsOpen ? 'Απόκρυψη ιστορικού' : 'Ιστορικό και πελάτες'}
      </button>

      {/* CRM tabs - shown when detailsOpen */}
      {detailsOpen && (
      <>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-xl py-2 text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recent' && (
        <RecentTab calls={calls} onSelect={setSelectedCall} />
      )}

      {tab === 'customers' && (
        <CustomersTab customers={customers} />
      )}

</>
      )}

      {/* Floating numpad launcher - hidden when inline numpad is active */}
      {(phoneToken.loading || !phoneToken.ready) && (
      <button
        type="button"
        onClick={() => setNumpadOpen(true)}
        className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-500/20 transition hover:bg-indigo-700 active:bg-indigo-800 md:bottom-8 md:right-8"
        aria-label="Άνοιγμα πληκτρολογίου"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="4" r="1.75" />
          <circle cx="10" cy="4" r="1.75" />
          <circle cx="16" cy="4" r="1.75" />
          <circle cx="4" cy="10" r="1.75" />
          <circle cx="10" cy="10" r="1.75" />
          <circle cx="16" cy="10" r="1.75" />
          <circle cx="4" cy="16" r="1.75" />
          <circle cx="10" cy="16" r="1.75" />
          <circle cx="16" cy="16" r="1.75" />
        </svg>
      </button>
      )}

      {/* Numpad modal */}
      <NumpadPanel
        open={numpadOpen}
        onClose={() => setNumpadOpen(false)}
        onDial={(number) => setPendingDialTarget(number)}
      />

      {/* Call action sheet */}
      {selectedCall && (
        <CallActionSheet
          call={selectedCall}
          calls={calls}
          customers={customers}
          getAuthToken={() => tokenRef.current}
          onClose={() => setSelectedCall(null)}
          onDeleted={handleCallDeleted}
          onContactAdded={handleContactAdded}
          onCallLinked={handleCallLinkedToCustomer}
        />
      )}

      {/* After-call review modal */}
      {pendingCallReview && (
        <CallReviewModal
          event={pendingCallReview}
          busy={callReviewBusy}
          error={callReviewError}
          onSave={handleSaveReviewedCall}
          onSkip={handleSkipReviewedCall}
        />
      )}

    </div>
  );
}
