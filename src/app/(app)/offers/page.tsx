'use client';

import { useState, useMemo } from 'react';
import { loadState, saveState, addOffer, updateOffer, deleteOffer } from '@/lib/storage';
import { generateDemoOffers } from '@/lib/demo-data';
import type { Offer, OfferStatus, Customer } from '@/lib/types';
import OfferCard from '@/components/offers/OfferCard';
import OfferForm from '@/components/offers/OfferForm';

function initOffers(): Offer[] {
  if (typeof window === 'undefined') return [];
  const state = loadState();
  if (state.offers === undefined) {
    const seeded = generateDemoOffers();
    saveState({ offers: seeded });
    return seeded;
  }
  return state.offers;
}

function initCustomers(): Customer[] {
  if (typeof window === 'undefined') return [];
  return loadState().customers ?? [];
}

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>(initOffers);
  const [customers] = useState<Customer[]>(initCustomers);
  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);

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

      {/* List */}
      {offers.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-zinc-500">Δεν υπάρχουν προσφορές ακόμα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Μπορείς να δημιουργήσεις προσφορά με υπαγόρευση ή με το κουμπί παραπάνω.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {offers.map((offer) => (
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
