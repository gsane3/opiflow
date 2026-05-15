'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Task, Offer, CallRecord } from '@/lib/types';
import { TASK_TYPE_LABELS } from '@/components/tasks/TaskStatusBadge';
import { OFFER_STATUS_LABELS } from '@/components/offers/OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';
import {
  listCustomerFiles,
  isCustomerFileStorageSupported,
  type CustomerFileRecord,
} from '@/lib/customer-files';

const INITIAL_VISIBLE = 8;

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
  kind: 'call' | 'task' | 'offer' | 'media';
  subKind?: string; // for media: 'image' | 'video' | 'other'
  title: string;
  detail: string;
  dateIso: string;
  dateLabel: string;
  href?: string;
}

function buildItems(
  tasks: Task[],
  offers: Offer[],
  calls: CallRecord[],
  mediaFiles: CustomerFileRecord[]
): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const call of calls) {
    const dateIso = call.startedAt || call.createdAt;
    const dateLabel = formatDate(dateIso);
    if (!dateLabel) continue;
    items.push({
      id: call.id,
      kind: 'call',
      title: 'Κλήση',
      detail: [
        DIRECTION_LABELS[call.direction] ?? call.direction,
        call.durationSeconds > 0 ? fmtDuration(call.durationSeconds) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      dateIso,
      dateLabel,
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
      href: '/tasks',
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

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  customerId: string;
  tasks: Task[];
  offers: Offer[];
  calls: CallRecord[];
}

export default function CustomerTimeline({ customerId, tasks, offers, calls }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<CustomerFileRecord[]>([]);

  // Load IndexedDB media files after mount — async promise callback is OK for setState.
  useEffect(() => {
    if (!isCustomerFileStorageSupported()) return;
    listCustomerFiles(customerId)
      .then(setMediaFiles)
      .catch(() => setMediaFiles([]));
  }, [customerId]);

  const items = buildItems(tasks, offers, calls, mediaFiles);
  const visible = showAll ? items : items.slice(0, INITIAL_VISIBLE);
  const hasMore = items.length > INITIAL_VISIBLE;

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
          <ul className="space-y-3">
            {visible.map((item) => {
              const icon =
                item.kind === 'call' ? (
                  <CallIcon />
                ) : item.kind === 'task' ? (
                  <TaskIcon status={tasks.find((t) => t.id === item.id)?.status ?? ''} />
                ) : item.kind === 'offer' ? (
                  <OfferIcon status={offers.find((o) => o.id === item.id)?.status ?? ''} />
                ) : (
                  <MediaIcon subKind={item.subKind} />
                );

              const isHashLink = item.href?.startsWith('#');

              const content = (
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {icon}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800">{item.title}</p>
                    <p className="truncate text-xs text-zinc-500">{item.detail}</p>
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

          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs text-indigo-600 hover:text-indigo-700"
            >
              Προβολή όλων ({items.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}
