'use client';

// Chat-first Work Folders strip (web prototype, ux-web-chat-first-folders).
// Renders ACTIVE «Έργα» as cards pinned near the top of the customer
// conversation, plus a simple quick-action row — so the user manages the job
// WITHOUT digging into the profile/info panel. Opening a card shows the existing
// FolderDetailPanel from the chat context. Read-only over the merged WF APIs
// (#232–#237): GET /api/customers/[id]/folders, POST folders, FolderDetailPanel.
// No backend/DB/public changes. The info panel keeps WorkFoldersSection as a
// secondary path; this is the primary, visible entry point.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import ProjectProcess from '@/components/customers/ProjectProcess';
import { ergoStepCaption } from '@/components/customers/Stepper';

interface FolderCounts {
  offers: number;
  appointments: number;
  messages: number;
  uploadRequests: number;
  intakeRequests: number;
}
interface Folder {
  id: string;
  title: string;
  status: string;
  step?: number;
  createdAt: string;
  updatedAt: string;
  counts?: FolderCounts;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Νέο',
  in_progress: 'Σε εξέλιξη',
  done: 'Ολοκληρώθηκε',
  archived: 'Αρχειοθετήθηκε',
};
const STATUS_TONE: Record<string, string> = {
  open: 'bg-indigo-50 text-indigo-700',
  in_progress: 'bg-amber-50 text-amber-700',
};

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

function countsLine(counts?: FolderCounts): string {
  if (!counts) return '';
  const parts: string[] = [];
  if (counts.offers) parts.push(`${counts.offers} προσφορές`);
  if (counts.appointments) parts.push(`${counts.appointments} ραντεβού`);
  if (counts.uploadRequests) parts.push(`${counts.uploadRequests} φωτογραφίες`);
  if (counts.messages) parts.push(`${counts.messages} μηνύματα`);
  return parts.join(' · ');
}

export default function CustomerFoldersStrip({
  customerId,
  onNewOffer,
  onNewAppointment,
  onChanged,
}: {
  customerId: string;
  onNewOffer: () => void;
  onNewAppointment: () => void;
  onChanged?: () => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Νέο έργο (create) — minimal, must work.
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
      if (res.ok && json?.ok) { setFolders(json.folders ?? []); setError(false); }
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  async function refreshAll() {
    await load();
    onChanged?.();
  }

  async function createFolder() {
    const t = title.trim();
    if (!t) { setCreateErr('Γράψε τίτλο έργου.'); return; }
    setCreateErr('');
    setCreateBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setCreateErr('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/customers/${customerId}/folders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: t }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; folder?: { id: string } };
      if (res.ok && json?.ok) {
        setCreating(false);
        setTitle('');
        await refreshAll();
        if (json.folder?.id) setOpenId(json.folder.id); // open the new folder straight away
      } else {
        setCreateErr('Το έργο δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch {
      setCreateErr('Το έργο δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setCreateBusy(false);
    }
  }

  const active = folders.filter((f) => f.status === 'open' || f.status === 'in_progress');
  const openFolder = folders.find((f) => f.id === openId) ?? null;

  return (
    <section className="shrink-0 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Ανοιχτά έργα{active.length ? ` · ${active.length}` : ''}
        </p>
        <button
          type="button"
          onClick={() => { setTitle(''); setCreateErr(''); setCreating(true); }}
          className="rounded-full px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 active:scale-95"
        >
          Νέο έργο
        </button>
      </div>

      {/* Active folder cards */}
      {loading ? (
        <div className="flex justify-center py-2"><Spinner className="text-indigo-500" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 py-1">
          <p className="text-xs text-zinc-500">Δεν φορτώθηκαν τα έργα.</p>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold text-indigo-600">Δοκίμασε ξανά</button>
        </div>
      ) : active.length === 0 ? (
        <p className="px-1 py-1 text-xs text-zinc-400 dark:text-zinc-500">Δεν υπάρχει ανοιχτό έργο ακόμα.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {active.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setOpenId(f.id)}
              className="w-56 shrink-0 rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] p-3 text-left ring-1 ring-zinc-200/70 dark:ring-white/10 transition hover:bg-white dark:hover:bg-white/5 active:scale-[0.99]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Έργο</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{f.title}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[f.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                  {STATUS_LABELS[f.status] ?? f.status}
                </span>
                <span className="text-[11px] tabular-nums text-zinc-400">{formatDateGr(f.updatedAt)}</span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-indigo-600/90 dark:text-indigo-300">{ergoStepCaption(f.step ?? 0)}</p>
              {countsLine(f.counts) ? (
                <p className="mt-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{countsLine(f.counts)}</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-zinc-400">Καμία εγγραφή ακόμα</p>
              )}
              <span className="mt-2 inline-block text-xs font-semibold text-indigo-600">Άνοιγμα έργου ›</span>
            </button>
          ))}
        </div>
      )}

      {/* Quick actions near the conversation. «Ζήτα φωτογραφίες» / «Ζήτα στοιχεία»
          are folder-bound and live INSIDE the opened folder (FolderDetailPanel),
          where the workFolderId is known — so they are intentionally not here. */}
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <QuickBtn label="Νέα προσφορά" onClick={onNewOffer} />
        <QuickBtn label="Νέο ραντεβού" onClick={onNewAppointment} />
      </div>

      {/* Νέο έργο — create modal */}
      {creating && (
        <Overlay title="Νέο έργο" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            {createErr && <p className="text-xs text-red-600">{createErr}</p>}
            <Input
              label="Τίτλος έργου"
              value={title}
              maxLength={120}
              onChange={(e) => { setTitle(e.target.value); if (createErr) setCreateErr(''); }}
              placeholder="π.χ. Τοποθέτηση κλιματιστικού"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>Ακύρωση</Button>
              <Button size="sm" loading={createBusy} onClick={createFolder}>Δημιουργία έργου</Button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Project «Διαδικασία» — full-screen, chat-first, opened from the chat. */}
      {openFolder && (
        <ProjectProcess
          folderId={openFolder.id}
          customerId={customerId}
          onClose={() => setOpenId(null)}
          onChanged={() => void refreshAll()}
        />
      )}
    </section>
  );
}

function QuickBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="shrink-0 whitespace-nowrap rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100 transition active:scale-95 enabled:hover:bg-indigo-100 disabled:opacity-50"
    >
      {busy ? '…' : label}
    </button>
  );
}

function Overlay({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl dark:bg-[#17232f] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
            {subtitle && <p className="truncate text-[11px] text-zinc-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-full px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700">Κλείσιμο</button>
        </div>
        {children}
      </div>
    </div>
  );
}
