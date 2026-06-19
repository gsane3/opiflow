'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { getBusinessProfile, saveBusinessProfile } from '@/lib/storage';
import type { BusinessProfile } from '@/lib/types';
import BusinessForm from '@/components/settings/BusinessForm';
import ImportExportPanel from '@/components/settings/ImportExportPanel';
import SnippetsPanel from '@/components/settings/SnippetsPanel';
import AutomationsPanel from '@/components/settings/AutomationsPanel';
import AccountPanel from '@/components/settings/AccountPanel';
import TelephonyPanel from '@/components/settings/TelephonyPanel';
import NotificationsPanel from '@/components/settings/NotificationsPanel';
import NativeCallTestPanel from '@/components/settings/NativeCallTestPanel';
import SystemStatusCard from '@/components/settings/SystemStatusCard';
import TeamPanel from '@/components/settings/TeamPanel';
import ServiceCatalogPanel from '@/components/settings/ServiceCatalogPanel';
import AppearancePanel from '@/components/settings/AppearancePanel';
import BankPanel from '@/components/settings/BankPanel';

type SettingsSection = 'business' | 'telephony' | 'appearance' | 'catalog' | 'bank' | 'snippets' | 'automations' | 'data' | 'account' | 'notifications';

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
    facebook_url?: string | null;
    instagram_url?: string | null;
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
  telephony: 'Τηλεφωνία',
  appearance: 'Εμφάνιση',
  catalog: 'Κατάλογος υπηρεσιών',
  bank: 'Τραπεζικά στοιχεία',
  snippets: 'Πρότυπα μηνυμάτων',
  automations: 'Ωράριο & αυτοματισμοί',
  data: 'Δεδομένα',
  account: 'Λογαριασμός',
  notifications: 'Ειδοποιήσεις',
};

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  team: 'Team',
};

// B4 — settings organised into logical categories (was a flat 10-item list).
type SettingsGroup = 'Η επιχείρησή σου' | 'Επικοινωνία με πελάτες' | 'Εφαρμογή' | 'Λογαριασμός';
const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['Η επιχείρησή σου', 'Επικοινωνία με πελάτες', 'Εφαρμογή', 'Λογαριασμός'];

interface SectionMeta { id: SettingsSection; label: string; subtitle: string; group: SettingsGroup; icon: React.ReactNode }

const SECTION_ICON = (path: string) => (
  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

const SETTINGS_SECTIONS: SectionMeta[] = [
  { id: 'business', label: 'Επιχείρηση', subtitle: 'Στοιχεία και προτιμήσεις επιχείρησης', group: 'Η επιχείρησή σου',
    icon: SECTION_ICON('M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21') },
  { id: 'bank', label: 'Τραπεζικά στοιχεία', subtitle: 'IBAN & δικαιούχος για καταθέσεις πελατών', group: 'Η επιχείρησή σου',
    icon: SECTION_ICON('M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z') },
  { id: 'catalog', label: 'Κατάλογος υπηρεσιών', subtitle: 'Υπηρεσίες & υλικά με τιμές για προσφορές', group: 'Η επιχείρησή σου',
    icon: SECTION_ICON('M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5') },
  { id: 'telephony', label: 'Τηλεφωνία', subtitle: 'Αριθμός, σύνδεση & ηχογράφηση κλήσεων', group: 'Επικοινωνία με πελάτες',
    icon: SECTION_ICON('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z') },
  { id: 'snippets', label: 'Πρότυπα μηνυμάτων', subtitle: 'Έτοιμες απαντήσεις με ένα tap στη συνομιλία', group: 'Επικοινωνία με πελάτες',
    icon: SECTION_ICON('M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z') },
  { id: 'automations', label: 'Ωράριο & αυτοματισμοί', subtitle: 'Ωράριο, αυτόματη απάντηση, εβδομαδιαία σύνοψη', group: 'Επικοινωνία με πελάτες',
    icon: SECTION_ICON('M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z') },
  { id: 'notifications', label: 'Ειδοποιήσεις', subtitle: 'Push ειδοποιήσεις & δοκιμή', group: 'Επικοινωνία με πελάτες',
    icon: SECTION_ICON('M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0') },
  { id: 'appearance', label: 'Εμφάνιση', subtitle: 'Σκούρο θέμα', group: 'Εφαρμογή',
    icon: SECTION_ICON('M21.752 15.002A9.718 9.718 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z') },
  { id: 'data', label: 'Δεδομένα', subtitle: 'Εισαγωγή & εξαγωγή πελατών (CSV)', group: 'Εφαρμογή',
    icon: SECTION_ICON('M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75') },
  { id: 'account', label: 'Λογαριασμός', subtitle: 'Συνδρομή, ομάδα & διαγραφή λογαριασμού', group: 'Λογαριασμός',
    icon: SECTION_ICON('M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z') },
];

// Category cards for the top-level settings hub (item 3 drill-in).
const GROUP_META: Record<SettingsGroup, { subtitle: string; icon: React.ReactNode }> = {
  'Η επιχείρησή σου': {
    subtitle: 'Επιχείρηση, τραπεζικά, κατάλογος',
    icon: SECTION_ICON('M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21'),
  },
  'Επικοινωνία με πελάτες': {
    subtitle: 'Τηλεφωνία, πρότυπα, ωράριο, ειδοποιήσεις',
    icon: SECTION_ICON('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z'),
  },
  'Εφαρμογή': {
    subtitle: 'Εμφάνιση, δεδομένα & επαφές',
    icon: SECTION_ICON('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'),
  },
  'Λογαριασμός': {
    subtitle: 'Συνδρομή, ομάδα & διαγραφή',
    icon: SECTION_ICON('M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z'),
  },
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
      return { label: 'Ακυρώθηκε', cls: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-[#1e2b38] dark:text-zinc-300 dark:ring-white/10' };
    default:
      return { label: status, cls: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-[#1e2b38] dark:text-zinc-300 dark:ring-white/10' };
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
    facebookUrl: '',
    instagramUrl: '',
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
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile>(defaultProfile);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
  // Item 3 — clean drill-in: tap a CATEGORY → see its settings → tap a setting →
  // open. activeGroup is the middle level; activeSection is the open detail.
  const [activeGroup, setActiveGroup] = useState<SettingsGroup | null>(null);
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
              facebookUrl:    biz.facebook_url     !== undefined ? (biz.facebook_url     ?? '')                                               : current.facebookUrl,
              instagramUrl:   biz.instagram_url    !== undefined ? (biz.instagram_url    ?? '')                                               : current.instagramUrl,
              // Logo is now persisted to businesses.logo_url — the DB is the
              // source of truth (shown on the public offer/intake/appointment pages).
              logoDataUrl: (biz as { logo_url?: string | null }).logo_url !== undefined
                ? ((biz as { logo_url?: string | null }).logo_url ?? '')
                : current.logoDataUrl,
              // ownerName: kept from localStorage (no DB column).
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
          facebook_url:             profile.facebookUrl      || null,
          instagram_url:            profile.instagramUrl     || null,
          logoDataUrl:              profile.logoDataUrl      || null,
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

  async function handleLogout() {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
    } catch {
      // silently continue to login
    }
    router.push('/login');
  }

  // Render helpers (not components, no hooks)

  function renderBusiness() {
    return (
      <div className="space-y-6">
        <BusinessForm profile={profile} onChange={setProfile} onSave={handleSave} saved={saved} />
        {saveError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200 dark:bg-red-950/40 dark:ring-red-900/40">
            <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
          </div>
        )}
      </div>
    );
  }

  function renderData() {
    return <ImportExportPanel />;
  }

  function renderCatalog() {
    return <ServiceCatalogPanel />;
  }

  function renderSnippets() {
    return <SnippetsPanel />;
  }

  function renderAutomations() {
    return <AutomationsPanel />;
  }

  function renderNotifications() {
    return <NotificationsPanel />;
  }

  function renderTelephony() {
    return (
      <div className="space-y-4">
        {/* Phone line */}
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ο αριθμός σου</p>
              {phoneLoading ? (
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Έλεγχος γραμμής...</p>
              ) : phoneError ? (
                <p className="mt-0.5 text-xs text-red-600">{phoneError}</p>
              ) : phoneInfo?.business?.business_phone_number ? (
                <>
                  <p className="mt-0.5 text-base font-semibold text-zinc-900 dark:text-zinc-100">{phoneInfo.business.business_phone_number}</p>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Ο αριθμός ενεργοποιείται αυτόματα από το Opiflow. Δεν χρειάζεται χειροκίνητη ρύθμιση.</p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Ο αριθμός ενεργοποιείται αυτόματα από το Opiflow. Δεν χρειάζεται χειροκίνητη ρύθμιση.</p>
              )}
            </div>
            {!phoneLoading && !phoneError && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${phoneInfo?.phoneAssigned ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
                {phoneInfo?.phoneAssigned ? 'Ενεργός' : 'Σε αναμονή'}
              </span>
            )}
          </div>
        </div>
        <TelephonyPanel businessPhoneNumber={phoneInfo?.business?.business_phone_number ?? null} />
        <NativeCallTestPanel />
      </div>
    );
  }

  function renderAccount() {
    return (
      <div className="space-y-4">
        {/* Subscription */}
        <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
          <p className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Συνδρομή</p>
          {phoneLoading ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση...</p>
          ) : phoneInfo?.subscription ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{PLAN_NAMES[phoneInfo.subscription.plan_key] ?? phoneInfo.subscription.plan_key}</span>
                {(() => {
                  const pill = subStatusPill(phoneInfo.subscription!.status);
                  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${pill.cls}`}>{pill.label}</span>;
                })()}
              </div>
              {phoneInfo.subscription.trial_ends_at && <p className="text-xs text-zinc-500 dark:text-zinc-400">Λήγει: {fmtSubDate(phoneInfo.subscription.trial_ends_at)}</p>}
              {phoneInfo.activationAllowed === false && <p className="text-xs text-amber-700">Επικοινώνησε με την υποστήριξη για ενεργοποίηση.</p>}
            </div>
          ) : (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Δεν βρέθηκε ενεργή συνδρομή.</p>
          )}
        </div>
        <AccountPanel />
        <TeamPanel />
        <SystemStatusCard />
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-[28px] bg-white px-5 py-3.5 text-sm font-semibold text-red-600 shadow-sm ring-1 ring-zinc-200/60 transition active:bg-red-50 dark:bg-[#17232f] dark:ring-white/10"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
          </svg>
          Αποσύνδεση
        </button>
      </div>
    );
  }

  // Settings content

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Λογαριασμός</p>
        <h1 className="mb-6 text-xl font-bold text-zinc-900 dark:text-zinc-100">Ρυθμίσεις</h1>
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">Φόρτωση ρυθμίσεων...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-6 pb-28 md:max-w-2xl md:px-8">
      {activeSection === null ? (
        activeGroup === null ? (
          /* ── Level 1: category hub ── */
          <>
            <div className="mb-6">
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Λογαριασμός</p>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Ρυθμίσεις</h1>
            </div>
            <div className="space-y-2">
              {SETTINGS_GROUP_ORDER.map((group) => {
                const count = SETTINGS_SECTIONS.filter((s) => s.group === group).length;
                if (count === 0) return null;
                const meta = GROUP_META[group];
                return (
                  <button
                    key={group}
                    type="button"
                    onClick={() => setActiveGroup(group)}
                    className="flex w-full items-center gap-4 rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:ring-indigo-200 active:bg-zinc-50 dark:bg-[#17232f] dark:ring-white/10 dark:active:bg-white/5"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50">{meta.icon}</div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{group}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{meta.subtitle}</p>
                    </div>
                    <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                );
              })}
            </div>

            {/* Στατιστικά — opens the analytics page */}
            <div className="mt-6 border-t border-zinc-200/60 pt-6 dark:border-white/10">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Επισκόπηση</p>
              <button
                type="button"
                onClick={() => router.push('/stats')}
                className="flex w-full items-center gap-4 rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:ring-indigo-200 active:bg-zinc-50 dark:bg-[#17232f] dark:ring-white/10 dark:active:bg-white/5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50">
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Στατιστικά</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Τζίρος, win rate, πελάτες ανά κατάσταση</p>
                </div>
                <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          /* ── Level 2: a category's settings ── */
          <div key={activeGroup} className="motion-safe:animate-[fadeIn_0.2s]">
            <div className="mb-6">
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                className="mb-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
                Ρυθμίσεις
              </button>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{activeGroup}</h1>
            </div>
            <div className="space-y-2">
              {SETTINGS_SECTIONS.filter((s) => s.group === activeGroup).map(({ id, label, subtitle, icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id)}
                  className="flex w-full items-center gap-4 rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:ring-indigo-200 active:bg-zinc-50 dark:bg-[#17232f] dark:ring-white/10 dark:active:bg-white/5"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50">{icon}</div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )
      ) : (
        <div key={activeSection ?? 'hub'} className="motion-safe:animate-[fadeIn_0.2s]">
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setActiveSection(null)}
              className="mb-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              {activeGroup ?? 'Ρυθμίσεις'}
            </button>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{SECTION_LABELS[activeSection]}</h1>
          </div>
          {activeSection === 'business' && renderBusiness()}
          {activeSection === 'telephony' && renderTelephony()}
          {activeSection === 'appearance' && <AppearancePanel />}
          {activeSection === 'catalog' && renderCatalog()}
          {activeSection === 'bank' && <BankPanel />}
          {activeSection === 'snippets' && renderSnippets()}
          {activeSection === 'automations' && renderAutomations()}
          {activeSection === 'data' && renderData()}
          {activeSection === 'account' && renderAccount()}
          {activeSection === 'notifications' && renderNotifications()}
        </div>
      )}
    </div>
  );
}
