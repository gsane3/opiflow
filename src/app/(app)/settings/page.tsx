'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { getBusinessProfile, saveBusinessProfile } from '@/lib/storage';
import type { BusinessProfile } from '@/lib/types';
import BusinessForm from '@/components/settings/BusinessForm';
import ImportExportPanel from '@/components/settings/ImportExportPanel';
import AccountPanel from '@/components/settings/AccountPanel';
import TelephonyPanel from '@/components/settings/TelephonyPanel';

type SettingsSection = 'business' | 'providers' | 'data' | 'account';

type BusinessMeResponse = {
  ok?: boolean;
  business?: {
    business_phone_number?: string | null;
    name?: string | null;
    type?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    vat_number?: string | null;
    tax_office?: string | null;
    default_vat_rate?: number | null;
    default_offer_terms?: string | null;
    default_acceptance_text?: string | null;
    preferred_contact_method?: string | null;
    legal_name?: string | null;
    trade_name?: string | null;
    owner_first_name?: string | null;
    owner_last_name?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    postal_code?: string | null;
    region?: string | null;
    website?: string | null;
  };
  phoneAssigned?: boolean;
  activationAllowed?: boolean;
  subscription?: {
    plan_key: string;
    status: string;
    trial_ends_at: string | null;
  } | null;
  error?: string;
};

const SECTION_LABELS: Record<SettingsSection, string> = {
  business: 'Επιχείρηση',
  providers: 'Πάροχοι',
  data: 'Δεδομένα',
  account: 'Λογαριασμός',
};

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  team: 'Team',
};

function subStatusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'pending_manual_review':
      return { label: 'Αναμένει ενεργοποίηση', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
    case 'trialing':
      return { label: 'Δοκιμαστική περίοδος', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' };
    case 'active':
      return { label: 'Ενεργή', cls: 'bg-green-50 text-green-700 ring-green-200' };
    case 'cancelled':
      return { label: 'Ακυρώθηκε', cls: 'bg-zinc-100 text-zinc-600 ring-zinc-200' };
    default:
      return { label: status, cls: 'bg-zinc-100 text-zinc-600 ring-zinc-200' };
  }
}

function fmtSubDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function defaultProfile(): BusinessProfile {
  return {
    id: crypto.randomUUID(),
    businessName: '',
    businessType: 'technical_services',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    legalName: '',
    tradeName: '',
    ownerFirstName: '',
    ownerLastName: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    region: '',
    website: '',
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
  const [phoneInfo, setPhoneInfo] = useState<BusinessMeResponse | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(true);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPhone() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setPhoneLoading(false);
          return;
        }
        const resp = await fetch('/api/businesses/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (resp.ok) {
          const data: BusinessMeResponse = await resp.json();
          setPhoneInfo(data);
          // Hydrate profile from DB. Uses functional update so ownerName and
          // logoDataUrl (localStorage-only) are preserved regardless of whether
          // localStorage hydration has already run.
          if (data.ok && data.business) {
            const biz = data.business;
            const validTypes = ['technical_services', 'sales_services', 'projects_construction', 'other'] as const;
            const validContact = ['viber', 'email', 'phone'] as const;
            setProfile((current) => ({
              ...current,
              businessName:          typeof biz.name === 'string'                  ? biz.name                                              : current.businessName,
              businessType:          (validTypes as readonly string[]).includes(biz.type ?? '') ? (biz.type as BusinessProfile['businessType']) : current.businessType,
              phone:                 biz.phone                 !== undefined        ? (biz.phone ?? '')                                     : current.phone,
              email:                 biz.email                 !== undefined        ? (biz.email ?? '')                                     : current.email,
              address:               biz.address               !== undefined        ? (biz.address ?? '')                                   : current.address,
              city:                  biz.city                  !== undefined        ? (biz.city ?? '')                                      : current.city,
              vatNumber:             biz.vat_number            !== undefined        ? (biz.vat_number ?? '')                                : current.vatNumber,
              taxOffice:             biz.tax_office            !== undefined        ? (biz.tax_office ?? '')                                : current.taxOffice,
              defaultVatRate:        typeof biz.default_vat_rate === 'number'       ? biz.default_vat_rate                                  : current.defaultVatRate,
              defaultOfferTerms:     biz.default_offer_terms   !== undefined        ? (biz.default_offer_terms ?? '')                       : current.defaultOfferTerms,
              defaultAcceptanceText: biz.default_acceptance_text !== undefined      ? (biz.default_acceptance_text ?? current.defaultAcceptanceText) : current.defaultAcceptanceText,
              preferredContactMethod: (validContact as readonly string[]).includes(biz.preferred_contact_method ?? '') ? (biz.preferred_contact_method as BusinessProfile['preferredContactMethod']) : current.preferredContactMethod,
              legalName:      biz.legal_name       !== undefined ? (biz.legal_name       ?? (typeof biz.name === 'string' ? biz.name : '')) : current.legalName,
              tradeName:      biz.trade_name       !== undefined ? (biz.trade_name       ?? '')                                               : current.tradeName,
              ownerFirstName: biz.owner_first_name !== undefined ? (biz.owner_first_name ?? '')                                               : current.ownerFirstName,
              ownerLastName:  biz.owner_last_name  !== undefined ? (biz.owner_last_name  ?? '')                                               : current.ownerLastName,
              addressLine1:   biz.address_line1    !== undefined ? (biz.address_line1    ?? (biz.address !== undefined ? (biz.address ?? '') : '')) : current.addressLine1,
              addressLine2:   biz.address_line2    !== undefined ? (biz.address_line2    ?? '')                                               : current.addressLine2,
              postalCode:     biz.postal_code      !== undefined ? (biz.postal_code      ?? '')                                               : current.postalCode,
              region:         biz.region           !== undefined ? (biz.region           ?? '')                                               : current.region,
              website:        biz.website          !== undefined ? (biz.website          ?? '')                                               : current.website,
              // ownerName: kept from localStorage (no DB column).
              // logoDataUrl: kept from localStorage (logo storage deferred).
            }));
          }
        } else {
          setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
        }
      } catch {
        setPhoneError('Δεν μπορέσαμε να ελέγξουμε τον αριθμό αυτή τη στιγμή.');
      } finally {
        setPhoneLoading(false);
      }
    }
    fetchPhone();
  }, []);

  useEffect(() => {
    const stored = getBusinessProfile();
    const nextProfile = stored ?? defaultProfile();
    const timer = window.setTimeout(() => {
      setProfile(nextProfile);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSave() {
    setSaveError(null);

    let accessToken: string | null = null;
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token ?? null;
    } catch {
      setSaveError('Δεν αποθηκεύτηκαν τα στοιχεία. Δοκίμασε ξανά.');
      return;
    }

    if (!accessToken) {
      setSaveError('Πρέπει να είσαι συνδεδεμένος για να αποθηκεύσεις.');
      return;
    }

    try {
      const resp = await fetch('/api/businesses/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name:                     profile.businessName,
          type:                     profile.businessType,
          phone:                    profile.phone       || null,
          email:                    profile.email       || null,
          address:                  profile.address     || null,
          city:                     profile.city        || null,
          vat_number:               profile.vatNumber   || null,
          tax_office:               profile.taxOffice   || null,
          default_vat_rate:         profile.defaultVatRate,
          default_offer_terms:      profile.defaultOfferTerms      || null,
          default_acceptance_text:  profile.defaultAcceptanceText  || null,
          preferred_contact_method: profile.preferredContactMethod,
          legal_name:               profile.legalName        || null,
          trade_name:               profile.tradeName        || null,
          owner_first_name:         profile.ownerFirstName   || null,
          owner_last_name:          profile.ownerLastName    || null,
          address_line1:            profile.addressLine1     || null,
          address_line2:            profile.addressLine2     || null,
          postal_code:              profile.postalCode       || null,
          region:                   profile.region           || null,
          website:                  profile.website          || null,
        }),
      });

      if (!resp.ok) {
        setSaveError('Δεν αποθηκεύτηκαν τα στοιχεία. Δοκίμασε ξανά.');
        return;
      }

      // Update localStorage cache after successful DB save.
      saveBusinessProfile({ ...profile, updatedAt: new Date().toISOString() });
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Δεν αποθηκεύτηκαν τα στοιχεία. Δοκίμασε ξανά.');
    }
  }

  // Render helpers (not components, no hooks)

  function renderBusiness() {
    return (
      <div className="space-y-6">
        <BusinessForm profile={profile} onChange={setProfile} onSave={handleSave} saved={saved} />
        {saveError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
            <p className="text-sm text-red-700">{saveError}</p>
          </div>
        )}
      </div>
    );
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

  function renderData() {
    return <ImportExportPanel />;
  }

  function renderAccount() {
    return <AccountPanel />;
  }

  // Settings content

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">Λογαριασμός</p>
        <h1 className="mb-6 text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Φόρτωση ρυθμίσεων...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
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
              {
                id: 'data' as SettingsSection,
                label: 'Δεδομένα',
                subtitle: 'Εισαγωγή & εξαγωγή πελατών (CSV)',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'account' as SettingsSection,
                label: 'Λογαριασμός',
                subtitle: 'Συνδρομή & διαγραφή λογαριασμού',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
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

          {/* Subscription card */}
          <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
            <p className="mb-2 text-sm font-semibold text-zinc-900">Συνδρομή</p>
            {phoneLoading ? (
              <p className="text-xs text-zinc-400">Φόρτωση...</p>
            ) : phoneInfo?.subscription ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800">
                    {PLAN_NAMES[phoneInfo.subscription.plan_key] ?? phoneInfo.subscription.plan_key}
                  </span>
                  {(() => {
                    const pill = subStatusPill(phoneInfo.subscription.status);
                    return (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${pill.cls}`}>
                        {pill.label}
                      </span>
                    );
                  })()}
                </div>
                {phoneInfo.subscription.trial_ends_at && (
                  <p className="text-xs text-zinc-500">
                    Λήγει: {fmtSubDate(phoneInfo.subscription.trial_ends_at)}
                  </p>
                )}
                {phoneInfo.activationAllowed === false && (
                  <p className="text-xs text-amber-700">
                    Επικοινώνησε με την υποστήριξη για ενεργοποίηση.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">Δεν βρέθηκε ενεργή συνδρομή.</p>
            )}
          </div>

          {/* Phone line card */}
          <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">Ο αριθμός σου</p>
                {phoneLoading ? (
                  <p className="mt-0.5 text-xs text-zinc-400">Έλεγχος γραμμής...</p>
                ) : phoneError ? (
                  <p className="mt-0.5 text-xs text-red-600">{phoneError}</p>
                ) : phoneInfo?.business?.business_phone_number ? (
                  <>
                    <p className="mt-0.5 text-base font-semibold text-zinc-900">
                      {phoneInfo.business.business_phone_number}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Ο αριθμός ενεργοποιείται αυτόματα από το Opiflow. Δεν χρειάζεται χειροκίνητη ρύθμιση.
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Ο αριθμός ενεργοποιείται αυτόματα από το Opiflow. Δεν χρειάζεται χειροκίνητη ρύθμιση.
                  </p>
                )}
              </div>
              {!phoneLoading && !phoneError && (
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  phoneInfo?.phoneAssigned
                    ? 'bg-green-50 text-green-700 ring-green-200'
                    : 'bg-amber-50 text-amber-700 ring-amber-200'
                }`}>
                  {phoneInfo?.phoneAssigned ? 'Ενεργός' : 'Σε αναμονή'}
                </span>
              )}
            </div>
          </div>

          {/* Telephony: availability + A/B onboarding model (keep own number / Opiflow number) */}
          <TelephonyPanel businessPhoneNumber={phoneInfo?.business?.business_phone_number ?? null} />
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
          {activeSection === 'data' && renderData()}
          {activeSection === 'account' && renderAccount()}
        </>
      )}
    </div>
  );
}
