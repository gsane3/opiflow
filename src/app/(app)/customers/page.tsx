'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button, Card, EmptyState, BottomSheet, SheetRow } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Customer, CustomerStatus, CustomerSource } from '@/lib/types';

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
  importedFromPhone?: boolean | null;
  needsIntake?: boolean | null;
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
    needsIntake: dto.needsIntake ?? false,
  };
}

// Quick-filter values. Filtering is server-side (parity with the native list):
// 'awaiting' → ?awaiting=1 (inbound-call contacts with no name yet); the four
// statuses map to ?status=. This also fixes the old client-side 100-row cap.
type QuickFilter =
  | 'all'
  | 'awaiting'
  | 'new'
  | 'in_progress'
  | 'won'
  | 'lost';

// Status chips shown inline.
const PRIMARY_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'Όλοι' },
  { value: 'awaiting', label: 'Αναμονή στοιχείων' },
  { value: 'new', label: 'Νέοι' },
  { value: 'in_progress', label: 'Σε εξέλιξη' },
  { value: 'won', label: 'Κερδισμένοι' },
];

// Extra filters tucked behind "Περισσότερα φίλτρα".
const ADVANCED_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'lost', label: 'Χαμένοι' },
];

const PAGE_SIZE = 100;

// iOS-Contacts grouping: first letter of the display name (Greek + Latin),
// accents stripped (Ά→Α). Digits/symbols/blank → '#'.
function sectionLetter(name: string): string {
  const ch = (name ?? '').trim().charAt(0).toUpperCase();
  if (!ch) return '#';
  if (/[A-ZΑ-Ω]/.test(ch)) return ch;
  const norm = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/[A-ZΑ-Ω]/.test(norm)) return norm;
  return '#';
}

interface ContactSection { title: string; items: Customer[] }

function groupSections(list: Customer[]): ContactSection[] {
  const map = new Map<string, Customer[]>();
  for (const cu of list) {
    const key = sectionLetter(cu.name || cu.companyName || cu.mobilePhone || cu.phone || '');
    const arr = map.get(key);
    if (arr) arr.push(cu); else map.set(key, [cu]);
  }
  const order = (a: string, b: string) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b, 'el'));
  return Array.from(map.keys()).sort(order).map((title) => ({
    title,
    items: map.get(title)!.slice().sort((x, y) =>
      (x.name || x.companyName || '').localeCompare(y.name || y.companyName || '', 'el')),
  }));
}

type PageMessage = 'no_session' | 'fetch_error' | null;

export default function CustomersPage() {
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<PageMessage>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  // iOS-Contacts style: the list is ALWAYS alphabetical, grouped into A–Z
  // sections client-side. Server sort=name keeps pagination order consistent.
  const sortByName = true;
  // U6 — phone-imported contacts are HIDDEN BY DEFAULT (owner request: show app
  // contacts only). A toggle reveals them; shown only when some exist. Filtering
  // is client-side over the loaded rows (parity with native).
  const [hideImported, setHideImported] = useState(true);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // Sequence guard: a slow response for an old query/filter must not overwrite a newer one.
  const loadSeq = useRef(0);

  // Debounce free-text search before re-querying the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (offset: number, append: boolean) => {
    const seq = ++loadSeq.current;
    if (append) setLoadingMore(true); else setLoading(true);

    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      if (seq === loadSeq.current) { setMessage('fetch_error'); setHydrated(true); setLoading(false); setLoadingMore(false); }
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      if (seq === loadSeq.current) { setMessage('no_session'); setCustomers([]); setHydrated(true); setLoading(false); setLoadingMore(false); }
      return;
    }

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (sortByName) params.set('sort', 'name');
    if (quickFilter === 'awaiting') params.set('awaiting', '1');
    else if (quickFilter !== 'all') params.set('status', quickFilter);

    try {
      const res = await fetch(`/api/customers?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json() as { ok?: boolean; customers?: CustomerDto[]; error?: string };
      if (seq !== loadSeq.current) return; // a newer query already won
      if (json.ok && Array.isArray(json.customers)) {
        const mapped = json.customers.map(mapCustomer);
        const pageImported = json.customers.filter((c) => c.importedFromPhone).map((c) => c.id);
        setCustomers((prev) => (append ? [...prev, ...mapped] : mapped));
        setImportedIds((prev) => (append ? new Set([...prev, ...pageImported]) : new Set(pageImported)));
        setCanLoadMore(json.customers.length === PAGE_SIZE);
        setMessage(null);
      } else {
        if (!append) setCustomers([]);
        setMessage('fetch_error');
      }
    } catch {
      if (seq !== loadSeq.current) return;
      if (!append) setCustomers([]);
      setMessage('fetch_error');
    } finally {
      if (seq === loadSeq.current) { setHydrated(true); setLoading(false); setLoadingMore(false); }
    }
  }, [debouncedSearch, quickFilter, sortByName]);

  useEffect(() => { void load(0, false); }, [load, refreshTick]);

  const hasFilter = debouncedSearch !== '' || quickFilter !== 'all';

  // U6 — only offer the toggle when some phone-imported contacts are present.
  const hasImported = customers.some((c) => importedIds.has(c.id));
  const visibleCustomers = hideImported ? customers.filter((c) => !importedIds.has(c.id)) : customers;
  // A–Z sections (iOS Contacts). Grouped client-side over the loaded rows.
  const sections = groupSections(visibleCustomers);

  // Selected-row tick for the «Ταξινόμηση & φίλτρα» sheet.
  const checkIcon = (
    <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );

  // The label of an active "advanced" filter (one not shown as a primary chip),
  // surfaced as a removable active chip so it stays visible.
  const activeAdvancedLabel = ADVANCED_FILTERS.find((f) => f.value === quickFilter)?.label ?? null;


  // Loading skeleton
  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
          <div className="h-7 w-56 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
          <div className="h-4 w-44 rounded-full bg-zinc-200 dark:bg-[#1e2b38]" />
        </div>
        <div className="h-12 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-16 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
          <div className="h-16 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
          <div className="h-16 rounded-[28px] bg-white dark:bg-[#17232f] shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10" />
        </div>
        {/* Card placeholders so the list feels instant (no blank-then-pop). */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="status" aria-label="Φόρτωση πελατών">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-[28px]" />
          ))}
        </div>
      </div>
    );
  }

  // No session
  if (message === 'no_session') {
    return (
      <div className="mx-auto w-full max-w-md md:max-w-4xl space-y-5 px-5 pt-6 pb-28">
        <div>
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Πελάτες</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Ποιος χρειάζεται προσοχή;</h1>
        </div>
        <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-8 text-center shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Συνδέσου για να δεις τους πελάτες.</p>
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
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Πελάτες</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Ποιος χρειάζεται προσοχή;</h1>
        </div>
        <div className="rounded-[28px] bg-red-50 px-5 py-6 text-center ring-1 ring-red-200">
          <p className="text-sm font-medium text-red-700">
            Αδυναμία φόρτωσης πελατών. Έλεγξε τη σύνδεση ή ανανέωσε.
          </p>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="mt-4 rounded-2xl bg-white dark:bg-[#17232f] px-5 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 ring-1 ring-zinc-200 dark:ring-white/10 transition hover:bg-zinc-50 dark:hover:bg-white/5"
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
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Επαφές
          </h1>
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
            className="rounded-full bg-white dark:bg-[#17232f] p-2 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40"
            title="Ανανέωση"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search card */}
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-4 py-3 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ψάξε με όνομα ή τηλέφωνο"
            className="flex-1 rounded-lg bg-transparent py-3.5 text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search.trim() !== '' && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Καθαρισμός
            </button>
          )}
        </div>

        {/* Filter chips — 4 primary + "Περισσότερα φίλτρα" */}
        <div className="mt-3 flex flex-wrap gap-2.5 border-t border-zinc-100 dark:border-white/10 pt-3">
          {PRIMARY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setQuickFilter(f.value)}
              className={`min-h-[40px] rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-[0.97] ${
                quickFilter === f.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10'
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

          {/* Sort + view options live in the sheet to keep this row simple (B6). */}
          <button
            type="button"
            onClick={() => setMoreFiltersOpen(true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-700 transition active:scale-[0.97] hover:bg-zinc-200 dark:bg-[#1e2b38] dark:text-zinc-200 dark:hover:bg-white/10"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M6 12h12m-9 5.25h6" />
            </svg>
            Ταξινόμηση & φίλτρα
            {hideImported && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-indigo-600" />}
          </button>
        </div>
      </div>

      {/* Results summary line */}
      {visibleCustomers.length > 0 && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {hasFilter ? 'Αποτελέσματα αναζήτησης' : 'Όλοι οι πελάτες'}
          </p>
          <span className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {visibleCustomers.length}{canLoadMore ? '+' : ''}
          </span>
        </div>
      )}

      {/* Customer list */}
      {visibleCustomers.length === 0 ? (
        (hasFilter || (hideImported && customers.length > 0)) ? (
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
                    setHideImported(false);
                  }}
                >
                  Καθαρισμός φίλτρων
                </Button>
              }
            />
          </Card>
        ) : (
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
        )
      ) : (
        <>
          {/* iOS-Contacts list: sticky A–Z section headers + right-edge index. */}
          <div className="relative motion-safe:animate-[fadeIn_0.18s]">
            <div className="overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
              {sections.map((section) => (
                <div key={section.title}>
                  <div
                    id={`sec-${section.title}`}
                    className="sticky top-0 z-10 scroll-mt-2 bg-zinc-100/95 px-4 py-1 text-xs font-bold uppercase tracking-wide text-zinc-500 backdrop-blur dark:bg-[#101a24]/95 dark:text-zinc-400"
                  >
                    {section.title}
                  </div>
                  <ul>
                    {section.items.map((customer) => {
                      const phone = customer.mobilePhone || customer.landlinePhone || customer.phone || '';
                      const secondary = customer.name
                        ? [customer.companyName, phone].filter(Boolean).join(' · ') || '—'
                        : 'Αναμονή στοιχείων';
                      return (
                        <li key={customer.id}>
                          <Link
                            href={`/customers/${customer.id}`}
                            className="flex items-center gap-3 border-b border-zinc-100 py-2.5 pl-4 pr-7 transition hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                              {(customer.name || customer.companyName || 'Π').trim().charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {customer.name || customer.companyName || phone || 'Πελάτης'}
                              </span>
                              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{secondary}</span>
                            </span>
                            {customer.needsIntake && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Λείπουν στοιχεία" />}
                            <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                            </svg>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            {/* A–Z index scrubber — anchored to the card's right edge (absolute,
                inside the relative wrapper) so it tracks the centred card on desktop. */}
            {sections.length > 1 && (
              <div className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center">
                {sections.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => document.getElementById(`sec-${s.title}`)?.scrollIntoView({ block: 'start' })}
                    className="px-1 text-[10px] font-bold leading-[1.15] text-indigo-600 transition hover:text-indigo-800 dark:text-indigo-400"
                    aria-label={`Μετάβαση στο ${s.title}`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          {canLoadMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="secondary"
                size="md"
                disabled={loadingMore}
                onClick={() => void load(customers.length, true)}
              >
                {loadingMore ? 'Φόρτωση…' : 'Φόρτωσε περισσότερους'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Ταξινόμηση & φίλτρα sheet */}
      <BottomSheet
        open={moreFiltersOpen}
        onClose={() => setMoreFiltersOpen(false)}
        title="Ταξινόμηση & φίλτρα"
      >
        {hasImported && (
          <>
            <p className="mt-4 px-1 pb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Προβολή</p>
            <div className="space-y-1">
              <SheetRow
                label="Απόκρυψη επαφών κινητού"
                description="Κρύψε επαφές που εισήχθησαν από το βιβλίο διευθύνσεων"
                trailing={hideImported ? checkIcon : undefined}
                onClick={() => setHideImported((v) => !v)}
              />
            </div>
          </>
        )}

        <p className="mt-4 px-1 pb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Κατάσταση</p>
        <div className="space-y-1">
          {ADVANCED_FILTERS.map((f) => (
            <SheetRow
              key={f.value}
              label={f.label}
              trailing={quickFilter === f.value ? checkIcon : undefined}
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
