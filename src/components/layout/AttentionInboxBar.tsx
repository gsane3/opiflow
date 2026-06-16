'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationKind = 'offer' | 'appointment' | 'intake' | 'upload' | 'call' | 'sms' | 'message';

// Shape returned by GET /api/notifications
interface ApiNotification {
  id: string;
  kind: NotificationKind;
  response: string;
  title: string;
  description: string;
  customerId: string | null;
  customerName: string;
  href: string;
  // Canonical event timestamp; respondedAt mirrors it for backward compatibility.
  eventAt?: string;
  respondedAt: string;
  isNew: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

// Internal display shape
interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  href: string;
  // ISO timestamp of the underlying event (used for the persistent seen logic).
  eventAt: string;
  timeLabel: string;
  typeLabel: string;
  isTimeChange: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

// ---------------------------------------------------------------------------
// Persistent "last seen" + resolved-handling helpers
// ---------------------------------------------------------------------------

// Persisted ISO timestamp of the last time the operator opened the bell. Any
// notification whose event time is newer than this is considered unseen.
const LAST_SEEN_KEY = 'opiflow_notifs_last_seen_at';
// Time-change requests the operator has resolved (kept so they don't reappear).
const HANDLED_KEY = 'deskop_handled_notifs';

function loadLastSeen(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(LAST_SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistLastSeen(iso: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    // ignore storage errors
  }
}

function loadHandled(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(HANDLED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistHandled(s: Set<string>) {
  try {
    localStorage.setItem(HANDLED_KEY, JSON.stringify([...s]));
  } catch {
    // ignore storage errors
  }
}

// A notification counts as "newer than seen" when its event time is strictly
// after the given seen timestamp. An empty seen value means everything is new.
function isAfter(eventAt: string, seenIso: string): boolean {
  if (!eventAt) return false;
  if (!seenIso) return true;
  return eventAt > seenIso;
}

function formatTimeLabel(eventAt: string): string {
  try {
    const diff = Date.now() - new Date(eventAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 2) return 'Μόλις τώρα';
    if (minutes < 60) return `${minutes} λεπτά πριν`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return 'Σήμερα';
    if (hours < 48) return 'Χθες';
    const d = new Date(eventAt);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  } catch {
    return '';
  }
}

const TYPE_LABELS: Record<NotificationKind, string> = {
  offer: 'Προσφορά',
  appointment: 'Ραντεβού',
  intake: 'Στοιχεία',
  upload: 'Αρχεία',
  call: 'Κλήση',
  sms: 'SMS',
  message: 'Μήνυμα',
};

function mapApiToNotification(n: ApiNotification): Notification {
  const eventAt = n.eventAt ?? n.respondedAt;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    description: n.description,
    href: n.href,
    eventAt,
    timeLabel: formatTimeLabel(eventAt),
    typeLabel: TYPE_LABELS[n.kind] ?? 'Ειδοποίηση',
    isTimeChange:
      n.kind === 'appointment' && n.response === 'time_change_requested' && !!n.taskId,
    taskId: n.taskId,
    requestedDueDate: n.requestedDueDate,
    requestedDueTime: n.requestedDueTime,
  };
}

// Inline icon per kind (kept tiny + monochrome so it inherits text colour).
function KindIcon({ kind, className }: { kind: NotificationKind; className?: string }) {
  const cls = className ?? 'h-4 w-4';
  switch (kind) {
    case 'call':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
        </svg>
      );
    case 'sms':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.671 1.09-.085 2.17-.207 3.238-.364 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      );
    case 'upload':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
      );
    case 'intake':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
        </svg>
      );
    case 'offer':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
        </svg>
      );
    case 'message':
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      );
    case 'appointment':
    default:
      return (
        <svg className={cls} fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AttentionInboxBar() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Persistent "last seen" timestamp (badge count is driven off this).
  const [lastSeenAt, setLastSeenAt] = useState<string>(() => loadLastSeen());
  // Snapshot of lastSeen captured the moment the panel was opened. Drives the
  // per-item highlight WHILE the panel is open, so the operator still sees what
  // is new even though lastSeenAt was just advanced to "now".
  const [sessionSeenAt, setSessionSeenAt] = useState<string>('');

  // Time-change requests the operator has resolved (persisted per-device so they
  // don't reappear after a reload).
  const [handled, setHandled] = useState<Set<string>>(() => loadHandled());
  const [results, setResults] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotifications() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session || cancelled) {
          setLoading(false);
          return;
        }

        const res = await fetch('/api/notifications', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (cancelled) return;
        if (!res.ok) {
          setLoading(false);
          return;
        }

        const json = (await res.json()) as {
          ok?: boolean;
          notifications?: ApiNotification[];
        };

        if (cancelled) return;
        if (json.ok && Array.isArray(json.notifications)) {
          setNotifications(json.notifications.map(mapApiToNotification));
        }
      } catch {
        // Network error: show empty state, do not crash.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  // Toggle the dropdown. On OPEN, snapshot the current persisted lastSeen into
  // sessionSeenAt (so items still highlight while open) and then advance the
  // persisted lastSeenAt to now (so the badge clears and stays cleared across
  // reloads).
  function toggleOpen() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) {
        setSessionSeenAt(lastSeenAt);
        const now = new Date().toISOString();
        persistLastSeen(now);
        setLastSeenAt(now);
      }
      return next;
    });
  }

  function closePanel() {
    setOpen(false);
  }

  async function getToken(): Promise<string | null> {
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  function resolveLocally(id: string, kind: 'accepted' | 'rejected') {
    setResults((prev) => ({ ...prev, [id]: kind }));
    setHandled((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistHandled(next);
      return next;
    });
  }

  async function acceptTimeChange(n: Notification) {
    if (!n.taskId || !n.requestedDueDate || !n.requestedDueTime) return;
    const token = await getToken();
    if (!token) {
      setErrorId(n.id);
      return;
    }
    setBusyId(n.id);
    setErrorId(null);
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      // 1) Reschedule the appointment to the requested date/time.
      const r1 = await fetch(`/api/tasks/${n.taskId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ dueDate: n.requestedDueDate, dueTime: n.requestedDueTime }),
      });
      if (!r1.ok) {
        setErrorId(n.id);
        setBusyId(null);
        return;
      }
      // 2) Notify the customer (best-effort; never blocks the resolution).
      await fetch('/api/appointment-notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: n.taskId, kind: 'time_change_approved', mode: 'send' }),
      }).catch(() => {});
      resolveLocally(n.id, 'accepted');
    } catch {
      setErrorId(n.id);
    } finally {
      setBusyId(null);
    }
  }

  async function rejectTimeChange(n: Notification) {
    if (!n.taskId) return;
    const token = await getToken();
    if (!token) {
      setErrorId(n.id);
      return;
    }
    setBusyId(n.id);
    setErrorId(null);
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      // The original time stands; just notify the customer (best-effort).
      await fetch('/api/appointment-notifications', {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: n.taskId, kind: 'time_change_rejected', mode: 'send' }),
      }).catch(() => {});
      resolveLocally(n.id, 'rejected');
    } catch {
      setErrorId(n.id);
    } finally {
      setBusyId(null);
    }
  }

  // Hide time-change requests resolved in a PREVIOUS session (handled but no
  // in-session result); keep everything else.
  const visible = notifications.filter(
    (n) => !(n.isTimeChange && handled.has(n.id) && !results[n.id])
  );

  // Badge: notifications whose event time is newer than the persisted lastSeenAt
  // (and not already resolved). Time-change items the operator handled no longer
  // count.
  const unreadCount = visible.filter(
    (n) => isAfter(n.eventAt, lastSeenAt) && !handled.has(n.id)
  ).length;

  // Per-item highlight uses the in-session snapshot so items stay highlighted
  // while the panel is open, but are no longer highlighted after close + reopen.
  const isUnseen = (n: Notification) => isAfter(n.eventAt, sessionSeenAt) && !handled.has(n.id);

  const sorted = [...visible].sort((a, b) => {
    const aUnread = isUnseen(a) ? 0 : 1;
    const bUnread = isUnseen(b) ? 0 : 1;
    if (aUnread !== bUnread) return aUnread - bUnread;
    return b.eventAt.localeCompare(a.eventAt);
  });

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        type="button"
        title="Ειδοποιήσεις"
        aria-label="Ειδοποιήσεις"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/5 ${
          open ? 'bg-zinc-100 dark:bg-[#1e2b38]' : 'bg-white dark:bg-[#17232f]'
        }`}
      >
        <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-[#17232f] tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-2xl bg-white dark:bg-[#17232f] shadow-xl ring-1 ring-zinc-200/60 dark:ring-white/10 motion-safe:animate-[fadeIn_0.16s]">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-zinc-200/60 dark:border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ειδοποιήσεις</p>
              {unreadCount > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                  {unreadCount} νέα
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Κλείσιμο"
              className="rounded-lg p-1 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="px-4 pb-1 pt-2 text-xs text-zinc-500 dark:text-zinc-400">Τα νέα που χρειάζονται προσοχή.</p>

          {/* Content area */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 dark:border-white/10 border-t-indigo-500" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="px-4 pb-6 pt-2 text-center text-sm text-zinc-400 dark:text-zinc-500">Δεν υπάρχουν νέες ειδοποιήσεις.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto px-3 pb-3 pt-1">
              {sorted.map((n) => {
                const resolvedKind = results[n.id];

                // 1) Time-change request — inline Αποδοχή / Απόρριψη.
                if (n.isTimeChange && !resolvedKind) {
                  const busy = busyId === n.id;
                  return (
                    <li key={n.id}>
                      <div className="rounded-xl bg-amber-50 dark:bg-amber-500/15 px-3 py-2.5 ring-1 ring-amber-200 dark:ring-amber-500/20">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{n.title}</span>
                          <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Νέο
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{n.description}</p>
                        {errorId === n.id && (
                          <p className="mt-1 text-[11px] text-red-600">Κάτι πήγε στραβά. Δοκίμασε ξανά.</p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => acceptTimeChange(n)}
                            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                          >
                            {busy ? '…' : 'Αποδοχή'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rejectTimeChange(n)}
                            className="flex-1 rounded-lg bg-white dark:bg-[#17232f] px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            Απόρριψη
                          </button>
                          <Link
                            href={n.href}
                            onClick={closePanel}
                            className="shrink-0 px-1 py-2 text-[11px] font-medium text-indigo-600 hover:underline"
                          >
                            Άνοιγμα
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                }

                // 2) Just-resolved time-change — confirmation.
                if (n.isTimeChange && resolvedKind) {
                  return (
                    <li key={n.id}>
                      <div className="rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5">
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{n.title}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-green-700">
                          {resolvedKind === 'rejected'
                            ? '✓ Απορρίφθηκε — ειδοποιήθηκε ο πελάτης'
                            : '✓ Έγινε αποδοχή — ειδοποιήθηκε ο πελάτης'}
                        </p>
                      </div>
                    </li>
                  );
                }

                // 3) Default — a link notification.
                const unseen = isUnseen(n);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={closePanel}
                      className={`block rounded-xl px-3 py-2.5 transition ${
                        unseen ? 'bg-indigo-50 hover:bg-indigo-100' : 'bg-zinc-50 dark:bg-[#1e2b38] hover:bg-zinc-100 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            unseen ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-400 dark:text-zinc-500'
                          }`}
                        >
                          <KindIcon kind={n.kind} />
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-semibold ${unseen ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
                              {n.title}
                            </span>
                            {unseen && (
                              <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                Νέο
                              </span>
                            )}
                          </div>
                          <p className={`text-xs ${unseen ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-500'}`}>{n.description}</p>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                              {n.typeLabel} · {n.timeLabel}
                            </span>
                            <span className="text-[10px] font-medium text-indigo-600">Άνοιγμα</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
