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
  suspended: number;
  cooling_down: number;
  retired: number;
  total: number;
  by_city: Record<string, number>;
  by_type?: Record<string, number>;
}

interface PoolNumber {
  id: string;
  e164_number: string;
  provider: string;
  city: string | null;
  number_type: string | null;
  status: string;
  imported_at: string;
  assigned_at: string | null;
  cooling_down_since: string | null;
  available_after: string | null;
  retired_at: string | null;
  // Safe assignment metadata returned by GET enrichment.
  // Never includes email, phone, vat, address, owner_id or other sensitive fields.
  assigned_business_id:   string | null;
  assigned_business_name: string | null;
  assignment_status:      string | null;
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

interface ReleaseApiResponse {
  ok: boolean;
  released?: boolean;
  managed_phone_number_id?: string | null;
  available_after?: string | null;
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
    case 'suspended':
      return { label: 'Σε αναστολή', cls: 'bg-orange-50 text-orange-700 ring-orange-200' };
    case 'cooling_down':
      return { label: 'Αποψύχεται', cls: 'bg-sky-50 text-sky-700 ring-sky-200' };
    case 'retired':
      return { label: 'Αποσυρμένος', cls: 'bg-zinc-100 text-zinc-500 ring-zinc-200' };
    default:
      return { label: status, cls: 'bg-zinc-100 text-zinc-500 ring-zinc-200' };
  }
}

function numberTypeLabel(type: string | null): string {
  if (type === 'platform_owned') return 'Πλατφόρμας';
  if (type === 'customer_ported') return 'Πελάτη';
  return 'Άγνωστος τύπος';
}

const IMPORT_ERRORS: Record<string, string> = {
  invalid_e164: 'Μη έγκυρος αριθμός. Χρησιμοποίησε τη μορφή +302101234567.',
  invalid_provider: 'Μη αποδεκτός πάροχος.',
  invalid_city: 'Η πόλη υπερβαίνει τα 100 χαρακτήρες.',
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
  const [importCity, setImportCity] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Release action state: tracks which row is in-flight and the last result.
  const [releaseLoadingId, setReleaseLoadingId] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<{
    mpnId: string;
    msg: string;
    isError: boolean;
  } | null>(null);

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
      const trimmedCity = importCity.trim();
      if (trimmedCity) {
        body['city'] = trimmedCity;
      }
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
      setImportCity('');
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
  // Release number action
  // ---------------------------------------------------------------------------
  // Calls PATCH /api/admin/phone-pool with business_id only.
  // Does NOT send e164_number, business name, or any other sensitive data.
  // Requires window.confirm before proceeding.

  async function handleRelease(businessId: string, mpnId: string) {
    const confirmed = window.confirm(
      'Αυτό θα αποδεσμεύσει τον αριθμό και, για αριθμό πλατφόρμας, θα τον βάλει σε αποψύξη 18 μηνών. Δεν συνδέεται ακόμα με ακύρωση συνδρομής.'
    );
    if (!confirmed) return;

    setReleaseLoadingId(mpnId);
    setReleaseResult(null);

    try {
      const token = await getToken();
      if (!token) {
        setReleaseResult({
          mpnId,
          msg: 'Δεν έγινε η αποδέσμευση. Δοκίμασε ξανά.',
          isError: true,
        });
        return;
      }

      const res = await fetch('/api/admin/phone-pool', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          business_id:    businessId,
          release_reason: 'admin_release',
        }),
      });

      const json = (await res.json()) as ReleaseApiResponse;

      if (res.status === 403 || json.error === 'forbidden') {
        setForbidden(true);
        return;
      }

      if (!res.ok || !json.ok) {
        setReleaseResult({
          mpnId,
          msg: 'Δεν έγινε η αποδέσμευση. Δοκίμασε ξανά.',
          isError: true,
        });
        return;
      }

      setReleaseResult({
        mpnId,
        msg: json.released === true
          ? 'Ο αριθμός αποδεσμεύτηκε. Αν είναι αριθμός πλατφόρμας, μπήκε σε αποψύξη 18 μηνών.'
          : 'Δεν βρέθηκε ενεργή ανάθεση για αποδέσμευση.',
        isError: false,
      });

      await loadPool();
    } catch {
      setReleaseResult({
        mpnId,
        msg: 'Δεν έγινε η αποδέσμευση. Δοκίμασε ξανά.',
        isError: true,
      });
    } finally {
      setReleaseLoadingId(null);
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { label: 'Διαθέσιμοι', value: stats.available, cls: 'text-green-700' },
              { label: 'Ανατεθ.', value: stats.assigned, cls: 'text-indigo-700' },
              { label: 'Δεσμευμ.', value: stats.reserved, cls: 'text-amber-700' },
              { label: 'Αναστολή', value: stats.suspended, cls: 'text-orange-700' },
              { label: 'Αποψύξη', value: stats.cooling_down, cls: 'text-sky-700' },
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

      {/* City inventory breakdown */}
      {stats && Object.keys(stats.by_city).length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">Κατανομή ανά πόλη</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Τα tags πόλης προετοιμάζουν μελλοντική ανάθεση βάσει πόλης. Η ανάθεση γίνεται ακόμα καθολικά.
            </p>
          </div>
          <ul className="divide-y divide-zinc-100">
            {Object.entries(stats.by_city)
              .sort(([, a], [, b]) => b - a)
              .map(([cityKey, count]) => (
                <li key={cityKey} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-zinc-700">
                    {cityKey !== '' ? cityKey : <span className="italic text-zinc-400">Χωρίς πόλη</span>}
                  </span>
                  <span className="text-sm font-semibold text-zinc-900">{count}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Numbers list */}
      {numbers.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">
              Αριθμοί στο pool
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Η αποδέσμευση αριθμού είναι backend-ready, αλλά δεν έχει συνδεθεί ακόμα με ακύρωση συνδρομής.
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
                  <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
                    {numberTypeLabel(n.number_type)}
                  </span>
                  {n.city ? (
                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
                      {n.city}
                    </span>
                  ) : (
                    <span className="text-xs italic text-zinc-300">Χωρίς πόλη</span>
                  )}
                  {n.status === 'cooling_down' && (
                    <span className="w-full text-xs text-sky-600">
                      Αποψύξη: {formatDate(n.cooling_down_since)} · Επαναχρησιμοποίηση: {formatDate(n.available_after)}
                    </span>
                  )}
                  {n.status === 'assigned' && (
                    <span className="flex w-full flex-wrap items-center gap-2">
                      {n.assigned_business_name ? (
                        <span className="text-xs text-zinc-500">
                          Επιχείρηση: {n.assigned_business_name}
                        </span>
                      ) : n.assigned_business_id ? (
                        <span className="text-xs text-zinc-500">Συνδεδεμένη επιχείρηση</span>
                      ) : null}
                      {n.assigned_business_id ? (
                        <button
                          type="button"
                          onClick={() => handleRelease(n.assigned_business_id!, n.id)}
                          disabled={releaseLoadingId === n.id}
                          className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {releaseLoadingId === n.id ? 'Αποδέσμευση...' : 'Αποδέσμευση'}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400">
                          Δεν υπάρχει ακόμα σύνδεση επιχείρησης για αποδέσμευση από UI.
                        </span>
                      )}
                    </span>
                  )}
                  {releaseResult?.mpnId === n.id && (
                    <span className={`w-full text-xs ${releaseResult.isError ? 'text-red-600' : 'text-green-600'}`}>
                      {releaseResult.msg}
                    </span>
                  )}
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
              htmlFor="pool-city"
              className="mb-1 block text-xs font-medium text-zinc-600"
            >
              Πόλη (προαιρετικό)
            </label>
            <input
              id="pool-city"
              type="text"
              value={importCity}
              onChange={(e) => setImportCity(e.target.value)}
              placeholder="π.χ. Αθήνα"
              maxLength={100}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Προετοιμάζει τη μελλοντική ανάθεση βάσει πόλης. Δεν επηρεάζει την τρέχουσα ανάθεση.
            </p>
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
