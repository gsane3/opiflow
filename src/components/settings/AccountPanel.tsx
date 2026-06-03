'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const card = 'rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-zinc-200/60';

export default function AccountPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'checkout' | 'portal' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

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
      {/* Subscription */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-900">Συνδρομή</h2>
        <p className="mt-1 text-xs text-zinc-500">Διαχειρίσου το πλάνο και τις πληρωμές σου.</p>
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
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
          >
            {busy === 'portal' ? 'Άνοιγμα...' : 'Διαχείριση συνδρομής'}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-red-200">
        <h2 className="text-sm font-semibold text-red-700">Διαγραφή λογαριασμού</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Διαγράφει οριστικά τον λογαριασμό σου και όλα τα δεδομένα (πελάτες, προσφορές, ραντεβού). Δεν αναιρείται.
        </p>
        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            Διαγραφή λογαριασμού
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-600">Γράψε <b>ΔΙΑΓΡΑΦΗ</b> για επιβεβαίωση.</p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ΔΙΑΓΡΑΦΗ"
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
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
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
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
