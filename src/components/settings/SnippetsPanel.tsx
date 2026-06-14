'use client';

// Manage reusable message snippets (Πρότυπα μηνυμάτων) — used in the customer
// chat composer with one tap. Backed by /api/snippets. Merge tokens {όνομα},
// {ημερομηνία}, {ώρα}, {διεύθυνση} are filled at send time.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/ui/Spinner';

interface Snippet { id: string; title: string; body: string; sortOrder: number }

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

export default function SnippetsPanel() {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); return; }
    try {
      const res = await fetch('/api/snippets', { headers });
      const json = await res.json().catch(() => ({}));
      setSnippets(json?.ok && Array.isArray(json.snippets) ? json.snippets : []);
    } catch {
      setError('Δεν φορτώθηκαν τα πρότυπα.');
      setSnippets([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!title.trim() || !body.trim() || busy) return;
    const headers = await authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      const url = editingId ? `/api/snippets/${editingId}` : '/api/snippets';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify({ title: title.trim(), body: body.trim() }) });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setTitle(''); setBody(''); setEditingId(null);
        void load();
      } else {
        setError('Η αποθήκευση απέτυχε.');
      }
    } catch {
      setError('Η αποθήκευση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const headers = await authHeaders();
    if (!headers) return;
    setSnippets((prev) => prev?.filter((s) => s.id !== id) ?? null);
    try {
      await fetch(`/api/snippets/${id}`, { method: 'DELETE', headers });
    } catch {
      void load();
    }
  }

  function startEdit(s: Snippet) {
    setEditingId(s.id); setTitle(s.title); setBody(s.body);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{editingId ? 'Επεξεργασία προτύπου' : 'Νέο πρότυπο'}</p>
        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
          Μπορείς να βάλεις {'{όνομα}'}, {'{ημερομηνία}'}, {'{ώρα}'}, {'{διεύθυνση}'} — συμπληρώνονται αυτόματα.
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Τίτλος (π.χ. Ερχόμαστε σύντομα)"
          maxLength={80}
          className="mt-3 w-full rounded-xl bg-zinc-100 dark:bg-[#0f1923] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Κείμενο μηνύματος…"
          rows={3}
          maxLength={1000}
          className="mt-2 w-full resize-none rounded-xl bg-zinc-100 dark:bg-[#0f1923] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!title.trim() || !body.trim() || busy}
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy && <Spinner className="text-white" />}
            {editingId ? 'Αποθήκευση' : 'Προσθήκη'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setTitle(''); setBody(''); }} className="rounded-full bg-zinc-100 dark:bg-[#1e2b38] px-4 py-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-white/5">
              Ακύρωση
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-1 text-xs text-red-500">{error}</p>}

      {snippets === null ? (
        <div className="flex justify-center py-6"><Spinner className="text-indigo-500" /></div>
      ) : snippets.length === 0 ? (
        <p className="px-1 py-2 text-sm text-zinc-400 dark:text-zinc-500">Δεν υπάρχουν πρότυπα ακόμα.</p>
      ) : (
        <div className="space-y-2">
          {snippets.map((s) => (
            <div key={s.id} className="rounded-[24px] bg-white dark:bg-[#17232f] px-4 py-3 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-zinc-500 dark:text-zinc-400">{s.body}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => startEdit(s)} aria-label="Επεξεργασία" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-indigo-600">
                    <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                  </button>
                  <button type="button" onClick={() => void remove(s.id)} aria-label="Διαγραφή" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition hover:bg-red-50 hover:text-red-600">
                    <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
