'use client';

import { useState, useMemo, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Card, EmptyState } from '@/components/ui';
import type { Customer, CustomerStatus, CustomerSource } from '@/lib/types';
import { norm } from '@/lib/search';
import { STATUS_LABELS } from '@/components/customers/CustomerStatusBadge';

// API response type
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
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALID_SOURCES: readonly CustomerSource[] = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
];

const VALID_STATUSES: readonly CustomerStatus[] = [
  'new_lead', 'contacted', 'follow_up_needed', 'offer_drafted',
  'offer_sent', 'won', 'lost',
];

const VALID_CONTACT_METHODS = ['viber', 'email', 'phone'] as const;

function mapIntakeStatus(raw: string): 'none' | 'waiting_sms' | 'completed' {
  if (raw === 'submitted') return 'completed';
  if (raw === 'pending' || raw === 'sent' || raw === 'opened') return 'waiting_sms';
  return 'none';
}

function mapCustomer(dto: CustomerDto): Customer {
  return {
    id: dto.id,
    name: dto.name ?? dto.companyName ?? dto.crmNumber ?? 'Νέος πελάτης',
    companyName: dto.companyName ?? '',
    phone: dto.phone ?? '',
    mobilePhone: dto.mobilePhone ?? undefined,
    landlinePhone: dto.landlinePhone ?? undefined,
    email: dto.email ?? '',
    address: dto.address ?? '',
    source: VALID_SOURCES.includes(dto.source as CustomerSource)
      ? (dto.source as CustomerSource)
      : 'manual_entry',
    status: VALID_STATUSES.includes(dto.status as CustomerStatus)
      ? (dto.status as CustomerStatus)
      : 'new_lead',
    preferredContactMethod: VALID_CONTACT_METHODS.includes(
      dto.preferredContactMethod as (typeof VALID_CONTACT_METHODS)[number]
    )
      ? (dto.preferredContactMethod as 'viber' | 'email' | 'phone')
      : 'phone',
    needsSummary: dto.needsSummary ?? '',
    notes: '',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    lastContactAt: dto.lastContactAt ?? undefined,
    crmNumber: dto.crmNumber ?? undefined,
    intakeStatus: mapIntakeStatus(dto.intakeStatus),
  };
}

// Status chip colors -- calm, no loud backgrounds
const STATUS_CHIP: Record<CustomerStatus, string> = {
  new_lead: 'bg-blue-50 text-blue-600',
  contacted: 'bg-zinc-100 text-zinc-500',
  follow_up_needed: 'bg-amber-50 text-amber-600',
  offer_drafted: 'bg-indigo-50 text-indigo-600',
  offer_sent: 'bg-indigo-50 text-indigo-500',
  won: 'bg-green-50 text-green-600',
  lost: 'bg-zinc-100 text-zinc-400',
};

// Status-based filter chips
type QuickFilter = 'all' | 'new_lead' | 'follow_up_needed' | 'offer_drafted' | 'offer_sent' | 'won' | 'lost';
const QUICK_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'Όλοι' },
  { value: 'new_lead', label: 'Νέα leads' },
  { value: 'follow_up_needed', label: 'Follow-up' },
  { value: 'offer_drafted', label: 'Draft προσφορά' },
  { value: 'offer_sent', label: 'Στάλθηκε προσφορά' },
  { value: 'won', label: 'Κερδισμένοι' },
  { value: 'lost', label: 'Χαμένοι' },
];

const LEAD_STATUSES = new Set<CustomerStatus>(['new_lead', 'contacted', 'offer_drafted', 'offer_sent']);

function ChevronRight() {
  return (
    <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

type PageMessage = 'no_session' | 'fetch_error' | null;

export default function CustomersPage() {
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<PageMessage>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [refreshTick, setRefreshTick] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) {
          setMessage('fetch_error');
          setHydrated(true);
          setLoading(false);
        }
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) {
          setMessage('no_session');
          setCustomers([]);
          setHydrated(true);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/customers?limit=100', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json() as { ok?: boolean; customers?: CustomerDto[]; error?: string };

        if (!cancelled) {
          if (json.ok && Array.isArray(json.customers)) {
            setCustomers(json.customers.map(mapCustomer));
            setMessage(null);
          } else {
            setCustomers([]);
            setMessage('fetch_error');
          }
          setHydrated(true);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setCustomers([]);
          setMessage('fetch_error');
          setHydrated(true);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshTick]);

  const hasFilter = search.trim() !== '' || quickFilter !== 'all';

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    // Normalise phone-like queries: strip spaces, dashes, parentheses, dots
    const qPhone = search.trim().replace(/[\s\-().+]/g, '');
    const normPhone = (s: string) => s.replace(/[\s\-().+]/g, '');
    return customers.filter((c) => {
      if (q) {
        const hit =
          norm(c.name).includes(q) ||
          norm(c.companyName).includes(q) ||
          norm(c.email).includes(q) ||
          norm(c.needsSummary).includes(q) ||
          norm(c.crmNumber ?? '').includes(q) ||
          norm(c.phone).includes(q) ||
          norm(c.mobilePhone ?? '').includes(q) ||
          norm(c.landlinePhone ?? '').includes(q) ||
          (qPhone.length >= 4 && normPhone(c.phone).includes(qPhone)) ||
          (qPhone.length >= 4 && normPhone(c.mobilePhone ?? '').includes(qPhone)) ||
          (qPhone.length >= 4 && normPhone(c.landlinePhone ?? '').includes(qPhone));
        if (!hit) return false;
      }
      if (quickFilter !== 'all' && c.status !== quickFilter) return false;
      return true;
    });
  }, [customers, search, quickFilter]);


  // Loading skeleton
  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded-full bg-zinc-200" />
          <div className="h-7 w-56 rounded-full bg-zinc-200" />
          <div className="h-4 w-44 rounded-full bg-zinc-200" />
        </div>
        <div className="h-12 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-16 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
          <div className="h-16 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
          <div className="h-16 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        </div>
        <p className="text-center text-sm text-zinc-400">Φόρτωση πελατών...</p>
      </div>
    );
  }

  // No session
  if (message === 'no_session') {
    return (
      <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">
        <div>
          <p className="text-xs font-medium text-zinc-400">Πελάτες</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">Ποιος χρειάζεται προσοχή;</h1>
        </div>
        <div className="rounded-[28px] bg-white px-5 py-8 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm font-medium text-zinc-600">Συνδέσου για να δεις τους πελάτες.</p>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  // Fetch error
  if (message === 'fetch_error') {
    return (
      <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">
        <div>
          <p className="text-xs font-medium text-zinc-400">Πελάτες</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">Ποιος χρειάζεται προσοχή;</h1>
        </div>
        <div className="rounded-[28px] bg-red-50 px-5 py-6 text-center ring-1 ring-red-200">
          <p className="text-sm font-medium text-red-700">
            Αδυναμία φόρτωσης πελατών. Έλεγξε τη σύνδεση ή ανανέωσε.
          </p>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="mt-4 rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // Summary stats
  const leadsCount = customers.filter((c) => LEAD_STATUSES.has(c.status)).length;
  const followUpCount = customers.filter((c) => c.status === 'follow_up_needed').length;

  // Main view
  async function handleAddCustomer(e: FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    const phone = addPhone.trim();
    if (!name && !phone) {
      setAddError('Βάλε όνομα ή τηλέφωνο.');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAddError('Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.');
        setAddBusy(false);
        return;
      }
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: name || null, phone: phone || null, source: 'manual_entry' }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setShowAdd(false);
        setAddName('');
        setAddPhone('');
        setRefreshTick((t) => t + 1);
      } else {
        setAddError('Αποτυχία. Δοκίμασε ξανά.');
      }
    } catch {
      setAddError('Αποτυχία. Δοκίμασε ξανά.');
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-400">Πελάτες</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
            Ποιος χρειάζεται προσοχή;
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Όλοι οι πελάτες και τα leads σε ένα καθαρό workspace.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setAddError(null); setShowAdd(true); }}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Νέος
          </button>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            disabled={loading}
            className="rounded-full bg-white p-2 shadow-sm ring-1 ring-zinc-200/60 text-zinc-400 transition hover:text-zinc-600 disabled:opacity-40"
            title="Ανανέωση"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add-customer modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          onClick={() => setShowAdd(false)}
        >
          <form
            onSubmit={handleAddCustomer}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-zinc-200/60"
          >
            <h2 className="text-base font-semibold text-zinc-900">Νέος πελάτης</h2>
            <input
              type="text"
              autoFocus
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Όνομα"
              className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="tel"
              inputMode="tel"
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              placeholder="Τηλέφωνο (π.χ. 69…)"
              className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
            />
            {addError && <p className="text-xs text-red-600">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={addBusy}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {addBusy ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Άκυρο
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search card */}
      <div className="rounded-[28px] bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200/60">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Αναζήτηση με όνομα, εταιρεία, τηλέφωνο ή email"
            className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none"
          />
          {search.trim() !== '' && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:text-zinc-600"
            >
              Καθαρισμός
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setQuickFilter(f.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                quickFilter === f.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      {customers.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-[28px] bg-white px-3 py-3.5 text-center shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-2xl font-bold leading-none text-zinc-900">{customers.length}</p>
            <p className="mt-1 text-[10px] text-zinc-400">Σύνολο</p>
          </div>
          <div className="rounded-[28px] bg-white px-3 py-3.5 text-center shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-2xl font-bold leading-none text-zinc-900">{leadsCount}</p>
            <p className="mt-1 text-[10px] text-zinc-400">Leads</p>
          </div>
          <div className="rounded-[28px] bg-white px-3 py-3.5 text-center shadow-sm ring-1 ring-zinc-200/60">
            <p className={`text-2xl font-bold leading-none ${followUpCount > 0 ? 'text-amber-600' : 'text-zinc-300'}`}>
              {followUpCount}
            </p>
            <p className="mt-1 text-[10px] text-zinc-400">Follow-up</p>
          </div>
        </div>
      )}

      {/* Results summary line */}
      {customers.length > 0 && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-zinc-500">
            {hasFilter ? 'Αποτελέσματα αναζήτησης' : 'Όλοι οι πελάτες'}
          </p>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
            {filtered.length}
          </span>
        </div>
      )}

      {/* Customer list */}
      {customers.length === 0 ? (
        <Card padding="none">
          <EmptyState title="Δεν υπάρχουν πελάτες ακόμα." />
        </Card>
      ) : filtered.length === 0 ? (
        <Card padding="none">
          <EmptyState title="Δεν βρέθηκαν πελάτες με αυτά τα κριτήρια." />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((customer) => {
            const initial = customer.name.trim().slice(0, 1).toUpperCase() || 'Π';
            return (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className="flex items-start gap-3 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:bg-zinc-50/60 active:bg-zinc-50"
                >
                  {/* Avatar */}
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-base font-bold text-indigo-600">
                    {initial}
                  </div>
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-bold leading-snug text-zinc-900 truncate">
                        {customer.name}
                      </p>
                      <ChevronRight />
                    </div>
                    {(customer.companyName || customer.phone) && (
                      <p className="mt-0.5 text-sm text-zinc-400 truncate">
                        {customer.companyName || customer.phone}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[customer.status]}`}>
                        {STATUS_LABELS[customer.status]}
                      </span>
                    </div>
                    {customer.needsSummary && (
                      <p className="mt-1.5 line-clamp-1 text-xs text-zinc-400">
                        {customer.needsSummary}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}
