'use client';

// Chat ➕ composer (redesign P3c-2). A bottom sheet opened from the ➕ in the
// Messenger composer, for manual customer actions:
//   • Ζήτα στοιχεία  → POST intake-link { mode:'send' } (preferred channel, Viber→SMS)
//   • Ζήτα φωτογραφίες → POST upload-link { mode:'send' }
//   • Κλείσε ραντεβού → inline date/time → POST /api/tasks (book_appointment)
//   • Στείλε προσφορά → coming with the service catalog (P4)
// On success it calls onDone() so the chat timeline refreshes.

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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

type View = 'menu' | 'appointment';

export default function ChatComposerSheet({
  customerId,
  open,
  onClose,
  onDone,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [apptDate, setApptDate] = useState(tomorrowISO());
  const [apptTime, setApptTime] = useState('10:00');
  const [apptNote, setApptNote] = useState('');

  if (!open) return null;

  function close() {
    setView('menu');
    setResult(null);
    setBusy(false);
    onClose();
  }

  async function sendLink(kind: 'intake' | 'upload') {
    setBusy(true);
    setResult(null);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); setResult({ ok: false, text: 'Συνδέσου ξανά.' }); return; }
    try {
      const path = kind === 'intake' ? 'intake-link' : 'upload-link';
      const res = await fetch(`/api/customers/${customerId}/${path}`, {
        method: 'POST', headers, body: JSON.stringify({ mode: 'send' }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (json?.ok && json.sent) {
        setResult({ ok: true, text: kind === 'intake' ? 'Στάλθηκε αίτημα στοιχείων ✓' : 'Στάλθηκε αίτημα φωτογραφιών ✓' });
        onDone();
        setTimeout(close, 1100);
      } else {
        const r = json?.fallbackReason;
        const msg = r === 'missing_mobile' || r === 'missing_email'
          ? 'Λείπει αριθμός/email του πελάτη.'
          : r === 'provider_unavailable'
          ? 'Ο πάροχος αποστολής δεν είναι ρυθμισμένος ακόμα.'
          : 'Δεν στάλθηκε. Δοκίμασε ξανά.';
        setResult({ ok: false, text: msg });
      }
    } catch {
      setResult({ ok: false, text: 'Δεν στάλθηκε. Δοκίμασε ξανά.' });
    } finally {
      setBusy(false);
    }
  }

  async function createAppointment() {
    setBusy(true);
    setResult(null);
    const headers = await authHeaders();
    if (!headers) { setBusy(false); setResult({ ok: false, text: 'Συνδέσου ξανά.' }); return; }
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: 'Ραντεβού',
          type: 'book_appointment',
          customerId,
          dueDate: apptDate,
          dueTime: apptTime || undefined,
          note: apptNote || undefined,
        }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean };
      if (json?.ok) {
        setResult({ ok: true, text: 'Το ραντεβού δημιουργήθηκε ✓' });
        onDone();
        setTimeout(close, 1100);
      } else {
        setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
      }
    } catch {
      setResult({ ok: false, text: 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.' });
    } finally {
      setBusy(false);
    }
  }

  const ACTIONS = [
    { key: 'offer', icon: '📄', label: 'Στείλε προσφορά', soon: true, onClick: () => {} },
    { key: 'appointment', icon: '📅', label: 'Κλείσε ραντεβού', soon: false, onClick: () => { setResult(null); setView('appointment'); } },
    { key: 'intake', icon: '📋', label: 'Ζήτα στοιχεία', soon: false, onClick: () => sendLink('intake') },
    { key: 'photos', icon: '📷', label: 'Ζήτα φωτογραφίες', soon: false, onClick: () => sendLink('upload') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="relative mx-auto w-full max-w-2xl rounded-t-[28px] bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200" />

        {view === 'menu' ? (
          <>
            <p className="mb-2 px-1 text-sm font-semibold text-zinc-900">Ενέργειες</p>
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  disabled={busy || a.soon}
                  onClick={a.onClick}
                  className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3.5 text-left ring-1 ring-zinc-200/70 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  <span className="text-xl" aria-hidden>{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-900">{a.label}</span>
                    {a.soon && <span className="block text-[11px] text-zinc-400">Σύντομα — με τον κατάλογο</span>}
                  </span>
                </button>
              ))}
            </div>
            {busy && <p className="mt-3 text-center text-xs text-zinc-500">Αποστολή…</p>}
            {result && (
              <p className={`mt-3 text-center text-sm font-medium ${result.ok ? 'text-green-600' : 'text-amber-600'}`}>{result.text}</p>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button type="button" onClick={() => setView('menu')} aria-label="Πίσω" className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
                <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
              </button>
              <p className="text-sm font-semibold text-zinc-900">Κλείσε ραντεβού</p>
            </div>
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <label className="flex-1 text-xs font-medium text-zinc-500">
                  Ημερομηνία
                  <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
                </label>
                <label className="w-28 text-xs font-medium text-zinc-500">
                  Ώρα
                  <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
                </label>
              </div>
              <input type="text" value={apptNote} onChange={(e) => setApptNote(e.target.value)} placeholder="Σημείωση (προαιρετικό)" className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400" />
              <button
                type="button"
                disabled={busy || !apptDate}
                onClick={createAppointment}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Δημιουργία…' : 'Δημιουργία ραντεβού'}
              </button>
              {result && (
                <p className={`text-center text-sm font-medium ${result.ok ? 'text-green-600' : 'text-amber-600'}`}>{result.text}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
