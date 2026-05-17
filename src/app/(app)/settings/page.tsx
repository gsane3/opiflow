'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { getBusinessProfile, saveBusinessProfile, exportStateJson, loadState, clearState, saveState, parseBackupJson, normalizeImportedState, saveCustomers, getNextCrmNumber, type ParsedBackup } from '@/lib/storage';
import { demoCustomers, generateDemoTasks, generateDemoOffers, buildRichDemoState } from '@/lib/demo-data';
import { buildDataHealthReport, type DataHealthReport } from '@/lib/data-health';
import { downloadCustomersCsv } from '@/lib/csv-export';
import { parseCustomerCsv, parseCsvToRows, detectCrmDuplicates, type CsvImportPreview } from '@/lib/csv-import';
import type { BusinessProfile, Customer, CallRecord } from '@/lib/types';
import BusinessForm from '@/components/settings/BusinessForm';
import MockWorkspacePanel from '@/components/settings/MockWorkspacePanel';
import MockCrmPanel from '@/components/settings/MockCrmPanel';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';
import {
  loadDemoGuideSession,
  completeDemoGuideStep,
  setCurrentDemoGuideStep,
} from '@/lib/demo-guide-session';

type SettingsSection = 'business' | 'data' | 'demo' | 'csv' | 'providers' | 'danger';

const SECTION_LABELS: Record<SettingsSection, string> = {
  business: 'Επιχείρηση',
  data: 'Backup & δεδομένα',
  demo: 'Demo',
  csv: 'CSV / Εισαγωγή',
  providers: 'Πάροχοι',
  danger: 'Διαγραφή',
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
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [backupPreview, setBackupPreview] = useState<ParsedBackup | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [healthReport, setHealthReport] = useState<DataHealthReport | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [seedConfirming, setSeedConfirming] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [seedVariant, setSeedVariant] = useState<'basic' | 'rich'>('basic');
  const [csvImportText, setCsvImportText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);
  const [csvImportDone, setCsvImportDone] = useState(false);
  const [csvImportCount, setCsvImportCount] = useState(0);
  const [csvImportConfirming, setCsvImportConfirming] = useState(false);
  const [csvImportMeta, setCsvImportMeta] = useState<{ validCount: number; dupCount: number } | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);

  // Auto-open demo section when arriving via demoStep=seed URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demoStep') === 'seed') {
      const timer = window.setTimeout(() => setActiveSection('demo'), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // Preselect Rich pilot demo when in guided mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('guide') === '1' && params.get('demoStep') === 'seed') {
      const session = loadDemoGuideSession();
      if (session?.active) {
        const timer = window.setTimeout(() => setSeedVariant('rich'), 0);
        return () => window.clearTimeout(timer);
      }
    }
  }, []);

  useEffect(() => {
    const stored = getBusinessProfile();
    const nextProfile = stored ?? defaultProfile();
    const report = buildDataHealthReport(loadState());
    const timer = window.setTimeout(() => {
      setProfile(nextProfile);
      setHealthReport(report);
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
    setRestoreStatus('idle');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseBackupJson(text);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!parsed) {
        setRestoreStatus('error');
        setBackupPreview(null);
        return;
      }
      setBackupPreview(parsed);
    };
    reader.onerror = () => {
      setRestoreStatus('error');
      setBackupPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  }

  function handleConfirmRestore() {
    if (!backupPreview) return;
    const { state } = backupPreview;
    const normalized = normalizeImportedState(state);
    clearState();
    saveState(normalized);
    setBackupPreview(null);
    setRestoreStatus('success');
    setHealthReport(buildDataHealthReport(normalized));
  }

  function handleCancelRestore() {
    setBackupPreview(null);
    setRestoreStatus('idle');
  }

  function handleRecheck() {
    setHealthReport(buildDataHealthReport(loadState()));
  }

  function handleExportCsv() {
    downloadCustomersCsv(loadState().customers ?? []);
  }

  function handleReset() {
    clearState();
    setResetConfirming(false);
    setResetDone(true);
    setHealthReport(buildDataHealthReport(loadState()));
    setTimeout(() => window.location.reload(), 1500);
  }

  function handleSeedDemo() {
    let demoState: ReturnType<typeof buildRichDemoState>;
    if (seedVariant === 'rich') {
      demoState = buildRichDemoState();
    } else {
      demoState = {
        customers: demoCustomers,
        tasks: generateDemoTasks(),
        offers: generateDemoOffers(),
        calls: [] as CallRecord[],
        communications: [],
      };
    }
    clearState();
    saveState(demoState);
    setSeedConfirming(false);
    setSeedDone(true);
    setHealthReport(buildDataHealthReport(demoState));
    const guideSession = loadDemoGuideSession();
    if (guideSession?.active && guideSession.currentStep === 'seed') {
      completeDemoGuideStep('seed');
      setCurrentDemoGuideStep('dashboard');
      setTimeout(() => {
        window.location.href = '/dashboard?demoStep=dashboard&guide=1';
      }, 1000);
    } else {
      setTimeout(() => window.location.reload(), 1500);
    }
  }

  function handleSave() {
    saveBusinessProfile({ ...profile, updatedAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleCsvImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvImportText(text);
      setCsvPreview(parseCustomerCsv(text));
      if (csvImportRef.current) csvImportRef.current.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleClearCsvPreview() {
    setCsvPreview(null);
    setCsvImportText('');
    setCsvImportDone(false);
    setCsvImportCount(0);
    setCsvImportConfirming(false);
    setCsvImportMeta(null);
  }

  function handleCsvImportClick() {
    if (!csvPreview || !csvImportText) return;
    const state = loadState();
    const headers = csvPreview.columns.map(c => c.header);
    const rows = parseCsvToRows(csvImportText, headers);
    const existing = state.customers ?? [];
    const dupIndices = detectCrmDuplicates(rows, existing);
    const dupCount = dupIndices.size;
    const validRows = rows.filter((_, i) => !dupIndices.has(i) && rows[i].name?.trim());
    if (validRows.length === 0) {
      alert('Δεν υπάρχουν έγκυρες γραμμές για εισαγωγή' + (dupCount > 0 ? ` (${dupCount} διπλότυπα).` : '.'));
      return;
    }
    setCsvImportMeta({ validCount: validRows.length, dupCount });
    setCsvImportConfirming(true);
  }

  function handleCsvImport() {
    if (!csvPreview || !csvImportText) return;
    const state = loadState();
    const headers = csvPreview.columns.map(c => c.header);
    const rows = parseCsvToRows(csvImportText, headers);
    const existing = state.customers ?? [];
    const dupIndices = detectCrmDuplicates(rows, existing);
    const validRows = rows.filter((_, i) => !dupIndices.has(i) && rows[i].name?.trim());
    if (validRows.length === 0) return;
    const now = new Date().toISOString();
    let allCustomers = [...existing];
    const newCustomers: Customer[] = validRows.map(row => {
      const crmNumber = getNextCrmNumber(allCustomers);
      const resolvedPhone = row.mobilePhone || row.landlinePhone || row.phone;
      const c: Customer = {
        id: crypto.randomUUID(),
        crmNumber,
        name: row.name.trim(),
        companyName: row.companyName,
        phone: resolvedPhone,
        mobilePhone: row.mobilePhone || undefined,
        landlinePhone: row.landlinePhone || undefined,
        email: row.email,
        address: row.address,
        source: (row.source as Customer['source']) || 'manual_entry',
        status: (row.status as Customer['status']) || 'new_lead',
        preferredContactMethod: (row.preferredContactMethod as Customer['preferredContactMethod']) || 'phone',
        opportunityValue: row.opportunityValue,
        needsSummary: row.needsSummary,
        notes: row.notes,
        createdAt: now,
        updatedAt: now,
      };
      allCustomers = [...allCustomers, c];
      return c;
    });
    saveCustomers([...existing, ...newCustomers]);
    setHealthReport(buildDataHealthReport(loadState()));
    setCsvImportCount(newCustomers.length);
    setCsvPreview(null);
    setCsvImportText('');
    setCsvImportConfirming(false);
    setCsvImportMeta(null);
    setCsvImportDone(true);
  }

  // ── Render helpers (not components — called as functions, no hooks) ────────────

  function renderBusiness() {
    return (
      <div className="space-y-8 divide-y divide-zinc-100">
        <div className="pt-0">
          <BusinessForm profile={profile} onChange={setProfile} onSave={handleSave} saved={saved} />
        </div>
        <div className="pt-8">
          <MockWorkspacePanel />
        </div>
        <div className="pt-8">
          <MockCrmPanel />
        </div>
      </div>
    );
  }

  function renderData() {
    return (
      <div className="space-y-8 divide-y divide-zinc-100">
        {/* Backup & Restore */}
        <div className="pt-0 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Backup δεδομένων</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Κατέβασε αντίγραφο ασφαλείας ή επαναφέρε από προηγούμενο backup.
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
            {!backupPreview && restoreStatus !== 'success' && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Επιλογή backup για επαναφορά
                <input ref={fileInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={handleRestoreFile} />
              </label>
            )}
          </div>
          {backupPreview && (
            <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
              <p className="text-sm font-semibold text-zinc-800">Προεπισκόπηση backup</p>
              <div className="space-y-1 text-xs text-zinc-600">
                {backupPreview.exportedAt && (
                  <p>Εξαχθηκε: {new Date(backupPreview.exportedAt).toLocaleString('el-GR')}</p>
                )}
                {backupPreview.version && <p>Έκδοση: {backupPreview.version}</p>}
                {!backupPreview.isWrapped && (
                  <p className="text-amber-600">Παλαιός τύπος backup — χωρίς metadata.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { label: 'Πελάτες', value: (backupPreview.state.customers ?? []).length },
                  { label: 'Tasks', value: (backupPreview.state.tasks ?? []).length },
                  { label: 'Προσφορές', value: (backupPreview.state.offers ?? []).length },
                  { label: 'Κλήσεις', value: (backupPreview.state.calls ?? []).length },
                  { label: 'Επικοινωνίες', value: (backupPreview.state.communications ?? []).length },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-white px-3 py-2 text-center ring-1 ring-zinc-100">
                    <p className="text-base font-bold text-zinc-900">{value}</p>
                    <p className="text-xs text-zinc-400">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500">Η επαναφορά θα αντικαταστήσει τα τρέχοντα τοπικά δεδομένα.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={handleCancelRestore} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50">
                  Ακύρωση
                </button>
                <button type="button" onClick={handleConfirmRestore} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700">
                  Επαναφορά δεδομένων
                </button>
              </div>
            </div>
          )}
          {restoreStatus === 'success' && !backupPreview && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">Το backup επαναφέρθηκε. Κάνε refresh για να δεις τα δεδομένα.</p>
            </div>
          )}
          {restoreStatus === 'error' && !backupPreview && (
            <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-700">Το αρχείο backup δεν είναι έγκυρο ή δεν αναγνωρίζεται ως backup yorgos.ai.</p>
            </div>
          )}
        </div>

        {/* Data health */}
        <div className="pt-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">Έλεγχος τοπικών δεδομένων</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Ο έλεγχος γίνεται μόνο τοπικά στον browser.</p>
            </div>
            <button type="button" onClick={handleRecheck} className="shrink-0 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
              Επανέλεγχος
            </button>
          </div>
          {healthReport && (
            <div className="rounded-2xl bg-white ring-1 ring-zinc-100 shadow-sm overflow-hidden">
              <div className={`px-4 py-3 ${healthReport.healthy ? 'bg-green-50' : 'bg-amber-50'}`}>
                <p className={`text-sm font-semibold ${healthReport.healthy ? 'text-green-700' : 'text-amber-900'}`}>
                  {healthReport.healthy ? 'Όλα φαίνονται σωστά' : `Βρέθηκαν ${healthReport.issues.length} θέματα στα τοπικά δεδομένα`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-px bg-zinc-100 sm:grid-cols-5">
                {[
                  { label: 'Πελάτες', value: healthReport.counts.customers },
                  { label: 'Tasks', value: healthReport.counts.tasks },
                  { label: 'Προσφορές', value: healthReport.counts.offers },
                  { label: 'Κλήσεις', value: healthReport.counts.calls },
                  { label: 'Επικοινωνίες', value: healthReport.counts.communications },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white px-4 py-3 text-center">
                    <p className="text-lg font-bold text-zinc-900">{value}</p>
                    <p className="text-xs text-zinc-400">{label}</p>
                  </div>
                ))}
              </div>
              {healthReport.issues.length > 0 && (
                <div className="border-t border-zinc-100 px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-500 mb-2">Λεπτομέρειες</p>
                  <ul className="space-y-1">
                    {healthReport.issues.slice(0, 20).map((issue, i) => {
                      const href = issue.entity === 'Task' ? '/tasks' : issue.entity === 'Προσφορά' ? '/offers' : '/customers';
                      return (
                        <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-zinc-700">{issue.entity}:</span>{' '}{issue.message}
                          </span>
                          <Link href={href} className="shrink-0 text-xs text-indigo-600 hover:text-indigo-700">Άνοιγμα</Link>
                        </li>
                      );
                    })}
                  </ul>
                  {healthReport.issues.length > 20 && (
                    <p className="text-xs text-zinc-400">+{healthReport.issues.length - 20} ακόμα</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderDemo() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Επαναφορά demo δεδομένων</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Επαναφέρει τα αρχικά demo δεδομένα (πελάτες, tasks, προσφορές) σε αυτόν τον browser.
            Τα υπάρχοντα δεδομένα θα αντικατασταθούν.
          </p>
        </div>
        {seedDone ? (
          <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
            <p className="text-sm font-medium text-green-700">Τα demo δεδομένα επαναφέρθηκαν. Η σελίδα θα ανανεωθεί...</p>
          </div>
        ) : seedConfirming ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-900">Επιβεβαίωση επαναφοράς demo</p>
            <p className="text-xs text-amber-800">Πριν συνεχίσεις, κατέβασε backup αν θέλεις να κρατήσεις τα τρέχοντα δεδομένα.</p>
            <p className="text-xs text-amber-800">Πελάτες, tasks, προσφορές, κλήσεις και επικοινωνίες θα αντικατασταθούν από τα αρχικά demo δεδομένα.</p>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-amber-800">Επιλογή τύπου demo:</p>
              <div className="flex flex-col gap-1">
                {[
                  { id: 'basic', label: 'Basic demo', note: '4 πελάτες, 4 tasks, 2 προσφορές.' },
                  { id: 'rich', label: 'Rich pilot demo', note: 'Ίδια βάση + completed task, accepted offer, 2 comm records.' },
                ].map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="seed-variant"
                      value={v.id}
                      checked={seedVariant === v.id}
                      onChange={() => setSeedVariant(v.id as 'basic' | 'rich')}
                      className="mt-0.5 accent-amber-600"
                    />
                    <div>
                      <span className="text-xs font-medium text-amber-900">{v.label}</span>
                      <span className="ml-1 text-xs text-amber-700">— {v.note}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setSeedConfirming(false)} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50">
                Ακύρωση
              </button>
              <button type="button" onClick={handleSeedDemo} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700">
                Ναι, επαναφορά demo δεδομένων
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSeedConfirming(true)}
            className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
          >
            Επαναφορά demo δεδομένων
          </button>
        )}
      </div>
    );
  }

  function renderCsv() {
    return (
      <div className="space-y-8 divide-y divide-zinc-100">
        {/* CSV export */}
        <div className="pt-0 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Εξαγωγή πελατών CSV</h2>
            <p className="mt-0.5 text-xs text-zinc-400">Κατέβασε τους πελάτες σου σε CSV για έλεγχο ή μεταφορά σε spreadsheet.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleExportCsv} className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Κατέβασμα CSV
            </button>
            <p className="text-xs text-zinc-400">Η εξαγωγή γίνεται μόνο από τα τοπικά δεδομένα αυτού του browser.</p>
          </div>
        </div>

        {/* CSV Import */}
        <div className="pt-8 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Εισαγωγή πελατών CSV</h2>
            <p className="mt-0.5 text-xs text-zinc-400">Προεπισκόπηση μόνο — δεν αποθηκεύεται τίποτα ακόμα.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
              Επιλογή CSV
              <input ref={csvImportRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={handleCsvImportFile} />
            </label>
            {csvPreview && (
              <button type="button" onClick={handleClearCsvPreview} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50">
                Καθαρισμός preview
              </button>
            )}
          </div>
          {csvPreview && (
            <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-800">Προεπισκόπηση CSV</p>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${csvPreview.hasIssues ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {csvPreview.totalRows} γραμμές{csvPreview.hasIssues ? ' · υπάρχουν θέματα' : ' · εντάξει'}
                </span>
              </div>
              {csvPreview.globalIssues.length > 0 && (
                <ul className="space-y-1">
                  {csvPreview.globalIssues.map((issue, i) => (
                    <li key={i} className="text-xs text-amber-700">&#x26A0; {issue}</li>
                  ))}
                </ul>
              )}
              <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-100">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      {csvPreview.columns.map(col => (
                        <th key={col.index} className={`px-3 py-2 text-left font-medium ${col.known ? 'text-zinc-700' : 'text-amber-600'}`}>
                          {col.header}{!col.known && ' ⚠'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {csvPreview.rows.slice(0, 5).map(row => (
                      <tr key={row.rowIndex} className={row.issues.length > 0 ? 'bg-amber-50' : ''}>
                        {row.raw.map((cell, ci) => (
                          <td key={ci} className="max-w-[150px] truncate px-3 py-2 text-zinc-600">{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvPreview.rows.some(r => r.issues.length > 0) && (
                <ul className="space-y-1">
                  {csvPreview.rows.filter(r => r.issues.length > 0).slice(0, 5).map(row => (
                    <li key={row.rowIndex} className="text-xs text-amber-700">
                      Γραμμή {row.rowIndex}: {row.issues.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-zinc-400">Προεπισκόπηση μόνο. Χρησιμοποίησε το κουμπί εισαγωγής παρακάτω για αποθήκευση.</p>
            </div>
          )}
          {csvPreview && !csvImportDone && !csvImportConfirming && (
            <button type="button" onClick={handleCsvImportClick} className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700">
              Εισαγωγή πελατών
            </button>
          )}
          {csvImportConfirming && csvImportMeta && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <p className="text-sm font-medium text-zinc-700">
                Να γίνει εισαγωγή {csvImportMeta.validCount} πελατών;
              </p>
              {csvImportMeta.dupCount > 0 && (
                <p className="text-xs text-zinc-500">{csvImportMeta.dupCount} διπλότυπα θα παραλειφθούν.</p>
              )}
              <p className="text-xs text-zinc-400">Η ενέργεια αφορά μόνο το τοπικό CRM. Δεν υπάρχει undo.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCsvImport}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Ναι, συνέχισε
                </button>
                <button
                  type="button"
                  onClick={() => { setCsvImportConfirming(false); setCsvImportMeta(null); }}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                >
                  Πίσω
                </button>
              </div>
            </div>
          )}
          {csvImportDone && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">Εισαχθηκαν {csvImportCount} πελάτες.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderProviders() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Πάροχοι επικοινωνίας</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Στο MVP οι επικοινωνίες γίνονται με native συνδέσμους (tel:, sms:) και αντιγραφή κειμένου.
            Οι πάροχοι θα συνδεθούν σε επόμενη έκδοση cloud.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { label: 'Τηλεφωνία', desc: 'Ανοίγει την εφαρμογή κλήσεων της συσκευής.' },
            { label: 'SMS', desc: 'Ανοίγει την εφαρμογή SMS της συσκευής.' },
            { label: 'Viber', desc: 'Αντιγραφή κειμένου για αποστολή από Viber.' },
            { label: 'Email', desc: 'Αντιγραφή draft για αποστολή από email client.' },
          ].map(p => (
            <div key={p.label} className="rounded-xl bg-white px-4 py-3 ring-1 ring-zinc-100 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800">{p.label}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">Demo</span>
              </div>
              <p className="text-xs text-zinc-400">{p.desc}</p>
            </div>
          ))}
        </div>
        <Link href="/demo/production-readiness" className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700">
          Τεχνική ετοιμότητα για production →
        </Link>
      </div>
    );
  }

  function renderDanger() {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
          <p className="text-sm font-semibold text-red-800">Προσοχή</p>
          <p className="mt-0.5 text-xs text-red-700">Αυτή η ενέργεια διαγράφει δεδομένα χωρίς δυνατότητα ανάκτησης από το app.</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Καθαρισμός τοπικών δεδομένων</h2>
          <div className="mt-2 space-y-1 text-xs text-zinc-500">
            <p>Τα δεδομένα είναι αποθηκευμένα μόνο σε αυτόν τον browser.</p>
            <p>Πριν τα διαγράψεις, κατέβασε backup από την ενότητα <span className="font-medium text-zinc-700">Backup & δεδομένα</span>.</p>
            <p className="font-medium text-zinc-700">Η διαγραφή δεν μπορεί να αναιρεθεί από το app αν δεν έχεις backup.</p>
          </div>
        </div>
        {resetDone ? (
          <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
            <p className="text-sm font-medium text-green-700">Τα δεδομένα διαγράφηκαν. Η σελίδα θα ανανεωθεί...</p>
          </div>
        ) : resetConfirming ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-red-900">Επιβεβαίωση διαγραφής</p>
            <p className="text-xs text-red-700">Πριν συνεχίσεις, κατέβασε backup αν θέλεις να κρατήσεις τα τρέχοντα δεδομένα.</p>
            <p className="text-xs text-red-700">Πελάτες, tasks, προσφορές, κλήσεις και επικοινωνίες θα διαγραφούν χωρίς δυνατότητα ανάκτησης από το app.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setResetConfirming(false)} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50">
                Ακύρωση
              </button>
              <button type="button" onClick={handleReset} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700">
                Ναι, διαγραφή δεδομένων
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setResetConfirming(true)}
            className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Διαγραφή τοπικών δεδομένων
          </button>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

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
      <DemoStepBanner
        step="seed"
        stepNum={1}
        title="Ετοίμασε demo δεδομένα"
        body="Πάτα 'Demo' στη λίστα ρυθμίσεων. Επέλεξε Rich pilot demo και πάτα επιβεβαίωση."
        watchLabel="Επιλογή Rich pilot demo — επαναφέρει 4 πελάτες, tasks, 3 προσφορές και comms."
        actionLabel="Επόμενο: Dashboard"
        actionHref="/dashboard?demoStep=dashboard"
      />
      <GuidedDemoBanner
        step="seed"
        stepNum={1}
        title="Ετοίμασε demo δεδομένα"
        whatYouSee="Ρυθμίσεις — πάτα 'Demo' στη λίστα."
        whatToDo="Πάτα 'Demo'. Επέλεξε Rich pilot demo. Πάτα Επαναφορά demo δεδομένων."
        whyItMatters="Χρειάζεσαι πραγματικά demo δεδομένα για να δεις ολόκληρη τη ροή."
        canManualComplete={false}
      />

      {activeSection === null ? (
        <>
          <div className="mb-6">
            <h1 className="text-xl font-bold text-zinc-900">Ρυθμίσεις</h1>
            <p className="mt-1 text-xs text-zinc-400">
              Τα δεδομένα αποθηκεύονται τοπικά στον browser σας (MVP). Δεν αποστέλλεται τίποτα σε server.
            </p>
          </div>
          <div className="space-y-2">
            {([
              {
                id: 'business' as SettingsSection,
                label: 'Επιχείρηση',
                subtitle: 'Στοιχεία επιχείρησης, workspace, CRM',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'data' as SettingsSection,
                label: 'Backup & δεδομένα',
                subtitle: 'Backup, restore, έλεγχος υγείας',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'demo' as SettingsSection,
                label: 'Demo',
                subtitle: 'Επαναφορά demo δεδομένων για δοκιμή',
                icon: (
                  <svg className="h-5 w-5 text-amber-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                  </svg>
                ),
                bg: 'bg-amber-50',
              },
              {
                id: 'csv' as SettingsSection,
                label: 'CSV / Εισαγωγή',
                subtitle: 'Εισαγωγή και εξαγωγή πελατών',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h1.5m-1.5 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h17.25" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'providers' as SettingsSection,
                label: 'Πάροχοι',
                subtitle: 'Μελλοντικοί πάροχοι επικοινωνίας',
                icon: (
                  <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
                  </svg>
                ),
                bg: 'bg-indigo-50',
              },
              {
                id: 'danger' as SettingsSection,
                label: 'Διαγραφή',
                subtitle: 'Καθαρισμός τοπικών δεδομένων',
                icon: (
                  <svg className="h-5 w-5 text-red-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                ),
                bg: 'bg-red-50',
                danger: true,
              },
            ] as Array<{ id: SettingsSection; label: string; subtitle: string; icon: React.ReactNode; bg: string; danger?: boolean }>).map(({ id, label, subtitle, icon, bg, danger }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`flex w-full items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 transition active:bg-zinc-50 ${
                  danger ? 'ring-red-100 hover:ring-red-200' : 'ring-zinc-100 hover:ring-indigo-200'
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
          {activeSection === 'data' && renderData()}
          {activeSection === 'demo' && renderDemo()}
          {activeSection === 'csv' && renderCsv()}
          {activeSection === 'providers' && renderProviders()}
          {activeSection === 'danger' && renderDanger()}
        </>
      )}
    </div>
  );
}
