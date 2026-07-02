'use client';

// «Έργα» (Projects) section — pixel-faithful port of the prototype's Projects
// list (screens-customer.jsx): proj-card with status dot/pill + a 5-segment
// mini-stepper + link/date foot, inside the prototype's design system
// (opf-* CSS on .opf-stage). Tapping a card opens the full «Διαδικασία» screen
// (ProjectProcess). Wired to the live folder APIs. Used by the customer profile
// (the «Έργα» section + the «Νέο έργο» / «Μήνυμα» round actions via signals).

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import ProjectProcess from '@/components/customers/ProjectProcess';

interface FolderCounts { offers: number; appointments: number; messages: number; uploadRequests: number; intakeRequests: number }
interface Folder { id: string; title: string; status: string; step?: number; createdAt: string; updatedAt: string; counts?: FolderCounts }

const STATUS_LABEL: Record<string, string> = { open: 'Νέο', in_progress: 'Σε εξέλιξη', done: 'Ολοκληρώθηκε', archived: 'Αρχειοθ.' };
const STATUS_DOT: Record<string, string> = { open: 'new', in_progress: 'progress', done: 'won', archived: 'lost' };
const STATUS_PILL: Record<string, string> = { open: 'pending', in_progress: 'sent', done: 'accepted', archived: 'pending' };
const STATUS_RANK = (s: string) => (s === 'in_progress' ? 0 : s === 'open' ? 1 : s === 'done' ? 2 : 3);

const ICON: Record<string, string> = {
  folder: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h3.8a1.5 1.5 0 0 1 1.1.5l1 1.1a1.5 1.5 0 0 0 1.1.5h5.5A1.5 1.5 0 0 1 19.5 9.6V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17z',
  folderPlus: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h3.8a1.5 1.5 0 0 1 1.1.5l1 1.1a1.5 1.5 0 0 0 1.1.5h5.5A1.5 1.5 0 0 1 19.5 9.6V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17zM12 11v4M10 13h4',
  plus: 'M12 5v14M5 12h14',
  link: 'M9.5 14.5 14.5 9.5M10 7l1.5-1.5a3.5 3.5 0 0 1 5 5L15 12M14 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L9 12',
  x: 'M6 6l12 12M18 6 6 18',
};
function Icon({ name, size = 18, color = 'currentColor', stroke = 2 }: { name: string; size?: number; color?: string; stroke?: number }) {
  const d = ICON[name];
  if (!d) return null;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

function countsLine(c?: FolderCounts): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.offers) parts.push(`${c.offers} προσφ.`);
  if (c.appointments) parts.push(`${c.appointments} ραντ.`);
  if (c.uploadRequests) parts.push(`${c.uploadRequests} φωτό`);
  if (c.messages) parts.push(`${c.messages} μην.`);
  return parts.join(' · ');
}


// Legacy titles were stored as «{δουλειά} — {όνομα πελάτη}» — inside the
// customer's own card the suffix is pure noise. Display-only strip.
function displayTitle(title: string, customerName?: string | null): string {
  const t = (title ?? '').trim();
  const n = customerName?.trim();
  if (n && t.endsWith(` — ${n}`)) return t.slice(0, -(n.length + 3)).trim() || t;
  return t;
}

export default function CustomerFoldersStrip({ customerId, customerName, onChanged, openCreateSignal, openLatestSignal }: { customerId: string; customerName?: string | null; onChanged?: () => void; openCreateSignal?: number; openLatestSignal?: number }) {
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setError(true); setLoading(false); return; }
      const res = await fetch(`/api/customers/${customerId}/folders`, { headers });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; folders?: Folder[] };
      if (res.ok && json?.ok) { setFolders(json.folders ?? []); setError(false); } else setError(true);
    } catch { setError(true); } finally { setLoading(false); }
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);

  // Lets the parent (customer profile «Νέο project» action) open the create sheet.
  useEffect(() => {
    if (openCreateSignal && openCreateSignal > 0) { setTitle(''); setCreateErr(''); setCreating(true); }
  }, [openCreateSignal]);

  // «Μήνυμα» round action: open the most relevant project (active first) where the
  // chat lives, or the create sheet if the customer has no project yet (the
  // project-first gate — you must create a project before messaging). The action
  // is DEFERRED until folders have loaded, so an early tap never wrongly opens
  // «Νέο έργο» for a customer who actually has projects.
  const [pendingLatest, setPendingLatest] = useState(false);
  useEffect(() => {
    if (openLatestSignal && openLatestSignal > 0) setPendingLatest(true);
  }, [openLatestSignal]);
  useEffect(() => {
    if (!pendingLatest || loading) return;
    setPendingLatest(false);
    if (folders.length > 0) {
      const sorted = [...folders].sort((a, b) => STATUS_RANK(a.status) - STATUS_RANK(b.status));
      setOpenId(sorted[0].id);
    } else {
      setTitle(''); setCreateErr(''); setCreating(true);
    }
  }, [pendingLatest, loading, folders]);

  async function refresh() { await load(); onChanged?.(); }

  async function createFolder() {
    const t = title.trim();
    if (!t) { setCreateErr('Γράψε τίτλο έργου.'); return; }
    setCreateErr(''); setCreateBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setCreateErr('Λήξη σύνδεσης.'); return; }
      const res = await fetch(`/api/customers/${customerId}/folders`, { method: 'POST', headers, body: JSON.stringify({ title: t }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; folder?: { id: string } };
      if (res.ok && json?.ok) {
        setCreating(false); setTitle('');
        await refresh();
        if (json.folder?.id) setOpenId(json.folder.id);
      } else setCreateErr('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } catch { setCreateErr('Δεν δημιουργήθηκε. Δοκίμασε ξανά.'); } finally { setCreateBusy(false); }
  }

  // Active first; show all (matches the prototype Projects list).
  const list = [...folders].sort((a, b) => STATUS_RANK(a.status) - STATUS_RANK(b.status));

  return (
    <div className="opf-stage" data-theme={theme} style={{ background: 'var(--bg)' }}>
      <div className="opf-sec-title">
        <div className="opf-sec-title-l"><Icon name="folder" size={19} color="var(--brand)" /> <span>Έργα</span></div>
        <button className="opf-sec-add opf-press" onClick={() => { setTitle(''); setCreateErr(''); setCreating(true); }} aria-label="Νέο έργο"><Icon name="plus" size={18} color="var(--brand)" stroke={2.3} /></button>
      </div>

      {loading ? (
        <div className="opf-empty-card">Φόρτωση έργων…</div>
      ) : error ? (
        <div className="opf-proj-list"><button className="opf-card opf-proj-empty opf-press" onClick={() => void load()} style={{ width: 'auto' }}><div className="opf-proj-empty-txt">Δεν φορτώθηκαν τα έργα. Πάτησε για δοκίμασε ξανά.</div></button></div>
      ) : list.length === 0 ? (
        <div className="opf-proj-list">
          <div className="opf-card opf-proj-empty">
            <div className="opf-gate-step">
              <span className="opf-gate-num">1</span>
              <div><b>Δημιούργησε έργο</b><span>Απαραίτητο πριν στείλεις προσφορά, ραντεβού ή μήνυμα. Κάθε έργο έχει μοναδικό σύνδεσμο που στέλνεις εσύ στον πελάτη.</span></div>
            </div>
            <button className="opf-btn-primary opf-full opf-press" onClick={() => { setTitle(''); setCreateErr(''); setCreating(true); }}><Icon name="folderPlus" size={19} color="#fff" stroke={2.1} /><span>Δημιουργία έργου</span></button>
          </div>
        </div>
      ) : (
        <div className="opf-proj-list">
          {list.map((p) => {
            const cl = countsLine(p.counts);
            return (
              <button key={p.id} className="opf-card opf-proj-card opf-press" onClick={() => setOpenId(p.id)} style={{ textAlign: 'left', width: '100%' }}>
                <div className="opf-proj-card-top">
                  <span className={`opf-pj-dot opf-dot-${STATUS_DOT[p.status] ?? 'new'}`} />
                  <div className="opf-proj-card-title">{displayTitle(p.title, customerName)}</div>
                  <div className={`opf-ev-status opf-st-${STATUS_PILL[p.status] ?? 'pending'}`}>{STATUS_LABEL[p.status] ?? p.status}</div>
                </div>
                <div className="opf-proj-card-foot"><Icon name="link" size={13} color="var(--muted)" /> {cl || 'Άνοιγμα έργου'} · {formatDateGr(p.updatedAt)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* New project sheet */}
      {creating && (
        <div className="opf-sheet-wrap opf-open" onClick={() => setCreating(false)}>
          <div className="opf-sheet-backdrop" />
          <div className="opf-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="opf-sheet-grab" />
            <div className="opf-sheet-head"><div className="opf-sheet-title">Νέο έργο</div><button className="opf-sheet-x opf-press" onClick={() => setCreating(false)} aria-label="close"><Icon name="x" size={20} color="var(--muted)" stroke={2.2} /></button></div>
            <div className="opf-sheet-body">
              {createErr && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{createErr}</p>}
              <label className="opf-field"><span className="opf-field-label">Τίτλος έργου</span><input className="opf-inp" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); if (createErr) setCreateErr(''); }} placeholder="π.χ. Τοποθέτηση κλιματιστικού" autoFocus /></label>
              <div className="opf-tpl-chips">{['Τοποθέτηση A/C', 'Επισκευή', 'Συντήρηση', 'Νέα εγκατάσταση'].map((x) => <button key={x} className="opf-tpl-chip opf-press" onClick={() => setTitle(x)}>{x}</button>)}</div>
              <div className="opf-link-note"><Icon name="link" size={16} color="var(--brand)" /> Κάθε έργο έχει έναν μοναδικό σύνδεσμο για τον πελάτη. Θα τον στείλεις μέσα από το έργο — με προσφορά, ραντεβού, μήνυμα ή «Κοινοποίηση συνδέσμου».</div>
            </div>
            <div className="opf-sheet-foot">
              <button className="opf-btn-primary opf-full opf-press" onClick={() => void createFolder()}><Icon name="folderPlus" size={19} color="#fff" stroke={2.1} /><span>{createBusy ? 'Δημιουργία…' : 'Δημιουργία έργου'}</span></button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen «Διαδικασία» */}
      {openId && (
        <ProjectProcess folderId={openId} customerId={customerId} onClose={() => setOpenId(null)} onChanged={() => void refresh()} />
      )}
    </div>
  );
}
