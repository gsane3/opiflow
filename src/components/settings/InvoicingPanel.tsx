'use client';

// Account → «Τιμολόγηση μέσω εφαρμογής (ΑΑΔΕ/myDATA)».
// Optional per-tenant feature: the technician activates it here. Gated on
// /api/health.integrations.invoicing (the provider/SBZ env Opiflow sets) — until
// then the card explains it's not available yet (never shows dead controls).
// Reads/writes /api/invoicing/settings. The Stripe add-on payment + the gsis
// authorization step are a guided follow-up; this card is the activation surface.

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const card = 'rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10';

interface InvoicingSettings {
  enabled: boolean;
  issuer_vat: string | null;
  invoice_series: string | null;
  auto_issue_on_payment: boolean;
  onboarding_status: string;
}

export default function InvoicingPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [issuerVat, setIssuerVat] = useState('');
  const [invoiceSeries, setInvoiceSeries] = useState('');
  const [autoIssue, setAutoIssue] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function getToken(): Promise<string | null> {
    try {
      const { data: { session } } = await createBrowserSupabaseClient().auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await fetch('/api/health').then((r) => r.json());
        if (cancelled) return;
        const ok = Boolean(health?.integrations?.invoicing);
        setConfigured(ok);
        if (!ok) return;
        const token = await getToken();
        if (!token) return;
        const res = await fetch('/api/invoicing/settings', { headers: { Authorization: `Bearer ${token}` } });
        const data = (await res.json()) as { ok?: boolean; settings?: InvoicingSettings | null };
        if (cancelled) return;
        const s = data.settings;
        if (s) {
          setEnabled(s.enabled);
          setIssuerVat(s.issuer_vat ?? '');
          setInvoiceSeries(s.invoice_series ?? '');
          setAutoIssue(s.auto_issue_on_payment);
          setActive(s.onboarding_status === 'active' || s.enabled);
        }
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) { setError('Πρέπει να συνδεθείς ξανά.'); return; }
      const res = await fetch('/api/invoicing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enabled,
          issuerVat: issuerVat.trim(),
          invoiceSeries: invoiceSeries.trim(),
          autoIssueOnPayment: autoIssue,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSaved(true);
      } else if (data.error === 'invalid_input') {
        setError('Έλεγξε το ΑΦΜ — δεν είναι έγκυρο.');
      } else if (data.error === 'forbidden_admin_only') {
        setError('Μόνο ο ιδιοκτήτης/διαχειριστής μπορεί να αλλάξει αυτές τις ρυθμίσεις.');
      } else {
        setError('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.');
      }
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) {
    return <div className={card}><p className="text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση…</p></div>;
  }

  return (
    <div className={card}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Τιμολόγηση μέσω εφαρμογής</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Έκδοση επίσημων τιμολογίων / αποδείξεων στους πελάτες σου, με αυτόματη διαβίβαση στο myDATA (ΑΑΔΕ) — χωρίς ταμειακή.
      </p>

      {!configured ? (
        <p className="mt-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/60 dark:ring-white/10">
          Δεν είναι διαθέσιμη ακόμη. Θα ενεργοποιηθεί σύντομα — θα ειδοποιηθείς.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {active && (
            <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-medium text-green-700 ring-1 ring-green-200">
              ✓ Ενεργό — μπορείς να εκδίδεις τιμολόγια («τύπωσε τιμολόγιο …» στον AI βοηθό).
            </p>
          )}

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">ΑΦΜ έκδοσης</span>
            <input
              value={issuerVat}
              onChange={(e) => setIssuerVat(e.target.value)}
              inputMode="numeric"
              placeholder="π.χ. 094000000"
              className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Σειρά παραστατικών (προαιρετικό)</span>
            <input
              value={invoiceSeries}
              onChange={(e) => setInvoiceSeries(e.target.value)}
              placeholder="π.χ. Α"
              className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-200/60 dark:ring-white/10">
            <span className="text-xs text-zinc-700 dark:text-zinc-200">Ενεργό (να μπορώ να εκδίδω τιμολόγια)</span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-200/60 dark:ring-white/10">
            <span className="text-xs text-zinc-700 dark:text-zinc-200">Αυτόματη έκδοση τιμολογίου όταν επιβεβαιώνεται πληρωμή</span>
            <input type="checkbox" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {saved && <p className="text-xs text-green-600">Αποθηκεύτηκε.</p>}

          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={busy}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      )}
    </div>
  );
}
