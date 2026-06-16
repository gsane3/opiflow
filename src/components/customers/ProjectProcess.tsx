'use client';

// Project «Διαδικασία» — full-screen, chat-first project screen matching the
// Opiflow prototype (screens-project.jsx). Opens from the customer chat for a
// work folder. Shows: header + status, the 5-step Stepper, a single chat-style
// timeline that MERGES every folder event (messages, offers, appointments,
// payments, photo/info requests) into prototype-style cards/bubbles, and a
// bottom dock with the 4 quick actions (Στοιχεία · Φωτό · Ραντεβού · Προσφορά)
// + a message composer. Wired to the real, already-live folder APIs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Stepper from './Stepper';

interface DetailOffer { id: string; offerNumber: string | null; status: string; total: number | null; createdAt: string }
interface DetailAppt { id: string; title: string; type: string; status: string; dueDate: string | null; dueTime: string | null }
interface DetailMsg { id: string; summary: string | null; direction: string; channel: string; createdAt: string }
interface DetailReq { id: string; status: string; createdAt: string }
interface FolderPayment { id: string; kind: string; pct: number | null; amount: number; status: string; createdAt: string }
interface FolderDetail {
  folder: { id: string; title: string; status: string; step: number; notes: string | null };
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  sections: {
    offers: { items: DetailOffer[] };
    appointments: { items: DetailAppt[] };
    messages: { items: DetailMsg[] };
    photos: { items: DetailReq[] };
    intake: { items: DetailReq[] };
  };
}

const STATUS_LABELS: Record<string, string> = { open: 'Νέο', in_progress: 'Σε εξέλιξη', done: 'Ολοκληρώθηκε', archived: 'Αρχειοθετήθηκε' };
const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Σε ετοιμασία', ready_to_send: 'Σε ετοιμασία', sent_manually: 'Απεστάλη', sent_provider: 'Απεστάλη',
  accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε', cancelled: 'Ακυρώθηκε',
};
const APPT_TYPE_GR: Record<string, string> = { book_appointment: 'Ραντεβού', visit_customer: 'Επίσκεψη' };
const REQ_STATUS_GR: Record<string, string> = {
  pending: 'Σε αναμονή πελάτη', sent: 'Απεστάλη', opened: 'Ανοίχτηκε', submitted: 'Υποβλήθηκε', completed: 'Ολοκληρώθηκε', expired: 'Έληξε', revoked: 'Ακυρώθηκε',
};
const PAY_KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };
const PAY_STATUS_GR: Record<string, string> = { pending: 'Σε αναμονή κατάθεσης', declared: 'Ο πελάτης δήλωσε κατάθεση', confirmed: 'Πληρώθηκε — επιβεβαιωμένο', cancelled: 'Ακυρώθηκε' };

function money(n: number | null): string {
  return typeof n === 'number' ? `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '';
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

type Item =
  | { kind: 'msg'; ts: number; data: DetailMsg }
  | { kind: 'offer'; ts: number; data: DetailOffer }
  | { kind: 'appt'; ts: number; data: DetailAppt }
  | { kind: 'payment'; ts: number; data: FolderPayment }
  | { kind: 'upload'; ts: number; data: DetailReq }
  | { kind: 'intake'; ts: number; data: DetailReq };

const ts = (s: string | null | undefined) => (s ? new Date(s).getTime() || 0 : 0);

export default function ProjectProcess({
  folderId,
  customerId,
  onClose,
  onChanged,
}: {
  folderId: string;
  customerId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [payments, setPayments] = useState<FolderPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const [msg, setMsg] = useState('');
  const [sheet, setSheet] = useState<'offer' | 'appt' | null>(null);
  const [oDesc, setODesc] = useState('');
  const [oAmount, setOAmount] = useState('');
  const [aTitle, setATitle] = useState('');
  const [aDate, setADate] = useState(() => new Date().toISOString().split('T')[0]);

  const notify = (m: string, isErr = false) => { setToast(m); setToastErr(isErr); };

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) { setError(true); setLoading(false); return; }
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/folders/${folderId}`, { headers }),
        fetch(`/api/folders/${folderId}/payment-requests`, { headers }),
      ]);
      const dJson = (await dRes.json().catch(() => ({}))) as { ok?: boolean } & Partial<FolderDetail>;
      if (dRes.ok && dJson?.ok && dJson.sections) { setDetail(dJson as FolderDetail); setError(false); }
      else setError(true);
      const pJson = (await pRes.json().catch(() => ({}))) as { ok?: boolean; payments?: FolderPayment[] };
      if (pRes.ok && pJson?.ok) setPayments(pJson.payments ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function refresh() { await load(); onChanged?.(); }

  const timeline = useMemo<Item[]>(() => {
    if (!detail) return [];
    const s = detail.sections;
    const items: Item[] = [
      ...s.messages.items.filter((m) => m.channel !== 'call' && (m.summary ?? '').trim()).map((m): Item => ({ kind: 'msg', ts: ts(m.createdAt), data: m })),
      ...s.offers.items.map((o): Item => ({ kind: 'offer', ts: ts(o.createdAt), data: o })),
      ...s.appointments.items.map((a): Item => ({ kind: 'appt', ts: ts(a.dueDate) || 0, data: a })),
      ...payments.map((p): Item => ({ kind: 'payment', ts: ts(p.createdAt), data: p })),
      ...s.photos.items.map((u): Item => ({ kind: 'upload', ts: ts(u.createdAt), data: u })),
      ...s.intake.items.map((i): Item => ({ kind: 'intake', ts: ts(i.createdAt), data: i })),
    ];
    return items.sort((a, b) => a.ts - b.ts);
  }, [detail, payments]);

  // ── Actions (same endpoints FolderDetailPanel uses) ──────────────────────
  async function patchFolder(updates: Record<string, unknown>) {
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const res = await fetch(`/api/folders/${folderId}`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) await refresh();
      else notify('Η αποθήκευση απέτυχε.', true);
    } catch { notify('Η αποθήκευση απέτυχε.', true); } finally { setBusy(false); }
  }
  async function advanceStep() {
    if (!detail) return;
    await patchFolder({ step: Math.min(detail.folder.step + 1, 4) });
  }
  async function completeProject() { await patchFolder({ step: 4, status: 'done' }); }

  async function sendMessage() {
    const t = msg.trim();
    if (!t) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const res = await fetch(`/api/customers/${customerId}/message`, { method: 'POST', headers, body: JSON.stringify({ text: t }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) { setMsg(''); notify('Στάλθηκε στον πελάτη'); await refresh(); }
      else notify('Δεν στάλθηκε (λείπει τηλέφωνο;).', true);
    } catch { notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true); } finally { setBusy(false); }
  }

  async function sendRequest(kind: 'upload' | 'intake') {
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const path = kind === 'upload' ? 'upload-link' : 'intake-link';
      const res = await fetch(`/api/customers/${customerId}/${path}`, { method: 'POST', headers, body: JSON.stringify({ mode: 'send', workFolderId: folderId }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (res.ok && json?.ok) {
        notify(json.sent ? (kind === 'upload' ? 'Στάλθηκε αίτημα φωτογραφιών' : 'Στάλθηκε αίτημα στοιχείων') : (json.fallbackReason === 'missing_mobile' ? 'Λείπει κινητό τηλέφωνο.' : 'Δεν στάλθηκε.'), !json.sent);
        await refresh();
      } else notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true);
    } catch { notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true); } finally { setBusy(false); }
  }

  async function submitOffer() {
    const desc = oDesc.trim();
    const amount = Number(oAmount.replace(',', '.'));
    if (!desc) { notify('Γράψε περιγραφή.', true); return; }
    if (!isFinite(amount) || amount < 0) { notify('Γράψε ποσό.', true); return; }
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const res = await fetch('/api/offers', { method: 'POST', headers, body: JSON.stringify({ customerId, workFolderId: folderId, items: [{ description: desc, quantity: 1, unitPrice: amount }] }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) { setSheet(null); setODesc(''); setOAmount(''); notify('Η προσφορά δημιουργήθηκε'); await refresh(); }
      else notify('Δεν δημιουργήθηκε. Δοκίμασε ξανά.', true);
    } catch { notify('Δεν δημιουργήθηκε. Δοκίμασε ξανά.', true); } finally { setBusy(false); }
  }
  async function submitAppt() {
    const title = aTitle.trim();
    if (!title) { notify('Γράψε τίτλο.', true); return; }
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const res = await fetch('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ customerId, workFolderId: folderId, title, type: 'book_appointment', dueDate: aDate }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) { setSheet(null); setATitle(''); notify('Το ραντεβού δημιουργήθηκε'); await refresh(); }
      else notify('Δεν δημιουργήθηκε. Δοκίμασε ξανά.', true);
    } catch { notify('Δεν δημιουργήθηκε. Δοκίμασε ξανά.', true); } finally { setBusy(false); }
  }

  async function confirmPayment(paymentId: string, status: 'confirmed' | 'cancelled') {
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { notify('Λήξη σύνδεσης.', true); return; }
      const res = await fetch(`/api/payments/${paymentId}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) { notify(status === 'confirmed' ? 'Η πληρωμή επιβεβαιώθηκε' : 'Το αίτημα ακυρώθηκε'); await refresh(); }
      else notify('Δεν ολοκληρώθηκε.', true);
    } catch { notify('Δεν ολοκληρώθηκε.', true); } finally { setBusy(false); }
  }

  const f = detail?.folder;
  const status = f ? STATUS_LABELS[f.status] ?? f.status : '';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#eef3f8] dark:bg-[#0a131e]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200/70 bg-white/85 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#122130]/85">
        <button type="button" onClick={onClose} aria-label="Πίσω" className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-600 transition active:scale-90 hover:bg-indigo-50 dark:hover:bg-white/5">
          <svg className="h-6 w-6" fill="none" strokeWidth={2.4} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{f?.title ?? 'Έργο'}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{detail?.customer?.name ?? 'Πελάτης'} · {status}</p>
        </div>
      </header>

      {/* Stepper + controls */}
      {f && (
        <div className="shrink-0 border-b border-zinc-200/70 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#122130]">
          <Stepper step={f.step} />
          {(f.step < 4 || (f.status !== 'done' && f.status !== 'archived')) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {f.step < 4 && <Button variant="secondary" size="sm" loading={busy} onClick={() => void advanceStep()}>Παράλειψη βήματος ›</Button>}
              {f.status !== 'done' && f.status !== 'archived' && <Button variant="secondary" size="sm" loading={busy} onClick={() => void completeProject()}>Ολοκλήρωση έργου</Button>}
            </div>
          )}
        </div>
      )}

      {toast && <p className={`shrink-0 px-4 py-1.5 text-center text-xs font-medium ${toastErr ? 'text-red-600' : 'text-green-700'}`}>{toast}</p>}

      {/* Timeline */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-zinc-400">Φόρτωση…</p>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-500">Δεν φορτώθηκαν τα στοιχεία.</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Δοκίμασε ξανά</Button>
          </div>
        ) : timeline.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Ξεκίνα το έργο — στείλε μήνυμα, προσφορά ή ζήτα στοιχεία από κάτω.</p>
        ) : (
          timeline.map((it) => <TimelineRow key={`${it.kind}:${it.data.id}`} it={it} busy={busy} onConfirm={confirmPayment} />)
        )}
        <p className="pt-2 pb-1 text-center text-[11px] text-zinc-400 dark:text-zinc-500">Ό,τι στέλνεις εδώ το βλέπει ο πελάτης στο link του.</p>
      </div>

      {/* Dock: 4 quick actions + composer */}
      <div className="shrink-0 border-t border-zinc-200/70 bg-white px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-[#122130]">
        <div className="mb-2 grid grid-cols-4 gap-2">
          <DockBtn label="Στοιχεία" onClick={() => void sendRequest('intake')} busy={busy} icon="clipboard" />
          <DockBtn label="Φωτό" onClick={() => void sendRequest('upload')} busy={busy} icon="image" />
          <DockBtn label="Ραντεβού" onClick={() => { setATitle(f?.title ?? ''); setSheet('appt'); }} busy={busy} icon="calendar" />
          <DockBtn label="Προσφορά" onClick={() => { setODesc(''); setOAmount(''); setSheet('offer'); }} busy={busy} icon="file" />
        </div>
        <div className="flex items-center gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void sendMessage(); }}
            placeholder="Μήνυμα στον πελάτη…"
            className="min-w-0 flex-1 rounded-full bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-200 dark:bg-[#0f1d2b] dark:text-zinc-100"
          />
          <button type="button" onClick={() => void sendMessage()} disabled={busy || !msg.trim()} aria-label="Αποστολή" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white transition active:scale-90 disabled:opacity-40">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
          </button>
        </div>
      </div>

      {/* Quick offer sheet */}
      {sheet === 'offer' && (
        <Sheet title="Νέα προσφορά" onClose={() => setSheet(null)}>
          <Input label="Περιγραφή" value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
          <Input label="Ποσό (€)" value={oAmount} inputMode="decimal" onChange={(e) => setOAmount(e.target.value)} placeholder="0" />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setSheet(null)}>Ακύρωση</Button>
            <Button size="sm" loading={busy} onClick={() => void submitOffer()}>Αποστολή στο link</Button>
          </div>
        </Sheet>
      )}
      {/* Quick appointment sheet */}
      {sheet === 'appt' && (
        <Sheet title="Νέο ραντεβού" onClose={() => setSheet(null)}>
          <Input label="Τίτλος" value={aTitle} onChange={(e) => setATitle(e.target.value)} placeholder="π.χ. Επίσκεψη για μέτρηση" />
          <Input label="Ημερομηνία" type="date" value={aDate} onChange={(e) => setADate(e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setSheet(null)}>Ακύρωση</Button>
            <Button size="sm" loading={busy} onClick={() => void submitAppt()}>Αποστολή στο link</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Timeline row ───────────────────────────────────────────────────────────
function TimelineRow({ it, busy, onConfirm }: { it: Item; busy: boolean; onConfirm: (id: string, s: 'confirmed' | 'cancelled') => void }) {
  if (it.kind === 'msg') {
    const m = it.data;
    const out = m.direction === 'outbound';
    return (
      <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm ${out ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-800 ring-1 ring-zinc-200 dark:bg-[#1e2b38] dark:text-zinc-100 dark:ring-white/10'}`}>
          {(m.summary ?? '').trim()}
          <div className={`mt-0.5 text-[10px] ${out ? 'text-white/70' : 'text-zinc-400'}`}>{formatDateGr(m.createdAt)}</div>
        </div>
      </div>
    );
  }
  if (it.kind === 'offer') {
    const o = it.data;
    return (
      <EventCard tone="indigo" icon="file" title="Προσφορά" sub={o.offerNumber ?? '—'} status={OFFER_STATUS_GR[o.status] ?? o.status} done={o.status === 'accepted'}>
        {o.total != null && <Row label="Σύνολο" value={money(o.total)} bold />}
      </EventCard>
    );
  }
  if (it.kind === 'appt') {
    const a = it.data;
    return (
      <EventCard tone="violet" icon="calendar" title="Ραντεβού" sub={a.title} status={a.status === 'completed' ? 'Ολοκληρώθηκε' : APPT_TYPE_GR[a.type] ?? 'Ραντεβού'} done={a.status === 'completed'}>
        {a.dueDate && <Row label="Ημερομηνία" value={`${formatDateGr(a.dueDate)}${a.dueTime ? ` · ${a.dueTime}` : ''}`} bold />}
      </EventCard>
    );
  }
  if (it.kind === 'payment') {
    const p = it.data;
    const final = p.status === 'confirmed' || p.status === 'cancelled';
    return (
      <EventCard tone="emerald" icon="euro" title={`${PAY_KIND_GR[p.kind] ?? p.kind}${p.pct != null ? ` · ${p.pct}%` : ''}`} sub={PAY_STATUS_GR[p.status] ?? p.status} done={p.status === 'confirmed'}>
        <Row label="Ποσό" value={money(p.amount)} bold />
        {!final && (
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => onConfirm(p.id, 'confirmed')} className="rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-40">Επιβεβαίωση είσπραξης</button>
            <button type="button" disabled={busy} onClick={() => onConfirm(p.id, 'cancelled')} className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition hover:text-red-600 disabled:opacity-40">Ακύρωση</button>
          </div>
        )}
      </EventCard>
    );
  }
  // upload / intake request
  const r = it.data;
  const isPhotos = it.kind === 'upload';
  return (
    <EventCard tone="amber" icon={isPhotos ? 'image' : 'clipboard'} title={isPhotos ? 'Αίτημα φωτογραφιών' : 'Αίτημα στοιχείων'} sub={REQ_STATUS_GR[r.status] ?? r.status} done={r.status === 'submitted' || r.status === 'completed'} />
  );
}

// ── Prototype-style event card ───────────────────────────────────────────────
const TONE_BG: Record<string, string> = {
  indigo: 'bg-indigo-600', violet: 'bg-violet-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500',
};
function EventCard({ tone, icon, title, sub, status, done, children }: { tone: string; icon: string; title: string; sub: string; status?: string; done?: boolean; children?: React.ReactNode }) {
  return (
    <div className="ml-auto w-[82%] rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-200/70 dark:bg-[#122130] dark:ring-white/10">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${TONE_BG[tone] ?? 'bg-indigo-600'}`}><CardIcon name={icon} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>
        </div>
        {status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${done ? 'bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300' : 'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200 dark:bg-white/5 dark:text-zinc-400'}`}>{status}</span>}
      </div>
      {children && <div className="mt-2 space-y-1">{children}</div>}
      <p className="mt-2 text-[10px] text-zinc-400">Εσύ</p>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={bold ? 'font-bold text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-200'}>{value}</span>
    </div>
  );
}
function DockBtn({ label, onClick, busy, icon }: { label: string; onClick: () => void; busy: boolean; icon: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="flex flex-col items-center gap-1 rounded-2xl bg-zinc-50 py-2 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200/70 transition active:scale-95 disabled:opacity-50 dark:bg-[#0f1d2b] dark:text-zinc-200 dark:ring-white/10">
      <span className="text-indigo-600"><CardIcon name={icon} /></span>
      {label}
    </button>
  );
}
function CardIcon({ name }: { name: string }) {
  const common = { className: 'h-[18px] w-[18px]', fill: 'none', strokeWidth: 1.9, stroke: 'currentColor', viewBox: '0 0 24 24' } as const;
  switch (name) {
    case 'file': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>;
    case 'calendar': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>;
    case 'euro': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M14.25 7.756a4.5 4.5 0 1 0 0 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
    case 'image': return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>;
    case 'clipboard': default: return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>;
  }
}
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-4 shadow-xl dark:bg-[#122130] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700">Κλείσιμο</button>
        </div>
        {children}
      </div>
    </div>
  );
}
