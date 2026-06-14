'use client';

// Settings → Κατάλογος υπηρεσιών/προϊόντων (redesign P4). The team-shared price
// list that feeds the offer composer's auto-suggest. Manual CRUD here; AI paste /
// file import comes next. CRUD via /api/catalog (+ /api/catalog/[id]).

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

interface CatalogItem {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  category: string | null;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch {
    return null;
  }
}

export default function ServiceCatalogPanel() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('24');

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch('/api/catalog', { headers });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && Array.isArray(json.items)) setItems(json.items as CatalogItem[]);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addItem() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || undefined,
          unit: unit.trim() || undefined,
          unitPrice: price ? Number(price) : 0,
          vatRate: vat ? Number(vat) : 24,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.item) {
        setItems((prev) => [json.item as CatalogItem, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
        setName(''); setCode(''); setUnit(''); setPrice('');
      } else {
        setError(json?.error === 'duplicate_code' ? 'Υπάρχει ήδη είδος με αυτόν τον κωδικό.' : 'Δεν προστέθηκε.');
      }
    } catch {
      setError('Δεν προστέθηκε.');
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    const headers = await authHeaders();
    if (!headers) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await fetch(`/api/catalog/${id}`, { method: 'DELETE', headers });
    } catch {
      /* optimistic; reload on next mount corrects */
    }
  }

  return (
    <div className="mt-4 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Κατάλογος υπηρεσιών / προϊόντων</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Οι υπηρεσίες &amp; τα υλικά σου με τιμές — για γρήγορη δημιουργία προσφορών (κοινός για την ομάδα).
      </p>

      {/* Add form */}
      <div className="mt-3 space-y-2 rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] p-3 ring-1 ring-zinc-200/60 dark:ring-white/10">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα υπηρεσίας/υλικού" className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500" />
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Κωδ." className="w-20 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Μον. (τεμ./ώρα)" className="flex-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="€" className="w-20 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500" />
          <input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" placeholder="ΦΠΑ%" className="w-16 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500" />
        </div>
        <Button type="button" onClick={addItem} disabled={busy || !name.trim()} loading={busy} fullWidth>
          {busy ? 'Προσθήκη…' : '+ Προσθήκη στον κατάλογο'}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* List */}
      <div className="mt-3 space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Spinner size="sm" className="text-indigo-500" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Φόρτωση…</span>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={
              <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
              </svg>
            }
            title="Ο κατάλογος είναι κενός"
            description="Πρόσθεσε υπηρεσίες ή υλικά με τιμές για να τα προτείνει αυτόματα ο συντάκτης προσφορών."
          />
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex min-h-[44px] items-center gap-2 rounded-xl px-2 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {it.code ? <span className="text-zinc-400 dark:text-zinc-500">{it.code} · </span> : null}{it.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400"><span className="tabular-nums">€{it.unitPrice.toLocaleString('el-GR')}</span>{it.unit ? ` / ${it.unit}` : ''} · ΦΠΑ <span className="tabular-nums">{it.vatRate}</span>%</p>
              </div>
              <button type="button" onClick={() => removeItem(it.id)} aria-label="Διαγραφή" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition hover:bg-red-50 hover:text-red-500 active:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
