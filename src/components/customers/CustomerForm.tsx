'use client';

import { useState } from 'react';
import type { Customer, CustomerStatus, CustomerSource, PreferredContactMethod } from '@/lib/types';
import { isLikelyMobile } from '@/lib/phone';
import { STATUS_LABELS } from './CustomerStatusBadge';
import { SOURCE_LABELS } from './CustomerCard';

const CONTACT_LABELS: Record<PreferredContactMethod, string> = {
  viber: 'Viber',
  email: 'Email',
  phone: 'Τηλέφωνο',
};

interface Props {
  initial?: Customer;
  onSave: (customer: Customer) => void;
  onCancel: () => void;
}

export default function CustomerForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '');
  const [mobilePhoneVal, setMobilePhoneVal] = useState(() => {
    if (initial?.mobilePhone) return initial.mobilePhone;
    if (initial?.phone && isLikelyMobile(initial.phone)) return initial.phone;
    return '';
  });
  const [landlinePhoneVal, setLandlinePhoneVal] = useState(() => {
    if (initial?.landlinePhone) return initial.landlinePhone;
    if (initial?.phone && !isLikelyMobile(initial.phone)) return initial.phone;
    return '';
  });
  const [email, setEmail] = useState(initial?.email ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [source, setSource] = useState<CustomerSource>(initial?.source ?? 'manual_entry');
  const [status, setStatus] = useState<CustomerStatus>(initial?.status ?? 'new_lead');
  const [opportunityValue, setOpportunityValue] = useState(
    initial?.opportunityValue?.toString() ?? ''
  );
  const [preferredContact, setPreferredContact] = useState<PreferredContactMethod>(
    initial?.preferredContactMethod ?? 'phone'
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');

  function handleSave() {
    if (!name.trim()) {
      setError('Το όνομα είναι υποχρεωτικό.');
      return;
    }
    const now = new Date().toISOString();
    const resolvedMobile = mobilePhoneVal.trim();
    const resolvedLandline = landlinePhoneVal.trim();
    const resolvedPhone = resolvedMobile || resolvedLandline || initial?.phone || '';
    const customer: Customer = {
      ...(initial ?? {}),
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      companyName: companyName.trim(),
      phone: resolvedPhone,
      mobilePhone: resolvedMobile || undefined,
      landlinePhone: resolvedLandline || undefined,
      email: email.trim(),
      address: address.trim(),
      source,
      status,
      opportunityValue: opportunityValue ? Number(opportunityValue) : undefined,
      preferredContactMethod: preferredContact,
      needsSummary: initial?.needsSummary ?? '',
      notes: notes.trim(),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(customer);
  }

  const inputCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
  const selectCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white';
  const labelCls = 'mb-1 block text-sm font-medium text-zinc-700';

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">
        {initial ? 'Επεξεργασία πελάτη' : 'Νέος πελάτης'}
      </h3>

      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <label className={labelCls}>Όνομα *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="π.χ. Γιώργης Καραγιάννης"
            className={inputCls}
          />
        </div>

        {/* Company */}
        <div>
          <label className={labelCls}>
            Εταιρεία{' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="π.χ. Καραγιάννης ΕΠΕ"
            className={inputCls}
          />
        </div>

        {/* Mobile */}
        <div>
          <label className={labelCls}>
            Κινητό{' '}
            <span className="text-xs font-normal text-zinc-400">(για SMS)</span>
          </label>
          <input
            type="tel"
            value={mobilePhoneVal}
            onChange={(e) => setMobilePhoneVal(e.target.value)}
            placeholder="π.χ. 694 000 0000"
            className={inputCls}
          />
        </div>

        {/* Landline */}
        <div>
          <label className={labelCls}>
            Σταθερό{' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <input
            type="tel"
            value={landlinePhoneVal}
            onChange={(e) => setLandlinePhoneVal(e.target.value)}
            placeholder="π.χ. 210 000 0000"
            className={inputCls}
          />
        </div>

        {/* Email */}
        <div>
          <label className={labelCls}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="π.χ. info@example.gr"
            className={inputCls}
          />
        </div>

        {/* Address */}
        <div>
          <label className={labelCls}>Διεύθυνση</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="π.χ. Αθήνα, Αττική"
            className={inputCls}
          />
        </div>

        {/* Status */}
        <div>
          <label className={labelCls}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CustomerStatus)}
            className={selectCls}
          >
            {(Object.entries(STATUS_LABELS) as [CustomerStatus, string][]).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label className={labelCls}>Πηγή</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as CustomerSource)}
            className={selectCls}
          >
            {(Object.entries(SOURCE_LABELS) as [CustomerSource, string][]).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Opportunity value */}
        <div>
          <label className={labelCls}>
            Εκτιμώμενη αξία (€){' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <input
            type="number"
            min={0}
            value={opportunityValue}
            onChange={(e) => setOpportunityValue(e.target.value)}
            placeholder="π.χ. 1500"
            className={inputCls}
          />
        </div>

        {/* Preferred contact */}
        <div>
          <label className={labelCls}>Προτιμώμενη επικοινωνία</label>
          <select
            value={preferredContact}
            onChange={(e) => setPreferredContact(e.target.value as PreferredContactMethod)}
            className={selectCls}
          >
            {(Object.entries(CONTACT_LABELS) as [PreferredContactMethod, string][]).map(
              ([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Σημειώσεις</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Σημειώσεις για αυτόν τον πελάτη..."
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
