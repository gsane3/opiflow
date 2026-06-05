'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Shape returned by GET /api/notifications
interface ApiNotification {
  id: string;
  kind: 'offer' | 'appointment';
  response: string;
  title: string;
  description: string;
  customerId: string | null;
  customerName: string;
  href: string;
  respondedAt: string;
  isNew: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

// Internal display shape
interface Notification {
  id: string;
  title: string;
  description: string;
  href: string;
  timeLabel: string;
  typeLabel: string;
  isNew: boolean;
  isTimeChange: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HANDLED_KEY = 'deskop_handled_notifs';

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

function formatTimeLabel(respondedAt: string): string {
  try {
    const diff = Date.now() - new Date(respondedAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 2) return 'Μόλις τώρα';
    if (minutes < 60) return `${minutes} λεπτά πριν`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return 'Σήμερα';
    if (hours < 48) return 'Χθες';
    const d = new Date(respondedAt);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  } catch {
    return '';
  }
}

function mapApiToNotification(n: ApiNotification): Notification {
  return {
    id: n.id,
    title: n.title,
    description: n.description,
    href: n.href,
    timeLabel: formatTimeLabel(n.respondedAt),
    typeLabel: n.kind === 'offer' ? 'Προσφορά' : 'Ραντεβού',
    isNew: n.isNew,
    isTimeChange:
      n.kind === 'appointment' && n.response === 'time_change_requested' && !!n.taskId,
    taskId: n.taskId,
    requestedDueDate: n.requestedDueDate,
    requestedDueTime: n.requestedDueTime,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AttentionInboxBar() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
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

  function markRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
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

  // Badge: unread, not-yet-read, not-handled.
  const unreadCount = visible.filter(
    (n) => n.isNew && !readIds.has(n.id) && !handled.has(n.id)
  ).length;

  const sorted = [...visible].sort((a, b) => {
    const aUnread = a.isNew && !readIds.has(a.id) && !handled.has(a.id) ? 0 : 1;
    const bUnread = b.isNew && !readIds.has(b.id) && !handled.has(b.id) ? 0 : 1;
    return aUnread - bUnread;
  });

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        type="button"
        title="Ειδοποιήσεις"
        aria-label="Ειδοποιήσεις"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200/60 transition hover:bg-zinc-50 active:bg-zinc-100"
      >
        <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900">Ειδοποιήσεις</p>
              {unreadCount > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                  {unreadCount} νέα
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Κλείσιμο"
              className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="px-4 pb-1 pt-2 text-xs text-zinc-500">Τα νέα που χρειάζονται προσοχή.</p>

          {/* Content area */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="px-4 pb-6 pt-2 text-center text-sm text-zinc-400">Δεν υπάρχουν νέες απαντήσεις.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto px-3 pb-3 pt-1">
              {sorted.map((n) => {
                const resolvedKind = results[n.id];

                // 1) Time-change request — inline Αποδοχή / Απόρριψη.
                if (n.isTimeChange && !resolvedKind) {
                  const busy = busyId === n.id;
                  return (
                    <li key={n.id}>
                      <div className="rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-zinc-900">{n.title}</span>
                          <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Νέο
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-600">{n.description}</p>
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
                            className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            Απόρριψη
                          </button>
                          <Link
                            href={n.href}
                            onClick={() => setOpen(false)}
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
                      <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
                        <p className="text-xs font-medium text-zinc-500">{n.title}</p>
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
                const isUnread = n.isNew && !readIds.has(n.id);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                      className={`block rounded-xl px-3 py-2.5 transition ${
                        isUnread ? 'bg-indigo-50 hover:bg-indigo-100' : 'bg-zinc-50 hover:bg-zinc-100'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-semibold ${isUnread ? 'text-zinc-900' : 'text-zinc-500'}`}>
                            {n.title}
                          </span>
                          {isUnread && (
                            <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              Νέο
                            </span>
                          )}
                        </div>
                        <p className={`text-xs ${isUnread ? 'text-zinc-600' : 'text-zinc-400'}`}>{n.description}</p>
                        <div className="flex items-center justify-between pt-0.5">
                          <span className="text-[10px] text-zinc-400">
                            {n.typeLabel} · {n.timeLabel}
                          </span>
                          <span className="text-[10px] font-medium text-indigo-600">Άνοιγμα</span>
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
