'use client';

import { useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n');
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function norm(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'ονομα', 'ονοματεπωνυμο', 'πελατης', 'customer', 'fullname', 'full name'],
  companyName: ['company', 'companyname', 'company name', 'εταιρεια', 'επωνυμια'],
  phone: ['phone', 'τηλεφωνο', 'τηλ', 'telephone'],
  mobilePhone: ['mobile', 'mobilephone', 'mobile phone', 'κινητο', 'κιν'],
  landlinePhone: ['landline', 'σταθερο'],
  email: ['email', 'mail', 'e-mail', 'ηλεκτρονικο ταχυδρομειο'],
  address: ['address', 'διευθυνση'],
  notes: ['notes', 'note', 'σημειωσεις', 'σχολια'],
  needsSummary: ['needs', 'αναγκη', 'αναγκες', 'περιληψη', 'summary'],
  opportunityValue: ['value', 'opportunityvalue', 'opportunity value', 'αξια', 'αξια ευκαιριας'],
};

const HEADER_TO_FIELD: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) map[norm(a)] = field;
  }
  return map;
})();

function phoneKey(p: string | null | undefined): string {
  const digits = (p ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

interface ImportRow {
  name?: string;
  companyName?: string;
  phone?: string;
  mobilePhone?: string;
  landlinePhone?: string;
  email?: string;
  address?: string;
  notes?: string;
  needsSummary?: string;
  opportunityValue?: number;
}

type ApiCustomer = Record<string, unknown>;

const cls = {
  card: 'rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10',
  primary: 'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60',
};

export default function ImportExportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'export' | 'import' | 'delete-imported' | 'delete-all'>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDeleteImported, setConfirmDeleteImported] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  async function handleDeleteImported() {
    setMessage(null);
    setBusy('delete-imported');
    try {
      const token = await getToken();
      if (!token) { setMessage({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' }); return; }
      const res = await fetch('/api/customers/imported', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; deleted?: number; columnMissing?: boolean };
      if (json.ok && json.columnMissing) {
        setMessage({ tone: 'info', text: 'Δεν εντοπίστηκαν επαφές σημειωμένες ως «από κινητό». Για να σβήσεις τα πάντα, χρησιμοποίησε «Διαγραφή όλων των επαφών».' });
      } else if (json.ok) {
        setMessage({ tone: 'ok', text: `Διαγράφηκαν ${json.deleted ?? 0} εισαγόμενες επαφές.` });
      } else {
        setMessage({ tone: 'err', text: 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.' });
      }
    } catch {
      setMessage({ tone: 'err', text: 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.' });
    } finally {
      setBusy(null);
      setConfirmDeleteImported(false);
    }
  }

  // «Διαγραφή όλων των επαφών» — every contact (imported + app/CRM). Works
  // regardless of the imported flag (no migration dependency).
  async function handleDeleteAll() {
    setMessage(null);
    setBusy('delete-all');
    try {
      const token = await getToken();
      if (!token) { setMessage({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' }); return; }
      const res = await fetch('/api/customers/imported?scope=all', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; deleted?: number };
      if (json.ok) {
        setMessage({ tone: 'ok', text: `Διαγράφηκαν ${json.deleted ?? 0} επαφές.` });
      } else {
        setMessage({ tone: 'err', text: 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.' });
      }
    } catch {
      setMessage({ tone: 'err', text: 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.' });
    } finally {
      setBusy(null);
      setConfirmDeleteAll(false);
    }
  }

  async function getToken(): Promise<string | null> {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async function fetchAllCustomers(token: string): Promise<ApiCustomer[]> {
    // The list API caps `limit` at 100, so page through with offset until a
    // short page — otherwise export + import dedup only ever saw 100 customers.
    const all: ApiCustomer[] = [];
    const PAGE = 100;
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const res = await fetch(`/api/customers?limit=${PAGE}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fetch_failed');
      const data = await res.json();
      const page: ApiCustomer[] = Array.isArray(data) ? data : (data.customers ?? []);
      all.push(...page);
      if (page.length < PAGE) break;
    }
    return all;
  }

  async function handleExport() {
    setMessage(null);
    setBusy('export');
    try {
      const token = await getToken();
      if (!token) { setMessage({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' }); return; }
      const customers = await fetchAllCustomers(token);
      const headers = ['crmNumber', 'name', 'companyName', 'phone', 'mobilePhone', 'landlinePhone', 'email', 'address', 'source', 'status', 'opportunityValue', 'needsSummary', 'notes', 'createdAt'];
      const rows = customers.map((c) => headers.map((h) => (c[h] ?? '') as string | number));
      const today = new Date().toISOString().slice(0, 10);
      downloadFile(`opiflow-pelates-${today}.csv`, buildCsv(headers, rows), 'text/csv;charset=utf-8');
      setMessage({ tone: 'ok', text: `Εξήχθησαν ${customers.length} πελάτες.` });
    } catch {
      setMessage({ tone: 'err', text: 'Η εξαγωγή απέτυχε. Δοκίμασε ξανά.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFile(file: File) {
    setMessage(null);
    setProgress(null);
    setBusy('import');
    try {
      const token = await getToken();
      if (!token) { setMessage({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' }); return; }

      const text = await file.text();
      const grid = parseCsv(text);
      if (grid.length < 2) {
        setMessage({ tone: 'err', text: 'Το αρχείο δεν περιέχει γραμμές πελατών.' });
        return;
      }
      const headerRow = grid[0].map((h) => HEADER_TO_FIELD[norm(h)] ?? null);
      const parsed: ImportRow[] = [];
      for (let r = 1; r < grid.length; r++) {
        const cells = grid[r];
        const row: ImportRow = {};
        headerRow.forEach((field, idx) => {
          if (!field) return;
          const val = (cells[idx] ?? '').trim();
          if (!val) return;
          if (field === 'opportunityValue') {
            const n = Number(val.replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (Number.isFinite(n) && n > 0) row.opportunityValue = n;
          } else {
            (row as Record<string, string>)[field] = val;
          }
        });
        // require at least a name or a phone
        if (row.name || row.phone || row.mobilePhone) parsed.push(row);
      }

      if (parsed.length === 0) {
        setMessage({ tone: 'err', text: 'Δεν βρέθηκαν έγκυρες γραμμές. Έλεγξε ότι υπάρχει στήλη Όνομα ή Τηλέφωνο.' });
        return;
      }
      if (parsed.length > 2000) {
        setMessage({ tone: 'err', text: 'Πολλές γραμμές (όριο 2000). Σπάσε το αρχείο σε μικρότερα.' });
        return;
      }

      // Dedupe against existing customers by phone.
      const existing = await fetchAllCustomers(token);
      const existingPhones = new Set<string>();
      for (const c of existing) {
        for (const k of ['phone', 'mobilePhone', 'landlinePhone']) {
          const key = phoneKey(c[k] as string | undefined);
          if (key) existingPhones.add(key);
        }
      }

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const seen = new Set(existingPhones);
      setProgress({ done: 0, total: parsed.length });

      for (let i = 0; i < parsed.length; i++) {
        const row = parsed[i];
        const key = phoneKey(row.mobilePhone || row.phone);
        if (key && seen.has(key)) { skipped++; setProgress({ done: i + 1, total: parsed.length }); continue; }
        try {
          const res = await fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              name: row.name || row.companyName || 'Πελάτης',
              companyName: row.companyName,
              phone: row.phone,
              mobilePhone: row.mobilePhone,
              landlinePhone: row.landlinePhone,
              email: row.email,
              address: row.address,
              notes: row.notes,
              needsSummary: row.needsSummary,
              opportunityValue: row.opportunityValue,
              source: 'manual_entry',
              status: 'new',
            }),
          });
          if (res.ok) { imported++; if (key) seen.add(key); }
          else failed++;
        } catch {
          failed++;
        }
        setProgress({ done: i + 1, total: parsed.length });
      }

      setMessage({
        tone: failed > 0 ? 'info' : 'ok',
        text: `Εισήχθησαν ${imported}, παραλείφθηκαν ${skipped} διπλά${failed ? `, απέτυχαν ${failed}` : ''}.`,
      });
    } catch {
      setMessage({ tone: 'err', text: 'Η εισαγωγή απέτυχε. Έλεγξε το αρχείο και δοκίμασε ξανά.' });
    } finally {
      setBusy(null);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className={cls.card}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Εξαγωγή πελατών</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Κατέβασε όλους τους πελάτες σου σε αρχείο CSV (ανοίγει σε Excel / Google Sheets).
        </p>
        <button type="button" onClick={handleExport} disabled={busy !== null} className={`mt-3 ${cls.secondary}`}>
          <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {busy === 'export' ? 'Εξαγωγή…' : 'Εξαγωγή CSV'}
        </button>
      </div>

      {/* Import */}
      <div className={cls.card}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Εισαγωγή από παλιό CRM</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Ανέβασε αρχείο CSV. Αναγνωρίζονται στήλες: Όνομα, Εταιρεία, Τηλέφωνο, Κινητό, Email, Διεύθυνση, Σημειώσεις.
          Διπλά (ίδιο τηλέφωνο) παραλείπονται.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className={`mt-3 ${cls.primary}`}
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          {busy === 'import' ? 'Εισαγωγή…' : 'Επιλογή αρχείου CSV'}
        </button>

        {progress && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1e2b38]">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{progress.done} / {progress.total}</p>
          </div>
        )}
      </div>

      {/* Phone contacts: cleanup (import itself happens in the mobile app) */}
      <div className={cls.card}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Επαφές κινητού</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Η εισαγωγή επαφών από το κινητό γίνεται από την εφαρμογή (Ρυθμίσεις → Επαφές).
          Εδώ μπορείς να διαγράψεις όλες τις επαφές που έχεις εισαγάγει από το κινητό — οι
          επαφές της εφαρμογής (κλήσεις, έργα, χειροκίνητες) δεν επηρεάζονται.
        </p>
        {confirmDeleteImported ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDeleteImported}
              disabled={busy !== null}
              className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {busy === 'delete-imported' ? 'Διαγραφή…' : 'Ναι, διαγραφή όλων'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteImported(false)}
              disabled={busy !== null}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Άκυρο
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeleteImported(true)}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-300 transition hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Διαγραφή εισαγόμενων επαφών
          </button>
        )}

        {/* Delete ALL contacts (imported + app/CRM) — no migration dependency. */}
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Ή διέγραψε <strong>όλες</strong> τις επαφές (εισαγόμενες και μη). Έργα/προσφορές/ραντεβού
          αποσυνδέονται από τον πελάτη. Η ενέργεια δεν αναιρείται.
        </p>
        {confirmDeleteAll ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={busy !== null}
              className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {busy === 'delete-all' ? 'Διαγραφή…' : 'Ναι, διαγραφή ΟΛΩΝ'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteAll(false)}
              disabled={busy !== null}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Άκυρο
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeleteAll(true)}
            disabled={busy !== null}
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-red-300 dark:border-red-500/40 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
          >
            Διαγραφή όλων των επαφών
          </button>
        )}
      </div>

      {message && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ring-1 ${
            message.tone === 'ok'
              ? 'bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 ring-green-200 dark:ring-green-500/20'
              : message.tone === 'err'
              ? 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-500/20'
              : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-500/20'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
