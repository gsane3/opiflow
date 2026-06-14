'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const card = 'rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10';

export default function AccountPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'checkout' | 'portal' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  // null = unknown (loading); avoids flashing dead buttons before we know.
  const [billingEnabled, setBillingEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setBillingEnabled(Boolean(d?.integrations?.billing));
      })
      .catch(() => {
        if (!cancelled) setBillingEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function getToken(): Promise<string | null> {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async function billing(path: '/api/billing/checkout' | '/api/billing/portal', which: 'checkout' | 'portal') {
    setError(null);
    setBusy(which);
    try {
      const token = await getToken();
      if (!token) { setError('Πρέπει να συνδεθείς ξανά.'); setBusy(null); return; }
      const res = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (data.ok && data.url) { window.location.href = data.url; return; }
      if (data.error === 'billing_not_configured') setError('Οι πληρωμές δεν είναι ρυθμισμένες ακόμα.');
      else if (data.error === 'no_customer') setError('Δεν βρέθηκε ενεργή συνδρομή για διαχείριση.');
      else setError('Κάτι πήγε στραβά. Δοκίμασε ξανά.');
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setError(null);
    setBusy('delete');
    try {
      const token = await getToken();
      if (!token) { setError('Πρέπει να συνδεθείς ξανά.'); setBusy(null); return; }
      const res = await fetch('/api/account/delete', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        try { await createBrowserSupabaseClient().auth.signOut(); } catch {}
        router.replace('/');
        return;
      }
      setError('Η διαγραφή απέτυχε. Δοκίμασε ξανά ή επικοινώνησε μαζί μας.');
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Subscription — only show the billing actions when Stripe is configured,
          so we never present buttons that 503. */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Συνδρομή</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Διαχειρίσου το πλάνο και τις πληρωμές σου.</p>
        {billingEnabled === true ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => billing('/api/billing/checkout', 'checkout')}
              disabled={busy !== null}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy === 'checkout' ? 'Άνοιγμα...' : 'Αναβάθμιση πλάνου'}
            </button>
            <button
              type="button"
              onClick={() => billing('/api/billing/portal', 'portal')}
              disabled={busy !== null}
              className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-60"
            >
              {busy === 'portal' ? 'Άνοιγμα...' : 'Διαχείριση συνδρομής'}
            </button>
          </div>
        ) : billingEnabled === false ? (
          <p className="mt-3 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/60 dark:ring-white/10">
            Οι online πληρωμές δεν είναι ενεργές ακόμα. Για αλλαγή πλάνου επικοινώνησε μαζί μας.
          </p>
        ) : (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">Φόρτωση…</p>
        )}
      </div>

      {/* Danger zone */}
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-sm ring-1 ring-red-200">
        <h2 className="text-sm font-semibold text-red-700">Διαγραφή λογαριασμού</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Διαγράφει οριστικά τον λογαριασμό σου και όλα τα δεδομένα (πελάτες, προσφορές, ραντεβού). Δεν αναιρείται.
        </p>
        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mt-3 rounded-xl border border-red-300 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            Διαγραφή λογαριασμού
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-600 dark:text-zinc-300">Γράψε <b>ΔΙΑΓΡΑΦΗ</b> για επιβεβαίωση.</p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ΔΙΑΓΡΑΦΗ"
              className="w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={confirmText.trim() !== 'ΔΙΑΓΡΑΦΗ' || busy !== null}
                onClick={deleteAccount}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy === 'delete' ? 'Διαγραφή...' : 'Οριστική διαγραφή'}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmText(''); }}
                className="rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                Άκυρο
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}
    </div>
  );
}
