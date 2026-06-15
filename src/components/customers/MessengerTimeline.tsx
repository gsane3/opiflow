'use client';

// Messenger-style customer chat (redesign P3b). Reads the unified per-customer
// stream from GET /api/customers/[id]/timeline and renders it as chat bubbles —
// our side right, the customer left, like Facebook Messenger. Call bubbles expand
// to show the AI brief ("πατήστε για περίληψη"). This is the read view; the ➕
// composer + AI mic + interactive actions land in P3c/P3d. Self-contained and
// additive — it does not touch the existing customer card.

import { useEffect, useState, useCallback, useRef, type ComponentType, type SVGProps } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateTimeGr } from '@/lib/date';
import { Spinner } from '@/components/ui/Spinner';
import { ChatSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import CustomerInfoPanel, { type BriefEntry, type InfoSection } from './CustomerInfoPanel';
import ChatComposerSheet from './ChatComposerSheet';

const TAPPABLE = new Set(['call', 'upload', 'intake_submitted', 'intake_request', 'appointment', 'appointment_response', 'offer', 'offer_response']);

type Side = 'us' | 'customer';
interface TimelineItem {
  id: string;
  type: string;
  side: Side;
  interactive: boolean;
  title: string;
  body: string | null;
  status: string | null;
  occurredAt: string;
  refTable: string | null;
  refId: string | null;
  payload?: Record<string, unknown>;
}

interface CustomerLite {
  id: string;
  name: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  address: string | null;
  pinned?: boolean;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    return null;
  }
}

const fmtTime = formatDateTimeGr;

type IconProps = SVGProps<SVGSVGElement>;
const svg = (path: string): ComponentType<IconProps> =>
  function Icon(props: IconProps) {
    return (
      <svg fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    );
  };

// One stroke-icon family (R5) — no emoji.
const IconPhone = svg('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z');
const IconChat = svg('M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-2.288.452 3.04 3.04 0 0 0 .684-1.265 1.5 1.5 0 0 0-.443-1.456A8.156 8.156 0 0 1 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z');
const IconMail = svg('M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75');
const IconDoc = svg('M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z');
const IconCheck = svg('m4.5 12.75 6 6 9-13.5');
const IconCalendar = svg('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5');
const IconCalendarCheck = svg('M9 12.75 11.25 15 15 9.75M21 11.25v7.5A2.25 2.25 0 0 1 18.75 21H5.25A2.25 2.25 0 0 1 3 18.75v-7.5m18 0V7.5A2.25 2.25 0 0 0 18.75 5.25H5.25A2.25 2.25 0 0 0 3 7.5v3.75m18 0H3M6.75 3v2.25M17.25 3v2.25');
const IconClipboard = svg('M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z');
const IconPaperclip = svg('m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13');
const IconDot = svg('M12 12.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z');
const IconClock = svg('M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');

/** Gist ("Σύνοψη") of an AI call brief: the text between the «AI brief …:»
 *  prefix and the first «Λεπτομέρειες:» / «Επόμενα βήματα:» heading. Drives the
 *  "what the customer is waiting for" banner at the top of the chat. */
function extractBriefGist(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text.trim().replace(/^AI brief[^\n:]*:?\s*/i, '');
  const stop = t.search(/\n\s*(Λεπτομέρειες|Επόμενα βήματα)\s*:/);
  if (stop >= 0) t = t.slice(0, stop);
  t = t.split(/\n-{3,}\n/)[0].trim();
  return t.length > 0 ? t : null;
}

const TYPE_ICON: Record<string, ComponentType<IconProps>> = {
  call: IconPhone, sms: IconChat, viber: IconChat, email: IconMail,
  offer: IconDoc, offer_response: IconCheck,
  appointment: IconCalendar, appointment_response: IconCalendarCheck,
  intake_request: IconClipboard, intake_submitted: IconCheck, upload: IconPaperclip,
};

export default function MessengerTimeline({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoSection, setInfoSection] = useState<InfoSection | null>(null);
  const [infoGallery, setInfoGallery] = useState(false);
  const [callPopup, setCallPopup] = useState<{ title: string; body: string | null; at: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerView, setComposerView] = useState<'menu' | 'appointment' | 'offer'>('menu');
  // Server-driven AI suggested actions (table suggested_actions). Falls back to
  // the heuristic below when empty.
  const [serverActions, setServerActions] = useState<{ id: string; actionType: string; label: string }[]>([]);
  // Free-text message composer + snippet picker.
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<{ id: string; title: string; body: string }[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [pendingScheduled, setPendingScheduled] = useState<{ id: string; body: string; scheduledFor: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); setLoading(false); return; }
    try {
      const [cRes, tRes, aRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/customers/${customerId}/timeline`, { headers }),
        fetch(`/api/customers/${customerId}/suggested-actions`, { headers }),
      ]);
      const cJson = await cRes.json().catch(() => ({}));
      const tJson = await tRes.json().catch(() => ({}));
      const aJson = await aRes.json().catch(() => ({}));
      if (cJson?.ok && cJson.customer) setCustomer(cJson.customer as CustomerLite);
      if (tJson?.ok && Array.isArray(tJson.items)) {
        setItems(tJson.items as TimelineItem[]);
      } else if (!tJson?.ok) {
        setError('Δεν φορτώθηκε η συνομιλία.');
      }
      if (aJson?.ok && Array.isArray(aJson.actions)) {
        setServerActions((aJson.actions as Array<{ id: string; actionType: string; label: string }>).map((a) => ({ id: a.id, actionType: a.actionType, label: a.label })));
      }
    } catch {
      setError('Δεν φορτώθηκε η συνομιλία.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  // Keep the newest message in view (chat scrolls to the bottom).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  const name = customer?.name ?? 'Πελάτης';
  const dialNumber = customer?.mobilePhone || customer?.phone || customer?.landlinePhone || null;
  const callBriefs: BriefEntry[] = items
    .filter((i) => i.type === 'call' && Boolean(i.body))
    .map((i) => ({ id: i.id, title: i.title, body: i.body as string, occurredAt: i.occurredAt }));

  // "Τι περιμένει ο πελάτης": gist of the most recent call brief (items are
  // oldest→newest, so scan from the end). Tapping opens the full brief popup.
  let latestCallBrief: TimelineItem | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'call' && it.body && Boolean(it.payload?.hasBrief)) { latestCallBrief = it; break; }
  }
  const waiting = extractBriefGist(latestCallBrief?.body);

  // AI suggested-action chips. Server-driven (the suggested_actions table, written
  // by the AI review apply) when present, otherwise a heuristic from what's missing
  // in the conversation. Tapping a server chip marks it done so it doesn't return.
  type Chip = { key: string; label: string; Icon: ComponentType<IconProps>; onTap: () => void };
  const ICON_BY_VIEW: Record<'offer' | 'appointment', ComponentType<IconProps>> = { offer: IconDoc, appointment: IconCalendar };
  const VIEW_BY_ACTION: Record<string, 'offer' | 'appointment' | undefined> = { send_offer: 'offer', book_appointment: 'appointment' };

  const serverChips: Chip[] = serverActions
    .map((a) => ({ a, view: VIEW_BY_ACTION[a.actionType] }))
    .filter((x): x is { a: { id: string; actionType: string; label: string }; view: 'offer' | 'appointment' } => Boolean(x.view))
    .map(({ a, view }) => ({ key: a.id, label: a.label, Icon: ICON_BY_VIEW[view], onTap: () => actServerChip(a.id, view) }));

  const hasOffer = items.some((i) => i.type === 'offer');
  const hasAppointment = items.some((i) => i.type === 'appointment');
  const heuristicChips: Chip[] = [];
  if (!hasOffer) heuristicChips.push({ key: 'h-offer', label: 'Δημιουργία προσφοράς', Icon: IconDoc, onTap: () => openComposer('offer') });
  if (!hasAppointment) heuristicChips.push({ key: 'h-appt', label: 'Κλείσε ραντεβού', Icon: IconCalendar, onTap: () => openComposer('appointment') });

  const chips: Chip[] = (!loading && items.length > 0)
    ? (serverChips.length > 0 ? serverChips : heuristicChips)
    : [];

  function openComposer(view: 'menu' | 'appointment' | 'offer') {
    setComposerView(view);
    setComposerOpen(true);
  }

  // Fill snippet merge tokens from the customer we already have client-side.
  function fillTokens(bodyText: string): string {
    return bodyText
      .replace(/\{όνομα\}/g, customer?.name?.trim() || '')
      .replace(/\{διεύθυνση\}/g, customer?.address?.trim() || '')
      .replace(/\{ημερομηνία\}/g, '')
      .replace(/\{ώρα\}/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!;])/g, '$1')
      .trim();
  }

  async function toggleSnippets() {
    const next = !snippetsOpen;
    setSnippetsOpen(next);
    if (next && snippets === null) {
      const headers = await authHeaders();
      if (!headers) return;
      try {
        const res = await fetch('/api/snippets', { headers });
        const json = await res.json().catch(() => ({}));
        setSnippets(json?.ok && Array.isArray(json.snippets) ? json.snippets : []);
      } catch {
        setSnippets([]);
      }
    }
  }

  function pickSnippet(s: { body: string }) {
    setMessageText((prev) => (prev ? `${prev} ${fillTokens(s.body)}` : fillTokens(s.body)));
    setSnippetsOpen(false);
  }

  async function draftReply() {
    if (drafting) return;
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); return; }
    setDrafting(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/reply-draft`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(messageText.trim() ? { hint: messageText.trim() } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.draft) setMessageText(json.draft as string);
      else setError(json?.error === 'ai_not_configured' ? 'Ο AI βοηθός δεν είναι ρυθμισμένος.' : 'Δεν δημιουργήθηκε πρόταση.');
    } catch {
      setError('Δεν δημιουργήθηκε πρόταση.');
    } finally {
      setDrafting(false);
    }
  }

  async function loadPendingScheduled() {
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`/api/customers/${customerId}/scheduled-messages`, { headers });
      const json = await res.json().catch(() => ({}));
      setPendingScheduled(json?.ok && Array.isArray(json.messages) ? json.messages : []);
    } catch {
      setPendingScheduled([]);
    }
  }

  async function cancelScheduled(id: string) {
    setPendingScheduled((prev) => prev.filter((p) => p.id !== id));
    const headers = await authHeaders();
    if (!headers) return;
    try {
      await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE', headers });
    } catch {
      void loadPendingScheduled();
    }
  }

  function toggleSchedule() {
    const next = !scheduleOpen;
    setScheduleOpen(next);
    if (next) void loadPendingScheduled();
  }

  async function scheduleMessage() {
    const text = messageText.trim();
    if (!text || !scheduleAt || sending) return;
    const when = new Date(scheduleAt);
    if (isNaN(when.getTime()) || when.getTime() < Date.now()) { setError('Διάλεξε μελλοντική ώρα.'); return; }
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/scheduled-messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, scheduledFor: when.toISOString() }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) { setMessageText(''); setScheduleAt(''); void loadPendingScheduled(); }
      else setError(json?.error === 'no_phone' ? 'Ο πελάτης δεν έχει τηλέφωνο.' : 'Ο προγραμματισμός απέτυχε.');
    } catch {
      setError('Ο προγραμματισμός απέτυχε.');
    } finally {
      setSending(false);
    }
  }

  async function sendMessage() {
    const text = messageText.trim();
    if (!text || sending) return;
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); return; }

    // Optimistic: show the bubble instantly with a "sending…" state and clear the
    // input — like a real messenger. On success the reload swaps in the real row;
    // on failure we drop the bubble and put the text back so the user can retry.
    const tempId = `pending-${Date.now()}`;
    const optimistic: TimelineItem = {
      id: tempId, type: 'sms', side: 'us', interactive: false,
      title: 'Μήνυμα', body: text, status: 'sending',
      occurredAt: new Date().toISOString(), refTable: null, refId: null,
    };
    setItems((prev) => [...prev, optimistic]);
    setMessageText('');
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/message`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        void load(); // replaces the optimistic bubble with the real timeline row
      } else {
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setMessageText(text);
        setError(json?.error === 'no_phone' ? 'Ο πελάτης δεν έχει τηλέφωνο.' : 'Το μήνυμα δεν στάλθηκε.');
      }
    } catch {
      setItems((prev) => prev.filter((it) => it.id !== tempId));
      setMessageText(text);
      setError('Το μήνυμα δεν στάλθηκε.');
    } finally {
      setSending(false);
    }
  }

  async function patchAction(id: string, status: 'done' | 'dismissed') {
    const headers = await authHeaders();
    if (!headers) return;
    try {
      await fetch(`/api/customers/${customerId}/suggested-actions`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
    } catch { /* non-fatal */ }
  }

  function actServerChip(id: string, view: 'offer' | 'appointment') {
    setServerActions((prev) => prev.filter((a) => a.id !== id));
    openComposer(view);
    void patchAction(id, 'done');
  }

  function openInfo(section: InfoSection | null, gallery = false) {
    setInfoSection(section);
    setInfoGallery(gallery);
    setInfoOpen(true);
  }

  async function togglePin() {
    if (!customer) return;
    const next = !customer.pinned;
    setCustomer({ ...customer, pinned: next });
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`/api/customers/${customerId}/pin`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) setCustomer((c) => (c ? { ...c, pinned: !next } : c));
    } catch {
      setCustomer((c) => (c ? { ...c, pinned: !next } : c));
    }
  }

  // Clickable bubbles: customer actions + calls jump to the relevant view.
  function onBubbleTap(it: TimelineItem) {
    switch (it.type) {
      case 'call': setCallPopup({ title: it.title, body: it.body, at: it.occurredAt }); break;
      case 'upload': openInfo('files', true); break;
      case 'intake_submitted':
      case 'intake_request': openInfo('contact'); break;
      case 'appointment':
      case 'appointment_response': openInfo('appointments'); break;
      case 'offer':
      case 'offer_response': openInfo('offers'); break;
      default: break;
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col md:h-[100dvh]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 dark:border-white/10 bg-white/90 dark:bg-[#17232f] px-4 py-3 backdrop-blur">
        <Link href={`/customers/${customerId}`} aria-label="Πίσω" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400 transition active:bg-zinc-50 dark:active:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/5">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </Link>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 ring-1 ring-indigo-200/60">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100">{name}</p>
        {dialNumber && (
          <a href={`tel:${dialNumber}`} aria-label="Κλήση" className="flex h-10 w-10 items-center justify-center rounded-full text-indigo-600 transition active:bg-zinc-50 dark:active:bg-white/5 hover:bg-indigo-50">
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
          </a>
        )}
        <button type="button" onClick={() => void togglePin()} aria-label={customer?.pinned ? 'Ξεκαρφίτσωμα' : 'Καρφίτσωμα'} className={`flex h-10 w-10 items-center justify-center rounded-full transition active:bg-zinc-50 dark:active:bg-white/5 ${customer?.pinned ? 'text-indigo-600 hover:bg-indigo-50' : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5'}`}>
          <svg className="h-5 w-5" fill={customer?.pinned ? 'currentColor' : 'none'} strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button type="button" onClick={() => openInfo(null)} aria-label="Στοιχεία" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400 transition active:bg-zinc-50 dark:active:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/5">
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
        </button>
      </header>

      {/* What the customer is waiting for — gist of the latest AI call brief */}
      {!loading && waiting && (
        <button
          type="button"
          onClick={() => latestCallBrief && setCallPopup({ title: latestCallBrief.title, body: latestCallBrief.body, at: latestCallBrief.occurredAt })}
          className="shrink-0 border-b border-indigo-100 dark:border-white/10 bg-indigo-50/70 dark:bg-indigo-500/10 px-4 py-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            <IconClock aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.7} />
            Τι περιμένει ο πελάτης
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">{waiting}</p>
        </button>
      )}

      {/* Chat body (the only scroll area) */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#F5F5F7] dark:bg-[#0e1722] px-3 py-4">
        {loading ? (
          <ChatSkeleton />
        ) : error ? (
          <p className="py-10 text-center text-sm text-red-500">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<IconChat className="h-6 w-6" strokeWidth={1.7} />}
            title="Καμία δραστηριότητα ακόμα"
            description="Μόλις ξεκινήσει η συνομιλία, θα εμφανιστεί εδώ."
          />
        ) : (
          items.map((it) => {
            const mine = it.side === 'us';
            const Icon = TYPE_ICON[it.type] ?? IconDot;
            const isCall = it.type === 'call';
            const tappable = TAPPABLE.has(it.type);
            const hint = isCall ? 'Πατήστε για περίληψη' : it.type === 'upload' ? 'Πατήστε για άνοιγμα' : 'Πατήστε για λεπτομέρειες';
            return (
              <div key={it.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} motion-safe:animate-[sheetUp_0.2s_ease-out]`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ring-1 sm:max-w-[70%] ${
                    mine ? 'rounded-br-md bg-indigo-600 text-white ring-indigo-600/10' : 'rounded-bl-md bg-white dark:bg-[#17232f] text-zinc-900 dark:text-zinc-100 ring-zinc-200/70 dark:ring-white/10'
                  } ${tappable ? 'cursor-pointer' : ''}`}
                  onClick={() => tappable && onBubbleTap(it)}
                >
                  <p className={`flex items-center gap-1.5 font-medium ${mine ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                    <Icon aria-hidden className={`h-5 w-5 shrink-0 ${mine ? 'text-white' : 'text-indigo-600'}`} strokeWidth={1.7} />
                    <span>{it.title}</span>
                  </p>
                  {!isCall && it.body ? (
                    <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed ${mine ? 'text-indigo-50' : 'text-zinc-600 dark:text-zinc-300'}`}>{it.body}</p>
                  ) : null}
                  {tappable && (
                    <p className={`mt-0.5 text-[12px] ${mine ? 'text-white/80' : 'text-indigo-600'}`}>{hint}</p>
                  )}
                  <p className={`mt-1 text-[11px] tabular-nums ${mine ? 'text-white/70' : 'text-zinc-400 dark:text-zinc-500'}`}>{it.status === 'sending' ? 'Αποστολή…' : fmtTime(it.occurredAt)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* AI suggested-action chips (server-driven, heuristic fallback) */}
      {chips.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-zinc-200/60 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onTap}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100 transition active:scale-95 hover:bg-indigo-100"
            >
              <c.Icon aria-hidden className="h-5 w-5 text-indigo-600" strokeWidth={1.7} />
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Snippet picker (opens above the composer) */}
      {snippetsOpen && (
        <div className="shrink-0 border-t border-zinc-200/60 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2">
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Πρότυπα μηνυμάτων</p>
          {snippets === null ? (
            <div className="flex justify-center py-3"><Spinner className="text-indigo-500" /></div>
          ) : snippets.length === 0 ? (
            <p className="px-1 py-2 text-xs text-zinc-400 dark:text-zinc-500">Δεν υπάρχουν πρότυπα. Πρόσθεσέ τα από τις Ρυθμίσεις.</p>
          ) : (
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
              {snippets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSnippet(s)}
                  className="rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2 text-left transition active:scale-[0.99] hover:bg-indigo-50"
                >
                  <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{s.title}</p>
                  <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">{fillTokens(s.body)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Schedule-later panel */}
      {scheduleOpen && (
        <>
        {pendingScheduled.length > 0 && (
          <div className="shrink-0 space-y-1 border-t border-zinc-200/60 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Προγραμματισμένα ({pendingScheduled.length})</p>
            {pendingScheduled.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{fmtTime(p.scheduledFor)}</p>
                  <p className="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{p.body}</p>
                </div>
                <button type="button" onClick={() => void cancelScheduled(p.id)} aria-label="Ακύρωση" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50">
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200/60 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Αποστολή στις:</span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="flex-1 rounded-xl bg-zinc-100 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200"
          />
          <button type="button" onClick={() => void scheduleMessage()} disabled={!messageText.trim() || !scheduleAt || sending} className="rounded-full bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40">
            Προγραμμάτισε
          </button>
        </div>
        </>
      )}

      {/* Composer */}
      <div className="flex shrink-0 items-end gap-2 border-t border-zinc-200/60 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2.5">
        <button type="button" onClick={() => openComposer('menu')} aria-label="Ενέργειες" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition active:scale-95 hover:bg-indigo-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <button type="button" onClick={() => void toggleSnippets()} aria-label="Πρότυπα μηνυμάτων" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${snippetsOpen ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
        <button type="button" onClick={toggleSchedule} aria-label="Αποστολή αργότερα" title="Αποστολή αργότερα" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${scheduleOpen ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        </button>
        <button type="button" onClick={() => void draftReply()} disabled={drafting} aria-label="Πρόταση απάντησης" title="Πρόταση απάντησης" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition active:scale-95 enabled:hover:bg-indigo-100 disabled:opacity-50">
          {drafting ? <Spinner className="text-indigo-500" /> : (
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>
          )}
        </button>
        <textarea
          rows={1}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
          placeholder="Γράψε μήνυμα στον πελάτη…"
          className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl bg-zinc-100 dark:bg-[#0f1923] px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={!messageText.trim() || sending}
          aria-label="Αποστολή"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40"
        >
          {sending ? (
            <Spinner className="text-white" />
          ) : (
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
          )}
        </button>
      </div>

      <CustomerInfoPanel
        key={`${infoSection ?? 'all'}-${infoGallery}`}
        customerId={customerId}
        open={infoOpen}
        onClose={() => { setInfoOpen(false); setInfoSection(null); setInfoGallery(false); }}
        callBriefs={callBriefs}
        initialSection={infoSection}
        autoOpenGallery={infoGallery}
      />
      <ChatComposerSheet
        key={composerView}
        customerId={customerId}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onDone={() => { void load(); }}
        initialView={composerView}
      />

      {/* Call brief popup */}
      {callPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.2s]" onClick={() => setCallPopup(null)} />
          <div className="relative w-full max-w-md rounded-[24px] bg-white dark:bg-[#17232f] p-5 shadow-2xl motion-safe:animate-[fadeIn_0.2s]">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <IconPhone aria-hidden className="h-5 w-5 shrink-0 text-indigo-600" strokeWidth={1.7} />
                <span>{callPopup.title}</span>
              </p>
              <button type="button" onClick={() => setCallPopup(null)} aria-label="Κλείσιμο" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400 transition active:scale-95 hover:bg-zinc-200 dark:hover:bg-white/5">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{fmtTime(callPopup.at)}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{callPopup.body || 'Δεν βρέθηκε περίληψη κλήσης.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
