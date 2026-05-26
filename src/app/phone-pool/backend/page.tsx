'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types matching the API response
// ---------------------------------------------------------------------------

interface PoolStats {
  available: number;
  assigned: number;
  reserved: number;
  retired: number;
  total: number;
}

interface PoolNumber {
  id: string;
  e164_number: string;
  provider: string;
  status: string;
  imported_at: string;
  assigned_at: string | null;
  retired_at: string | null;
}

interface PoolApiResponse {
  ok: boolean;
  stats?: PoolStats;
  numbers?: PoolNumber[];
  error?: string;
}

interface ImportApiResponse {
  ok: boolean;
  number?: PoolNumber;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null): string {
  if (!value) return 'Κενό';
  try {
    return new Date(value).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'available':
      return { label: 'Διαθέσιμος', cls: 'bg-green-50 text-green-700 ring-green-200' };
    case 'assigned':
      return { label: 'Ανατεθειμένος', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' };
    case 'reserved':
      return { label: 'Δεσμευμένος', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };
    case 'retired':
      return { label: 'Αποσυρμένος', cls: 'bg-zinc-100 text-zinc-500 ring-zinc-200' };
    default:
      return { label: status, cls: 'bg-zinc-100 text-zinc-500 ring-zinc-200' };
  }
}

const IMPORT_ERRORS: Record<string, string> = {
  invalid_e164: 'Μη έγκυρος αριθμός. Χρησιμοποίησε τη μορφή +302101234567.',
  invalid_provider: 'Μη αποδεκτός πάροχος.',
  invalid_notes: 'Οι σημειώσεις υπερβαίνουν τα 500 χαρακτήρες.',
  duplicate_number: 'Αυτός ο αριθμός υπάρχει ήδη στο pool.',
  missing_auth: 'Το session έληξε. Κάνε login ξανά.',
  admin_not_configured: 'Ο admin δεν είναι ρυθμισμένος στον server.',
  missing_supabase_config: 'Η σύνδεση με τη βάση δεν είναι ρυθμισμένη.',
};

function importErrorMessage(error: string | undefined): string {
  if (!error) return 'Άγνωστο σφάλμα εισαγωγής.';
  return IMPORT_ERRORS[error] ?? `Σφάλμα εισαγωγής: ${error}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PhonePoolBackendPage() {
  // Pool state
  const [loading, setLoading] = useState(false);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [numbers, setNumbers] = useState<PoolNumber[]>([]);

  // Import form state
  const [importE164, setImportE164] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Session helper
  // ---------------------------------------------------------------------------

  async function getToken(): Promise<string | null> {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // ---------------------------------------------------------------------------
  // Load pool
  // ---------------------------------------------------------------------------

  async function loadPool() {
    setLoading(true);
    setLoadMessage(null);
    setLoadError(null);
    setForbidden(false);

    try {
      const token = await getToken();
      if (!token) {
        setLoadError(
          'Δεν υπάρχει ενεργό session. Κάνε login από /login/backend πρώτα.'
        );
        return;
      }

      const res = await fetch('/api/admin/phone-pool', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = (await res.json()) as PoolApiResponse;

      if (res.status === 403 || json.error === 'forbidden') {
        setForbidden(true);
        return;
      }

      if (!res.ok || !json.ok) {
        setLoadError(`Σφάλμα φόρτωσης: ${json.error ?? res.status}`);
        return;
      }

      setStats(json.stats ?? null);
      setNumbers(json.numbers ?? []);
      setLoadMessage(
        `Φορτώθηκαν ${json.numbers?.length ?? 0} αριθμοί.`
      );
    } catch {
      setLoadError('Αδύνατη η σύνδεση με το API.');
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Import form submit
  // ---------------------------------------------------------------------------

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setImportLoading(true);
    setImportSuccess(null);
    setImportError(null);

    try {
      const token = await getToken();
      if (!token) {
        setImportError('Δεν υπάρχει ενεργό session. Κάνε login πρώτα.');
        return;
      }

      const body: Record<string, string> = { e164_number: importE164.trim() };
      const trimmedNotes = importNotes.trim();
      if (trimmedNotes) {
        body['notes'] = trimmedNotes;
      }

      const res = await fetch('/api/admin/phone-pool', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as ImportApiResponse;

      if (res.status === 403 || json.error === 'forbidden') {
        setForbidden(true);
        return;
      }

      if (!res.ok || !json.ok) {
        setImportError(importErrorMessage(json.error));
        return;
      }

      setImportSuccess(
        `Ο αριθμός ${json.number?.e164_number ?? importE164} προστέθηκε στο pool.`
      );
      setImportE164('');
      setImportNotes('');
      // Reload pool list to reflect the new number.
      await loadPool();
    } catch {
      setImportError('Αδύνατη η σύνδεση με το API.');
    } finally {
      setImportLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Forbidden state
  // ---------------------------------------------------------------------------

  if (forbidden) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <p className="text-sm font-semibold text-red-600">
          Δεν έχεις πρόσβαση σε αυτό το εργαλείο.
        </p>
        <Link
          href="/backend"
          className="inline-block text-sm text-indigo-600 hover:text-indigo-800"
        >
          Πίσω στο hub
        </Link>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Admin
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            Pool τηλεφωνικών αριθμών
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Διαχείριση διαθέσιμων αριθμών για αυτόματη ανάθεση σε επιχειρήσεις.
          </p>
        </div>
        <Link
          href="/backend"
          className="shrink-0 text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          Πίσω στο hub
        </Link>
      </div>

      {/* Load button + status */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={loadPool}
          disabled={loading}
          className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Φόρτωση...' : 'Φόρτωση'}
        </button>
        {loadMessage && (
          <p className="text-sm text-zinc-500">{loadMessage}</p>
        )}
        {loadError && (
          <p className="text-sm text-red-600">{loadError}</p>
        )}
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              { label: 'Διαθέσιμοι', value: stats.available, cls: 'text-green-700' },
              { label: 'Ανατεθ.', value: stats.assigned, cls: 'text-indigo-700' },
              { label: 'Δεσμευμ.', value: stats.reserved, cls: 'text-amber-700' },
              { label: 'Αποσυρμ.', value: stats.retired, cls: 'text-zinc-400' },
              { label: 'Σύνολο', value: stats.total, cls: 'text-zinc-900' },
            ] as Array<{ label: string; value: number; cls: string }>
          ).map((s) => (
            <div
              key={s.label}
              className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-zinc-200/60"
            >
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Numbers list */}
      {numbers.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">
              Αριθμοί στο pool
            </p>
          </div>
          <ul className="divide-y divide-zinc-100">
            {numbers.map((n) => {
              const badge = statusBadge(n.status);
              return (
                <li
                  key={n.id}
                  className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="font-mono text-sm font-semibold text-zinc-900">
                    {n.e164_number}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-xs text-zinc-400">{n.provider}</span>
                  <span className="ml-auto text-right text-xs text-zinc-400">
                    <span className="block">
                      Εισαγωγή: {formatDate(n.imported_at)}
                    </span>
                    {n.assigned_at && (
                      <span className="block">
                        Ανάθεση: {formatDate(n.assigned_at)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stats && numbers.length === 0 && (
        <p className="text-sm text-zinc-400">
          Δεν υπάρχουν αριθμοί στο pool ακόμα.
        </p>
      )}

      {/* Import form */}
      <section className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900">
          Εισαγωγή νέου αριθμού
        </h2>
        <form onSubmit={handleImport} className="space-y-4">
          <div>
            <label
              htmlFor="pool-e164"
              className="mb-1 block text-xs font-medium text-zinc-600"
            >
              Αριθμός E.164
            </label>
            <input
              id="pool-e164"
              type="text"
              value={importE164}
              onChange={(e) => setImportE164(e.target.value)}
              placeholder="+302101234567"
              required
              autoComplete="off"
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label
              htmlFor="pool-notes"
              className="mb-1 block text-xs font-medium text-zinc-600"
            >
              Σημειώσεις (προαιρετικό)
            </label>
            <input
              id="pool-notes"
              type="text"
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              placeholder="Προαιρετικές σημειώσεις..."
              maxLength={500}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={importLoading || !importE164.trim()}
              className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importLoading ? 'Εισαγωγή...' : 'Εισαγωγή αριθμού'}
            </button>
            {importSuccess && (
              <p className="text-sm text-green-600">{importSuccess}</p>
            )}
            {importError && (
              <p className="text-sm text-red-600">{importError}</p>
            )}
          </div>
        </form>
      </section>

    </main>
  );
}
