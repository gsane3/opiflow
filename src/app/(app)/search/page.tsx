'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Customer, Task, Offer } from '@/lib/types';
import { norm } from '@/lib/search';

// ---------------------------------------------------------------------------
// Backend -> local mappers (same shape as the dashboard)
// ---------------------------------------------------------------------------

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
    mobilePhone: (d.mobilePhone as string | null) ?? undefined,
    landlinePhone: (d.landlinePhone as string | null) ?? undefined,
  };
}

function mapOffer(d: Record<string, unknown>): Offer {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    relatedTaskId: (d.relatedTaskId as string | null) ?? undefined,
    offerNumber: d.offerNumber as string,
    status: d.status as Offer['status'],
    offerDate: d.offerDate as string,
    validUntil: (d.validUntil as string | null) ?? (d.offerDate as string),
    items: (d.items as unknown as Offer['items']) ?? [],
    subtotal: d.subtotal as number,
    vatRate: d.vatRate as number,
    vatAmount: d.vatAmount as number,
    total: d.total as number,
    notes: (d.notes as string | null) ?? '',
    terms: (d.terms as string | null) ?? '',
    acceptanceText: (d.acceptanceText as string | null) ?? '',
    createdFromAi: (d.createdFromAi as boolean) ?? false,
    createdAt: d.createdAt as string,
    updatedAt: d.updatedAt as string,
  };
}

function mapTask(d: Record<string, unknown>): Task {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    offerId: (d.offerId as string | null) ?? undefined,
    title: d.title as string,
    type: (d.type as Task['type']) ?? 'other',
    status: d.status as Task['status'],
    priority: (d.priority as Task['priority']) ?? 'normal',
    dueDate: d.dueDate as string,
    dueTime: (d.dueTime as string | null) ?? undefined,
    note: (d.note as string | null) ?? '',
    createdFromAi: (d.createdFromAi as boolean) ?? false,
    completedAt: (d.completedAt as string | null) ?? undefined,
    createdAt: d.createdAt as string,
    updatedAt: d.updatedAt as string,
  };
}

interface SearchData {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
}

const MAX_PER_GROUP = 8;

function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-zinc-300"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-5 w-5 text-zinc-400"
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

export default function SearchPage() {
  const [hydrated, setHydrated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [data, setData] = useState<SearchData>({ customers: [], tasks: [], offers: [] });

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce the query (~200ms) before filtering.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const loadData = useCallback(async (token: string) => {
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    try {
      const [customersResp, tasksResp, offersResp] = await Promise.all([
        fetch('/api/customers?limit=100', { headers }),
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/offers?limit=100', { headers }),
      ]);

      if (!customersResp.ok || !tasksResp.ok || !offersResp.ok) {
        setActionError('Αποτυχία φόρτωσης δεδομένων. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }

      const [customersData, tasksData, offersData] = await Promise.all([
        customersResp.json(),
        tasksResp.json(),
        offersResp.json(),
      ]);

      const customers: Customer[] = (
        Array.isArray(customersData) ? customersData : (customersData.customers ?? [])
      ).map(mapCustomer);

      const tasks: Task[] = (
        Array.isArray(tasksData) ? tasksData : (tasksData.tasks ?? [])
      ).map(mapTask);

      const offers: Offer[] = (
        Array.isArray(offersData) ? offersData : (offersData.offers ?? [])
      ).map(mapOffer);

      setData({ customers, tasks, offers });
      setHydrated(true);
    } catch {
      setActionError('Αποτυχία φόρτωσης δεδομένων. Δοκίμασε ξανά.');
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
          setHydrated(true);
          return;
        }
        await loadData(session.access_token);
      } catch {
        setActionError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  const trimmed = debouncedQuery.trim();
  const q = norm(trimmed);

  // Filter each list against the normalized query.
  const matchedCustomers = useMemo(() => {
    if (!q) return [];
    return data.customers
      .filter((c) => {
        return (
          norm(c.name).includes(q) ||
          (c.phone && norm(c.phone).includes(q)) ||
          (c.mobilePhone && norm(c.mobilePhone).includes(q)) ||
          (c.landlinePhone && norm(c.landlinePhone).includes(q)) ||
          (c.email && norm(c.email).includes(q))
        );
      })
      .slice(0, MAX_PER_GROUP);
  }, [data.customers, q]);

  const matchedOffers = useMemo(() => {
    if (!q) return [];
    return data.offers
      .filter((o) => o.offerNumber && norm(o.offerNumber).includes(q))
      .slice(0, MAX_PER_GROUP);
  }, [data.offers, q]);

  const matchedTasks = useMemo(() => {
    if (!q) return [];
    return data.tasks
      .filter((t) => t.title && norm(t.title).includes(q))
      .slice(0, MAX_PER_GROUP);
  }, [data.tasks, q]);

  // Lookup name for an offer/task's customer, shown as a subtitle.
  const customerMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of data.customers) map[c.id] = c.name;
    return map;
  }, [data.customers]);

  const totalResults = matchedCustomers.length + matchedOffers.length + matchedTasks.length;
  const hasQuery = q.length > 0;

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Loading skeleton (matches the dashboard).
  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-5 py-6 md:max-w-4xl md:px-8">
        <div className="space-y-1.5">
          <div className="h-3 w-20 rounded-full bg-zinc-200" />
          <div className="h-7 w-32 rounded-full bg-zinc-200" />
        </div>
        <div className="h-14 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        <div className="h-24 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
        <div className="h-24 rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
      {/* Error banner */}
      {actionError && (
        <div className="rounded-[28px] bg-red-50 px-4 py-2.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Auth required */}
      {authRequired && (
        <div className="rounded-[28px] bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-sm text-amber-700">
            Συνδέσου για να φορτωθούν τα πραγματικά δεδομένα.
          </p>
          <Link
            href="/login"
            className="mt-2 inline-block rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      )}

      {/* Header */}
      <div>
        <p className="text-xs text-zinc-400">Παντού</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">Αναζήτηση</h1>
      </div>

      {/* Search input */}
      <div className="flex items-center gap-3 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 focus-within:ring-indigo-300">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Πελάτες, προσφορές, tasks…"
          className="w-full bg-transparent text-base text-zinc-900 placeholder:text-zinc-400 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="text-xs font-medium text-zinc-400 hover:text-zinc-600"
          >
            Καθαρισμός
          </button>
        )}
      </div>

      {/* Empty-query prompt */}
      {!hasQuery && (
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-base font-medium text-zinc-600">Ξεκίνα να πληκτρολογείς</p>
          <p className="mt-1 text-sm text-zinc-400">
            Ψάξε πελάτες με όνομα, τηλέφωνο ή email, προσφορές με αριθμό, ή tasks με τίτλο.
          </p>
        </div>
      )}

      {/* No results */}
      {hasQuery && totalResults === 0 && (
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-base font-medium text-zinc-600">Κανένα αποτέλεσμα</p>
          <p className="mt-1 text-sm text-zinc-400">
            Δεν βρέθηκε κάτι για «{trimmed}».
          </p>
        </div>
      )}

      {/* Results: Customers */}
      {hasQuery && matchedCustomers.length > 0 && (
        <section className="rounded-[28px] bg-white px-5 py-6 shadow-sm ring-1 ring-zinc-200/60">
          <h2 className="text-sm font-semibold text-zinc-900">Πελάτες</h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {matchedCustomers.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/customers/${c.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition active:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">{c.name}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {c.phone || c.mobilePhone || c.email || c.companyName || '—'}
                    </p>
                  </div>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Results: Offers */}
      {hasQuery && matchedOffers.length > 0 && (
        <section className="rounded-[28px] bg-white px-5 py-6 shadow-sm ring-1 ring-zinc-200/60">
          <h2 className="text-sm font-semibold text-zinc-900">Προσφορές</h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {matchedOffers.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/offers/${o.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition active:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">{o.offerNumber}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {o.customerId ? customerMap[o.customerId] ?? '—' : '—'}
                    </p>
                  </div>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Results: Tasks */}
      {hasQuery && matchedTasks.length > 0 && (
        <section className="rounded-[28px] bg-white px-5 py-6 shadow-sm ring-1 ring-zinc-200/60">
          <h2 className="text-sm font-semibold text-zinc-900">Tasks</h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {matchedTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href="/tasks"
                  className="flex items-center justify-between gap-3 py-3 transition active:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">{t.title}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {t.customerId ? customerMap[t.customerId] ?? '—' : '—'}
                    </p>
                  </div>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
