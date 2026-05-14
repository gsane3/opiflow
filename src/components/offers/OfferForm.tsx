'use client';

import { useState } from 'react';
import type { Offer, OfferItem, Customer } from '@/lib/types';
import { loadState } from '@/lib/storage';
import { calculateTotals, lineTotal, fmtEur } from '@/lib/offer-calculations';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
function in30daysStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}
function newItem(): OfferItem {
  return { id: crypto.randomUUID(), description: '', quantity: 1, unitPrice: 0 };
}

interface Props {
  initial?: Offer;
  customers: Customer[];
  nextOfferNumber: string;
  onSave: (offer: Offer) => void;
  onCancel: () => void;
}

export default function OfferForm({ initial, customers, nextOfferNumber, onSave, onCancel }: Props) {
  const [bp] = useState(() => {
    if (typeof window === 'undefined') return null;
    return loadState().businessProfile ?? null;
  });

  const [offerNumber, setOfferNumber] = useState(initial?.offerNumber ?? nextOfferNumber);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [offerDate, setOfferDate] = useState(initial?.offerDate ?? todayStr());
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? in30daysStr());
  const [vatRate, setVatRate] = useState(initial?.vatRate ?? bp?.defaultVatRate ?? 24);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? bp?.defaultOfferTerms ?? '');
  const [acceptanceText, setAcceptanceText] = useState(
    initial?.acceptanceText ?? bp?.defaultAcceptanceText ?? 'Αποδέχομαι τους παραπάνω όρους.'
  );
  const [items, setItems] = useState<OfferItem[]>(
    initial?.items?.length ? initial.items : [newItem()]
  );
  const [error, setError] = useState('');

  const totals = calculateTotals(items, vatRate);

  function updateItem(id: string, field: keyof Omit<OfferItem, 'id'>, value: string | number) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function handleSave() {
    if (!offerNumber.trim()) {
      setError('Ο αριθμός προσφοράς είναι υποχρεωτικός.');
      return;
    }
    const validItems = items.filter((i) => i.description.trim() && i.unitPrice > 0);
    if (validItems.length === 0) {
      setError('Προσθέσε τουλάχιστον μία υπηρεσία ή υλικό με περιγραφή και τιμή.');
      return;
    }
    const now = new Date().toISOString();
    const offer: Offer = {
      id: initial?.id ?? crypto.randomUUID(),
      customerId: customerId || undefined,
      offerNumber: offerNumber.trim(),
      status: initial?.status ?? 'draft',
      offerDate,
      validUntil,
      items: validItems,
      subtotal: totals.subtotal,
      vatRate,
      vatAmount: totals.vatAmount,
      total: totals.total,
      notes: notes.trim(),
      terms: terms.trim(),
      acceptanceText: acceptanceText.trim(),
      createdFromAi: initial?.createdFromAi ?? false,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      isDemo: initial?.isDemo,
    };
    onSave(offer);
  }

  const inputCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
  const selectCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white';
  const labelCls = 'mb-1 block text-sm font-medium text-zinc-700';

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">
        {initial ? 'Επεξεργασία προσφοράς' : 'Νέα προσφορά'}
      </h3>

      <div className="flex flex-col gap-4">
        {/* Offer number + customer */}
        <div className="flex gap-3">
          <div className="w-28">
            <label className={labelCls}>Αρ. προσφοράς</label>
            <input
              type="text"
              value={offerNumber}
              onChange={(e) => { setOfferNumber(e.target.value); setError(''); }}
              className={inputCls}
            />
          </div>
          <div className="flex-1">
            <label className={labelCls}>
              Πελάτης{' '}
              <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={selectCls}
            >
              <option value="">— Χωρίς πελάτη —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dates */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Ημερομηνία</label>
            <input type="date" value={offerDate} onChange={(e) => setOfferDate(e.target.value)} className={inputCls} />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Ισχύει μέχρι</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Line items */}
        <div>
          <label className={labelCls}>Υπηρεσίες / Υλικά</label>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.id} className="rounded-xl border border-zinc-200 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">Υπηρεσία {idx + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      className="text-xs text-zinc-400 hover:text-red-500"
                    >
                      Αφαίρεση
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                  placeholder="Περιγραφή υπηρεσίας ή υλικού"
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <div className="w-20">
                    <p className="mb-1 text-xs text-zinc-500">Ποσ.</p>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, 'quantity', Number(e.target.value))}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="mb-1 text-xs text-zinc-500">Τιμή (€)</p>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unitPrice}
                      onChange={(e) => updateItem(item.id, 'unitPrice', Number(e.target.value))}
                      className={inputCls}
                    />
                  </div>
                  <div className="w-24">
                    <p className="mb-1 text-xs text-zinc-500">Σύνολο</p>
                    <div className="flex h-10 items-center rounded-xl bg-zinc-50 px-3 text-sm font-medium text-zinc-700">
                      {fmtEur(lineTotal(item))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, newItem()])}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-700"
          >
            + Προσθήκη υπηρεσίας / υλικού
          </button>
        </div>

        {/* VAT */}
        <div className="flex items-end gap-3">
          <div className="w-28">
            <label className={labelCls}>ΦΠΑ %</label>
            <input
              type="number"
              min={0}
              max={100}
              value={vatRate}
              onChange={(e) => setVatRate(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div className="flex-1 rounded-xl bg-zinc-50 p-3 text-sm space-y-1">
            <div className="flex justify-between text-zinc-500">
              <span>Καθαρή αξία</span>
              <span>{fmtEur(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>ΦΠΑ {vatRate}%</span>
              <span>{fmtEur(totals.vatAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-zinc-900 border-t border-zinc-200 pt-1">
              <span>Σύνολο</span>
              <span>{fmtEur(totals.total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>
            Σημειώσεις{' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Επιπλέον πληροφορίες..."
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Terms */}
        <div>
          <label className={labelCls}>Όροι προσφοράς</label>
          <textarea
            rows={3}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="π.χ. Η παρούσα προσφορά ισχύει για 30 ημέρες."
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Acceptance text */}
        <div>
          <label className={labelCls}>Κείμενο αποδοχής</label>
          <textarea
            rows={2}
            value={acceptanceText}
            onChange={(e) => setAcceptanceText(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Αποθήκευση
          </button>
        </div>
      </div>
    </div>
  );
}
