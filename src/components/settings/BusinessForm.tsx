'use client';

import { useRef, type ChangeEvent } from 'react';
import Image from 'next/image';
import type { BusinessProfile, BusinessType } from '@/lib/types';

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'technical_services', label: 'Τεχνικές υπηρεσίες' },
  { value: 'sales_services', label: 'Εμπορικές υπηρεσίες' },
  { value: 'projects_construction', label: 'Κατασκευές / έργα' },
  { value: 'other', label: 'Άλλο' },
];

const CONTACT_METHODS: { value: BusinessProfile['preferredContactMethod']; label: string }[] = [
  { value: 'viber', label: 'Viber' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Τηλέφωνο' },
];

const VAT_RATES = [0, 6, 13, 17, 24];

interface Props {
  profile: BusinessProfile;
  onChange: (profile: BusinessProfile) => void;
  onSave: () => void;
  saved: boolean;
}

const labelCls = 'block text-sm font-medium text-zinc-700 mb-1';
const inputCls =
  'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200';
const selectCls = inputCls + ' cursor-pointer';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export default function BusinessForm({ profile, onChange, onSave, saved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    onChange({ ...profile, [key]: value });
  }

  function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      set('logoDataUrl', reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="space-y-8">
      {/* 1. Business settings */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-zinc-900">Στοιχεία επιχείρησης</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Επωνυμία">
            <input
              className={inputCls}
              value={profile.businessName}
              onChange={(e) => set('businessName', e.target.value)}
              placeholder="π.χ. Τεχνική Σάνε"
            />
          </Field>
          <Field label="Όνομα ιδιοκτήτη">
            <input
              className={inputCls}
              value={profile.ownerName}
              onChange={(e) => set('ownerName', e.target.value)}
              placeholder="π.χ. Γιώργος Σανές"
            />
          </Field>
          <Field label="Τηλέφωνο">
            <input
              className={inputCls}
              type="tel"
              value={profile.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="π.χ. 6912345678"
            />
          </Field>
          <Field label="Email">
            <input
              className={inputCls}
              type="email"
              value={profile.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="π.χ. info@example.gr"
            />
          </Field>
          <Field label="Διεύθυνση">
            <input
              className={inputCls}
              value={profile.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="π.χ. Λεωφ. Βικέλα 30, Θεσσαλονίκη"
            />
          </Field>
          <Field label="Τύπος επιχείρησης">
            <select
              className={selectCls}
              value={profile.businessType}
              onChange={(e) => set('businessType', e.target.value as BusinessType)}
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ΑΦΜ">
            <input
              className={inputCls}
              value={profile.vatNumber}
              onChange={(e) => set('vatNumber', e.target.value)}
              placeholder="π.χ. 123456789"
            />
          </Field>
          <Field label="ΔΟΥ">
            <input
              className={inputCls}
              value={profile.taxOffice}
              onChange={(e) => set('taxOffice', e.target.value)}
              placeholder="π.χ. Δ΄ Θεσσαλονίκης"
            />
          </Field>
        </div>
      </section>

      {/* 2. Logo */}
      <section>
        <h2 className="mb-1 text-base font-semibold text-zinc-900">Λογότυπο</h2>
        <p className="mb-4 text-xs text-zinc-400">
          Το λογότυπο αποθηκεύεται μόνο στον browser σας. Δεν ανεβαίνει πουθενά.
        </p>
        <div className="flex items-start gap-4">
          {profile.logoDataUrl ? (
            <Image
              src={profile.logoDataUrl}
              alt="Λογότυπο"
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 rounded-xl border border-zinc-200 object-contain"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-xs text-zinc-400">
              Χωρίς
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {profile.logoDataUrl ? 'Αλλαγή' : 'Επιλογή αρχείου'}
            </button>
            {profile.logoDataUrl && (
              <button
                type="button"
                onClick={() => set('logoDataUrl', '')}
                className="rounded-xl border border-red-100 bg-red-50 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100"
              >
                Διαγραφή λογοτύπου
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>
        </div>
      </section>

      {/* 3. Offer settings */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-zinc-900">Ρυθμίσεις προσφορών</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Προεπιλεγμένος ΦΠΑ (%)">
            <select
              className={selectCls}
              value={profile.defaultVatRate}
              onChange={(e) => set('defaultVatRate', Number(e.target.value))}
            >
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Προεπιλεγμένοι όροι προσφοράς">
              <textarea
                className={inputCls + ' resize-none'}
                rows={3}
                value={profile.defaultOfferTerms}
                onChange={(e) => set('defaultOfferTerms', e.target.value)}
                placeholder="π.χ. Η παρούσα προσφορά ισχύει για 30 ημέρες από την ημερομηνία έκδοσης."
              />
            </Field>
          </div>
        </div>
      </section>

      {/* 4. Communication defaults */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-zinc-900">Προεπιλεγμένη επικοινωνία</h2>
        <Field label="Προτιμώμενος τρόπος επικοινωνίας">
          <div className="flex flex-wrap gap-2 mt-1">
            {CONTACT_METHODS.map((m) => {
              const active = profile.preferredContactMethod === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('preferredContactMethod', m.value)}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                    active
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </Field>
      </section>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:bg-indigo-800"
        >
          Αποθήκευση
        </button>
        {saved && (
          <span className="text-sm text-emerald-600">Αποθηκεύτηκε.</span>
        )}
      </div>
    </div>
  );
}
