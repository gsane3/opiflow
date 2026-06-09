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
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link href={`/customers/${customerId}`} aria-label="Πίσω" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition active:bg-zinc-50 hover:bg-zinc-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </Link>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 ring-1 ring-indigo-200/60">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-zinc-900">{name}</p>
        {dialNumber && (
          <a href={`tel:${dialNumber}`} aria-label="Κλήση" className="flex h-10 w-10 items-center justify-center rounded-full text-indigo-600 transition active:bg-zinc-50 hover:bg-indigo-50">
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
          </a>
        )}
        <button type="button" onClick={() => openInfo(null)} aria-label="Στοιχεία" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition active:bg-zinc-50 hover:bg-zinc-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
        </button>
      </header>

      {/* Chat body (the only scroll area) */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#F5F5F7] px-3 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Spinner className="text-indigo-500" />
            <p className="text-sm text-zinc-500">Φόρτωση συνομιλίας…</p>
          </div>
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
                    mine ? 'rounded-br-md bg-indigo-600 text-white ring-indigo-600/10' : 'rounded-bl-md bg-white text-zinc-900 ring-zinc-200/70'
                  } ${tappable ? 'cursor-pointer' : ''}`}
                  onClick={() => tappable && onBubbleTap(it)}
                >
                  <p className={`flex items-center gap-1.5 font-medium ${mine ? 'text-white' : 'text-zinc-900'}`}>
                    <Icon aria-hidden className={`h-5 w-5 shrink-0 ${mine ? 'text-white' : 'text-indigo-600'}`} strokeWidth={1.7} />
                    <span>{it.title}</span>
                  </p>
                  {!isCall && it.body ? (
                    <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed ${mine ? 'text-indigo-50' : 'text-zinc-600'}`}>{it.body}</p>
                  ) : null}
                  {tappable && (
                    <p className={`mt-0.5 text-[12px] ${mine ? 'text-white/80' : 'text-indigo-600'}`}>{hint}</p>
                  )}
                  <p className={`mt-1 text-[11px] tabular-nums ${mine ? 'text-white/70' : 'text-zinc-400'}`}>{fmtTime(it.occurredAt)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* AI suggested-action chips (server-driven, heuristic fallback) */}
      {chips.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-zinc-200/60 bg-white px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {/* Composer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200/60 bg-white px-3 py-2.5">
        <button type="button" onClick={() => openComposer('menu')} aria-label="Ενέργειες" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition active:scale-95 hover:bg-indigo-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <button
          type="button"
          onClick={() => openComposer('menu')}
          className="flex-1 cursor-default select-none rounded-full bg-zinc-100 px-4 py-2.5 text-left text-sm italic text-zinc-400 transition active:scale-[0.98] hover:bg-zinc-200/70"
        >
          Σύντομα: γράψε ή μίλα στον βοηθό…
        </button>
        <button type="button" disabled title="Σύντομα" aria-label="Φωνητικός βοηθός" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-300">
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>
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
          <div className="relative w-full max-w-md rounded-[24px] bg-white p-5 shadow-2xl motion-safe:animate-[fadeIn_0.2s]">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                <IconPhone aria-hidden className="h-5 w-5 shrink-0 text-indigo-600" strokeWidth={1.7} />
                <span>{callPopup.title}</span>
              </p>
              <button type="button" onClick={() => setCallPopup(null)} aria-label="Κλείσιμο" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition active:scale-95 hover:bg-zinc-200">
                <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-zinc-400">{fmtTime(callPopup.at)}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{callPopup.body || 'Δεν βρέθηκε περίληψη κλήσης.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
