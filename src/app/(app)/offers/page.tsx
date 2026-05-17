'use client';

import { useState, useMemo, useEffect } from 'react';
import { loadState, saveState, addOffer, updateOffer, deleteOffer } from '@/lib/storage';
import { generateDemoOffers } from '@/lib/demo-data';
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

export default function OffersPage() {
  // Start with [] so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);

  // Search + filter state
  const [offerSearch, setOfferSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OfferStatus | ''>('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  // Load localStorage after mount to avoid hydration mismatch.
  // Preserves seeding rule: undefined = seed demo, [] = user cleared intentionally.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    let nextOffers: Offer[];
    if (state.offers === undefined) {
      const seeded = generateDemoOffers();
      saveState({ offers: seeded });
      nextOffers = seeded;
    } else {
      nextOffers = state.offers;
    }
    const nextCustomers: Customer[] = state.customers ?? [];
    const timer = window.setTimeout(() => {
      setOffers(nextOffers);
      setCustomers(nextCustomers);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const hasFilter = offerSearch.trim() !== '' || statusFilter !== '';

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  const nextOfferNumber = useMemo(() => {
    if (offers.length === 0) return '#001';
    const maxNum = Math.max(
      ...offers.map((o) => {
        const match = o.offerNumber.match(/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
    );
    return `#${String(maxNum + 1).padStart(3, '0')}`;
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
      // newest: reverse insertion order
      result = [...result].reverse();
    }

    return result;
  }, [offers, offerSearch, statusFilter, sortBy, customerMap]);

  function clearFilters() {
    setOfferSearch('');
    setStatusFilter('');
  }

  function handleSave(offer: Offer) {
    if (editingOffer) {
      updateOffer(offer);
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? offer : o)));
    } else {
      addOffer(offer);
      setOffers((prev) => [...prev, offer]);
    }
    setShowForm(false);
    setEditingOffer(null);
  }

  function handleStatusChange(id: string, status: OfferStatus) {
    const offer = offers.find((o) => o.id === id);
    if (!offer) return;
    const updated = { ...offer, status, updatedAt: new Date().toISOString() };
    updateOffer(updated);
    setOffers((prev) => prev.map((o) => (o.id === id ? updated : o)));
  }

  function handleDelete(id: string) {
    deleteOffer(id);
    setOffers((prev) => prev.filter((o) => o.id !== id));
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingOffer(null);
  }

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">Προσφορές</h1>
          <button
            type="button"
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
          >
            + Νέα προσφορά
          </button>
        </div>
        <div className="mb-4 space-y-2">
          <input
            type="search"
            disabled
            placeholder="Αναζήτηση αριθμού, πελάτη, σημειώσεων, όρων..."
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <select disabled className={selCls}>
              <option>Όλα τα status</option>
            </select>
            <select disabled className={selCls}>
              <option>Νεότερες πρώτα</option>
            </select>
          </div>
        </div>
        <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση προσφορών...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-zinc-900">Προσφορές</h1>
          {offers.length > 0 && (
            <span className="text-sm text-zinc-400">{offers.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={showForm && !editingOffer ? handleCancelForm : () => { setEditingOffer(null); setShowForm(true); }}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            showForm && !editingOffer
              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {showForm && !editingOffer ? 'Ακύρωση' : '+ Νέα προσφορά'}
        </button>
      </div>

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
      <div className="mb-4 space-y-2">
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
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-500">Δεν υπάρχουν προσφορές ακόμα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Δημιούργησε προσφορά με το κουμπί + παραπάνω ή με υπαγόρευση.
          </p>
        </div>
      ) : filteredOffers.length === 0 ? (
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100">
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
                onDelete={handleDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
