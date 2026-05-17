'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Task } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
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
    main = { label: 'Άνοιγμα κλήσης', href: '/call/mock' };
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

  // Secondary links — shown only when they add context beyond the main action.
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

export default function TaskCard({ task, customerName, onComplete, onEdit, onDelete, onSnooze }: Props) {
  const [showMore, setShowMore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const effective = getEffectiveStatus(task);

  const cardBg =
    effective === 'overdue'
      ? 'bg-red-50 ring-red-200'
      : effective === 'due_today'
      ? 'bg-amber-50 ring-amber-200'
      : 'bg-white ring-zinc-100 shadow-sm';

  const titleColor =
    effective === 'overdue'
      ? 'text-red-900'
      : effective === 'due_today'
      ? 'text-amber-900'
      : 'text-zinc-900';

  function handleDelete() {
    onDelete(task.id);
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
          </div>

          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            {customerName && <span>{customerName}</span>}
            <span>{TASK_TYPE_LABELS[task.type]}</span>
            <span>{TASK_PRIORITY_LABELS[task.priority]}</span>
            <span>{formatDueDate(task.dueDate, task.dueTime)}</span>
          </div>

          {task.note && (
            <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">{task.note}</p>
          )}
        </div>
      </div>

      {effective !== 'completed' && effective !== 'cancelled' && (
        <div className="mt-3 space-y-2">
          {/* Primary row — always visible */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onComplete(task.id)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 min-h-[36px]"
            >
              <svg className="h-3 w-3" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Ολοκλήρωση
            </button>

            {main && (
              <Link
                href={main.href}
                className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 min-h-[36px]"
              >
                {main.label}
              </Link>
            )}

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50 min-h-[36px]"
              aria-expanded={showMore}
            >
              {showMore ? 'Λιγότερα' : 'Περισσότερα'}
              <svg
                className={`h-3.5 w-3.5 transition-transform duration-150 ${showMore ? 'rotate-180' : ''}`}
                fill="none"
                strokeWidth={2}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>

          {/* Secondary row — shown when expanded */}
          {showMore && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-zinc-100">
              {confirmingDelete ? (
                <>
                  <div className="w-full space-y-0.5">
                    <p className="text-xs font-medium text-zinc-700">Να διαγραφεί αυτό το task;</p>
                    <p className="text-xs text-zinc-400">Η ενέργεια αφορά μόνο το τοπικό CRM.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 min-h-[36px]"
                  >
                    Ναι, διαγραφή
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[36px]"
                  >
                    Πίσω
                  </button>
                </>
              ) : (
                <>
                  {secondaryCustomer && (
                    <Link
                      href={secondaryCustomer.href}
                      className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[36px]"
                    >
                      {secondaryCustomer.label}
                    </Link>
                  )}

                  {secondaryOffer && (
                    <Link
                      href={secondaryOffer.href}
                      className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[36px]"
                    >
                      {secondaryOffer.label}
                    </Link>
                  )}

                  {onSnooze && (
                    <>
                      <button
                        type="button"
                        onClick={() => onSnooze(task.id, addDays(1))}
                        className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50 min-h-[36px]"
                        title="Αναβολή για αύριο"
                      >
                        Αύριο
                      </button>
                      <button
                        type="button"
                        onClick={() => onSnooze(task.id, addDays(3))}
                        className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50 min-h-[36px]"
                        title="Αναβολή για σε 3 μέρες"
                      >
                        +3 μέρες
                      </button>
                      <button
                        type="button"
                        onClick={() => onSnooze(task.id, addDays(7))}
                        className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50 min-h-[36px]"
                        title="Αναβολή για σε 1 εβδομάδα"
                      >
                        +1 εβδ.
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => onEdit(task)}
                    className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[36px]"
                  >
                    Επεξεργασία
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-red-600 min-h-[36px]"
                  >
                    Διαγραφή
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {effective === 'completed' && (
        <p className="mt-2 text-xs text-zinc-400">
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
    </div>
  );
}
