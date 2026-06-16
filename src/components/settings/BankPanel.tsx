'use client';

// Τραπεζικά στοιχεία: beneficiary / bank / IBAN, shown to the customer on the
// portal payment card and the offer PDF. Backed by /api/businesses/me/bank
// (migration 048). The GET is tolerant of the pre-048 state (returns nulls);
// PATCH returns 503 bank_unavailable before the migration is applied — handled
// gracefully here so Settings never breaks.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/ui/Spinner';

interface Bank {
  beneficiary: string | null;
  bank: string | null;
  iban: string | null;
}

// Must match the server regex in /api/businesses/me/bank (after normalizing).
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

function normalizeIban(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}

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

export default function BankPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [beneficiary, setBeneficiary] = useState('');
  const [bank, setBank] = useState('');
  const [iban, setIban] = useState('');

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); setLoading(false); return; }
    try {
      const res = await fetch('/api/businesses/me/bank', { headers });
      const json = await res.json().catch(() => ({}));
      const b = json?.bank as Bank | undefined;
      if (b) {
        setBeneficiary(b.beneficiary ?? '');
        setBank(b.bank ?? '');
        setIban(b.iban ?? '');
      }
    } catch {
      // keep empty defaults; the panel still renders
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setError(null);

    // Client-side IBAN check (server validates again). Empty = clear it.
    const normIban = normalizeIban(iban);
    if (normIban.length > 0 && !IBAN_RE.test(normIban)) {
      setError('Το IBAN δεν φαίνεται έγκυρο. Έλεγξε τη μορφή (π.χ. GR16 0110 1250 0000 0001 2300 695).');
      return;
    }

    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); return; }

    setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/businesses/me/bank', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          beneficiary: beneficiary.trim() || null,
          bank: bank.trim() || null,
          iban: normIban || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        const b = json.bank as Bank | undefined;
        if (b) {
          setBeneficiary(b.beneficiary ?? '');
          setBank(b.bank ?? '');
          setIban(b.iban ?? '');
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else if (json?.error === 'invalid_iban') {
        setError('Το IBAN δεν είναι έγκυρο.');
      } else if (json?.error === 'bank_unavailable') {
        setError('Αυτή η λειτουργία δεν είναι ακόμα διαθέσιμη. Δοκίμασε ξανά σύντομα.');
      } else {
        setError('Η αποθήκευση απέτυχε.');
      }
    } catch {
      setError('Η αποθήκευση απέτυχε.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-indigo-500" /></div>;

  const inputCls =
    'mt-1.5 w-full rounded-xl bg-zinc-100 dark:bg-[#1e2b38] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Τραπεζικός λογαριασμός</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Εμφανίζονται στον πελάτη όταν του ζητάς κατάθεση/εξόφληση και στην προσφορά. Το Opiflow δεν διαχειρίζεται χρήματα — ο πελάτης καταθέτει απευθείας σε εσένα.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Δικαιούχος</span>
            <input
              type="text"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="π.χ. Γεώργιος Παπαδόπουλος"
              maxLength={200}
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Τράπεζα</span>
            <input
              type="text"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              placeholder="π.χ. Εθνική Τράπεζα"
              maxLength={200}
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">IBAN</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={iban}
              onChange={(e) => setIban(e.target.value.toUpperCase())}
              placeholder="GR16 0110 1250 0000 0001 2300 695"
              maxLength={42}
              className={`${inputCls} font-mono tracking-wide`}
            />
            <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">Τα κενά αγνοούνται — γράψ’ το όπως θέλεις.</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:ring-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40"
      >
        {saving && <Spinner className="text-white" />}
        {saved ? 'Αποθηκεύτηκε ✓' : 'Αποθήκευση'}
      </button>
    </div>
  );
}
