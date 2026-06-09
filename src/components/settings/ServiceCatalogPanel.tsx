'use client';

// Settings → Κατάλογος υπηρεσιών/προϊόντων (redesign P4). The team-shared price
// list that feeds the offer composer's auto-suggest. Manual CRUD here; AI paste /
// file import comes next. CRUD via /api/catalog (+ /api/catalog/[id]).

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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
    <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-sm font-semibold text-zinc-900">Κατάλογος υπηρεσιών / προϊόντων</p>
      <p className="mt-0.5 text-xs text-zinc-400">
        Οι υπηρεσίες &amp; τα υλικά σου με τιμές — για γρήγορη δημιουργία προσφορών (κοινός για την ομάδα).
      </p>

      {/* Add form */}
      <div className="mt-3 space-y-2 rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-200/60">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα υπηρεσίας/υλικού" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Κωδ." className="w-20 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Μον. (τεμ./ώρα)" className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="€" className="w-20 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          <input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" placeholder="ΦΠΑ%" className="w-16 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
        </div>
        <button type="button" onClick={addItem} disabled={busy || !name.trim()} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">
          {busy ? 'Προσθήκη…' : '+ Προσθήκη στον κατάλογο'}
        </button>
        {error && <p className="text-xs text-amber-600">{error}</p>}
      </div>

      {/* List */}
      <div className="mt-3 space-y-1.5">
        {loading ? (
          <p className="py-4 text-center text-xs text-zinc-400">Φόρτωση…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-400">Ο κατάλογος είναι κενός.</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-zinc-50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {it.code ? <span className="text-zinc-400">{it.code} · </span> : null}{it.name}
                </p>
                <p className="text-xs text-zinc-500">€{it.unitPrice.toLocaleString('el-GR')}{it.unit ? ` / ${it.unit}` : ''} · ΦΠΑ {it.vatRate}%</p>
              </div>
              <button type="button" onClick={() => removeItem(it.id)} aria-label="Διαγραφή" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-red-50 hover:text-red-500">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
