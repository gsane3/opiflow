'use client';

// Φάκελος εργασίας — detail body (WF-4, web). Shows the real folder sections
// (Προσφορές / Ραντεβού / Μηνύματα / Φωτογραφίες / Στοιχεία πελάτη) with counts +
// latest items, plus: connect an existing offer/appointment («Σύνδεση υπάρχοντος»),
// remove one («Αφαίρεση από φάκελο»), and a quick create that files the new
// offer/appointment straight into the folder. Authenticated WF-1A/WF-4 APIs only.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

const FOLDER_STATUS_OPTIONS = [
  { v: 'open', l: 'Νέο' },
  { v: 'in_progress', l: 'Σε εξέλιξη' },
  { v: 'done', l: 'Ολοκληρώθηκε' },
  { v: 'archived', l: 'Αρχειοθετήθηκε' },
];

const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Πρόχειρη', ready_to_send: 'Έτοιμη', sent_manually: 'Στάλθηκε', sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε', cancelled: 'Ακυρώθηκε',
};
const APPT_TYPE_GR: Record<string, string> = { book_appointment: 'Ραντεβού', visit_customer: 'Επίσκεψη' };
// Request (intake/upload token) status, in plain Greek.
const REQ_STATUS_GR: Record<string, string> = {
  pending: 'Εκκρεμεί', sent: 'Στάλθηκε', opened: 'Ανοίχτηκε',
  submitted: 'Υποβλήθηκε', completed: 'Ολοκληρώθηκε', expired: 'Έληξε', revoked: 'Ακυρώθηκε',
};

interface DetailOffer { id: string; offerNumber: string | null; status: string; total: number | null; createdAt: string }
interface DetailAppt { id: string; title: string; type: string; status: string; dueDate: string | null; dueTime: string | null }
interface DetailMsg { id: string; summary: string | null; direction: string; channel: string; createdAt: string }
interface DetailUpload { id: string; status: string; sentChannel: string | null; createdAt: string; openedAt: string | null; completedAt: string | null }
interface DetailIntake { id: string; status: string; sentChannel: string | null; createdAt: string; openedAt: string | null; submittedAt: string | null }
interface FolderDetail {
  folder: { id: string; title: string; status: string; notes: string | null };
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  sections: {
    offers: { count: number; items: DetailOffer[] };
    appointments: { count: number; items: DetailAppt[] };
    messages: { count: number; items: DetailMsg[] };
    photos: { count: number; items: DetailUpload[] };
    intake: { count: number; items: DetailIntake[] };
  };
}
interface AttachOffer { id: string; offerNumber: string | null; status: string; total: number | null }
interface AttachAppt { id: string; title: string; type: string; status: string; dueDate: string | null }
interface AttachMsg { id: string; direction: string; channel: string; summary: string | null; createdAt: string }
interface AttachReq { id: string; status: string; sentChannel: string | null; createdAt: string }

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

function money(n: number | null): string {
  return typeof n === 'number' ? `€${n.toLocaleString('el-GR')}` : '';
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export default function FolderDetailPanel({
  folderId,
  onChanged,
  showActions = true,
}: {
  folderId: string;
  onChanged?: () => void;
  /** When true (default), also render the public link + edit + archive actions so
   *  this is a COMPLETE folder detail (used from the chat-first folder modal). The
   *  info-panel WorkFoldersSection passes false to keep its own copy (no double). */
  showActions?: boolean;
}) {
  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Panel-level toast: green for success, red for failure.
  const notify = (msg: string, isError = false) => { setToast(msg); setToastErr(isError); };

  // attach sheet
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState(false);
  const [attOffers, setAttOffers] = useState<AttachOffer[]>([]);
  const [attAppts, setAttAppts] = useState<AttachAppt[]>([]);
  const [attMsgs, setAttMsgs] = useState<AttachMsg[]>([]);
  const [attIntake, setAttIntake] = useState<AttachReq[]>([]);
  const [attUpload, setAttUpload] = useState<AttachReq[]>([]);

  // quick create
  const [qcMode, setQcMode] = useState<'offer' | 'appointment' | null>(null);
  const [qcDesc, setQcDesc] = useState('');
  const [qcAmount, setQcAmount] = useState('');
  const [qcTitle, setQcTitle] = useState('');
  const [qcType, setQcType] = useState('book_appointment');
  const [qcDate, setQcDate] = useState(todayStr());
  const [qcBusy, setQcBusy] = useState(false);
  const [qcError, setQcError] = useState('');

  // WF-2 public link (chat-complete actions)
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkErr, setLinkErr] = useState('');

  // edit / archive
  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eStatus, setEStatus] = useState('open');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setError(true); setLoading(false); return; }
      const res = await fetch(`/api/folders/${folderId}`, { headers });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean } & Partial<FolderDetail>;
      if (res.ok && json?.ok && json.sections) {
        setDetail(json as FolderDetail);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-dismiss the action toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function refreshAll() {
    await load();
    onChanged?.();
  }

  async function openAttach() {
    setAttachOpen(true);
    setAttachLoading(true);
    setAttachError(false);
    try {
      const headers = await authHeaders();
      if (!headers) { setAttachError(true); setAttachLoading(false); return; }
      const res = await fetch(`/api/folders/${folderId}/attachable`, { headers });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean; offers?: AttachOffer[]; appointments?: AttachAppt[];
        messages?: AttachMsg[]; intake?: AttachReq[]; upload?: AttachReq[];
      };
      if (res.ok && json?.ok) {
        setAttOffers(json.offers ?? []);
        setAttAppts(json.appointments ?? []);
        setAttMsgs(json.messages ?? []);
        setAttIntake(json.intake ?? []);
        setAttUpload(json.upload ?? []);
      } else {
        setAttachError(true);
      }
    } catch {
      setAttachError(true);
    } finally {
      setAttachLoading(false);
    }
  }

  type AttachEntity = 'offer' | 'task' | 'communication' | 'intake_token' | 'upload_token';
  async function setFolderLink(entityType: AttachEntity, entityId: string, attach: boolean) {
    setBusyKey(`${entityType}:${entityId}:${attach}`);
    try {
      const headers = await authHeaders();
      if (!headers) { notify(attach ? 'Δεν έγινε η σύνδεση. Δοκίμασε ξανά.' : 'Δεν αφαιρέθηκε. Δοκίμασε ξανά.', true); return; }
      const res = await fetch(`/api/folders/${folderId}/attach`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entityType, entityId, attach }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) {
        notify(attach ? 'Συνδέθηκε με τον φάκελο' : 'Αφαιρέθηκε από τον φάκελο');
        if (attach && attachOpen) {
          // refresh the pick lists so the just-attached item drops off
          setAttOffers((p) => p.filter((o) => o.id !== entityId));
          setAttAppts((p) => p.filter((a) => a.id !== entityId));
          setAttMsgs((p) => p.filter((m) => m.id !== entityId));
          setAttIntake((p) => p.filter((i) => i.id !== entityId));
          setAttUpload((p) => p.filter((u) => u.id !== entityId));
        }
        await refreshAll();
      } else {
        notify(attach ? 'Δεν έγινε η σύνδεση. Δοκίμασε ξανά.' : 'Δεν αφαιρέθηκε. Δοκίμασε ξανά.', true);
      }
    } catch {
      notify(attach ? 'Δεν έγινε η σύνδεση. Δοκίμασε ξανά.' : 'Δεν αφαιρέθηκε. Δοκίμασε ξανά.', true);
    } finally {
      setBusyKey(null);
    }
  }

  // WF-4B: send a photo/intake request to the customer, filed into this folder.
  async function sendRequest(kind: 'upload' | 'intake') {
    setBusyKey(`req:${kind}`);
    try {
      const headers = await authHeaders();
      const customerId = detail?.customer?.id;
      if (!headers || !customerId) { notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true); return; }
      const path = kind === 'upload' ? 'upload-link' : 'intake-link';
      const res = await fetch(`/api/customers/${customerId}/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'send', workFolderId: folderId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (res.ok && json?.ok) {
        // The token is created (and filed) even when delivery falls back, so always refresh.
        if (json.sent) notify(kind === 'upload' ? 'Στάλθηκε το αίτημα φωτογραφιών.' : 'Στάλθηκε το αίτημα στοιχείων.');
        else notify(json.fallbackReason === 'missing_mobile' ? 'Λείπει κινητό τηλέφωνο.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.', true);
        await refreshAll();
      } else {
        notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true);
      }
    } catch {
      notify('Δεν στάλθηκε. Δοκίμασε ξανά.', true);
    } finally {
      setBusyKey(null);
    }
  }

  function openQuickCreate(mode: 'offer' | 'appointment') {
    setQcMode(mode);
    setQcDesc(''); setQcAmount(''); setQcTitle(''); setQcType('book_appointment'); setQcDate(todayStr()); setQcError('');
  }

  async function submitQuickCreate() {
    if (!qcMode) return;
    setQcError('');
    setQcBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setQcError('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const customerId = detail?.customer?.id;
      if (!customerId) { setQcError('Δεν βρέθηκε ο πελάτης.'); return; }

      let res: Response;
      if (qcMode === 'offer') {
        const desc = qcDesc.trim();
        const amount = Number(qcAmount.replace(',', '.'));
        if (!desc) { setQcError('Γράψε περιγραφή.'); setQcBusy(false); return; }
        if (!isFinite(amount) || amount < 0) { setQcError('Γράψε ποσό.'); setQcBusy(false); return; }
        res = await fetch('/api/offers', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customerId,
            workFolderId: folderId,
            items: [{ description: desc, quantity: 1, unitPrice: amount }],
          }),
        });
      } else {
        const title = qcTitle.trim();
        if (!title) { setQcError('Γράψε τίτλο.'); setQcBusy(false); return; }
        res = await fetch('/api/tasks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customerId,
            workFolderId: folderId,
            title,
            type: qcType,
            dueDate: qcDate || todayStr(),
          }),
        });
      }
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) {
        setQcMode(null);
        notify('Συνδέθηκε με τον φάκελο');
        await refreshAll();
      } else {
        setQcError('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch {
      setQcError('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setQcBusy(false);
    }
  }

  // WF-2: public folder link — draft, copy, send (Viber/SMS), share.
  async function draftLink() {
    setLinkBusy(true); setLinkErr(''); setLinkSent(false); setLinkCopied(false);
    try {
      const headers = await authHeaders();
      if (!headers) { setLinkErr('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/folders/${folderId}/link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'draft' }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; responseUrl?: string };
      if (res.ok && json?.ok && json.responseUrl) setLinkUrl(json.responseUrl);
      else setLinkErr('Δεν δημιουργήθηκε ο σύνδεσμος. Δοκίμασε ξανά.');
    } catch {
      setLinkErr('Δεν δημιουργήθηκε ο σύνδεσμος. Δοκίμασε ξανά.');
    } finally {
      setLinkBusy(false);
    }
  }
  async function copyLink() {
    if (!linkUrl) return;
    try { await navigator.clipboard.writeText(linkUrl); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2000); }
    catch { setLinkErr('Δεν έγινε αντιγραφή. Αντίγραψε χειροκίνητα.'); }
  }
  async function sendLink() {
    if (!linkUrl) return;
    setLinkBusy(true); setLinkErr('');
    try {
      const headers = await authHeaders();
      if (!headers) { setLinkErr('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return; }
      const res = await fetch(`/api/folders/${folderId}/link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'send', responseUrl: linkUrl }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; fallbackReason?: string };
      if (res.ok && json?.ok && json.sent) setLinkSent(true);
      else setLinkErr(json?.fallbackReason === 'missing_mobile' ? 'Λείπει κινητό τηλέφωνο.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.');
    } catch {
      setLinkErr('Δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally {
      setLinkBusy(false);
    }
  }
  function shareLink() {
    if (!linkUrl) return;
    if (typeof navigator !== 'undefined' && navigator.share) void navigator.share({ url: linkUrl }).catch(() => {});
    else void copyLink();
  }

  // edit / archive — PATCH /api/folders/[id]
  async function patchFolder(updates: Record<string, unknown>): Promise<boolean> {
    setEditBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setEditErr('Λήξη σύνδεσης. Δοκίμασε ξανά.'); return false; }
      const res = await fetch(`/api/folders/${folderId}`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) { await refreshAll(); return true; }
      setEditErr('Η αποθήκευση απέτυχε. Δοκίμασε ξανά.');
      return false;
    } catch {
      setEditErr('Η αποθήκευση απέτυχε. Δοκίμασε ξανά.');
      return false;
    } finally {
      setEditBusy(false);
    }
  }
  function openEdit() {
    if (!detail) return;
    setETitle(detail.folder.title);
    setENotes(detail.folder.notes ?? '');
    setEStatus(detail.folder.status);
    setEditErr('');
    setEditing(true);
  }
  async function saveEdit() {
    const t = eTitle.trim();
    if (!t) { setEditErr('Γράψε τίτλο εργασίας.'); return; }
    const ok = await patchFolder({ title: t, notes: eNotes.trim() || null, status: eStatus });
    if (ok) setEditing(false);
  }
  async function archive() {
    await patchFolder({ status: 'archived' });
  }

  if (loading) {
    return <p className="py-3 text-sm text-zinc-400 dark:text-zinc-500">Φορτώνει...</p>;
  }
  if (error || !detail) {
    return (
      <div className="space-y-2 py-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Δεν φορτώθηκαν τα στοιχεία.</p>
        <Button variant="secondary" size="sm" onClick={() => void load()}>Δοκίμασε ξανά</Button>
      </div>
    );
  }

  const s = detail.sections;

  return (
    <div className="space-y-3">
      {toast && <p className={`text-xs font-medium ${toastErr ? 'text-red-600' : 'text-green-700'}`}>{toast}</p>}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={openAttach}>Σύνδεση υπάρχοντος</Button>
        <Button variant="secondary" size="sm" onClick={() => openQuickCreate('offer')}>Νέα προσφορά</Button>
        <Button variant="secondary" size="sm" onClick={() => openQuickCreate('appointment')}>Νέο ραντεβού</Button>
      </div>

      {/* Προσφορές */}
      <Section title="Προσφορές" count={s.offers.count}>
        {s.offers.items.length === 0 ? (
          <Empty />
        ) : (
          s.offers.items.map((o) => (
            <Row
              key={o.id}
              primary={o.offerNumber ?? '—'}
              secondary={`${OFFER_STATUS_GR[o.status] ?? o.status}${o.total != null ? ` · ${money(o.total)}` : ''}`}
              busy={busyKey === `offer:${o.id}:false`}
              onDetach={() => void setFolderLink('offer', o.id, false)}
            />
          ))
        )}
      </Section>

      {/* Ραντεβού */}
      <Section title="Ραντεβού" count={s.appointments.count}>
        {s.appointments.items.length === 0 ? (
          <Empty />
        ) : (
          s.appointments.items.map((a) => (
            <Row
              key={a.id}
              primary={a.title}
              secondary={`${APPT_TYPE_GR[a.type] ?? 'Ραντεβού'}${a.dueDate ? ` · ${formatDateGr(a.dueDate)}` : ''}${a.dueTime ? ` ${a.dueTime}` : ''}`}
              busy={busyKey === `task:${a.id}:false`}
              onDetach={() => void setFolderLink('task', a.id, false)}
            />
          ))
        )}
      </Section>

      {/* Μηνύματα */}
      <Section title="Μηνύματα" count={s.messages.count}>
        {s.messages.items.length === 0 ? (
          <Empty />
        ) : (
          s.messages.items.map((m) => (
            <Row
              key={m.id}
              primary={m.summary ?? '—'}
              secondary={formatDateGr(m.createdAt)}
              busy={busyKey === `communication:${m.id}:false`}
              onDetach={() => void setFolderLink('communication', m.id, false)}
            />
          ))
        )}
      </Section>

      {/* Φωτογραφίες */}
      <Section
        title="Φωτογραφίες"
        count={s.photos.count}
        action={<SmallAction busy={busyKey === 'req:upload'} onClick={() => void sendRequest('upload')}>Ζήτα φωτογραφίες</SmallAction>}
      >
        {s.photos.items.length === 0 ? (
          <Empty />
        ) : (
          s.photos.items.map((u) => (
            <Row
              key={u.id}
              primary={REQ_STATUS_GR[u.status] ?? u.status}
              secondary={`Αίτημα φωτογραφιών · ${formatDateGr(u.createdAt)}`}
              busy={busyKey === `upload_token:${u.id}:false`}
              onDetach={() => void setFolderLink('upload_token', u.id, false)}
            />
          ))
        )}
      </Section>

      {/* Στοιχεία πελάτη */}
      <Section
        title="Στοιχεία πελάτη"
        action={<SmallAction busy={busyKey === 'req:intake'} onClick={() => void sendRequest('intake')}>Ζήτα στοιχεία</SmallAction>}
      >
        {detail.customer && (
          <div className="px-1 text-xs text-zinc-600 dark:text-zinc-300">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">{detail.customer.name ?? 'Πελάτης'}</p>
            {detail.customer.phone && <p>{detail.customer.phone}</p>}
            {detail.customer.email && <p>{detail.customer.email}</p>}
          </div>
        )}
        {s.intake.items.map((i) => (
          <Row
            key={i.id}
            primary={REQ_STATUS_GR[i.status] ?? i.status}
            secondary={`Αίτημα στοιχείων · ${formatDateGr(i.createdAt)}`}
            busy={busyKey === `intake_token:${i.id}:false`}
            onDetach={() => void setFolderLink('intake_token', i.id, false)}
          />
        ))}
        {!detail.customer && s.intake.items.length === 0 && <Empty />}
      </Section>

      {/* WF-2 public link + edit + archive — makes this panel a COMPLETE folder
          detail, so the chat-opened modal needs nothing from the profile/info. */}
      {showActions && (
        <>
          <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Σύνδεσμος για τον πελάτη</p>
            {linkErr && <p className="text-xs text-red-600">{linkErr}</p>}
            {!linkUrl ? (
              <Button variant="secondary" size="sm" loading={linkBusy} onClick={draftLink}>Δημιουργία συνδέσμου</Button>
            ) : (
              <>
                <input
                  readOnly
                  value={linkUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-300"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={copyLink}>{linkCopied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή'}</Button>
                  <Button size="sm" loading={linkBusy} onClick={sendLink}>Αποστολή (Viber/SMS)</Button>
                  <Button variant="secondary" size="sm" onClick={shareLink}>Κοινοποίηση</Button>
                </div>
                {linkSent && <p className="text-xs font-medium text-green-700">Ο σύνδεσμος στάλθηκε.</p>}
              </>
            )}
          </div>

          {editing ? (
            <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              {editErr && <p className="text-xs text-red-600">{editErr}</p>}
              <Input label="Τίτλος εργασίας" value={eTitle} maxLength={120} onChange={(e) => { setETitle(e.target.value); if (editErr) setEditErr(''); }} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
              <Textarea label="Σημειώσεις" value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} placeholder="προαιρετικά" />
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Κατάσταση</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOLDER_STATUS_OPTIONS.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setEStatus(o.v)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${eStatus === o.v ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300'}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Ακύρωση</Button>
                <Button size="sm" loading={editBusy} onClick={saveEdit}>Αποθήκευση</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 border-t border-zinc-200/70 pt-2 dark:border-white/10">
              <button type="button" onClick={openEdit} className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50">Επεξεργασία</button>
              {detail.folder.status !== 'archived' && (
                <button type="button" onClick={() => void archive()} disabled={editBusy} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:text-amber-700 disabled:opacity-40">
                  {editBusy ? '...' : 'Αρχειοθέτηση'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Attach sheet */}
      {attachOpen && (
        <Overlay onClose={() => setAttachOpen(false)} title="Σύνδεση με φάκελο">
          {attachLoading ? (
            <p className="py-3 text-sm text-zinc-400">Φορτώνει...</p>
          ) : attachError ? (
            <div className="space-y-2 py-2">
              <p className="text-sm text-zinc-500">Δεν φορτώθηκαν τα στοιχεία.</p>
              <Button variant="secondary" size="sm" onClick={() => void openAttach()}>Δοκίμασε ξανά</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-semibold text-zinc-500">Προσφορές</p>
                {attOffers.length === 0 ? <Empty /> : attOffers.map((o) => (
                  <PickRow
                    key={o.id}
                    primary={o.offerNumber ?? '—'}
                    secondary={`${OFFER_STATUS_GR[o.status] ?? o.status}${o.total != null ? ` · ${money(o.total)}` : ''}`}
                    busy={busyKey === `offer:${o.id}:true`}
                    onAttach={() => void setFolderLink('offer', o.id, true)}
                  />
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-zinc-500">Ραντεβού</p>
                {attAppts.length === 0 ? <Empty /> : attAppts.map((a) => (
                  <PickRow
                    key={a.id}
                    primary={a.title}
                    secondary={`${APPT_TYPE_GR[a.type] ?? 'Ραντεβού'}${a.dueDate ? ` · ${formatDateGr(a.dueDate)}` : ''}`}
                    busy={busyKey === `task:${a.id}:true`}
                    onAttach={() => void setFolderLink('task', a.id, true)}
                  />
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-zinc-500">Μηνύματα</p>
                {attMsgs.length === 0 ? <Empty /> : attMsgs.map((m) => (
                  <PickRow
                    key={m.id}
                    primary={m.summary ?? '—'}
                    secondary={formatDateGr(m.createdAt)}
                    busy={busyKey === `communication:${m.id}:true`}
                    onAttach={() => void setFolderLink('communication', m.id, true)}
                  />
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-zinc-500">Στοιχεία</p>
                {attIntake.length === 0 ? <Empty /> : attIntake.map((i) => (
                  <PickRow
                    key={i.id}
                    primary={REQ_STATUS_GR[i.status] ?? i.status}
                    secondary={`Αίτημα στοιχείων · ${formatDateGr(i.createdAt)}`}
                    busy={busyKey === `intake_token:${i.id}:true`}
                    onAttach={() => void setFolderLink('intake_token', i.id, true)}
                  />
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-zinc-500">Φωτογραφίες</p>
                {attUpload.length === 0 ? <Empty /> : attUpload.map((u) => (
                  <PickRow
                    key={u.id}
                    primary={REQ_STATUS_GR[u.status] ?? u.status}
                    secondary={`Αίτημα φωτογραφιών · ${formatDateGr(u.createdAt)}`}
                    busy={busyKey === `upload_token:${u.id}:true`}
                    onAttach={() => void setFolderLink('upload_token', u.id, true)}
                  />
                ))}
              </div>
            </div>
          )}
        </Overlay>
      )}

      {/* Quick create sheet */}
      {qcMode && (
        <Overlay onClose={() => setQcMode(null)} title={qcMode === 'offer' ? 'Νέα προσφορά' : 'Νέο ραντεβού'}>
          <div className="space-y-3">
            {qcError && <p className="text-xs text-red-600">{qcError}</p>}
            {qcMode === 'offer' ? (
              <>
                <Input label="Περιγραφή" value={qcDesc} onChange={(e) => setQcDesc(e.target.value)} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
                <Input label="Ποσό (€)" value={qcAmount} inputMode="decimal" onChange={(e) => setQcAmount(e.target.value)} placeholder="0" />
              </>
            ) : (
              <>
                <Input label="Τίτλος" value={qcTitle} onChange={(e) => setQcTitle(e.target.value)} placeholder="π.χ. Επίσκεψη για μέτρηση" />
                <div className="flex gap-1.5">
                  {[{ v: 'book_appointment', l: 'Ραντεβού' }, { v: 'visit_customer', l: 'Επίσκεψη' }].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setQcType(o.v)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${qcType === o.v ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300'}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                <Input label="Ημερομηνία" type="date" value={qcDate} onChange={(e) => setQcDate(e.target.value)} />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setQcMode(null)}>Ακύρωση</Button>
              <Button size="sm" loading={qcBusy} onClick={submitQuickCreate}>Δημιουργία</Button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/70 dark:bg-[#17232f] dark:ring-white/10">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          {title}{typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
        </p>
        {action}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SmallAction({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40"
    >
      {busy ? '...' : children}
    </button>
  );
}

function Empty() {
  return <p className="px-1 text-xs text-zinc-400 dark:text-zinc-500">Δεν υπάρχει κάτι ακόμα.</p>;
}

function Row({ primary, secondary, busy, onDetach }: { primary: string; secondary: string; busy: boolean; onDetach: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-[#1e2b38]">
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">{primary}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{secondary}</p>
      </div>
      <button
        type="button"
        onClick={onDetach}
        disabled={busy}
        className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-zinc-400 transition hover:text-red-600 disabled:opacity-40"
      >
        {busy ? '...' : 'Αφαίρεση από φάκελο'}
      </button>
    </div>
  );
}

function PickRow({ primary, secondary, busy, onAttach }: { primary: string; secondary: string; busy: boolean; onAttach: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-[#1e2b38]">
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">{primary}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{secondary}</p>
      </div>
      <Button size="sm" loading={busy} onClick={onAttach}>Σύνδεση</Button>
    </div>
  );
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl dark:bg-[#17232f] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700">Κλείσιμο</button>
        </div>
        {children}
      </div>
    </div>
  );
}
