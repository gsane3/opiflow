'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { norm } from '@/lib/search';
import type { Customer } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'recent' | 'customers' | 'sms';

const TABS: { id: Tab; label: string }[] = [
  { id: 'recent', label: 'Πρόσφατες' },
  { id: 'customers', label: 'Πελάτες' },
  { id: 'sms', label: 'SMS' },
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
// Call detail modal
// ---------------------------------------------------------------------------

function CallDetailModal({
  call,
  onClose,
}: {
  call: BackendCall;
  onClose: () => void;
}) {
  const displayName =
    call.customer?.name ??
    call.customer?.companyName ??
    (call.phone ? `****${call.phone.slice(-4)}` : null) ??
    'Αγνωστος';
  const isMissed = call.status === 'missed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-zinc-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-semibold text-zinc-900">Λεπτομέρειες κλήσης</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
            aria-label="Κλείσιμο"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Caller info */}
        <div className="mt-4 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50">
            <PhoneIcon className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-snug text-zinc-900">{displayName}</p>
            {call.customer?.companyName && call.customer.companyName !== displayName && (
              <p className="text-xs text-zinc-400">{call.customer.companyName}</p>
            )}
            <p className="mt-0.5 text-xs text-zinc-400">{fmtDate(call.createdAt)}</p>
          </div>
        </div>

        {/* Status chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
            {CALL_DIRECTION_LABEL[call.direction] ?? call.direction}
          </span>
          {isMissed && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              Αναπάντητη
            </span>
          )}
        </div>

        {/* Summary / brief, shown only in modal */}
        {call.summary && (
          <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-3">
            <p className="mb-1.5 text-xs font-medium text-zinc-500">Περίληψη κλήσης</p>
            <p className="text-sm leading-relaxed text-zinc-700">{call.summary}</p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-col gap-2">
          {call.customerId && (
            <Link
              href={`/customers/${call.customerId}`}
              onClick={onClose}
              className="flex items-center justify-center rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Άνοιγμα πελάτη
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Κλείσιμο
          </button>
        </div>
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
          (call.phone ? `****${call.phone.slice(-4)}` : null) ??
          'Αγνωστος';
        const isMissed = call.status === 'missed';
        const isUnknown = !linkedCustomer?.name && !linkedCustomer?.companyName;
        const initial = displayName.charAt(0).toUpperCase();

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
  onNewSms,
}: {
  customers: Customer[];
  onNewSms: (customer: Customer) => void;
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
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onNewSms(c)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 transition hover:bg-indigo-100"
                    title="SMS"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                    </svg>
                  </button>
                  <Link
                    href={`/customers/${c.id}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-zinc-100"
                    title="Άνοιγμα"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SMS Tab, UI-only threads view
// ---------------------------------------------------------------------------

function SmsTab({
  customers,
  onNewSms,
}: {
  customers: Customer[];
  onNewSms: () => void;
}) {
  const withPhone = customers.filter((c) => c.phone && c.phone.trim().length > 0);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-900">Μηνύματα</p>
            <p className="mt-0.5 text-xs text-zinc-400">Νήματα πελατών και πρόχειρα μηνύματα.</p>
          </div>
          <button
            type="button"
            onClick={onNewSms}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
          >
            <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Νέο μήνυμα
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          Τα SMS θα ενεργοποιηθούν όταν συνδεθεί πάροχος μηνυμάτων.
        </p>
      </div>

      {/* Thread list */}
      {withPhone.length === 0 ? (
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm font-medium text-zinc-700">Δεν υπάρχουν νήματα ακόμα.</p>
          <p className="mt-1.5 text-xs text-zinc-400">
            Όταν συνδεθεί πάροχος μηνυμάτων, τα SMS θα εμφανίζονται εδώ.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {withPhone.slice(0, 20).map((c) => {
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
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold leading-snug text-zinc-900">
                      {c.name}
                    </p>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      Προς σύνδεση
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                    Δεν υπάρχει μήνυμα ακόμα.
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New SMS modal, UI-only, copy to clipboard
// ---------------------------------------------------------------------------

function NewSmsModal({
  customers,
  preselectedCustomer,
  onClose,
}: {
  customers: Customer[];
  preselectedCustomer: Customer | null;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(preselectedCustomer?.name ?? '');
  const [selectedCustomerId, setSelectedCustomerId] = useState(preselectedCustomer?.id ?? '');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleCopy() {
    if (!message.trim()) return;
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    });
  }

  const showDropdown = search.trim().length > 0 && !selectedCustomerId;
  const filtered = showDropdown
    ? customers.filter((c) => {
        const q = norm(search.trim());
        return norm(c.name).includes(q) || norm(c.phone ?? '').includes(q);
      })
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-[28px] bg-white shadow-2xl ring-1 ring-zinc-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <p className="text-base font-semibold text-zinc-900">Νέο μήνυμα</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
            aria-label="Κλείσιμο"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-5 pb-5">
          {/* Customer search */}
          <div className="relative space-y-1.5">
            <label className="block text-xs font-medium text-zinc-500">
              Αναζήτηση πελάτη ή κινητού
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedCustomerId('');
                }}
                placeholder="Όνομα ή αριθμός..."
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none"
              />
            </div>
            {showDropdown && filtered.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-2xl border border-zinc-100 bg-white shadow-lg">
                {filtered.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId(c.id);
                        setSearch(c.name);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-800 transition hover:bg-zinc-50"
                    >
                      <span className="flex-1 truncate">{c.name}</span>
                      {c.phone && (
                        <span className="shrink-0 text-xs text-zinc-400">{c.phone}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-500">Μήνυμα</label>
            <textarea
              ref={textareaRef}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Γράψε το μήνυμα εδώ..."
              className="w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Notice */}
          <p className="text-[11px] text-zinc-400">Δεν στάλθηκε μήνυμα από την εφαρμογή.</p>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!message.trim()}
              className={`flex-1 rounded-2xl py-2.5 text-sm font-semibold transition ${
                copied
                  ? 'bg-green-600 text-white'
                  : message.trim()
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
                  : 'cursor-not-allowed bg-zinc-100 text-zinc-400'
              }`}
            >
              {copied ? 'Αντιγράφηκε' : 'Αντιγραφή'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
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
// Numpad panel, centered modal, not bottom sheet
// ---------------------------------------------------------------------------

const DIAL_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

function NumpadPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  if (!open) return null;

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
              Πληκτρολόγησε αριθμό για αναζήτηση ή μελλοντική κλήση.
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
              <span className="text-base font-normal text-zinc-400">Αριθμός ή αναζήτηση</span>
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

        {/* Search hint */}
        {dialNumber && (
          <p className="mb-3 text-center text-xs text-zinc-400">
            Θα χρησιμοποιηθεί για αναζήτηση πελάτη ή κλήση όταν συνδεθεί.
          </p>
        )}

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
  const [newSmsOpen, setNewSmsOpen] = useState(false);
  const [newSmsCustomer, setNewSmsCustomer] = useState<Customer | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [phoneInfo, setPhoneInfo] = useState<BusinessMeResponse | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const loadData = useCallback(async (token: string) => {
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const [commsResp, customersResp, phoneResp] = await Promise.all([
        fetch('/api/communications?channel=call&limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
        fetch('/api/businesses/me', { headers }),
      ]);

      if (!commsResp.ok || !customersResp.ok) {
        setActionError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
        setPhoneLoading(false);
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

      setCalls(rawComms);
      setCustomers(rawCustomers.map(mapCustomer));
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
      setPhoneLoading(false);
      setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
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

  function openNewSms(customer?: Customer) {
    setNewSmsCustomer(customer ?? null);
    setNewSmsOpen(true);
  }

  function closeNewSms() {
    setNewSmsOpen(false);
    setNewSmsCustomer(null);
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

  const latestCall =
    calls.length > 0
      ? [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : null;

  const missedCount = calls.filter((c) => c.status === 'missed').length;

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
        <p className="text-xs font-medium text-zinc-400">Κλήσεις</p>
        <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Οι κλήσεις σου</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Κάθε κλήση οργανώνεται αφού την ελέγξεις.
        </p>
      </div>

      {/* Phone line card */}
      {phoneLoading ? (
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
      ) : null}

      {/* Latest call card */}
      {latestCall ? (
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50">
              <PhoneIcon className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-500">Τελευταία κλήση</p>
                {missedCount > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                    {missedCount} {missedCount === 1 ? 'αναπάντητη' : 'αναπάντητες'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-base font-semibold text-zinc-900">
                {latestCall.customer?.name ??
                  latestCall.customer?.companyName ??
                  (latestCall.phone ? `****${latestCall.phone.slice(-4)}` : 'Αγνωστος')}
              </p>
              <p className="text-xs text-zinc-400">{fmtDate(latestCall.createdAt)}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50">
              <PhoneIcon className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-700">Δεν υπάρχουν κλήσεις ακόμα.</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Όταν συνδεθεί το τηλεφωνικό σύστημα, οι κλήσεις θα εμφανίζονται εδώ.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Segmented tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-zinc-100 p-1">
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

      {/* Tab content */}
      {tab === 'recent' && (
        <RecentTab calls={calls} onSelect={setSelectedCall} />
      )}

      {tab === 'customers' && (
        <CustomersTab customers={customers} onNewSms={(c) => openNewSms(c)} />
      )}

      {tab === 'sms' && (
        <SmsTab customers={customers} onNewSms={() => openNewSms()} />
      )}

      {/* Floating numpad launcher */}
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

      {/* Numpad modal */}
      <NumpadPanel open={numpadOpen} onClose={() => setNumpadOpen(false)} />

      {/* Call detail modal */}
      {selectedCall && (
        <CallDetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}

      {/* New SMS modal */}
      {newSmsOpen && (
        <NewSmsModal
          customers={customers}
          preselectedCustomer={newSmsCustomer}
          onClose={closeNewSms}
        />
      )}

    </div>
  );
}
