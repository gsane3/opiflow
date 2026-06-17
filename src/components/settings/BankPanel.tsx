'use client';

// Τραπεζικά στοιχεία — MULTIPLE accounts (α). Each account = δικαιούχος / τράπεζα /
// IBAN; the FIRST (primary) is what the customer sees on the payment card + offer
// PDF (mirrored server-side into businesses.bank_*). Backed by
// /api/businesses/me/bank-accounts (migration 051). «+ Προσθήκη λογαριασμού»
// pre-fills the beneficiary from the first account or the company name.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/ui/Spinner';

interface Acct {
  key: string;
  id: string | null;
  beneficiary: string;
  bank: string;
  iban: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const normalizeIban = (v: string) => v.replace(/\s+/g, '').toUpperCase();

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
  } catch {
    return null;
  }
}

let keyCounter = 0;
const newKey = () => `new-${keyCounter++}`;

export default function BankPanel() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoadError('Συνδέσου ξανά.'); setLoading(false); return; }
    try {
      const [aRes, bRes] = await Promise.all([
        fetch('/api/businesses/me/bank-accounts', { headers }),
        fetch('/api/businesses/me', { headers }),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      const list = (aJson?.accounts ?? []) as Array<{ id: string; beneficiary: string | null; bankName: string | null; iban: string }>;
      setAccounts(list.map((a) => ({ key: a.id, id: a.id, beneficiary: a.beneficiary ?? '', bank: a.bankName ?? '', iban: a.iban ?? '', saving: false, saved: false, error: null })));
      const bJson = await bRes.json().catch(() => ({}));
      const b = bJson?.business as { name?: string | null; legal_name?: string | null; trade_name?: string | null } | undefined;
      setCompanyName((b?.legal_name || b?.name || b?.trade_name || '').trim());
    } catch {
      /* keep empty; the panel still renders */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = (key: string, upd: Partial<Acct>) => setAccounts((prev) => prev.map((a) => (a.key === key ? { ...a, ...upd } : a)));

  function addAccount() {
    const suggested = accounts[0]?.beneficiary?.trim() || companyName || '';
    setAccounts((prev) => [...prev, { key: newKey(), id: null, beneficiary: suggested, bank: '', iban: '', saving: false, saved: false, error: null }]);
  }

  async function saveAccount(key: string) {
    const acct = accounts.find((a) => a.key === key);
    if (!acct) return;
    const normIban = normalizeIban(acct.iban);
    if (!IBAN_RE.test(normIban)) { patch(key, { error: 'Το IBAN δεν φαίνεται έγκυρο (π.χ. GR16 0110 1250 0000 0001 2300 695).' }); return; }
    const headers = await authHeaders();
    if (!headers) { patch(key, { error: 'Συνδέσου ξανά.' }); return; }
    patch(key, { saving: true, saved: false, error: null });
    try {
      const body = JSON.stringify({ beneficiary: acct.beneficiary.trim() || null, bank: acct.bank.trim() || null, iban: normIban });
      const res = acct.id
        ? await fetch(`/api/businesses/me/bank-accounts/${acct.id}`, { method: 'PATCH', headers, body })
        : await fetch('/api/businesses/me/bank-accounts', { method: 'POST', headers, body });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.account) {
        patch(key, { id: json.account.id, iban: json.account.iban, saving: false, saved: true });
        setTimeout(() => patch(key, { saved: false }), 2500);
      } else if (json?.error === 'invalid_iban') {
        patch(key, { saving: false, error: 'Το IBAN δεν είναι έγκυρο.' });
      } else if (json?.error === 'bank_unavailable') {
        patch(key, { saving: false, error: 'Δεν είναι ακόμα διαθέσιμο. Δοκίμασε ξανά σύντομα.' });
      } else {
        patch(key, { saving: false, error: 'Η αποθήκευση απέτυχε.' });
      }
    } catch {
      patch(key, { saving: false, error: 'Η αποθήκευση απέτυχε.' });
    }
  }

  async function removeAccount(key: string) {
    const acct = accounts.find((a) => a.key === key);
    if (!acct) return;
    if (!acct.id) { setAccounts((prev) => prev.filter((a) => a.key !== key)); return; }
    const headers = await authHeaders();
    if (!headers) return;
    patch(key, { saving: true, error: null });
    try {
      const res = await fetch(`/api/businesses/me/bank-accounts/${acct.id}`, { method: 'DELETE', headers });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) setAccounts((prev) => prev.filter((a) => a.key !== key));
      else patch(key, { saving: false, error: 'Η διαγραφή απέτυχε.' });
    } catch {
      patch(key, { saving: false, error: 'Η διαγραφή απέτυχε.' });
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-indigo-500" /></div>;

  const inputCls = 'mt-1.5 w-full rounded-xl bg-zinc-100 dark:bg-[#1e2b38] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Τραπεζικοί λογαριασμοί</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Εμφανίζονται στον πελάτη όταν του ζητάς κατάθεση/εξόφληση και στην προσφορά. Ο <b>πρώτος</b> λογαριασμός είναι ο κύριος (αυτός που βλέπει ο πελάτης). Το Opiflow δεν διαχειρίζεται χρήματα — ο πελάτης καταθέτει απευθείας σε εσένα.
        </p>
      </div>

      {accounts.length === 0 && (
        <div className="rounded-2xl bg-white dark:bg-[#17232f] px-5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/60 dark:ring-white/10">
          Δεν έχεις προσθέσει τραπεζικό λογαριασμό ακόμα.
        </div>
      )}

      {accounts.map((a, idx) => (
        <div key={a.key} className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              {idx === 0 ? 'Κύριος λογαριασμός' : `Λογαριασμός ${idx + 1}`}
            </p>
            <button type="button" onClick={() => void removeAccount(a.key)} disabled={a.saving} className="text-xs font-semibold text-red-600 transition hover:text-red-700 disabled:opacity-40">Διαγραφή</button>
          </div>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Δικαιούχος</span>
              <input type="text" value={a.beneficiary} onChange={(e) => patch(a.key, { beneficiary: e.target.value, saved: false })} placeholder="π.χ. Γεώργιος Παπαδόπουλος" maxLength={200} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Τράπεζα</span>
              <input type="text" value={a.bank} onChange={(e) => patch(a.key, { bank: e.target.value, saved: false })} placeholder="π.χ. Εθνική Τράπεζα" maxLength={200} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">IBAN</span>
              <input type="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={a.iban} onChange={(e) => patch(a.key, { iban: e.target.value.toUpperCase(), saved: false })} placeholder="GR16 0110 1250 0000 0001 2300 695" maxLength={42} className={`${inputCls} font-mono tracking-wide`} />
              <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">Τα κενά αγνοούνται.</span>
            </label>
          </div>
          {a.error && <p className="mt-2 text-sm text-red-600">{a.error}</p>}
          <button type="button" onClick={() => void saveAccount(a.key)} disabled={a.saving} className="mt-3 flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40">
            {a.saving && <Spinner className="text-white" />}
            {a.saved ? 'Αποθηκεύτηκε ✓' : 'Αποθήκευση'}
          </button>
        </div>
      ))}

      <button type="button" onClick={addAccount} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-white/15 px-5 py-3 text-sm font-semibold text-zinc-600 dark:text-zinc-300 transition hover:border-indigo-400 hover:text-indigo-600">
        + Προσθήκη λογαριασμού
      </button>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
    </div>
  );
}
