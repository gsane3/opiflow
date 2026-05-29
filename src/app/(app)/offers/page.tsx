'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Offer, OfferStatus, Customer } from '@/lib/types';
import { norm } from '@/lib/search';
import OfferCard from '@/components/offers/OfferCard';
import OfferForm from '@/components/offers/OfferForm';
import { OFFER_STATUS_LABELS } from '@/components/offers/OfferStatusBadge';
import OfferAnalyticsPanel from '@/components/offers/OfferAnalyticsPanel';

type SortBy = 'newest' | 'amount_desc' | 'amount_asc';

const SORT_LABELS: Record<SortBy, string> = {
  newest: 'Νεότερες πρώτα',
  amount_desc: 'Υψηλότερο ποσό',
  amount_asc: 'Χαμηλότερο ποσό',
};

const selCls =
  'rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-700 outline-none focus:border-indigo-400';

// Map backend offer response to the local Offer type.
// Backend may return null for nullable fields; local type uses non-null strings.
function mapBackendOffer(d: Record<string, unknown>): Offer {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    relatedTaskId: (d.relatedTaskId as string | null) ?? undefined,
    offerNumber: d.offerNumber as string,
    status: d.status as OfferStatus,
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

// Minimal mapping from backend customer response to local Customer type.
function mapBackendCustomer(d: Record<string, unknown>): Customer {
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
    address: '',
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

// Build request body for POST /api/offers or PATCH /api/offers/[id].
// Backend recomputes subtotal, vatAmount, total from items and vatRate.
function buildOfferBody(offer: Offer): Record<string, unknown> {
  return {
    offerNumber: offer.offerNumber,
    status: offer.status,
    offerDate: offer.offerDate,
    validUntil: offer.validUntil || null,
    vatRate: offer.vatRate,
    // Full items array sent as replacement on every save.
    items: offer.items.map((item, idx) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      sortOrder: idx,
    })),
    notes: offer.notes,
    terms: offer.terms,
    acceptanceText: offer.acceptanceText,
    createdFromAi: offer.createdFromAi,
    // Explicitly null-clear customerId if not set, so PATCH can clear it.
    customerId: offer.customerId ?? null,
    relatedTaskId: offer.relatedTaskId ?? undefined,
  };
}

export default function OffersPage() {
  const [hydrated, setHydrated] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const tokenRef = useRef<string | null>(null);

  const [offerSearch, setOfferSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OfferStatus | ''>('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const loadData = useCallback(async (token: string) => {
    setFetchError(null);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [offersResp, customersResp] = await Promise.all([
        fetch('/api/offers?limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
      ]);

      if (!offersResp.ok || !customersResp.ok) {
        setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }

      const offersData = await offersResp.json();
      const customersData = await customersResp.json();

      const rawOffers: Record<string, unknown>[] = Array.isArray(offersData)
        ? offersData
        : (offersData.offers ?? []);
      const rawCustomers: Record<string, unknown>[] = Array.isArray(customersData)
        ? customersData
        : (customersData.customers ?? []);

      setOffers(rawOffers.map(mapBackendOffer));
      setCustomers(rawCustomers.map(mapBackendCustomer));
      setHydrated(true);
    } catch {
      setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
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
          setNoSession(true);
          setHydrated(true);
          return;
        }
        tokenRef.current = session.access_token;
        await loadData(session.access_token);
      } catch {
        setFetchError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  const hasFilter = offerSearch.trim() !== '' || statusFilter !== '';

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  // Local display estimate for the next offer number to pre-fill OfferForm.
  // The backend generates the authoritative number on POST; this is a hint only.
  const nextOfferNumber = useMemo(() => {
    const year = new Date().getFullYear();
    const prefix = `OFFER-${year}-`;
    let maxN = 0;
    for (const o of offers) {
      if (o.offerNumber.startsWith(prefix)) {
        const n = parseInt(o.offerNumber.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
    return `${prefix}${maxN + 1}`;
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const q = norm(offerSearch.trim());
    let result = offers.filter((o) => {
      if (q) {
        const customerName = o.customerId ? norm(customerMap[o.customerId] ?? '') : '';
        const hit =
          norm(o.offerNumber).includes(q) ||
          customerName.includes(q) ||
          norm(o.notes).includes(q) ||
          norm(o.terms).includes(q);
        if (!hit) return false;
      }
      if (statusFilter && o.status !== statusFilter) return false;
      return true;
    });

    if (sortBy === 'amount_desc') {
      result = [...result].sort((a, b) => b.total - a.total);
    } else if (sortBy === 'amount_asc') {
      result = [...result].sort((a, b) => a.total - b.total);
    } else {
      // newest: reverse insertion order (offers are returned offer_date DESC from API)
      result = [...result].reverse();
    }

    return result;
  }, [offers, offerSearch, statusFilter, sortBy, customerMap]);

  function clearFilters() {
    setOfferSearch('');
    setStatusFilter('');
  }

  async function handleSave(offer: Offer) {
    const token = tokenRef.current;
    if (!token) return;
    setActionError(null);

    const body = buildOfferBody(offer);

    if (editingOffer) {
      const resp = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const updated = mapBackendOffer(data.offer as Record<string, unknown>);
        setOffers((prev) => prev.map((o) => (o.id === offer.id ? updated : o)));
      } else {
        setActionError('Αποτυχία αποθήκευσης προσφοράς. Δοκίμασε ξανά.');
        return;
      }
    } else {
      const resp = await fetch('/api/offers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const created = mapBackendOffer(data.offer as Record<string, unknown>);
        setOffers((prev) => [...prev, created]);
      } else {
        setActionError('Αποτυχία δημιουργίας προσφοράς. Δοκίμασε ξανά.');
        return;
      }
    }

    setShowForm(false);
    setEditingOffer(null);
  }

  async function handleStatusChange(id: string, status: OfferStatus) {
    const token = tokenRef.current;
    if (!token) return;
    setActionError(null);
    const resp = await fetch(`/api/offers/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const updated = mapBackendOffer(data.offer as Record<string, unknown>);
      setOffers((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } else {
      setActionError('Αποτυχία αλλαγής status. Δοκίμασε ξανά.');
    }
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingOffer(null);
  }

  // ---------------------------------------------------------------------------
  // Loading shell - identical on server and first client render.
  // ---------------------------------------------------------------------------

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Φόρτωση προσφορών...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------

  if (noSession) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">Εμπορικές</p>
        <h1 className="mb-5 text-xl font-bold text-zinc-900">Προσφορές</h1>
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="mb-4 text-sm text-zinc-600">Συνδέσου για να δεις τις προσφορές.</p>
          <Link
            href="/login/backend"
            className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Fetch error
  // ---------------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">Εμπορικές</p>
        <h1 className="mb-5 text-xl font-bold text-zinc-900">Προσφορές</h1>
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="mb-4 text-sm text-red-600">{fetchError}</p>
          <button
            type="button"
            onClick={() => {
              const token = tokenRef.current;
              if (token) {
                setHydrated(false);
                loadData(token);
              }
            }}
            className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-4xl md:px-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">Εμπορικές</p>
          <h1 className="text-xl font-bold text-zinc-900">
            Προσφορές{offers.length > 0 && <span className="ml-2 text-sm font-normal text-zinc-400">{offers.length}</span>}
          </h1>
        </div>
        <button
          type="button"
          onClick={
            showForm && !editingOffer
              ? handleCancelForm
              : () => {
                  setEditingOffer(null);
                  setShowForm(true);
                }
          }
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            showForm && !editingOffer
              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {showForm && !editingOffer ? 'Ακύρωση' : '+ Νέα προσφορά'}
        </button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 ring-1 ring-red-200">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Analytics */}
      <OfferAnalyticsPanel offers={offers} />

      {/* Form */}
      {showForm && (
        <div className="mb-5">
          <OfferForm
            initial={editingOffer ?? undefined}
            customers={customers}
            nextOfferNumber={nextOfferNumber}
            onSave={handleSave}
            onCancel={handleCancelForm}
          />
        </div>
      )}

      {/* Search + filter + sort */}
      <div className="mb-5 rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 space-y-3">
        <input
          type="search"
          value={offerSearch}
          onChange={(e) => setOfferSearch(e.target.value)}
          placeholder="Αναζήτηση αριθμού, πελάτη, σημειώσεων, όρων..."
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OfferStatus | '')}
            className={selCls}
          >
            <option value="">Όλα τα status</option>
            {(Object.entries(OFFER_STATUS_LABELS) as [OfferStatus, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className={selCls}
          >
            {(Object.entries(SORT_LABELS) as [SortBy, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Καθαρισμός
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {offers.length === 0 ? (
        <div className="rounded-[28px] bg-white px-5 py-8 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm font-medium text-zinc-500">Δεν υπάρχουν προσφορές ακόμα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Δημιούργησε προσφορά με το κουμπί + παραπάνω ή με υπαγόρευση.
          </p>
        </div>
      ) : filteredOffers.length === 0 ? (
        <div className="rounded-[28px] bg-white px-5 py-8 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm font-medium text-zinc-500">Δεν βρέθηκαν αποτελέσματα.</p>
          <p className="mt-1 text-sm text-zinc-400">Δοκίμασε διαφορετικούς όρους ή κάνε καθαρισμό.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredOffers.map((offer) => (
            <li key={offer.id}>
              <OfferCard
                offer={offer}
                customerName={offer.customerId ? customerMap[offer.customerId] : undefined}
                onStatusChange={handleStatusChange}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
