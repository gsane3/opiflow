'use client';

// «Φάκελοι εργασίας» — per-job grouping under a customer (WF-1B, web). Rendered
// inside the customer info panel. Self-contained: lists the customer's folders,
// creates one (inline form), and opens an inline detail/edit view. Uses the
// WF-1A authenticated APIs. No public link / token / attach picker here.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

interface WorkFolderCounts {
  offers: number;
  appointments: number;
  messages: number;
  uploadRequests: number;
  intakeRequests: number;
}
interface WorkFolder {
  id: string;
  businessId: string;
  customerId: string;
  title: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: WorkFolderCounts;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Νέο',
  in_progress: 'Σε εξέλιξη',
  done: 'Ολοκληρώθηκε',
  archived: 'Αρχειοθετήθηκε',
};
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Νέο' },
  { value: 'in_progress', label: 'Σε εξέλιξη' },
  { value: 'done', label: 'Ολοκληρώθηκε' },
  { value: 'archived', label: 'Αρχειοθετήθηκε' },
];

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

function countsSummary(counts?: WorkFolderCounts): string {
  if (!counts) return '';
  const parts: string[] = [];
  if (counts.offers) parts.push(`${counts.offers} προσφορές`);
  if (counts.appointments) parts.push(`${counts.appointments} ραντεβού`);
  if (counts.messages) parts.push(`${counts.messages} μηνύματα`);
  if (counts.uploadRequests) parts.push(`${counts.uploadRequests} φωτογραφίες`);
  return parts.join(' · ');
}

function StatusChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            value === o.value
              ? 'border-indigo-500 bg-indigo-600 text-white'
              : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function WorkFoldersSection({ customerId }: { customerId: string }) {
  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // create (inline)
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('open');
  const [titleError, setTitleError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);

  // detail / edit (inline)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eStatus, setEStatus] = useState('open');
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);

  // public folder link (WF-2)
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setError(true); setLoading(false); return; }
      const res = await fetch(`/api/customers/${customerId}/folders`, { headers });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; folders?: WorkFolder[] };
      if (res.ok && json?.ok) {
        setFolders(json.folders ?? []);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setTitle(''); setNotes(''); setStatus('open'); setTitleError(''); setSubmitError(''); setCreated(false); setCreating(true);
  }

  async function createFolder() {
    const t = title.trim();
    if (!t) { setTitleError('Γράψε τίτλο εργασίας.'); return; }
    setSubmitError('');
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setSubmitError('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/customers/${customerId}/folders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: t, notes: notes.trim() || null, status }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && json?.ok) {
        setCreating(false);
        setCreated(true);
        void load();
      } else {
        setSubmitError(json?.error === 'title_too_long' ? 'Ο τίτλος είναι πολύ μεγάλος (έως 120).' : 'Ο φάκελος δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch {
      setSubmitError('Ο φάκελος δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setSaving(false);
    }
  }

  function openDetail(f: WorkFolder) {
    setSelectedId(f.id);
    setEditing(false);
    setTitleError(''); setEditError('');
    setLinkUrl(''); setLinkSent(false); setLinkCopied(false); setLinkError('');
    setETitle(f.title); setENotes(f.notes ?? ''); setEStatus(f.status);
  }

  async function patchSelected(updates: Record<string, unknown>): Promise<WorkFolder | null> {
    if (!selectedId) return null;
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) return null;
      const res = await fetch(`/api/folders/${selectedId}`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; folder?: WorkFolder };
      if (res.ok && json?.ok && json.folder) {
        void load();
        return json.folder;
      }
      return null;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const t = eTitle.trim();
    if (!t) { setEditError('Γράψε τίτλο εργασίας.'); return; }
    setEditError('');
    const updated = await patchSelected({ title: t, notes: eNotes.trim() || null, status: eStatus });
    if (updated) { setEditing(false); setETitle(updated.title); setENotes(updated.notes ?? ''); setEStatus(updated.status); }
    else setEditError('Η αποθήκευση απέτυχε. Δοκίμασε ξανά.');
  }

  async function archive() {
    setEditError('');
    const updated = await patchSelected({ status: 'archived' });
    if (!updated) setEditError('Η αρχειοθέτηση απέτυχε. Δοκίμασε ξανά.');
  }

  // WF-2: create (draft) the public folder link, then copy or send it.
  async function draftLink() {
    if (!selectedId) return;
    setLinkBusy(true); setLinkError(''); setLinkSent(false); setLinkCopied(false);
    try {
      const headers = await authHeaders();
      if (!headers) { setLinkError('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/folders/${selectedId}/link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'draft' }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; responseUrl?: string };
      if (res.ok && json?.ok && json.responseUrl) setLinkUrl(json.responseUrl);
      else setLinkError('Δεν δημιουργήθηκε ο σύνδεσμος. Δοκίμασε ξανά.');
    } catch {
      setLinkError('Δεν δημιουργήθηκε ο σύνδεσμος. Δοκίμασε ξανά.');
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkError('Δεν έγινε αντιγραφή. Αντίγραψε χειροκίνητα.');
    }
  }

  async function sendLink() {
    if (!selectedId || !linkUrl) return;
    setLinkBusy(true); setLinkError('');
    try {
      const headers = await authHeaders();
      if (!headers) { setLinkError('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/folders/${selectedId}/link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'send', responseUrl: linkUrl }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (res.ok && json?.ok && json.sent) setLinkSent(true);
      else setLinkError(json?.fallbackReason === 'missing_mobile' ? 'Λείπει κινητό τηλέφωνο.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.');
    } catch {
      setLinkError('Δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally {
      setLinkBusy(false);
    }
  }

  // Auto-dismiss the create-success banner (cleared on unmount, no stray timer).
  useEffect(() => {
    if (!created) return;
    const t = window.setTimeout(() => setCreated(false), 2500);
    return () => window.clearTimeout(t);
  }, [created]);

  const selected = folders.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Φάκελοι εργασίας</p>
        {!loading && !error && !creating && folders.length > 0 && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 active:scale-95"
          >
            Νέος φάκελος
          </button>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {created && (
          <p className="text-xs font-medium text-green-700">Ο φάκελος δημιουργήθηκε</p>
        )}

        {loading ? (
          <p className="py-4 text-sm text-zinc-400 dark:text-zinc-500">Φορτώνουν οι φάκελοι...</p>
        ) : error ? (
          <div className="space-y-2 py-2">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Δεν φορτώθηκαν οι φάκελοι.</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Δοκίμασε ξανά</Button>
          </div>
        ) : folders.length === 0 && !creating ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Δεν υπάρχει φάκελος ακόμα.</p>
            <Button size="md" onClick={openCreate}>Νέος φάκελος</Button>
          </div>
        ) : (
          <>
            {folders.map((f) => {
              const isSelected = f.id === selectedId;
              const summary = countsSummary(f.counts);
              return (
                <div key={f.id} className="overflow-hidden rounded-xl bg-zinc-50 ring-1 ring-transparent dark:bg-[#1e2b38]">
                  <button
                    type="button"
                    onClick={() => (isSelected ? setSelectedId(null) : openDetail(f))}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-white dark:hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{f.title}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {STATUS_LABELS[f.status] ?? f.status}
                        {f.updatedAt ? ` · ${formatDateGr(f.updatedAt)}` : ''}
                        {summary ? ` · ${summary}` : ''}
                      </p>
                    </div>
                    <svg className={`h-4 w-4 shrink-0 text-zinc-300 transition dark:text-zinc-500 ${isSelected ? 'rotate-90' : ''}`} fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>

                  {/* Inline detail / edit */}
                  {isSelected && selected && (
                    <div className="space-y-3 border-t border-zinc-200/70 px-3 py-3 dark:border-white/10">
                      {editError && <p className="text-xs text-red-600">{editError}</p>}
                      {editing ? (
                        <>
                          <Input label="Τίτλος εργασίας" value={eTitle} maxLength={120} onChange={(e) => { setETitle(e.target.value); if (editError) setEditError(''); }} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
                          <Textarea label="Σημειώσεις" value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} placeholder="προαιρετικά" />
                          <div>
                            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Κατάσταση</label>
                            <StatusChips value={eStatus} onChange={setEStatus} />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Ακύρωση</Button>
                            <Button size="sm" loading={busy} onClick={saveEdit}>Αποθήκευση</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          {selected.notes && <p className="text-sm text-zinc-700 dark:text-zinc-200">{selected.notes}</p>}
                          {countsSummary(selected.counts) && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{countsSummary(selected.counts)}</p>
                          )}
                          <div className="rounded-lg bg-zinc-100 p-3 text-xs text-zinc-500 dark:bg-[#17232f] dark:text-zinc-400">
                            <p>Οι προσφορές, τα ραντεβού και οι φωτογραφίες θα εμφανίζονται εδώ.</p>
                            <p className="mt-1">Σύντομα θα μπορείς να συνδέεις προσφορές και ραντεβού εδώ.</p>
                          </div>
                          {/* Public folder link — copy/send to the customer (WF-2) */}
                          <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
                            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Σύνδεσμος για τον πελάτη</p>
                            {linkError && <p className="text-xs text-red-600">{linkError}</p>}
                            {!linkUrl ? (
                              <Button variant="secondary" size="sm" loading={linkBusy} onClick={draftLink}>Δημιουργία συνδέσμου</Button>
                            ) : (
                              <>
                                <input readOnly value={linkUrl} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-300" />
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="secondary" size="sm" onClick={copyLink}>{linkCopied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή'}</Button>
                                  <Button size="sm" loading={linkBusy} onClick={sendLink}>Αποστολή (Viber/SMS)</Button>
                                </div>
                                {linkSent && <p className="text-xs font-medium text-green-700">Ο σύνδεσμος στάλθηκε.</p>}
                              </>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" onClick={() => { setETitle(selected.title); setENotes(selected.notes ?? ''); setEStatus(selected.status); setEditError(''); setEditing(true); }}>
                              Επεξεργασία
                            </Button>
                            {selected.status !== 'archived' && (
                              <Button variant="secondary" size="sm" loading={busy} onClick={archive}>Αρχειοθέτηση</Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Inline create form */}
            {creating && (
              <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
                <Input label="Τίτλος εργασίας" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError(''); if (submitError) setSubmitError(''); }} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
                {titleError && <p className="text-xs text-red-600">{titleError}</p>}
                {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                <Textarea label="Σημειώσεις" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="προαιρετικά" />
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Κατάσταση</label>
                  <StatusChips value={status} onChange={setStatus} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>Ακύρωση</Button>
                  <Button size="sm" loading={saving} onClick={createFolder}>Δημιουργία φακέλου</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
