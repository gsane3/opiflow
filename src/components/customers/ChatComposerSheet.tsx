'use client';

// Chat ➕ composer (redesign P3c-2 / P4b). Bottom sheet opened from the ➕ in the
// Messenger composer, for manual customer actions:
//   • Ζήτα στοιχεία   → POST intake-link { mode:'send' } (preferred channel, Viber→SMS)
//   • Ζήτα φωτογραφίες → POST upload-link { mode:'send' }
//   • Κλείσε ραντεβού  → inline date/time → POST /api/tasks (book_appointment)
//   • Δημιουργία προσφοράς → line items (catalog quick-add) → POST /api/offers
// On success it calls onDone() so the chat timeline refreshes.

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui';

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

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface OfferLine { description: string; quantity: number; unitPrice: number }
interface CatalogResult { id: string; code: string | null; name: string; unitPrice: number; unit: string | null; vatRate: number }

type View = 'menu' | 'appointment' | 'offer';

export default function ChatComposerSheet({
  customerId,
  open,
  onClose,
  onDone,
  initialView = 'menu',
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Open straight into an action (used by the AI suggested-action chips). */
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // appointment
  const [apptDate, setApptDate] = useState(tomorrowISO());
  const [apptTime, setApptTime] = useState('10:00');
  const [apptNote, setApptNote] = useState('');
  // offer
  const [lines, setLines] = useState<OfferLine[]>([]);
  const [offerVat, setOfferVat] = useState('24');
  const [offerNotes, setOfferNotes] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogResult[]>([]);
  const [lineSuggest, setLineSuggest] = useState<{ idx: number; results: CatalogResult[] } | null>(null);

  if (!open) return null;

  function close() {
    setView('menu'); setResult(null); setBusy(false);
    setLines([]); setOfferNotes(''); setCatalogQuery(''); setCatalogResults([]);
    onClose();
  }

  async function sendLink(kind: 'intake' | 'upload') {
    setBusy(true); setResult(null);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); setResult({ ok: false, text: 'Συνδέσου ξανά.' }); return; }
    try {
      const path = kind === 'intake' ? 'intake-link' : 'upload-link';
      const res = await fetch(`/api/customers/${customerId}/${path}`, { method: 'POST', headers, body: JSON.stringify({ mode: 'send' }) });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (json?.ok && json.sent) {
        setResult({ ok: true, text: kind === 'intake' ? 'Στάλθηκε αίτημα στοιχείων' : 'Στάλθηκε αίτημα φωτογραφιών' });
        onDone(); setTimeout(close, 1100);
      } else {
        const r = json?.fallbackReason;
        setResult({ ok: false, text: r === 'missing_mobile' || r === 'missing_email' ? 'Λείπει αριθμός/email του πελάτη.' : r === 'provider_unavailable' ? 'Ο πάροχος αποστολής δεν είναι ρυθμισμένος ακόμα.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.' });
      }
    } catch {
      setResult({ ok: false, text: 'Δεν στάλθηκε. Δοκίμασε ξανά.' });
    } finally { setBusy(false); }
  }

  async function createAppointment() {
    setBusy(true); setResult(null);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); setResult({ ok: false, text: 'Συνδέσου ξανά.' }); return; }
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Ραντεβού', type: 'book_appointment', customerId, dueDate: apptDate, dueTime: apptTime || undefined, note: apptNote || undefined }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean };
      if (json?.ok) { setResult({ ok: true, text: 'Το ραντεβού δημιουργήθηκε' }); onDone(); setTimeout(close, 1100); }
      else setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
    } catch {
      setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
    } finally { setBusy(false); }
  }

  async function searchCatalog(q: string) {
    setCatalogQuery(q);
    if (!q.trim()) { setCatalogResults([]); return; }
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(q.trim())}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && Array.isArray(json.items)) setCatalogResults((json.items as CatalogResult[]).slice(0, 6));
    } catch { /* ignore */ }
  }

  function addLine(line: OfferLine) { setLines((prev) => [...prev, line]); }

  // Per-line catalog autosuggest: typing in a line's description matches the
  // catalog (e.g. "S50" → Alumil Smartia S50 + its code/price).
  async function searchLineCatalog(idx: number, q: string) {
    if (q.trim().length < 2) { setLineSuggest(null); return; }
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(q.trim())}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && Array.isArray(json.items) && json.items.length) setLineSuggest({ idx, results: (json.items as CatalogResult[]).slice(0, 5) });
      else setLineSuggest(null);
    } catch { setLineSuggest(null); }
  }
  function updateLine(i: number, patch: Partial<OfferLine>) { setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }
  function removeLine(i: number) { setLines((prev) => prev.filter((_, idx) => idx !== i)); }

  const validLines = lines.filter((l) => l.description.trim() && l.quantity > 0 && l.unitPrice >= 0);
  const subtotal = validLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const vatNum = Number(offerVat) || 0;
  const total = subtotal + (subtotal * vatNum) / 100;

  async function createOffer() {
    if (validLines.length === 0) return;
    setBusy(true); setResult(null);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); setResult({ ok: false, text: 'Συνδέσου ξανά.' }); return; }
    try {
      const res = await fetch('/api/offers', {
        method: 'POST', headers,
        body: JSON.stringify({
          customerId,
          items: validLines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice })),
          vatRate: vatNum,
          notes: offerNotes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean };
      if (json?.ok) { setResult({ ok: true, text: 'Η προσφορά δημιουργήθηκε' }); onDone(); setTimeout(close, 1100); }
      else setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
    } catch {
      setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
    } finally { setBusy(false); }
  }

  const ACTIONS = [
    {
      key: 'offer',
      icon: (
        <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
      label: 'Προσφορά',
      onClick: () => { setResult(null); setView('offer'); },
    },
    {
      key: 'appointment',
      icon: (
        <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      ),
      label: 'Ραντεβού',
      onClick: () => { setResult(null); setView('appointment'); },
    },
    {
      key: 'intake',
      icon: (
        <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
        </svg>
      ),
      label: 'Στοιχεία',
      onClick: () => sendLink('intake'),
    },
    {
      key: 'photos',
      icon: (
        <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
        </svg>
      ),
      label: 'Φωτο',
      onClick: () => sendLink('upload'),
    },
  ];

  function Back({ title }: { title: string }) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => { setView('menu'); setResult(null); }} aria-label="Πίσω" className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
          <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </button>
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="relative mx-auto max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" />

        {view === 'menu' && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {ACTIONS.map((a) => (
                <button key={a.key} type="button" disabled={busy} onClick={a.onClick} className="flex flex-col items-center gap-2.5 rounded-2xl bg-zinc-50 px-2 py-3.5 ring-1 ring-zinc-200/70 transition hover:bg-zinc-100 active:scale-95 disabled:opacity-50">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">{a.icon}</span>
                  <span className="text-center text-xs font-medium text-zinc-700">{a.label}</span>
                </button>
              ))}
            </div>
            {busy && <p className="mt-3 text-center text-xs text-zinc-500">Αποστολή…</p>}
            {result && (
              <p className={`mt-3 flex items-center justify-center gap-1.5 text-center text-sm font-medium motion-safe:animate-[fadeIn_0.2s_ease-out] ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
                {result.ok && (
                  <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
                {result.text}
              </p>
            )}
          </>
        )}

        {view === 'appointment' && (
          <>
            <Back title="Κλείσε ραντεβού" />
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <label className="flex-1 text-xs font-medium text-zinc-500">Ημερομηνία
                  <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </label>
                <label className="w-28 text-xs font-medium text-zinc-500">Ώρα
                  <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </label>
              </div>
              <input type="text" value={apptNote} onChange={(e) => setApptNote(e.target.value)} placeholder="Σημείωση (προαιρετικό)" className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <Button variant="primary" size="md" fullWidth loading={busy} disabled={busy || !apptDate} onClick={createAppointment}>
                Δημιουργία ραντεβού
              </Button>
              {result && (
                <p className={`flex items-center justify-center gap-1.5 text-center text-sm font-medium motion-safe:animate-[fadeIn_0.2s_ease-out] ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
                  {result.ok && (
                    <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                  {result.text}
                </p>
              )}
            </div>
          </>
        )}

        {view === 'offer' && (
          <>
            <Back title="Δημιουργία προσφοράς" />
            {/* Catalog quick-add */}
            <input value={catalogQuery} onChange={(e) => searchCatalog(e.target.value)} placeholder="Αναζήτηση στον κατάλογο…" className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            {catalogResults.length > 0 && (
              <div className="mt-1 space-y-1 rounded-xl bg-zinc-50 p-1 ring-1 ring-zinc-200/60">
                {catalogResults.map((r) => (
                  <button key={r.id} type="button" onClick={() => { addLine({ description: r.name, quantity: 1, unitPrice: r.unitPrice }); setCatalogQuery(''); setCatalogResults([]); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-sm transition hover:bg-white active:bg-zinc-100">
                    <span className="truncate text-zinc-800">{r.code ? <span className="text-zinc-500">{r.code} · </span> : null}{r.name}</span>
                    <span className="shrink-0 font-medium tabular-nums text-zinc-600">€{r.unitPrice.toLocaleString('el-GR')}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Lines */}
            <div className="mt-2 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="relative">
                  <div className="flex items-center gap-1.5">
                    <input value={l.description} onChange={(e) => { updateLine(i, { description: e.target.value }); void searchLineCatalog(i, e.target.value); }} placeholder="Περιγραφή (π.χ. S50)" aria-label="Περιγραφή γραμμής" className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })} inputMode="decimal" aria-label="Ποσότητα" className="min-h-[40px] w-14 rounded-lg border border-zinc-200 px-2 py-1.5 text-center text-sm tabular-nums outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <div className="relative w-[72px]">
                      <input value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })} inputMode="decimal" aria-label="Τιμή μονάδας" className="min-h-[40px] w-full rounded-lg border border-zinc-200 pl-5 pr-2 py-1.5 text-right text-sm tabular-nums outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-400" aria-hidden>€</span>
                    </div>
                    <button type="button" onClick={() => removeLine(i)} aria-label="Αφαίρεση" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:text-red-500 active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                      <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {lineSuggest?.idx === i && lineSuggest.results.length > 0 && (
                    <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 space-y-1 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200">
                      {lineSuggest.results.map((r) => (
                        <button key={r.id} type="button" onClick={() => { updateLine(i, { description: r.name, unitPrice: r.unitPrice }); setLineSuggest(null); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-sm transition hover:bg-zinc-50 active:bg-zinc-100">
                          <span className="truncate text-zinc-800">{r.code ? <span className="text-zinc-500">{r.code} · </span> : null}{r.name}</span>
                          <span className="shrink-0 font-medium tabular-nums text-zinc-600">€{r.unitPrice.toLocaleString('el-GR')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {lines.length === 0 ? (
                <button type="button" onClick={() => addLine({ description: '', quantity: 1, unitPrice: 0 })} className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  Προσθήκη γραμμής
                </button>
              ) : (
                <button type="button" onClick={() => addLine({ description: '', quantity: 1, unitPrice: 0 })} className="inline-flex items-center gap-1 rounded-lg px-1 py-1 text-xs font-medium text-indigo-600 transition active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  Κενή γραμμή
                </button>
              )}
            </div>

            {/* VAT + totals */}
            <div className="mt-3 flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">ΦΠΑ %
                <input value={offerVat} onChange={(e) => setOfferVat(e.target.value)} inputMode="decimal" aria-label="Συντελεστής ΦΠΑ" className="min-h-[40px] w-16 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm tabular-nums outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>
            </div>
            <div className="mt-3 space-y-1 border-t border-zinc-100 pt-2 text-sm">
              <div className="flex items-center justify-between text-zinc-500">
                <span>Υποσύνολο</span>
                <span className="tabular-nums text-zinc-700">€{subtotal.toLocaleString('el-GR', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-500">
                <span>ΦΠΑ {vatNum}%</span>
                <span className="tabular-nums text-zinc-700">€{((subtotal * vatNum) / 100).toLocaleString('el-GR', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-base font-bold text-zinc-900">Σύνολο</span>
                <span className="text-base font-bold tabular-nums text-zinc-900">€{total.toLocaleString('el-GR', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <input value={offerNotes} onChange={(e) => setOfferNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="mt-3 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <Button variant="primary" size="md" fullWidth loading={busy} disabled={busy || validLines.length === 0} onClick={createOffer} className="mt-3">
              Δημιουργία προσφοράς
            </Button>
            {result && (
              <p className={`mt-2 flex items-center justify-center gap-1.5 text-center text-sm font-medium motion-safe:animate-[fadeIn_0.2s_ease-out] ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
                {result.ok && (
                  <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
                {result.text}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
