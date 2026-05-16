'use client';

import { useState, useEffect, useRef } from 'react';
import { getBusinessProfile, saveBusinessProfile, exportStateJson, importStateJson } from '@/lib/storage';
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

export default function SettingsPage() {
  // Start with false so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  // Initial profile is not rendered until hydrated — value here does not matter for DOM.
  const [profile, setProfile] = useState<BusinessProfile>(defaultProfile);
  const [saved, setSaved] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const stored = getBusinessProfile();
    const nextProfile = stored ?? defaultProfile();
    const timer = window.setTimeout(() => {
      setProfile(nextProfile);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function handleDownloadBackup() {
    const json = exportStateJson();
    const date = new Date().toISOString().split('T')[0];
    const filename = `yorgos-crm-backup-${date}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (
        !window.confirm(
          'Η επαναφορά θα αντικαταστήσει τα τρέχοντα δεδομένα. Συνέχεια;'
        )
      ) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      const ok = importStateJson(text);
      setRestoreStatus(ok ? 'success' : 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => {
      setRestoreStatus('error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  }

  function handleSave() {
    saveBusinessProfile({ ...profile, updatedAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
        </div>
        <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση ρυθμίσεων...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
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

        {/* Backup & Restore */}
        <div className="pt-8 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Backup δεδομένων</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Κατέβασε αντίγραφο ασφαλείας των τοπικών δεδομένων ή επαναφέρτε από προηγούμενο backup.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Λήψη backup
            </button>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Επαναφορά backup
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleRestoreFile}
              />
            </label>
          </div>

          {restoreStatus === 'success' && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">
                Το backup επαναφέρθηκε. Κάνε refresh για να δεις τα δεδομένα.
              </p>
            </div>
          )}
          {restoreStatus === 'error' && (
            <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-700">
                Το αρχείο backup δεν είναι έγκυρο.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
