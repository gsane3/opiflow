'use client';

import { useState } from 'react';
import { getBusinessProfile, saveBusinessProfile } from '@/lib/storage';
import type { BusinessProfile } from '@/lib/types';
import BusinessForm from '@/components/settings/BusinessForm';
import MockWorkspacePanel from '@/components/settings/MockWorkspacePanel';
import MockCrmPanel from '@/components/settings/MockCrmPanel';

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

function initProfile(): BusinessProfile {
  if (typeof window === 'undefined') return defaultProfile();
  return getBusinessProfile() ?? defaultProfile();
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<BusinessProfile>(initProfile);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    saveBusinessProfile({ ...profile, updatedAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
        <p className="mt-1 text-xs text-zinc-400">
          Τα δεδομένα αποθηκεύονται τοπικά στον browser σας (MVP). Δεν αποστέλλεται τίποτα σε server.
        </p>
      </div>

      <div className="space-y-10 divide-y divide-zinc-100">
        {/* Business + Logo + Offers + Comms */}
        <div className="pt-0">
          <BusinessForm
            profile={profile}
            onChange={setProfile}
            onSave={handleSave}
            saved={saved}
          />
        </div>

        {/* Mock workspace */}
        <div className="pt-8">
          <MockWorkspacePanel />
        </div>

        {/* Mock CRM import */}
        <div className="pt-8">
          <MockCrmPanel />
        </div>
      </div>
    </div>
  );
}
