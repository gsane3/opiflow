'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Task } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import { BottomSheet, SheetRow } from '@/components/ui';
import TaskStatusBadge, { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from './TaskStatusBadge';

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDueDate(dateStr: string, timeStr?: string): string {
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let label: string;
  if (dateStr === todayStr) label = 'Σήμερα';
  else if (dateStr === tomorrowStr) label = 'Αύριο';
  else if (dateStr === yesterdayStr) label = 'Χθες';
  else {
    label = new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
    });
  }
  return timeStr ? `${label} ${timeStr}` : label;
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  normal: 'bg-zinc-400',
  low: 'bg-zinc-300',
};

interface ActionLink { label: string; href: string }

interface TaskActions {
  main: ActionLink | null;
  secondaryCustomer: ActionLink | null;
  secondaryOffer: ActionLink | null;
}

// Build context-aware action links for a task without loading full offer/customer objects.
// Deduplication: secondary links only appear when they differ from the main action target.
function buildActions(task: Task): TaskActions {
  const { type, customerId, offerId } = task;

  let main: ActionLink | null = null;
  let mainOpensCustomer = false;
  let mainOpensOffer = false;

  if (type === 'call_back') {
    main = customerId
      ? { label: 'Άνοιγμα πελάτη', href: `/customers/${customerId}` }
      : { label: 'Άνοιγμα κλήσεων', href: '/calls' };
    mainOpensCustomer = !!customerId;
  } else if (type === 'send_offer' || type === 'follow_up_offer') {
    main = offerId
      ? { label: 'Άνοιγμα προσφοράς', href: `/offers/${offerId}` }
      : { label: 'Άνοιγμα προσφορών', href: '/offers' };
    mainOpensOffer = true;
  } else if (
    type === 'visit_customer' ||
    type === 'ask_for_photos_documents' ||
    type === 'book_appointment' ||
    type === 'wait_for_reply' ||
    type === 'other'
  ) {
    if (customerId) {
      main = { label: 'Άνοιγμα πελάτη', href: `/customers/${customerId}` };
      mainOpensCustomer = true;
    }
  }

  // Secondary links. shown only when they add context beyond the main action.
  const secondaryCustomer: ActionLink | null =
    !mainOpensCustomer && customerId
      ? { label: 'Άνοιγμα πελάτη', href: `/customers/${customerId}` }
      : null;

  const secondaryOffer: ActionLink | null =
    !mainOpensOffer && offerId
      ? { label: 'Άνοιγμα προσφοράς', href: `/offers/${offerId}` }
      : null;

  return { main, secondaryCustomer, secondaryOffer };
}

interface Props {
  task: Task;
  customerName?: string;
  onComplete: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onSnooze?: (id: string, newDueDate: string) => void;
}

// Small inline icons for the "Περισσότερα" sheet rows.
function ClockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg className="h-4 w-4" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

export default function TaskCard({ task, customerName, onComplete, onEdit, onDelete, onSnooze }: Props) {
  const router = useRouter();
  const [showMore, setShowMore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const effective = getEffectiveStatus(task);

  const cardBg =
    effective === 'overdue'
      ? 'bg-red-50 ring-red-200'
      : effective === 'due_today'
      ? 'bg-amber-50 ring-amber-200'
      : 'bg-white dark:bg-[#17232f] ring-zinc-100 dark:ring-white/10 shadow-sm';

  const titleColor =
    effective === 'overdue'
      ? 'text-red-900'
      : effective === 'due_today'
      ? 'text-amber-900'
      : 'text-zinc-900 dark:text-zinc-100';

  function closeSheet() {
    setShowMore(false);
    setConfirmingDelete(false);
  }

  function handleDelete() {
    onDelete(task.id);
    closeSheet();
  }

  const { main, secondaryCustomer, secondaryOffer } = buildActions(task);

  return (
    <div className={`rounded-2xl p-4 ring-1 ${cardBg}`}>
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <p className={`text-sm font-semibold ${titleColor}`}>{task.title}</p>
            <TaskStatusBadge task={task} />
            {(task.status as string) === 'ai_draft' && (
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                Πρόταση Βοηθού
              </span>
            )}
          </div>

          {/* What / for whom / when */}
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {customerName && <span className="font-medium text-zinc-700 dark:text-zinc-200">{customerName}</span>}
            <span>{TASK_TYPE_LABELS[task.type]}</span>
            <span>{TASK_PRIORITY_LABELS[task.priority]}</span>
            <span className="font-medium">{formatDueDate(task.dueDate, task.dueTime)}</span>
          </div>

          {task.note && (
            <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{task.note}</p>
          )}
        </div>
      </div>

      {effective !== 'completed' && effective !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Primary CTA: the most relevant context action when one exists. */}
          {main && (
            <Link
              href={main.href}
              className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
            >
              {main.label}
            </Link>
          )}

          {/* Complete: primary when there is no context link, otherwise a strong secondary. */}
          <button
            type="button"
            onClick={() => onComplete(task.id)}
            className={
              main
                ? 'inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-semibold text-green-700 transition hover:bg-green-100'
                : 'inline-flex min-h-[48px] items-center gap-1.5 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700'
            }
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            Ολοκλήρωση
          </button>

          {/* More: snooze / edit / delete in a bottom sheet. */}
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="ml-auto inline-flex min-h-[48px] items-center gap-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            aria-haspopup="dialog"
          >
            Περισσότερα
          </button>
        </div>
      )}

      {effective === 'completed' && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Ολοκληρώθηκε
          {task.completedAt
            ? ' ' +
              new Date(task.completedAt).toLocaleDateString('el-GR', {
                day: 'numeric',
                month: 'short',
              })
            : ''}
        </p>
      )}

      {/* "Περισσότερα" sheet: extra context links, snooze, edit, delete. */}
      <BottomSheet
        open={showMore}
        onClose={closeSheet}
        title={task.title}
        description={confirmingDelete ? undefined : 'Επίλεξε τι θέλεις να κάνεις'}
      >
        {confirmingDelete ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">Να διαγραφεί αυτή η εργασία;</p>
              <p className="mt-0.5 text-xs text-red-600">Η εργασία θα ακυρωθεί και θα φύγει από τη λίστα.</p>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Ναι, διαγραφή
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Πίσω
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {secondaryCustomer && (
              <SheetRow
                label={secondaryCustomer.label}
                onClick={() => { closeSheet(); router.push(secondaryCustomer.href); }}
              />
            )}

            {secondaryOffer && (
              <SheetRow
                label={secondaryOffer.label}
                onClick={() => { closeSheet(); router.push(secondaryOffer.href); }}
              />
            )}

            {onSnooze && (
              <>
                <SheetRow
                  icon={<ClockIcon />}
                  label="Αναβολή για αύριο"
                  onClick={() => { onSnooze(task.id, addDays(1)); closeSheet(); }}
                />
                <SheetRow
                  icon={<ClockIcon />}
                  label="Αναβολή +3 μέρες"
                  onClick={() => { onSnooze(task.id, addDays(3)); closeSheet(); }}
                />
                <SheetRow
                  icon={<ClockIcon />}
                  label="Αναβολή +1 εβδομάδα"
                  onClick={() => { onSnooze(task.id, addDays(7)); closeSheet(); }}
                />
              </>
            )}

            <SheetRow
              icon={<PencilIcon />}
              label="Επεξεργασία"
              onClick={() => { closeSheet(); onEdit(task); }}
            />
            <SheetRow
              icon={<TrashIcon />}
              label="Διαγραφή"
              tone="danger"
              onClick={() => setConfirmingDelete(true)}
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
