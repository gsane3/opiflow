'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button, Card, EmptyState, BottomSheet, SheetRow } from '@/components/ui';
import type { Customer, CustomerStatus, CustomerSource } from '@/lib/types';
import { norm } from '@/lib/search';
import CustomerCard from '@/components/customers/CustomerCard';

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
  'new', 'in_progress', 'won', 'lost',
  'new_lead', 'contacted', 'follow_up_needed', 'offer_drafted', 'offer_sent',
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
      : 'new',
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

// Quick-filter values. 'offers' is a synthetic filter that matches any
// legacy offer status (offer_drafted | offer_sent) for back-compat.
type QuickFilter =
  | 'all'
  | 'new'
  | 'in_progress'
  | 'won'
  | 'lost'
  | 'offers';

// The 4 status chips always shown inline.
const PRIMARY_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'Όλοι' },
  { value: 'new', label: 'Νέοι' },
  { value: 'in_progress', label: 'Σε εξέλιξη' },
  { value: 'won', label: 'Κερδισμένοι' },
];

// Extra filters tucked behind "Περισσότερα φίλτρα".
const ADVANCED_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'lost', label: 'Χαμένοι' },
];

const OFFER_STATUSES = new Set<CustomerStatus>(['offer_drafted', 'offer_sent']);

type PageMessage = 'no_session' | 'fetch_error' | null;

export default function CustomersPage() {
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<PageMessage>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
      if (quickFilter === 'offers') {
        if (!OFFER_STATUSES.has(c.status)) return false;
      } else if (quickFilter !== 'all' && c.status !== quickFilter) {
        return false;
      }
      return true;
    });
  }, [customers, search, quickFilter]);

  // The label of an active "advanced" filter (one not shown as a primary chip),
  // surfaced as a removable active chip so it stays visible.
  const activeAdvancedLabel = ADVANCED_FILTERS.find((f) => f.value === quickFilter)?.label ?? null;


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
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors select-none hover:bg-indigo-700 active:bg-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
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
            Πελάτες και αιτήματα σε ένα απλό σημείο.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Link
            href="/customers/new"
            className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Νέος
          </Link>
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
            placeholder="Ψάξε με όνομα ή τηλέφωνο"
            className="flex-1 rounded-lg bg-transparent py-3.5 text-base text-zinc-900 placeholder-zinc-400 outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

        {/* Filter chips — 4 primary + "Περισσότερα φίλτρα" */}
        <div className="mt-3 flex flex-wrap gap-2.5 border-t border-zinc-100 pt-3">
          {PRIMARY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setQuickFilter(f.value)}
              className={`min-h-[40px] rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-[0.97] ${
                quickFilter === f.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}

          {/* Active advanced filter shown as a removable chip */}
          {activeAdvancedLabel && (
            <button
              type="button"
              onClick={() => setQuickFilter('all')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition active:scale-[0.97] hover:bg-indigo-700"
            >
              {activeAdvancedLabel}
              <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={() => setMoreFiltersOpen(true)}
            className="min-h-[40px] rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-700 transition active:scale-[0.97] hover:bg-zinc-200"
          >
            Περισσότερα φίλτρα
          </button>
        </div>
      </div>

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
          <EmptyState
            title="Δεν υπάρχουν πελάτες ακόμα."
            action={
              <Link
                href="/customers/new"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors select-none hover:bg-indigo-700 active:bg-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Νέος πελάτης
              </Link>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card padding="none" className="motion-safe:animate-[fadeIn_0.18s]">
          <EmptyState
            icon={
              <svg className="h-6 w-6" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            }
            title="Δεν βρέθηκαν πελάτες με αυτά τα κριτήρια."
            action={
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setSearch('');
                  setQuickFilter('all');
                }}
              >
                Καθαρισμός φίλτρων
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 motion-safe:animate-[fadeIn_0.18s] md:grid-cols-2">
          {filtered.map((customer) => (
            <li key={customer.id}>
              <CustomerCard customer={customer} />
            </li>
          ))}
        </ul>
      )}

      {/* "Περισσότερα φίλτρα" sheet */}
      <BottomSheet
        open={moreFiltersOpen}
        onClose={() => setMoreFiltersOpen(false)}
        title="Περισσότερα φίλτρα"
        description="Διάλεξε κατάσταση πελάτη"
      >
        <div className="space-y-1">
          {ADVANCED_FILTERS.map((f) => (
            <SheetRow
              key={f.value}
              label={f.label}
              onClick={() => {
                setQuickFilter(f.value);
                setMoreFiltersOpen(false);
              }}
            />
          ))}
        </div>
      </BottomSheet>

    </div>
  );
}
