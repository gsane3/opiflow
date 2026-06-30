'use client';

// Account → «Τιμολόγηση μέσω εφαρμογής (ΑΑΔΕ/myDATA)».
// Optional per-tenant feature, activated here via a step-by-step WIZARD:
//   1. Συνδρομή — pay the monthly add-on (Stripe Checkout). Shown only when the
//      add-on price is configured (integrations.invoicing_addon); otherwise skipped.
//   2. Στοιχεία έκδοσης — ΑΦΜ + σειρά παραστατικών.
//   3. Εξουσιοδότηση ΑΑΔΕ — authorize the provider (SBZ) on the gsis portal.
//   4. Ενεργοποίηση — turn it on (+ optional auto-issue on payment).
// Gated on /api/health.integrations.invoicing (the SBZ provider env). Reads/writes
// /api/invoicing/settings; the pay step posts /api/invoicing/checkout.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { OpfIcon } from '@/components/opf/icon';

const card = 'rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10';

interface InvoicingSettings {
  enabled: boolean;
  issuer_vat: string | null;
  invoice_series: string | null;
  auto_issue_on_payment: boolean;
  onboarding_status: string;
}
interface AddonStatus { addon_status: 'none' | 'active' | 'cancelled'; addon_current_period_end: string | null }
interface SettingsResponse {
  ok?: boolean;
  settings?: InvoicingSettings | null;
  configured?: boolean;
  addonConfigured?: boolean;
  addon?: AddonStatus | null;
}

export default function InvoicingPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [addonConfigured, setAddonConfigured] = useState(false);
  const [addonStatus, setAddonStatus] = useState<'none' | 'active' | 'cancelled'>('none');
  const [onboarding, setOnboarding] = useState('not_started');

  const [issuerVat, setIssuerVat] = useState('');
  const [invoiceSeries, setInvoiceSeries] = useState('');
  const [autoIssue, setAutoIssue] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function getToken(): Promise<string | null> {
    try {
      const { data: { session } } = await createBrowserSupabaseClient().auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  const load = useCallback(async () => {
    try {
      const health = await fetch('/api/health').then((r) => r.json());
      const ok = Boolean(health?.integrations?.invoicing);
      setConfigured(ok);
      if (!ok) return;
      const token = await getToken();
      if (!token) return;
      const res = await fetch('/api/invoicing/settings', { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as SettingsResponse;
      setAddonConfigured(Boolean(data.addonConfigured));
      setAddonStatus(data.addon?.addon_status ?? 'none');
      const s = data.settings;
      if (s) {
        setIssuerVat(s.issuer_vat ?? '');
        setInvoiceSeries(s.invoice_series ?? '');
        setAutoIssue(s.auto_issue_on_payment);
        setEnabled(s.enabled);
        setOnboarding(s.onboarding_status ?? 'not_started');
      }
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Returned from Stripe Checkout → show feedback + reload (the webhook flips addon_status).
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('invoicing');
      if (q === 'success') setNote('Η συνδρομή ενεργοποιήθηκε. Συνέχισε τα επόμενα βήματα.');
      else if (q === 'cancelled') setError('Η πληρωμή ακυρώθηκε.');
    }
  }, [load]);

  // PUT a partial settings patch; reloads on success.
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) { setError('Πρέπει να συνδεθείς ξανά.'); return false; }
      const res = await fetch('/api/invoicing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) { await load(); return true; }
      setError(
        data.error === 'invalid_input' ? 'Έλεγξε το ΑΦΜ — δεν είναι έγκυρο.'
          : data.error === 'forbidden_admin_only' ? 'Μόνο ο ιδιοκτήτης/διαχειριστής μπορεί να το αλλάξει.'
            : 'Δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
      );
      return false;
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Start the Stripe Checkout for the monthly add-on.
  async function startCheckout() {
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) { setError('Πρέπει να συνδεθείς ξανά.'); return; }
      const res = await fetch('/api/invoicing/checkout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { ok?: boolean; url?: string };
      if (res.ok && data.ok && data.url) { window.location.href = data.url; return; }
      setError('Δεν ξεκίνησε η πληρωμή. Δοκίμασε ξανά.');
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) {
    return <div className={card}><p className="text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση…</p></div>;
  }

  // Step completion. `enabled` short-circuits to done (back-compat with the old flat
  // panel, which set enabled=true without advancing onboarding_status).
  const payDone = !addonConfigured || addonStatus === 'active';
  const issuerDone = issuerVat.trim().length > 0;
  const gsisDone = onboarding === 'gsis_authorized' || onboarding === 'active';
  const activeDone = enabled;
  const current = !payDone ? 1 : !issuerDone ? 2 : (!gsisDone && !activeDone) ? 3 : !activeDone ? 4 : 5;

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
      ) : current === 5 ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-medium text-green-700 ring-1 ring-green-200">
            ✓ Ενεργό — μπορείς να εκδίδεις τιμολόγια («τύπωσε τιμολόγιο …» στον AI βοηθό).
          </p>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-200/60 dark:ring-white/10">
            <span className="text-xs text-zinc-700 dark:text-zinc-200">Αυτόματη έκδοση τιμολογίου όταν επιβεβαιώνεται πληρωμή</span>
            <input type="checkbox" checked={autoIssue} onChange={(e) => { setAutoIssue(e.target.checked); void patch({ autoIssueOnPayment: e.target.checked }); }} className="h-4 w-4 accent-indigo-600" />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {note && <p className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700 ring-1 ring-green-200">{note}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Step 1 — pay the monthly add-on (only when the add-on price is configured) */}
          {addonConfigured && (
            <Step n={1} title="Συνδρομή τιμολόγησης" done={payDone} active={current === 1}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Μηνιαία συνδρομή για την υπηρεσία έκδοσης τιμολογίων. Ασφαλής πληρωμή μέσω Stripe.</p>
              <button type="button" onClick={() => void startCheckout()} disabled={busy} className="mt-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
                {busy ? 'Μεταφορά…' : 'Ενεργοποίηση συνδρομής'}
              </button>
            </Step>
          )}

          {/* Step 2 — issuer ΑΦΜ + series */}
          <Step n={addonConfigured ? 2 : 1} title="Στοιχεία έκδοσης" done={issuerDone} active={current === 2}>
            <label className="block">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">ΑΦΜ έκδοσης</span>
              <input value={issuerVat} onChange={(e) => setIssuerVat(e.target.value)} inputMode="numeric" placeholder="π.χ. 094000000" className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </label>
            <label className="mt-2 block">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Σειρά παραστατικών (προαιρετικό)</span>
              <input value={invoiceSeries} onChange={(e) => setInvoiceSeries(e.target.value)} placeholder="π.χ. Α" className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </label>
            <button type="button" onClick={() => void patch({ issuerVat: issuerVat.trim(), invoiceSeries: invoiceSeries.trim() })} disabled={busy || !issuerVat.trim()} className="mt-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {busy ? 'Αποθήκευση…' : 'Αποθήκευση & συνέχεια'}
            </button>
          </Step>

          {/* Step 3 — authorize SBZ on the gsis portal */}
          <Step n={addonConfigured ? 3 : 2} title="Εξουσιοδότηση ΑΑΔΕ" done={gsisDone} active={current === 3}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Μπες στο <a href="https://www1.aade.gr/saadeapps2/bookkeeper-web/" target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-600 underline">myDATA (gsis)</a> και εξουσιοδότησε τον πάροχο για να στέλνει τα παραστατικά σου. Μόλις το κάνεις, πάτα παρακάτω.
            </p>
            <button type="button" onClick={() => void patch({ onboardingStatus: 'gsis_authorized' })} disabled={busy} className="mt-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {busy ? 'Αποθήκευση…' : 'Το έκανα — συνέχεια'}
            </button>
          </Step>

          {/* Step 4 — activate */}
          <Step n={addonConfigured ? 4 : 3} title="Ενεργοποίηση" done={activeDone} active={current === 4}>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Ενεργοποίησε την έκδοση τιμολογίων.</p>
            <label className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-200/60 dark:ring-white/10">
              <span className="text-xs text-zinc-700 dark:text-zinc-200">Αυτόματη έκδοση όταν επιβεβαιώνεται πληρωμή</span>
              <input type="checkbox" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            </label>
            <button type="button" onClick={() => void patch({ enabled: true, autoIssueOnPayment: autoIssue, onboardingStatus: 'active' })} disabled={busy} className="mt-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {busy ? 'Ενεργοποίηση…' : 'Ενεργοποίηση τιμολόγησης'}
            </button>
          </Step>
        </div>
      )}
    </div>
  );
}

// A single wizard step: number/check badge + title; body shown only when active.
function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-2xl px-3 py-2.5 ring-1 ${active ? 'bg-indigo-50/60 dark:bg-indigo-500/10 ring-indigo-200 dark:ring-indigo-500/30' : 'bg-zinc-50 dark:bg-[#1e2b38] ring-zinc-200/60 dark:ring-white/10'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-green-100 text-green-700' : active ? 'bg-indigo-600 text-white' : 'bg-zinc-200 text-zinc-500 dark:bg-white/10 dark:text-zinc-400'}`}>
          {done ? <OpfIcon name="check" size={14} color="currentColor" stroke={2.5} /> : n}
        </span>
        <span className={`text-xs font-semibold ${active || done ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>{title}</span>
      </div>
      {active && <div className="mt-2.5 pl-[34px]">{children}</div>}
    </div>
  );
}
