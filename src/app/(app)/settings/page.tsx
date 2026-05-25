'use client';

import { useState, useEffect } from 'react';
import { getBusinessProfile, saveBusinessProfile } from '@/lib/storage';
import type { BusinessProfile } from '@/lib/types';
import BusinessForm from '@/components/settings/BusinessForm';

type SettingsSection = 'business' | 'providers';

const SECTION_LABELS: Record<SettingsSection, string> = {
  business: 'Επιχείρηση',
  providers: 'Πάροχοι',
};

function defaultProfile(): BusinessProfile {
  return {
    id: crypto.randomUUID(),
    businessName: '',
    businessType: 'technical_services',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    vatNumber: '',
    taxOffice: '',
    logoDataUrl: '',
    defaultVatRate: 24,
    defaultOfferTerms: '',
    defaultAcceptanceText: 'Αποδέχομαι τους παραπάνω όρους.',
    preferredContactMethod: 'viber',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function SettingsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile>(defaultProfile);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);

  useEffect(() => {
    const stored = getBusinessProfile();
    const nextProfile = stored ?? defaultProfile();
    const timer = window.setTimeout(() => {
      setProfile(nextProfile);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function handleSave() {
    saveBusinessProfile({ ...profile, updatedAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Render helpers (not components, no hooks)

  function renderBusiness() {
    return <BusinessForm profile={profile} onChange={setProfile} onSave={handleSave} saved={saved} />;
  }

  function renderProviders() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Πάροχοι επικοινωνίας</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Οι επικοινωνίες γίνονται με native συνδέσμους (tel:, sms:) και αντιγραφή κειμένου.
            Αυτόματη αποστολή μέσω παρόχου δεν είναι ακόμα ενεργοποιημένη.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { label: 'Τηλεφωνία', desc: 'Ανοίγει την εφαρμογή κλήσεων της συσκευής.' },
            { label: 'SMS', desc: 'Ανοίγει την εφαρμογή SMS της συσκευής.' },
            { label: 'Viber', desc: 'Αντιγραφή κειμένου για αποστολή από Viber.' },
            { label: 'Email', desc: 'Αντιγραφή draft για αποστολή από email client.' },
          ].map(p => (
            <div key={p.label} className="rounded-[28px] bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200/60 space-y-1">
              <p className="text-sm font-medium text-zinc-800">{p.label}</p>
              <p className="text-xs text-zinc-400">{p.desc}</p>
            </div>
          ))}
        </div>

        <div className="rounded-[28px] bg-white px-4 py-3 text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-200/60 space-y-1">
          <p>Σήμερα, η αποστολή email λειτουργεί μόνο όταν είναι ρυθμισμένο το υπάρχον email endpoint. Αν δεν είναι ρυθμισμένο, χρησιμοποιείς αντιγραφή email draft και αποστολή από το δικό σου email client.</p>
          <p>Η αποστολή από δικό σου επαγγελματικό domain είναι μελλοντική λειτουργία.</p>
        </div>

        <div className="space-y-3 border-t border-zinc-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Σύντομα</p>
          {[
            {
              label: 'Επαγγελματικός αριθμός',
              desc: 'Αγορά επαγγελματικού αριθμού, προώθηση κλήσεων και αυτόματος εντοπισμός χαμένων κλήσεων.',
              helper: 'Απαιτεί cloud backend και σύνδεση με VoIP provider.',
            },
            {
              label: 'Αποστολή email από τον τομέα σου',
              desc: 'Επαλήθευση τομέα για αποστολή προσφορών και ραντεβού από τη δική σου επαγγελματική διεύθυνση.',
              helper: 'Σήμερα η αποστολή γίνεται μόνο όταν είναι ρυθμισμένο το υπάρχον email endpoint.',
            },
            {
              label: 'Πηγές leads',
              desc: 'Σύνδεση Meta, Google, TikTok και φόρμας ιστότοπου για αυτόματη εισαγωγή leads στο CRM.',
              helper: 'Απαιτεί cloud backend και σύνδεση με API κάθε πλατφόρμας.',
            },
          ].map(p => (
            <div key={p.label} className="rounded-[28px] bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200/60 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800">{p.label}</span>
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">Σύντομα</span>
              </div>
              <p className="text-xs text-zinc-400">{p.desc}</p>
              <p className="text-xs text-zinc-300">{p.helper}</p>
            </div>
          ))}
        </div>

      </div>
    );
  }

  // Settings content

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-md px-5 pt-6 pb-28">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">Λογαριασμός</p>
        <h1 className="mb-6 text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Φόρτωση ρυθμίσεων...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pt-6 pb-28">
      {activeSection === null ? (
        <>
          <div className="mb-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">Λογαριασμός</p>
            <h1 className="text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
          </div>
          <div className="space-y-2">
            {([
              {
                id: 'business' as SettingsSection,
                label: 'Επιχείρηση',
                subtitle: 'Στοιχεία και προτιμήσεις επιχείρησης',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'providers' as SettingsSection,
                label: 'Πάροχοι',
                subtitle: 'Επικοινωνία και μελλοντικοί πάροχοι',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
            ] as Array<{ id: SettingsSection; label: string; subtitle: string; icon: React.ReactNode; bg: string; danger?: boolean }>).map(({ id, label, subtitle, icon, bg, danger }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`flex w-full items-center gap-4 rounded-[28px] bg-white p-4 shadow-sm ring-1 transition active:bg-zinc-50 ${
                  danger ? 'ring-red-100 hover:ring-red-200' : 'ring-zinc-200/60 hover:ring-indigo-200'
                }`}
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                  {icon}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className={`text-sm font-semibold ${danger ? 'text-red-700' : 'text-zinc-900'}`}>{label}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
                </div>
                <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setActiveSection(null)}
              className="mb-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Ρυθμίσεις
            </button>
            <h1 className="text-xl font-bold text-zinc-900">{SECTION_LABELS[activeSection]}</h1>
          </div>
          {activeSection === 'business' && renderBusiness()}
          {activeSection === 'providers' && renderProviders()}
        </>
      )}
    </div>
  );
}
