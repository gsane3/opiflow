'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Task, Offer, CallRecord, CommunicationRecord } from '@/lib/types';
import { norm } from '@/lib/search';
import { TASK_TYPE_LABELS } from '@/components/tasks/TaskStatusBadge';
import { OFFER_STATUS_LABELS } from '@/components/offers/OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';
import {
  listCustomerFiles,
  isCustomerFileStorageSupported,
  type CustomerFileRecord,
} from '@/lib/customer-files';

const INITIAL_VISIBLE = 8;

type FilterChip = 'all' | 'calls' | 'sms' | 'tasks' | 'offers' | 'media';

const CHIP_LABELS: Record<FilterChip, string> = {
  all: 'Όλα',
  calls: 'Κλήσεις',
  sms: 'SMS',
  tasks: 'Tasks',
  offers: 'Προσφορές',
  media: 'Αρχεία',
};

const CHIP_ORDER: FilterChip[] = ['all', 'calls', 'sms', 'tasks', 'offers', 'media'];

function matchesChip(item: TimelineItem, chip: FilterChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'calls') return item.kind === 'call' || (item.kind === 'comm' && item.subKind === 'call');
  if (chip === 'sms') return item.kind === 'comm' && item.subKind === 'sms';
  if (chip === 'tasks') return item.kind === 'task';
  if (chip === 'offers') return item.kind === 'offer';
  if (chip === 'media') return item.kind === 'media';
  return false;
}

function matchesSearch(item: TimelineItem, q: string): boolean {
  if (!q) return true;
  return (
    norm(item.title).includes(q) ||
    norm(item.detail).includes(q) ||
    norm(item.summary ?? '').includes(q) ||
    norm(item.nextStep ?? '').includes(q) ||
    norm(item.dateLabel).includes(q)
  );
}

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Ανοιχτό',
  completed: 'Ολοκληρώθηκε',
  cancelled: 'Ακυρώθηκε',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'Εισερχόμενη',
  outbound: 'Εξερχόμενη',
};

const MEDIA_KIND_LABELS: Record<CustomerFileRecord['kind'], string> = {
  image: 'Φωτογραφία',
  video: 'Βίντεο',
  other: 'Αρχείο',
};

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m === 0) return `${seconds} δευτ.`;
  return `${m} λεπτ.`;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

interface TimelineItem {
  id: string;
  kind: 'call' | 'task' | 'offer' | 'media' | 'comm';
  subKind?: string; // media: 'image'|'video'|'other' — comm: 'call'|'sms'
  title: string;
  detail: string;
  dateIso: string;
  dateLabel: string;
  href?: string;
  summary?: string;
  nextStep?: string;
  isMock?: boolean;
  commStatus?: string; // for comm items: e.g. 'started' | 'sent' | 'completed' | 'failed'
}

// Local demo helper: updates a CommunicationRecord status directly in localStorage.
// The storage key matches the app's persistence layer. No auto-refresh — navigate
// away and back to see the updated status reflected in the timeline.
function updateCommStatus(commId: string, newStatus: 'completed' | 'failed') {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('yorgos_ai_mvp_state');
    if (!raw) return;
    const state = JSON.parse(raw) as { communications?: Array<{ id: string }> };
    if (!Array.isArray(state.communications)) return;
    state.communications = state.communications.map((c) =>
      c.id === commId ? { ...c, status: newStatus, updatedAt: new Date().toISOString() } : c
    );
    localStorage.setItem('yorgos_ai_mvp_state', JSON.stringify(state));
  } catch {
    // ignore parse/storage errors
  }
}

function buildItems(
  tasks: Task[],
  offers: Offer[],
  calls: CallRecord[],
  mediaFiles: CustomerFileRecord[],
  communications: CommunicationRecord[]
): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const call of calls) {
    const dateIso = call.startedAt || call.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: call.id,
      kind: 'call',
      title: call.summary ? 'Brief κλήσης' : 'Κλήση',
      detail: [
        DIRECTION_LABELS[call.direction] ?? call.direction,
        call.durationSeconds > 0 ? fmtDuration(call.durationSeconds) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      dateIso,
      dateLabel,
      summary: call.summary,
      nextStep: call.nextStep,
      isMock: call.isMock,
    });
  }

  for (const task of tasks) {
    const dateIso = task.updatedAt || task.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: task.id,
      kind: 'task',
      title: task.title,
      detail: [
        TASK_TYPE_LABELS[task.type] ?? task.type,
        TASK_STATUS_LABELS[task.status] ?? task.status,
      ].join(' · '),
      dateIso,
      dateLabel,
      href: `/tasks?taskId=${task.id}`,
    });
  }

  for (const offer of offers) {
    const dateIso = offer.updatedAt || offer.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: offer.id,
      kind: 'offer',
      title: `Προσφορά ${offer.offerNumber}`,
      detail: [
        fmtEur(offer.total),
        OFFER_STATUS_LABELS[offer.status] ?? offer.status,
      ].join(' · '),
      dateIso,
      dateLabel,
      href: `/offers/${offer.id}`,
    });
  }

  for (const file of mediaFiles) {
    const dateIso = file.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: file.id,
      kind: 'media',
      subKind: file.kind,
      title: MEDIA_KIND_LABELS[file.kind] ?? 'Αρχείο',
      detail: `${file.fileName} · ${formatBytes(file.sizeBytes)}`,
      dateIso,
      dateLabel,
      href: '#customer-files',
    });
  }

  for (const comm of communications) {
    const dateIso = comm.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: comm.id,
      kind: 'comm',
      subKind: comm.channel,
      title: comm.channel === 'sms' ? 'SMS από CRM' : 'Κλήση από CRM',
      detail: comm.phone || comm.summary || '',
      dateIso,
      dateLabel,
      commStatus: comm.status,
    });
  }

  items.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  return items;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CallIcon() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100">
      <svg className="h-4 w-4 text-indigo-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
      </svg>
    </div>
  );
}

function TaskIcon({ status }: { status: string }) {
  const done = status === 'completed' || status === 'cancelled';
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? 'bg-green-100' : 'bg-amber-100'}`}>
      <svg className={`h-4 w-4 ${done ? 'text-green-600' : 'text-amber-600'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    </div>
  );
}

function OfferIcon({ status }: { status: string }) {
  const accepted = status === 'accepted';
  const rejected = status === 'rejected';
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${accepted ? 'bg-green-100' : rejected ? 'bg-red-100' : 'bg-zinc-100'}`}>
      <svg className={`h-4 w-4 ${accepted ? 'text-green-600' : rejected ? 'text-red-600' : 'text-zinc-500'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    </div>
  );
}

function MediaIcon({ subKind }: { subKind?: string }) {
  if (subKind === 'image') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100">
        <svg className="h-4 w-4 text-rose-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      </div>
    );
  }
  if (subKind === 'video') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100">
        <svg className="h-4 w-4 text-violet-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100">
      <svg className="h-4 w-4 text-zinc-500" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    </div>
  );
}

function CommIcon({ subKind }: { subKind?: string }) {
  if (subKind === 'sms') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100">
        <svg className="h-4 w-4 text-violet-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100">
      <svg className="h-4 w-4 text-teal-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
      </svg>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  customerId: string;
  tasks: Task[];
  offers: Offer[];
  calls: CallRecord[];
  communications?: CommunicationRecord[];
}

export default function CustomerTimeline({ customerId, tasks, offers, calls, communications = [] }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<CustomerFileRecord[]>([]);
  const [activeChip, setActiveChip] = useState<FilterChip>('all');
  const [search, setSearch] = useState('');

  // Load IndexedDB media files after mount — async promise callback is OK for setState.
  useEffect(() => {
    if (!isCustomerFileStorageSupported()) return;
    listCustomerFiles(customerId)
      .then(setMediaFiles)
      .catch(() => setMediaFiles([]));
  }, [customerId]);

  const items = buildItems(tasks, offers, calls, mediaFiles, communications);

  const q = norm(search.trim());
  const filteredItems = items.filter(
    (item) => matchesChip(item, activeChip) && matchesSearch(item, q)
  );
  const visible = showAll ? filteredItems : filteredItems.slice(0, INITIAL_VISIBLE);
  const hasMore = filteredItems.length > INITIAL_VISIBLE;

  const chipCounts = Object.fromEntries(
    CHIP_ORDER.map((chip) => [chip, items.filter((i) => matchesChip(i, chip)).length])
  ) as Record<FilterChip, number>;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Ιστορικό πελάτη
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Δεν υπάρχει ακόμα ιστορικό για αυτόν τον πελάτη.
        </p>
      ) : (
        <>
          {/* Search */}
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowAll(false); }}
            placeholder="Αναζήτηση ιστορικού..."
            className="mb-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100"
          />

          {/* Filter chips */}
          <div className="mb-3 -mx-1 flex flex-wrap gap-1 overflow-x-auto px-1">
            {CHIP_ORDER.map((chip) => {
              const count = chipCounts[chip];
              if (count === 0 && chip !== 'all') return null;
              const active = activeChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setActiveChip(chip); setShowAll(false); }}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {CHIP_LABELS[chip]}
                  <span className={`text-[10px] leading-none ${active ? 'text-white/70' : 'text-zinc-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {filteredItems.length === 0 ? (
            <p className="py-2 text-sm text-zinc-400">
              Δεν βρέθηκαν εγγραφές για αυτό το φίλτρο.
            </p>
          ) : (
          <ul className="space-y-3">
            {visible.map((item) => {
              const icon =
                item.kind === 'call' ? (
                  <CallIcon />
                ) : item.kind === 'task' ? (
                  <TaskIcon status={tasks.find((t) => t.id === item.id)?.status ?? ''} />
                ) : item.kind === 'offer' ? (
                  <OfferIcon status={offers.find((o) => o.id === item.id)?.status ?? ''} />
                ) : item.kind === 'comm' ? (
                  <CommIcon subKind={item.subKind} />
                ) : (
                  <MediaIcon subKind={item.subKind} />
                );

              const isHashLink = item.href?.startsWith('#');

              const content = (
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {icon}
                  <div className="min-w-0 flex-1">
                    {item.kind === 'call' && item.summary ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-medium text-zinc-800">{item.title}</p>
                          <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
                            {item.isMock ? 'Demo κλήση' : 'Από κλήση'}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-zinc-500">{item.summary}</p>
                        {item.nextStep && (
                          <p className="truncate text-xs text-indigo-600 mt-0.5">
                            Επόμενο: {item.nextStep}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-medium text-zinc-800">{item.title}</p>
                          {item.kind === 'comm' && item.commStatus === 'completed' && (
                            <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Ολοκληρώθηκε" />
                          )}
                          {item.kind === 'comm' && item.commStatus === 'failed' && (
                            <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="Απέτυχε" />
                          )}
                        </div>
                        <p className="truncate text-xs text-zinc-500">{item.detail}</p>
                      </>
                    )}
                    {item.kind === 'comm' && !item.href && (
                      <div className="mt-1 flex gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            updateCommStatus(item.id, 'completed');
                          }}
                          className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 transition hover:bg-green-100"
                        >
                          Ολοκληρώθηκε
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            updateCommStatus(item.id, 'failed');
                          }}
                          className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 transition hover:bg-red-100"
                        >
                          Απέτυχε
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">{item.dateLabel}</span>
                </div>
              );

              return (
                <li key={item.id}>
                  {item.href ? (
                    isHashLink ? (
                      // In-page anchor — use plain <a> to avoid Next.js route navigation.
                      <a
                        href={item.href}
                        className="flex items-start rounded-xl p-2 transition hover:bg-zinc-50"
                      >
                        {content}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="flex items-start rounded-xl p-2 transition hover:bg-zinc-50"
                      >
                        {content}
                      </Link>
                    )
                  ) : (
                    <div className="flex items-start rounded-xl p-2">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          )}

          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs text-indigo-600 hover:text-indigo-700"
            >
              Προβολή όλων ({filteredItems.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}
