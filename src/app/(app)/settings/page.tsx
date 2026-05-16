'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { getBusinessProfile, saveBusinessProfile, exportStateJson, loadState, clearState, saveState, parseBackupJson, normalizeImportedState, saveCustomers, getNextCrmNumber, type ParsedBackup } from '@/lib/storage';
import { demoCustomers, generateDemoTasks, generateDemoOffers } from '@/lib/demo-data';
import { buildDataHealthReport, type DataHealthReport } from '@/lib/data-health';
import { downloadCustomersCsv } from '@/lib/csv-export';
import { parseCustomerCsv, parseCsvToRows, detectCrmDuplicates, type CsvImportPreview } from '@/lib/csv-import';
import type { BusinessProfile, Customer } from '@/lib/types';
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
  const [backupPreview, setBackupPreview] = useState<ParsedBackup | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [healthReport, setHealthReport] = useState<DataHealthReport | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [seedConfirming, setSeedConfirming] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [csvImportText, setCsvImportText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);
  const [csvImportDone, setCsvImportDone] = useState(false);
  const [csvImportCount, setCsvImportCount] = useState(0);

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
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
    const demoState = {
      customers: demoCustomers,
      tasks: generateDemoTasks(),
      offers: generateDemoOffers(),
      calls: [],
      communications: [],
    };
    clearState();
    saveState(demoState);
    setSeedConfirming(false);
    setSeedDone(true);
    setHealthReport(buildDataHealthReport(demoState));
    setTimeout(() => window.location.reload(), 1500);
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
  }

  function handleCsvImport() {
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
    const msg = dupCount > 0
      ? `Βρέθηκαν ${dupCount} διπλότυπα που θα παραλειφθούν. Εισαγωγή ${validRows.length} πελατών; Δεν υπάρχει undo.`
      : `Εισαγωγή ${validRows.length} πελατών; Δεν υπάρχει undo.`;
    if (!window.confirm(msg)) return;
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
    // Clear preview but keep done/count for the success banner
    setCsvPreview(null);
    setCsvImportText('');
    setCsvImportDone(true);
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
        {/* ── Στοιχεία επιχείρησης ───────────────────────────────── */}
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

        {/* ── Εισαγωγή / Εξαγωγή ────────────────────────────────── */}

        {/* CSV export */}
        <div className="pt-8 space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Εισαγωγή / Εξαγωγή
            </p>
            <h2 className="text-sm font-semibold text-zinc-800">Εξαγωγή πελατών CSV</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Κατέβασε τους πελάτες σου σε CSV για έλεγχο ή μεταφορά σε spreadsheet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Κατέβασμα CSV
            </button>
            <p className="text-xs text-zinc-400">
              Η εξαγωγή γίνεται μόνο από τα τοπικά δεδομένα αυτού του browser.
            </p>
          </div>
        </div>

        {/* CSV Import */}
        <div className="pt-8 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Εισαγωγή πελατών CSV</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Προεπισκόπηση μόνο — δεν αποθηκεύεται τίποτα ακόμα.
            </p>
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
              <p className="text-xs text-zinc-400">
                Προεπισκόπηση μόνο. Χρησιμοποίησε το κουμπί εισαγωγής παρακάτω για αποθήκευση.
              </p>
            </div>
          )}
          {csvPreview && !csvImportDone && (
            <button type="button" onClick={handleCsvImport}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700">
              Εισαγωγή πελατών
            </button>
          )}
          {csvImportDone && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">
                Εισαχθηκαν {csvImportCount} πελάτες.
              </p>
            </div>
          )}
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

            {!backupPreview && restoreStatus !== 'success' && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Επιλογή backup για επαναφορά
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={handleRestoreFile}
                />
              </label>
            )}
          </div>

          {/* Preview card — confirmation required before restore */}
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
              <p className="text-xs text-zinc-500">
                Η επαναφορά θα αντικαταστήσει τα τρέχοντα τοπικά δεδομένα.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCancelRestore}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Ακύρωση
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Επαναφορά δεδομένων
                </button>
              </div>
            </div>
          )}

          {restoreStatus === 'success' && !backupPreview && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">
                Το backup επαναφέρθηκε. Κάνε refresh για να δεις τα δεδομένα.
              </p>
            </div>
          )}
          {restoreStatus === 'error' && !backupPreview && (
            <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-700">
                Το αρχείο backup δεν είναι έγκυρο ή δεν αναγνωρίζεται ως backup yorgos.ai.
              </p>
            </div>
          )}
        </div>

        {/* ── Τοπικά δεδομένα ────────────────────────────────────── */}

        {/* Data health */}
        <div className="pt-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Τοπικά δεδομένα
              </p>
              <h2 className="text-sm font-semibold text-zinc-800">Έλεγχος τοπικών δεδομένων</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Ο έλεγχος γίνεται μόνο τοπικά στον browser. Δεν στέλνονται δεδομένα εκτός συσκευής.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRecheck}
              className="shrink-0 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Επανέλεγχος
            </button>
          </div>

          {healthReport && (
            <div className="rounded-2xl bg-white ring-1 ring-zinc-100 shadow-sm overflow-hidden">
              {/* Status banner */}
              <div className={`px-4 py-3 ${healthReport.healthy ? 'bg-green-50' : 'bg-amber-50'}`}>
                <p className={`text-sm font-semibold ${healthReport.healthy ? 'text-green-700' : 'text-amber-900'}`}>
                  {healthReport.healthy
                    ? 'Όλα φαίνονται σωστά'
                    : `Βρέθηκαν ${healthReport.issues.length} θέματα στα τοπικά δεδομένα`}
                </p>
              </div>

              {/* Counts */}
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

              {/* Issues list */}
              {healthReport.issues.length > 0 && (
                <div className="border-t border-zinc-100 px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-500 mb-2">Λεπτομέρειες</p>
                  <ul className="space-y-1">
                    {healthReport.issues.slice(0, 20).map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>
                          <span className="font-medium text-zinc-700">{issue.entity}:</span>{' '}
                          {issue.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {healthReport.issues.length > 20 && (
                    <p className="text-xs text-zinc-400">
                      +{healthReport.issues.length - 20} ακόμα
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Data reset */}
        <div className="pt-8 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Καθαρισμός τοπικών δεδομένων</h2>
            <div className="mt-2 space-y-1 text-xs text-zinc-500">
              <p>Τα δεδομένα είναι αποθηκευμένα μόνο σε αυτόν τον browser.</p>
              <p>
                Πριν τα διαγράψεις, μπορείς να κατεβάσεις backup από την ενότητα{' '}
                <span className="font-medium text-zinc-700">Backup δεδομένων</span> παραπάνω.
              </p>
              <p className="font-medium text-zinc-700">
                Η διαγραφή δεν μπορεί να αναιρεθεί από το app αν δεν έχεις backup.
              </p>
            </div>
          </div>

          {resetDone ? (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">
                Τα δεδομένα διαγράφηκαν. Η σελίδα θα ανανεωθεί...
              </p>
            </div>
          ) : resetConfirming ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-900">Επιβεβαίωση διαγραφής</p>
              <p className="text-xs text-red-700">
                Η ενέργεια αυτή θα αφαιρέσει όλα τα τοπικά δεδομένα CRM από αυτόν τον browser.
                Πελάτες, tasks, προσφορές, κλήσεις και επικοινωνίες θα διαγραφούν χωρίς δυνατότητα
                ανάκτησης εκτός αν έχεις αποθηκευμένο backup.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setResetConfirming(false)}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Ακύρωση
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
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

        {/* ── Demo και επαναφορά ─────────────────────────────────── */}

        {/* Seed demo data */}
        <div className="pt-8 space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Demo και επαναφορά
            </p>
            <h2 className="text-sm font-semibold text-zinc-800">Επαναφορά demo δεδομένων</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Επαναφέρει τα αρχικά demo δεδομένα (πελάτες, tasks, προσφορές) σε αυτόν τον browser.
              Τα υπάρχοντα δεδομένα θα αντικατασταθούν.
            </p>
          </div>
          {seedDone ? (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200">
              <p className="text-sm font-medium text-green-700">
                Τα demo δεδομένα επαναφέρθηκαν. Η σελίδα θα ανανεωθεί...
              </p>
            </div>
          ) : seedConfirming ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-900">Επιβεβαίωση επαναφοράς demo</p>
              <p className="text-xs text-amber-800">
                Τα τρέχοντα δεδομένα (πελάτες, tasks, προσφορές, κλήσεις, επικοινωνίες) θα
                αντικατασταθούν από τα demo δεδομένα. Κατέβασε backup πριν συνεχίσεις αν θέλεις
                να διατηρήσεις τα τρέχοντα δεδομένα.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setSeedConfirming(false)}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Ακύρωση
                </button>
                <button
                  type="button"
                  onClick={handleSeedDemo}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                >
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

        {/* ── Μελλοντικοί πάροχοι ───────────────────────────────── */}

        {/* Provider readiness */}
        <div className="pt-8 space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Μελλοντικοί πάροχοι
            </p>
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
          <Link
            href="/demo/production-readiness"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700"
          >
            Τεχνική ετοιμότητα για production →
          </Link>
        </div>
      </div>
    </div>
  );
}
