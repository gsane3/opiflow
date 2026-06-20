'use client';

// Project «Διαδικασία» — pixel-faithful port of the Opiflow prototype
// (screens-project.jsx). Uses the prototype's EXACT design-system CSS
// (src/styles/opiflow-proto.css, `opf-` namespaced) and DOM/markup, wired to the
// real, live folder APIs. Opens full-screen from the customer chat.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRelativeDateTimeGr } from '@/lib/date';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import NextActionCard, { type NextActionType } from '@/components/customers/NextActionCard';

// ── Icon set (ported verbatim from the prototype icons.jsx) ──────────────────
const ICON_PATHS: Record<string, string> = {
  sparkles: 'M12 4.5l1.6 4.3 4.3 1.6-4.3 1.6L12 16.3l-1.6-4.3-4.3-1.6 4.3-1.6zM18.5 4v3M20 5.5h-3M6 16v2.5M7.2 17.2H4.8',
  check: 'M5 12.5l4.5 4.5L19 7',
  calendar: 'M5 7.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3.5v4M16 3.5v4M5 10.5h14',
  file: 'M7 4.5h6l4 4V18a1.5 1.5 0 0 1-1.5 1.5h-8.5A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5ZM13 4.5V8.5h4M8.5 13h7M8.5 16h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  message: 'M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z',
  chevronL: 'M15 5l-7 7 7 7',
  chevronD: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  send: 'M21 4 3 11l6 2.5L12 20l3-7z M9 13.5 15 8',
  link: 'M9.5 14.5 14.5 9.5M10 7l1.5-1.5a3.5 3.5 0 0 1 5 5L15 12M14 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L9 12',
  image: 'M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2zM9 11a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 9 11ZM19 15l-4-4-8 6.5',
  clipboard: 'M9 4.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1ZM8 6.5H6.5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 6.5 19.5h11A1.5 1.5 0 0 0 19 18V8a1.5 1.5 0 0 0-1.5-1.5H16',
  x: 'M6 6l12 12M18 6 6 18',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  eye: 'M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12ZM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  euro: 'M16.5 7.2A5 5 0 0 0 8 11h7M8 13h6.5A5 5 0 0 1 6 16M5 11h2M5 13h2',
  folderPlus: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h3.8a1.5 1.5 0 0 1 1.1.5l1 1.1a1.5 1.5 0 0 0 1.1.5h5.5A1.5 1.5 0 0 1 19.5 9.6V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17zM12 11v4M10 13h4',
  trash: 'M6 7.5h12M9.5 7.5V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M7 7.5l.7 11a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.7-11M10.5 11v6M13.5 11v6',
};
function Icon({ name, size = 24, color = 'currentColor', stroke = 1.9 }: { name: string; size?: number; color?: string; stroke?: number }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS_LABELS: Record<string, string> = { open: 'Νέο', in_progress: 'Σε εξέλιξη', done: 'Ολοκληρώθηκε', archived: 'Αρχειοθετήθηκε' };
const STATUS_DOT: Record<string, string> = { open: 'new', in_progress: 'progress', done: 'won', archived: 'lost' };
const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Σε ετοιμασία', ready_to_send: 'Σε ετοιμασία', sent_manually: 'Απεστάλη', sent_provider: 'Απεστάλη',
  accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε', cancelled: 'Ακυρώθηκε',
};
const APPT_TYPE_GR: Record<string, string> = { book_appointment: 'Ραντεβού', visit_customer: 'Επίσκεψη' };
const REQ_STATUS_GR: Record<string, string> = { pending: 'Σε αναμονή πελάτη', sent: 'Απεστάλη', opened: 'Ανοίχτηκε', submitted: 'Υποβλήθηκε', completed: 'Ολοκληρώθηκε', expired: 'Έληξε', revoked: 'Ακυρώθηκε' };
const PAY_KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };
const REJECT_MESSAGE = 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';

interface DetailOffer { id: string; offerNumber: string | null; status: string; total: number | null; createdAt: string }
interface DetailAppt { id: string; title: string; type: string; status: string; dueDate: string | null; dueTime: string | null }
interface DetailMsg { id: string; summary: string | null; direction: string; channel: string; createdAt: string; readAt?: string | null }
interface DetailReq { id: string; status: string; createdAt: string }
interface FolderPayment { id: string; kind: string; pct: number | null; amount: number; status: string; createdAt: string }
interface FolderDetail {
  folder: { id: string; title: string; status: string; step: number; notes: string | null };
  customer: { id: string; name: string | null } | null;
  sections: {
    offers: { items: DetailOffer[] };
    appointments: { items: DetailAppt[] };
    messages: { items: DetailMsg[] };
    photos: { items: DetailReq[] };
    intake: { items: DetailReq[] };
  };
}

function eur(n: number | null): string {
  return typeof n === 'number' ? `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '';
}
function fmtDate(s: string | null): string {
  if (!s) return '';
  const [y, m, d] = s.split('T')[0].split('-');
  return y && m && d ? `${d}-${m}-${y}` : s;
}
async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

type Item =
  | { kind: 'msg'; ts: number; data: DetailMsg }
  | { kind: 'offer'; ts: number; data: DetailOffer }
  | { kind: 'appt'; ts: number; data: DetailAppt }
  | { kind: 'payment'; ts: number; data: FolderPayment }
  | { kind: 'req'; ts: number; data: DetailReq; photos: boolean };
const T = (s: string | null | undefined) => (s ? new Date(s).getTime() || 0 : 0);

type SheetName = 'msg' | 'appt' | 'offer' | 'req' | 'payreq' | 'menu' | 'reject' | 'delete' | null;

export default function ProjectProcess({ folderId, customerId, onClose, onChanged }: { folderId: string; customerId: string; onClose: () => void; onChanged?: () => void }) {
  const router = useRouter();
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [payments, setPayments] = useState<FolderPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous in-flight guard. React state updates are async, so two rapid
  // clicks (or Enter+click) on a send button both read busy=false and fire
  // duplicate POSTs — this is what caused a single send to go out many times.
  // busyRef blocks re-entry at the same tick; setBusy still drives the UI.
  const busyRef = useRef(false);
  const beginBusy = () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); return true; };
  const endBusy = () => { busyRef.current = false; setBusy(false); };

  const [sheet, setSheet] = useState<SheetName>(null);
  const [reqPhotos, setReqPhotos] = useState(false);
  const [msg, setMsg] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oAmount, setOAmount] = useState('');
  const [aTitle, setATitle] = useState('');
  const [aDate, setADate] = useState('');
  const [payKind, setPayKind] = useState<'deposit' | 'balance'>('deposit');
  const [payPct, setPayPct] = useState(30);
  const [naKey, setNaKey] = useState(0);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  // A single, always-visible error toast for owner actions. Previously every
  // action that failed (offer/appointment/message/payment/edit) did nothing —
  // the sheet just stayed open with no feedback. `fail()` surfaces a reason and
  // auto-clears so a failed send is never silent.
  const [actionErr, setActionErr] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fail = useCallback((message: string) => {
    setActionErr(message);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setActionErr(null), 4500);
  }, []);
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) { setError(true); setLoading(false); return; }
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/folders/${folderId}`, { headers }),
        fetch(`/api/folders/${folderId}/payment-requests`, { headers }),
      ]);
      const dJson = (await dRes.json().catch(() => ({}))) as { ok?: boolean } & Partial<FolderDetail>;
      if (dRes.ok && dJson?.ok && dJson.sections) { setDetail(dJson as FolderDetail); setError(false); } else setError(true);
      const pJson = (await pRes.json().catch(() => ({}))) as { ok?: boolean; payments?: FolderPayment[] };
      if (pRes.ok && pJson?.ok) setPayments(pJson.payments ?? []);
    } catch { setError(true); } finally { setLoading(false); }
  }, [folderId]);
  useEffect(() => { void load(); }, [load]);

  // Live updates without a manual refresh: re-fetch the project every 12s while
  // the tab is visible, so a customer's reply, an accepted offer, and read
  // receipts (read_at) surface on their own. Paused when the tab is hidden; the
  // initial-load spinner never re-fires (load() only flips loading→false).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load().then(() => setNaKey((n) => n + 1));
    }, 12000);
    return () => window.clearInterval(id);
  }, [load]);

  async function refresh() { await load(); setNaKey((n) => n + 1); onChanged?.(); }

  // «Εκτέλεση» on the single Next Best Action card → open the matching, already-
  // implemented flow. Nothing is auto-sent to the customer; the tech still
  // reviews/sends inside each sheet. create_work_folder never appears in folder
  // scope (a folder already exists), so it is a safe no-op here.
  function onNextAction(t: NextActionType) {
    switch (t) {
      case 'share_folder_link': void previewPortal(); break;
      case 'request_photos': setReqPhotos(true); setSheet('req'); break;
      case 'request_customer_details': setReqPhotos(false); setSheet('req'); break;
      case 'create_offer': setODesc(''); setOAmount(''); setSheet('offer'); break;
      case 'schedule_appointment': setATitle(f?.title ?? ''); setADate(''); setSheet('appt'); break;
      case 'send_follow_up':
      case 'reply_to_customer': setSheet('msg'); break;
      case 'mark_work_done': void completeProject(); break;
      default: break;
    }
  }

  const offers = detail?.sections.offers.items ?? [];
  const firstOffer = offers[0];

  const timeline = useMemo<Item[]>(() => {
    if (!detail) return [];
    const s = detail.sections;
    const items: Item[] = [
      ...s.messages.items.filter((m) => m.channel !== 'call' && (m.summary ?? '').trim()).map((m): Item => ({ kind: 'msg', ts: T(m.createdAt), data: m })),
      ...s.offers.items.map((o): Item => ({ kind: 'offer', ts: T(o.createdAt), data: o })),
      ...s.appointments.items.map((a): Item => ({ kind: 'appt', ts: T(a.dueDate), data: a })),
      ...payments.map((p): Item => ({ kind: 'payment', ts: T(p.createdAt), data: p })),
      ...s.photos.items.map((u): Item => ({ kind: 'req', ts: T(u.createdAt), data: u, photos: true })),
      ...s.intake.items.map((i): Item => ({ kind: 'req', ts: T(i.createdAt), data: i, photos: false })),
    ];
    return items.sort((a, b) => a.ts - b.ts);
  }, [detail, payments]);

  // ── actions ──────────────────────────────────────────────────────────────
  async function patchFolder(updates: Record<string, unknown>) {
    if (!beginBusy()) return;
    try {
      const headers = await authHeaders();
      if (!headers) { fail('Λήξη σύνδεσης. Συνδέσου ξανά.'); return; }
      const res = await fetch(`/api/folders/${folderId}`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
      if ((await res.json().catch(() => ({})) as { ok?: boolean })?.ok) await refresh();
      else fail('Η ενέργεια απέτυχε. Δοκίμασε ξανά.');
    } catch { fail('Πρόβλημα σύνδεσης. Δοκίμασε ξανά.'); } finally { endBusy(); }
  }
  // No step/stepper: the project is run «act freely» (parity with native). The
  // public portal does not render progress, and folder.step is no longer written.
  async function completeProject() { await patchFolder({ status: 'done' }); setSheet(null); }

  // Returns true only on a confirmed `{ ok: true }`; swallows network/auth errors
  // (returns false) so the caller can always surface a reason via fail().
  async function post(path: string, body: unknown): Promise<boolean> {
    try {
      const headers = await authHeaders();
      if (!headers) return false;
      const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
      return ((await res.json().catch(() => ({})) as { ok?: boolean })?.ok) === true;
    } catch { return false; }
  }
  async function sendMessage() {
    const t = msg.trim(); if (!t) return;
    if (!beginBusy()) return;
    try {
      if (await post(`/api/customers/${customerId}/message`, { text: t, workFolderId: folderId })) { setMsg(''); setSheet(null); await refresh(); }
      else fail('Το μήνυμα δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }
  async function sendRequest() {
    if (!beginBusy()) return;
    try {
      const path = reqPhotos ? 'upload-link' : 'intake-link';
      if (await post(`/api/customers/${customerId}/${path}`, { mode: 'send', workFolderId: folderId })) { setSheet(null); await refresh(); }
      else fail('Το αίτημα δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }
  async function submitOffer() {
    const desc = oDesc.trim(); const amount = Number(oAmount.replace(',', '.'));
    if (!desc || !isFinite(amount) || amount < 0) { fail('Συμπλήρωσε περιγραφή και έγκυρο ποσό.'); return; }
    if (!beginBusy()) return;
    try {
      if (await post('/api/offers', { customerId, workFolderId: folderId, items: [{ description: desc, quantity: 1, unitPrice: amount }] })) { setODesc(''); setOAmount(''); setSheet(null); await refresh(); }
      else fail('Η προσφορά δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }
  async function submitAppt() {
    const title = aTitle.trim(); if (!title) { fail('Συμπλήρωσε τίτλο ραντεβού.'); return; }
    if (!beginBusy()) return;
    try {
      if (await post('/api/tasks', { customerId, workFolderId: folderId, title, type: 'book_appointment', dueDate: aDate || new Date().toISOString().split('T')[0] })) { setATitle(''); setSheet(null); await refresh(); }
      else fail('Το ραντεβού δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }
  async function submitPayReq() {
    if (!firstOffer) return;
    if (!beginBusy()) return;
    try {
      if (await post(`/api/folders/${folderId}/payment-request`, { kind: payKind, pct: payPct, offerId: firstOffer.id })) { setSheet(null); await refresh(); }
      else fail('Το αίτημα πληρωμής δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }
  async function confirmPayment(id: string, status: 'confirmed' | 'cancelled') {
    if (!beginBusy()) return;
    try {
      const headers = await authHeaders();
      if (!headers) { fail('Λήξη σύνδεσης. Συνδέσου ξανά.'); return; }
      const res = await fetch(`/api/payments/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
      if ((await res.json().catch(() => ({})) as { ok?: boolean })?.ok) await refresh();
      else fail('Η ενέργεια πληρωμής απέτυχε. Δοκίμασε ξανά.');
    } catch { fail('Πρόβλημα σύνδεσης. Δοκίμασε ξανά.'); } finally { endBusy(); }
  }
  async function previewPortal() {
    if (!beginBusy()) return;
    try {
      const headers = await authHeaders();
      if (!headers) { fail('Λήξη σύνδεσης. Συνδέσου ξανά.'); return; }
      const res = await fetch(`/api/folders/${folderId}/link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'open' }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; responseUrl?: string };
      if (j?.ok && j.responseUrl) window.open(j.responseUrl, '_blank');
      else fail('Δεν άνοιξε ο σύνδεσμος. Δοκίμασε ξανά.');
    } catch { fail('Πρόβλημα σύνδεσης. Δοκίμασε ξανά.'); } finally { endBusy(); }
  }
  // «Απόρριψη πελάτη» — polite decline to the customer's link + mark customer «Χαμένος».
  async function rejectCustomer() {
    if (!beginBusy()) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      await fetch(`/api/customers/${customerId}/message`, { method: 'POST', headers, body: JSON.stringify({ text: REJECT_MESSAGE }) }).catch(() => {});
      await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'lost' }) }).catch(() => {});
      setSheet(null);
      onChanged?.();
      onClose();
    } finally { endBusy(); }
  }
  // «Διαγραφή έργου» — permanently delete this work folder. Its customer link +
  // next actions are removed (FK cascade); offers/appointments/messages stay in the
  // customer's history (FK set-null). After success, close and refresh the list.
  async function deleteFolder() {
    if (!beginBusy()) return;
    setDelMsg(null);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE', headers });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j?.ok) {
        setSheet(null);
        onChanged?.();
        onClose();
      } else if (j?.error === 'folder_has_payments') {
        setDelMsg('Το έργο έχει δηλωμένες/επιβεβαιωμένες πληρωμές. Ακύρωσε πρώτα την πληρωμή για να το διαγράψεις.');
      } else {
        setDelMsg('Η διαγραφή απέτυχε. Δοκίμασε ξανά.');
      }
    } catch {
      setDelMsg('Η διαγραφή απέτυχε. Δοκίμασε ξανά.');
    } finally { endBusy(); }
  }

  const f = detail?.folder;
  const grossOf = (pct: number) => (firstOffer?.total != null ? Math.round(firstOffer.total * pct) / 100 : 0);

  return (
    <div className="opf-stage" data-theme={theme} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--bg)' }}>
      <div className="opf-screen">
        {/* top bar */}
        <div className="opf-topbar opf-pj-top">
          <button className="opf-press opf-tb-back" onClick={onClose} aria-label="Πίσω"><Icon name="chevronL" size={24} color="var(--brand)" stroke={2.4} /></button>
          <div className="opf-pj-switch">
            <span className={`opf-pj-dot opf-dot-${STATUS_DOT[f?.status ?? 'open'] ?? 'new'}`} />
            <div className="opf-pj-switch-txt">
              <div className="opf-pj-switch-title">{f?.title ?? 'Έργο'}</div>
              <div className="opf-pj-switch-sub">{detail?.customer?.name ?? 'Πελάτης'} · {STATUS_LABELS[f?.status ?? 'open'] ?? ''}</div>
            </div>
          </div>
          <button className="opf-g-round opf-press" onClick={() => setSheet('menu')} aria-label="menu"><Icon name="dots" size={20} color="var(--brand)" stroke={2.6} /></button>
          <button className="opf-g-round opf-press" onClick={() => void previewPortal()} aria-label="preview"><Icon name="eye" size={19} color="var(--brand)" stroke={2} /></button>
        </div>

        {/* timeline */}
        <div className="opf-pj-body">
          {loading ? (
            <div className="opf-pj-end">Φόρτωση…</div>
          ) : error ? (
            <div className="opf-pj-end">Δεν φορτώθηκαν τα στοιχεία.</div>
          ) : (
            <>
              <NextActionCard endpoint={`/api/folders/${folderId}/next-action`} refreshKey={naKey} onExecute={onNextAction} />
              {timeline.map((it) => <Row key={`${it.kind}:${it.data.id}`} it={it} busy={busy} onConfirm={confirmPayment} onPayReq={() => { setPayKind('deposit'); setPayPct(30); setSheet('payreq'); }} onOpenOffer={(id) => router.push(`/offers/${id}`)} />)}
              <div className="opf-pj-end">Όλα όσα στέλνεις εδώ τα βλέπει ο πελάτης στο link του.</div>
            </>
          )}
        </div>

        {/* dock */}
        <div className="opf-pj-dock">
          <div className="opf-pj-quick">
            <button className="opf-pq opf-press" onClick={() => { setReqPhotos(false); setSheet('req'); }}><Icon name="clipboard" size={19} color="var(--brand)" stroke={2} /><span>Στοιχεία</span></button>
            <button className="opf-pq opf-press" onClick={() => { setReqPhotos(true); setSheet('req'); }}><Icon name="image" size={19} color="var(--brand)" stroke={2} /><span>Φωτό</span></button>
            <button className="opf-pq opf-press" onClick={() => { setATitle(f?.title ?? ''); setADate(''); setSheet('appt'); }}><Icon name="calendar" size={19} color="var(--brand)" stroke={2} /><span>Ραντεβού</span></button>
            <button className="opf-pq opf-press" onClick={() => { setODesc(''); setOAmount(''); setSheet('offer'); }}><Icon name="file" size={19} color="var(--brand)" stroke={2} /><span>Προσφορά</span></button>
          </div>
          <div className="opf-pj-composer">
            <button className="opf-pj-ai opf-press" onClick={() => setSheet('msg')} aria-label="ai"><Icon name="sparkles" size={18} color="#fff" stroke={2} /></button>
            <input className="opf-inp" placeholder="Μήνυμα στον πελάτη…" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendMessage(); }} />
            <button className="opf-pj-send opf-press" onClick={() => void sendMessage()} aria-label="send"><Icon name="send" size={19} color="#fff" stroke={2} /></button>
          </div>
        </div>

        {/* message sheet */}
        <Sheet open={sheet === 'msg'} title="Μήνυμα στον πελάτη" onClose={() => setSheet(null)} footer={<button className="opf-btn-primary opf-full opf-press" onClick={() => void sendMessage()}><Icon name="send" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Αποστολή…' : 'Αποστολή στο link'}</span></button>}>
          <textarea className="opf-ta" placeholder="Γράψε μήνυμα…" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus />
        </Sheet>

        {/* appointment sheet */}
        <Sheet open={sheet === 'appt'} title="Αποστολή ραντεβού" onClose={() => setSheet(null)} footer={<button className="opf-btn-primary opf-full opf-press" onClick={() => void submitAppt()}><Icon name="calendar" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Αποστολή…' : 'Αποστολή στο link'}</span></button>}>
          <label className="opf-field"><span className="opf-field-label">Τίτλος</span><input className="opf-inp" value={aTitle} onChange={(e) => setATitle(e.target.value)} placeholder="π.χ. Επίσκεψη για μέτρηση" /></label>
          <label className="opf-field"><span className="opf-field-label">Ημερομηνία</span><input className="opf-inp" type="date" value={aDate} onChange={(e) => setADate(e.target.value)} /></label>
        </Sheet>

        {/* offer sheet */}
        <Sheet open={sheet === 'offer'} title="Αποστολή προσφοράς" onClose={() => setSheet(null)} footer={<div style={{ width: '100%' }}><div className="opf-offer-total">Ποσό: <b>{eur(Number(oAmount.replace(',', '.')) || 0)}</b></div><button className="opf-btn-primary opf-full opf-press" onClick={() => void submitOffer()}><Icon name="file" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Αποστολή…' : 'Αποστολή στο link'}</span></button></div>}>
          <label className="opf-field"><span className="opf-field-label">Περιγραφή</span><input className="opf-inp" value={oDesc} onChange={(e) => setODesc(e.target.value)} placeholder="π.χ. Τοποθέτηση κλιματιστικού" /></label>
          <label className="opf-field"><span className="opf-field-label">Ποσό (€)</span><input className="opf-inp" inputMode="decimal" value={oAmount} onChange={(e) => setOAmount(e.target.value)} placeholder="0" /></label>
        </Sheet>

        {/* request sheet */}
        <Sheet open={sheet === 'req'} title={reqPhotos ? 'Αίτημα φωτογραφιών' : 'Αίτημα στοιχείων'} onClose={() => setSheet(null)} footer={<button className="opf-btn-primary opf-full opf-press" onClick={() => void sendRequest()}><Icon name="link" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Αποστολή…' : 'Αποστολή αιτήματος'}</span></button>}>
          <div className="opf-req-info"><Icon name={reqPhotos ? 'image' : 'clipboard'} size={22} color="var(--brand)" stroke={2} /><span>{reqPhotos ? 'Ο πελάτης θα ανεβάσει φωτογραφίες μέσα από το link του έργου.' : 'Ο πελάτης θα συμπληρώσει τα στοιχεία του (διεύθυνση, ΑΦΜ κ.λπ.) μέσα από το link.'}</span></div>
        </Sheet>

        {/* payment request sheet (deposit/balance + %-slider) */}
        <Sheet open={sheet === 'payreq'} title="Αίτημα πληρωμής" onClose={() => setSheet(null)} footer={firstOffer ? <button className="opf-btn-primary opf-full opf-press" onClick={() => void submitPayReq()}><Icon name="euro" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Αποστολή…' : 'Αποστολή αιτήματος'}</span></button> : <button className="opf-btn-primary opf-full opf-press" onClick={() => { setODesc(''); setOAmount(''); setSheet('offer'); }}><Icon name="file" size={19} color="#fff" stroke={2.1} /><span>Δημιουργία προσφοράς</span></button>}>
          {firstOffer ? (
            <>
              <div className="opf-seg opf-seg-pad" style={{ marginBottom: 18 }}>
                <div className="opf-seg-thumb" style={{ transform: payKind === 'balance' ? 'translateX(100%)' : 'none' }} />
                <button className={'opf-seg-btn opf-press' + (payKind === 'deposit' ? ' opf-on' : '')} onClick={() => setPayKind('deposit')}>Προκαταβολή</button>
                <button className={'opf-seg-btn opf-press' + (payKind === 'balance' ? ' opf-on' : '')} onClick={() => setPayKind('balance')}>Εξόφληση</button>
              </div>
              <div className="opf-pay-pct-wrap">
                <div className="opf-pay-pct-row"><span>Ποσοστό</span><b>{payPct}%</b></div>
                <input className="opf-pctslider" type="range" min={5} max={100} step={5} value={payPct} onChange={(e) => setPayPct(Number(e.target.value))} />
                <div className="opf-pay-amount-lg"><span>Ποσό αιτήματος (με ΦΠΑ)</span><span className="opf-pay-big">{eur(grossOf(payPct))}</span></div>
              </div>
            </>
          ) : (
            <div className="opf-req-info"><Icon name="file" size={22} color="var(--brand)" stroke={2} /><span>Πρόσθεσε πρώτα μια προσφορά για να ζητήσεις πληρωμή.</span></div>
          )}
        </Sheet>

        {/* menu sheet */}
        <Sheet open={sheet === 'menu'} title="Ενέργειες έργου" onClose={() => setSheet(null)}>
          <button className="opf-menu-item opf-press" onClick={() => void completeProject()}><div className="opf-menu-ic opf-ok"><Icon name="check" size={19} color="var(--success)" stroke={2.4} /></div> Ολοκλήρωση έργου (Κερδισμένο)</button>
          <button className="opf-menu-item opf-press" onClick={() => { setPayKind('deposit'); setPayPct(30); setSheet('payreq'); }}><div className="opf-menu-ic"><Icon name="euro" size={19} color="var(--brand)" stroke={2} /></div> Αίτημα πληρωμής</button>
          <button className="opf-menu-item opf-press" onClick={() => setSheet('reject')}><div className="opf-menu-ic opf-danger" style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}><Icon name="x" size={19} color="var(--danger)" stroke={2.4} /></div> <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Απόρριψη πελάτη</span></button>
          <button className="opf-menu-item opf-press" onClick={() => setSheet('delete')}><div className="opf-menu-ic opf-danger" style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}><Icon name="trash" size={19} color="var(--danger)" stroke={2.2} /></div> <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Διαγραφή έργου</span></button>
        </Sheet>

        {/* reject customer sheet */}
        <Sheet open={sheet === 'reject'} title="Απόρριψη πελάτη" onClose={() => setSheet(null)} footer={<button className="opf-btn-primary opf-full opf-press" onClick={() => void rejectCustomer()} style={{ background: 'var(--danger)' }}><Icon name="x" size={18} color="#fff" stroke={2.4} /><span>{busy ? 'Αποστολή…' : 'Αποστολή & απόρριψη'}</span></button>}>
          <div className="opf-req-info"><Icon name="message" size={22} color="var(--danger)" stroke={2} /><span>Στέλνουμε ένα ευγενικό μήνυμα στον πελάτη και σημαίνουμε τον πελάτη ως «Χαμένο».</span></div>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--surface-2, rgba(0,0,0,0.045))', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, fontStyle: 'italic' }}>«{REJECT_MESSAGE}»</div>
        </Sheet>

        {/* delete project sheet */}
        <Sheet open={sheet === 'delete'} title="Διαγραφή έργου" onClose={() => setSheet(null)} footer={<button className="opf-btn-primary opf-full opf-press" onClick={() => void deleteFolder()} style={{ background: 'var(--danger)' }}><Icon name="trash" size={18} color="#fff" stroke={2.2} /><span>{busy ? 'Διαγραφή…' : 'Οριστική διαγραφή'}</span></button>}>
          <div className="opf-req-info"><Icon name="trash" size={22} color="var(--danger)" stroke={2} /><span>Το έργο θα διαγραφεί οριστικά. Ο σύνδεσμος του πελάτη παύει να ισχύει. Οι προσφορές, τα ραντεβού και τα μηνύματα παραμένουν στο ιστορικό του πελάτη. Η ενέργεια δεν αναιρείται.</span></div>
          {delMsg && <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }}>{delMsg}</div>}
        </Sheet>

        {/* action error toast — top-anchored so it shows over any open sheet */}
        {actionErr && (
          <div role="alert" onClick={() => setActionErr(null)}
            style={{ position: 'fixed', left: '50%', top: 'calc(env(safe-area-inset-top) + 64px)', transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 'min(92vw, 420px)', background: 'var(--danger)', color: '#fff', padding: '11px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', cursor: 'pointer' }}>
            {actionErr}
          </div>
        )}
      </div>
    </div>
  );
}

// ── timeline event rows (prototype DOM) ──────────────────────────────────────
function Row({ it, busy, onConfirm, onPayReq, onOpenOffer }: { it: Item; busy: boolean; onConfirm: (id: string, s: 'confirmed' | 'cancelled') => void; onPayReq: () => void; onOpenOffer: (id: string) => void }) {
  if (it.kind === 'msg') {
    const m = it.data; const tech = m.direction === 'outbound';
    return (
      <div className={'opf-bub ' + (tech ? 'opf-r' : 'opf-l')}>
        <div className={'opf-bubble ' + (tech ? 'opf-role-tech' : 'opf-role-cust')}>
          <div className="opf-bubble-text">{(m.summary ?? '').trim()}</div>
          <div className="opf-bubble-when">
            {formatRelativeDateTimeGr(m.createdAt)}
            {tech && m.readAt && <span style={{ marginLeft: 6 }}>· Διαβάστηκε {formatRelativeDateTimeGr(m.readAt)}</span>}
            {tech && (
              <span style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle' }}>
                <Icon name="check" size={12} color={m.readAt ? '#7CF0C4' : 'rgba(255,255,255,0.85)'} stroke={2.6} />
                {m.readAt && <span style={{ marginLeft: -7, display: 'inline-flex' }}><Icon name="check" size={12} color="#7CF0C4" stroke={2.6} /></span>}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (it.kind === 'offer') {
    const o = it.data; const accepted = o.status === 'accepted';
    return (
      <>
        <div className="opf-ev-side opf-r">
          <div className="opf-ev-card opf-press" role="button" tabIndex={0} onClick={() => onOpenOffer(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenOffer(o.id); }} style={{ cursor: 'pointer' }}>
            <div className="opf-ev-card-top">
              <div className="opf-ev-card-ic opf-offer"><Icon name="file" size={18} color="#fff" stroke={2.1} /></div>
              <div className="opf-ev-card-h"><div className="opf-ev-card-title">Προσφορά</div><div className="opf-ev-card-sub">{o.offerNumber ?? '—'}</div></div>
              <div className={'opf-ev-status ' + (accepted ? 'opf-st-accepted' : 'opf-st-sent')}>{OFFER_STATUS_GR[o.status] ?? o.status}</div>
            </div>
            {o.total != null && <div className="opf-ev-total"><span>Σύνολο</span><b>{eur(o.total)}</b></div>}
            <div className="opf-ev-foot"><span className="opf-ev-dot opf-you" />Εσύ<span style={{ marginLeft: 8, color: 'var(--muted)', fontWeight: 500 }}>· {formatRelativeDateTimeGr(o.createdAt)}</span><span style={{ marginLeft: 'auto', color: 'var(--brand)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="file" size={13} color="var(--brand)" stroke={2} />Άνοιγμα PDF</span></div>
          </div>
        </div>
        {accepted && (
          <div className="opf-ev-accepted">
            <div className="opf-ev-acc-l"><Icon name="check" size={18} color="#fff" stroke={2.6} /></div>
            <div className="opf-ev-acc-main"><b>Η προσφορά έγινε αποδεκτή</b><span>Ζήτα προκαταβολή ή εξόφληση</span></div>
            <button className="opf-ev-acc-btn opf-press" onClick={onPayReq}>Αίτημα πληρωμής</button>
          </div>
        )}
      </>
    );
  }
  if (it.kind === 'appt') {
    const a = it.data; const confirmed = a.status === 'completed';
    return (
      <div className="opf-ev-side opf-r">
        <div className="opf-ev-card">
          <div className="opf-ev-card-top">
            <div className="opf-ev-card-ic opf-appt"><Icon name="calendar" size={18} color="#fff" stroke={2.1} /></div>
            <div className="opf-ev-card-h"><div className="opf-ev-card-title">Ραντεβού</div><div className="opf-ev-card-sub">{a.title}</div></div>
            <div className={'opf-ev-status ' + (confirmed ? 'opf-st-accepted' : 'opf-st-sent')}>{confirmed ? 'Ολοκληρώθηκε' : APPT_TYPE_GR[a.type] ?? 'Ραντεβού'}</div>
          </div>
          {a.dueDate && <div className="opf-ev-appt"><Icon name="clock" size={17} color="var(--brand)" stroke={2} /><b>{fmtDate(a.dueDate)}</b>{a.dueTime && <span>· {a.dueTime}</span>}</div>}
          <div className="opf-ev-foot"><span className="opf-ev-dot opf-you" />Εσύ</div>
        </div>
      </div>
    );
  }
  if (it.kind === 'payment') {
    const p = it.data; const final = p.status === 'confirmed' || p.status === 'cancelled';
    return (
      <div className="opf-ev-side opf-r">
        <div className="opf-ev-card opf-slim">
          <div className="opf-ev-card-top">
            <div className="opf-ev-card-ic opf-pay"><Icon name="euro" size={18} color="#fff" stroke={2.1} /></div>
            <div className="opf-ev-card-h"><div className="opf-ev-card-title">{PAY_KIND_GR[p.kind] ?? p.kind}{p.pct != null ? ` · ${p.pct}%` : ''} · {eur(p.amount)}</div><div className="opf-ev-card-sub">{p.status === 'confirmed' ? 'Πληρώθηκε — επιβεβαιωμένο' : p.status === 'declared' ? 'Ο πελάτης δήλωσε κατάθεση' : p.status === 'cancelled' ? 'Ακυρώθηκε' : 'Σε αναμονή κατάθεσης'}</div></div>
            <div className={'opf-ev-status ' + (p.status === 'confirmed' ? 'opf-st-accepted' : 'opf-st-pending')}>{p.status === 'confirmed' ? '✓' : '…'}</div>
          </div>
          {!final && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="opf-ev-acc-btn opf-press" onClick={() => onConfirm(p.id, 'confirmed')} style={{ opacity: busy ? 0.5 : 1 }}>Επιβεβαίωση είσπραξης</button>
              <button className="opf-press" onClick={() => onConfirm(p.id, 'cancelled')} style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', padding: '9px 6px' }}>Ακύρωση</button>
            </div>
          )}
          <div className="opf-ev-foot"><span className="opf-ev-dot opf-you" />Εσύ<span style={{ marginLeft: 8, color: 'var(--muted)', fontWeight: 500 }}>· {formatRelativeDateTimeGr(p.createdAt)}</span></div>
        </div>
      </div>
    );
  }
  // request (photos / info)
  const r = it.data; const done = r.status === 'submitted' || r.status === 'completed';
  return (
    <div className="opf-ev-side opf-r">
      <div className="opf-ev-card opf-slim">
        <div className="opf-ev-card-top">
          <div className="opf-ev-card-ic opf-req"><Icon name={it.photos ? 'image' : 'clipboard'} size={18} color="#fff" stroke={2.1} /></div>
          <div className="opf-ev-card-h"><div className="opf-ev-card-title">{it.photos ? 'Αίτημα φωτογραφιών' : 'Αίτημα στοιχείων'}</div><div className="opf-ev-card-sub">{REQ_STATUS_GR[r.status] ?? r.status}</div></div>
          <div className={'opf-ev-status ' + (done ? 'opf-st-accepted' : 'opf-st-pending')}>{done ? '✓' : '…'}</div>
        </div>
        <div className="opf-ev-foot"><span className="opf-ev-dot opf-you" />Εσύ<span style={{ marginLeft: 8, color: 'var(--muted)', fontWeight: 500 }}>· {formatRelativeDateTimeGr(r.createdAt)}</span></div>
      </div>
    </div>
  );
}

// ── prototype bottom sheet ───────────────────────────────────────────────────
function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="opf-sheet-wrap opf-open" onClick={onClose}>
      <div className="opf-sheet-backdrop" />
      <div className="opf-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="opf-sheet-grab" />
        <div className="opf-sheet-head">
          <div className="opf-sheet-title">{title}</div>
          <button className="opf-sheet-x opf-press" onClick={onClose} aria-label="close"><Icon name="x" size={20} color="var(--muted)" stroke={2.2} /></button>
        </div>
        <div className="opf-sheet-body">{children}</div>
        {footer && <div className="opf-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
