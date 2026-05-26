'use client';

import { useState, useMemo, useRef } from 'react';
import type { Offer, OfferItem, Customer } from '@/lib/types';
import { loadState } from '@/lib/storage';
import { calculateTotals, lineTotal, fmtEur } from '@/lib/offer-calculations';
import { norm } from '@/lib/search';

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
  initialCustomerId?: string;
  lockCustomer?: boolean;
  requireOfferNumber?: boolean;
}

export default function OfferForm({ initial, customers, nextOfferNumber, onSave, onCancel, initialCustomerId, lockCustomer = false, requireOfferNumber = true }: Props) {
  const [bp] = useState(() => {
    if (typeof window === 'undefined') return null;
    return loadState().businessProfile ?? null;
  });

  const [offerNumber, setOfferNumber] = useState(initial?.offerNumber ?? nextOfferNumber);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? initialCustomerId ?? '');
  const [customerQuery, setCustomerQuery] = useState(() => {
    if (initial?.customerId) return customers.find((c) => c.id === initial.customerId)?.name ?? '';
    if (initialCustomerId) return customers.find((c) => c.id === initialCustomerId)?.name ?? '';
    return '';
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  const filteredCustomers = useMemo(() => {
    const q = norm(customerQuery.trim());
    if (!q) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          norm(c.name).includes(q) ||
          norm(c.companyName ?? '').includes(q) ||
          norm(c.phone).includes(q) ||
          norm(c.email).includes(q)
      )
      .slice(0, 8);
  }, [customers, customerQuery]);

  function selectCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerQuery(c.name);
    setShowDropdown(false);
  }

  function clearCustomer() {
    setCustomerId('');
    setCustomerQuery('');
    setShowDropdown(false);
    customerInputRef.current?.focus();
  }

  function updateItem(id: string, field: keyof Omit<OfferItem, 'id'>, value: string | number) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function handleSave() {
    if (requireOfferNumber && !offerNumber.trim()) {
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
          {lockCustomer ? (
            <div className="flex-1">
              <label className={labelCls}>Πελάτης</label>
              <input
                type="text"
                value={customerQuery}
                disabled
                readOnly
                className={inputCls + ' bg-zinc-50 text-zinc-500 cursor-default'}
              />
            </div>
          ) : (
            <div className="relative flex-1">
              <label className={labelCls}>
                Πελάτης{' '}
                <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
              </label>
              <div className="relative">
                <input
                  ref={customerInputRef}
                  type="text"
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerId('');
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={(e) => {
                    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                      setShowDropdown(false);
                      if (!customerId) setCustomerQuery('');
                    }
                  }}
                  placeholder="Αναζήτηση πελάτη..."
                  className={inputCls + ' pr-8'}
                  autoComplete="off"
                />
                {customerQuery && (
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); clearCustomer(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    tabIndex={-1}
                  >
                    ✕
                  </button>
                )}
              </div>
              {showDropdown && customers.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-md"
                >
                  {!customerId && (
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); clearCustomer(); }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-50"
                    >
                      Χωρίς πελάτη
                    </button>
                  )}
                  {filteredCustomers.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-zinc-400">Δεν βρέθηκαν αποτελέσματα.</p>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                        className={`w-full px-3 py-2 text-left text-sm transition hover:bg-indigo-50 ${
                          c.id === customerId ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-zinc-800'
                        }`}
                      >
                        <span className="block truncate">{c.name}</span>
                        {c.companyName && (
                          <span className="block truncate text-xs text-zinc-400">{c.companyName}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
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
