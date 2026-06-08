'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Customer, Task, Offer } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import { TASK_TYPE_LABELS } from '@/components/tasks/TaskStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';

const INITIAL_VISIBLE = 5;

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

type ItemCategory =
  | 'task_overdue'
  | 'task_today'
  | 'offer_ready'
  | 'offer_followup'
  | 'customer_followup';

type FilterId = 'all' | 'urgent' | 'tasks' | 'offers' | 'followups';

const FILTER_CATEGORIES: Record<FilterId, ItemCategory[]> = {
  all: ['task_overdue', 'task_today', 'offer_ready', 'offer_followup', 'customer_followup'],
  urgent: ['task_overdue'],
  tasks: ['task_overdue', 'task_today'],
  offers: ['offer_ready', 'offer_followup'],
  followups: ['customer_followup', 'offer_followup'],
};

const FILTER_EMPTY: Record<FilterId, string> = {
  all: 'Δεν υπάρχουν άμεσες προτεραιότητες.',
  urgent: 'Δεν υπάρχουν επείγουσες εργασίες.',
  tasks: 'Δεν υπάρχουν εργασίες για σήμερα.',
  offers: 'Δεν υπάρχουν προσφορές που χρειάζονται ενέργεια.',
  followups: 'Δεν υπάρχει κάτι για να ξαναμιλήσεις.',
};

interface ActionItem {
  id: string;
  category: ItemCategory;
  tone: 'red' | 'amber' | 'indigo';
  title: string;
  detail: string;
  customerName?: string;
  href: string;
  taskId?: string; // set only for task items to enable inline completion
  offerId?: string; // set only for offer items
  hasExistingTask?: boolean; // true when a follow-up task already exists in loaded tasks
  quickHref?: string; // context-aware quick action route
  quickLabel?: string; // label for the quick action button
}

const CALL_TASK_TYPES = new Set(['call_back']);
const OFFER_TASK_TYPES = new Set(['send_offer', 'follow_up_offer']);

function getTaskQuickAction(
  task: Task,
  offers: Offer[]
): { quickHref: string; quickLabel: string } | null {
  if (CALL_TASK_TYPES.has(task.type)) {
    return task.customerId
      ? { quickHref: `/customers/${task.customerId}`, quickLabel: 'Άνοιγμα πελάτη' }
      : { quickHref: '/calls', quickLabel: 'Άνοιγμα κλήσεων' };
  }
  if (OFFER_TASK_TYPES.has(task.type) && task.customerId) {
    const draft = offers.find(
      (o) => o.customerId === task.customerId && o.status === 'draft'
    );
    return {
      quickHref: draft ? `/offers/${draft.id}` : '/offers',
      quickLabel: 'Προσφορά',
    };
  }
  return null;
}

function buildActions(
  customers: Customer[],
  tasks: Task[],
  offers: Offer[]
): ActionItem[] {
  const items: ActionItem[] = [];
  const customerMap: Record<string, string> = Object.fromEntries(
    customers.map((c) => [c.id, c.name])
  );

  // Customer IDs that already have an open task (used to deduplicate follow-up fallback).
  const customerIdsWithOpenTask = new Set(
    tasks
      .filter((t) => t.status === 'open' && t.customerId)
      .map((t) => t.customerId as string)
  );

  // 1. Overdue open tasks - sorted high > normal > low priority.
  const overdueTasks = tasks
    .filter((t) => t.status === 'open' && getEffectiveStatus(t) === 'overdue')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
  for (const task of overdueTasks) {
    const quick = getTaskQuickAction(task, offers);
    items.push({
      id: task.id,
      category: 'task_overdue',
      tone: 'red',
      title: task.title,
      detail: `Εκπρόθεσμο · ${TASK_TYPE_LABELS[task.type] ?? task.type}`,
      customerName: task.customerId ? customerMap[task.customerId] : undefined,
      href: task.customerId ? `/customers/${task.customerId}` : `/tasks?taskId=${task.id}`,
      taskId: task.id,
      ...(quick ?? {}),
    });
  }

  // 2. Open tasks due today - sorted by priority.
  const todayTasks = tasks
    .filter((t) => t.status === 'open' && getEffectiveStatus(t) === 'due_today')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
  for (const task of todayTasks) {
    const quick = getTaskQuickAction(task, offers);
    items.push({
      id: task.id,
      category: 'task_today',
      tone: 'amber',
      title: task.title,
      detail: `Σήμερα · ${TASK_TYPE_LABELS[task.type] ?? task.type}`,
      customerName: task.customerId ? customerMap[task.customerId] : undefined,
      href: task.customerId ? `/customers/${task.customerId}` : `/tasks?taskId=${task.id}`,
      taskId: task.id,
      ...(quick ?? {}),
    });
  }

  // 3. Offers ready to send - newest first.
  const readyOffers = offers
    .filter((o) => o.status === 'ready_to_send')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const offer of readyOffers) {
    items.push({
      id: offer.id,
      category: 'offer_ready',
      tone: 'indigo',
      title: `Προσφορά ${offer.offerNumber}, έτοιμη για αποστολή`,
      detail: fmtEur(offer.total),
      customerName: offer.customerId ? customerMap[offer.customerId] : undefined,
      href: `/offers/${offer.id}`,
      offerId: offer.id,
    });
  }

  // 4. Sent offers - suggest follow-up, newest first.
  const sentOffers = offers
    .filter((o) => o.status === 'sent_manually')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const offer of sentOffers) {
    // Detect existing open follow-up task for this offer (persistent dedup + task-first navigation).
    const existingFollowUpTask = tasks.find(
      (t) =>
        t.type === 'follow_up_offer' &&
        t.status === 'open' &&
        t.customerId === offer.customerId &&
        (t.offerId === offer.id || t.title === `Follow-up προσφοράς ${offer.offerNumber}`)
    );
    items.push({
      id: `follow-${offer.id}`,
      category: 'offer_followup',
      tone: 'indigo',
      title: `Follow-up προσφοράς ${offer.offerNumber}`,
      detail: fmtEur(offer.total),
      customerName: offer.customerId ? customerMap[offer.customerId] : undefined,
      // If a follow-up task exists, navigate to the task; otherwise navigate to the offer.
      href: existingFollowUpTask
        ? `/tasks?taskId=${existingFollowUpTask.id}`
        : `/offers/${offer.id}`,
      offerId: offer.id,
      hasExistingTask: !!existingFollowUpTask,
    });
  }

  // 5. Customers with follow_up_needed but no open task - newest first.
  const followUpCustomers = customers
    .filter((c) => c.status === 'follow_up_needed' && !customerIdsWithOpenTask.has(c.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const c of followUpCustomers) {
    items.push({
      id: `cu-${c.id}`,
      category: 'customer_followup',
      tone: 'amber',
      title: 'Χρειάζεται follow-up',
      detail: '',
      customerName: c.name,
      href: `/customers/${c.id}`,
    });
  }

  return items;
}

const TONE_ROW: Record<ActionItem['tone'], string> = {
  red: 'bg-red-50 ring-red-200',
  amber: 'bg-amber-50 ring-amber-200',
  indigo: 'bg-indigo-50 ring-indigo-200',
};

const TONE_DOT: Record<ActionItem['tone'], string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
};

interface Props {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
  onCompleteTask?: (taskId: string) => void;
  lastCompletedTaskTitle?: string;
  onUndoCompleteTask?: () => void;
  onMarkOfferSent?: (offerId: string) => void;
  onCreateOfferFollowUpTask?: (offerId: string) => void;
  /** When true: hides filter chips, limits to 3 items, shows Δες όλα link. */
  compact?: boolean;
}

const FILTER_DEFS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Όλα' },
  { id: 'urgent', label: 'Επείγοντα' },
  { id: 'tasks', label: 'Εργασίες' },
  { id: 'offers', label: 'Προσφορές' },
  { id: 'followups', label: 'Να ξαναμιλήσω' },
];

export default function NextActionsSection({
  customers,
  tasks,
  offers,
  onCompleteTask,
  lastCompletedTaskTitle,
  onUndoCompleteTask,
  onMarkOfferSent,
  onCreateOfferFollowUpTask,
  compact = false,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [showAll, setShowAll] = useState(false);
  // Track follow-up tasks created in this session to prevent duplicate creation.
  const [createdFollowUpOfferIds, setCreatedFollowUpOfferIds] = useState<Set<string>>(new Set());

  const allItems = buildActions(customers, tasks, offers);

  function filterItems(filter: FilterId): ActionItem[] {
    const allowed = new Set<ItemCategory>(FILTER_CATEGORIES[filter]);
    return allItems.filter((item) => allowed.has(item.category));
  }

  const filteredItems = filterItems(activeFilter);
  const visible = compact
    ? allItems.slice(0, 3)
    : showAll
    ? filteredItems
    : filteredItems.slice(0, INITIAL_VISIBLE);
  const extra = filteredItems.length - INITIAL_VISIBLE;

  function handleFilterChange(f: FilterId) {
    setActiveFilter(f);
    setShowAll(false);
  }

  return (
    <section className={compact ? 'overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60' : 'space-y-3'}>
      {/* Section header */}
      <div
        className={
          compact
            ? 'flex items-center justify-between border-b border-zinc-100 px-4 pb-3 pt-4'
            : 'flex items-center gap-2'
        }
      >
        <h2
          className={
            compact
              ? 'text-sm font-semibold text-zinc-900'
              : 'text-xs font-semibold uppercase tracking-wide text-zinc-500'
          }
        >
          {compact ? 'Επόμενες προτεραιότητες' : 'Προτεραιότητες σήμερα'}
        </h2>
        {compact ? (
          <Link href="/tasks" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Δες όλα
          </Link>
        ) : (
          allItems.length > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                allItems.some((i) => i.category === 'task_overdue')
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {allItems.length}
            </span>
          )
        )}
      </div>

      {/* Filter chips - hidden in compact mode */}
      {!compact && (
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
          {FILTER_DEFS.map((f) => {
            const count = filterItems(f.id).length;
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => handleFilterChange(f.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      active
                        ? 'bg-white/20 text-white'
                        : f.id === 'urgent'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-zinc-200 text-zinc-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Undo banner - shown after completing a task */}
      {lastCompletedTaskTitle && onUndoCompleteTask && (
        <div className={`flex items-center justify-between gap-3 rounded-xl bg-green-50 px-3 py-2 ring-1 ring-green-200${compact ? ' mx-4 my-2' : ''}`}>
          <div className="min-w-0">
            <p className="text-xs font-medium text-green-800">Η εργασία ολοκληρώθηκε.</p>
            <p className="truncate text-xs text-green-700">{lastCompletedTaskTitle}</p>
          </div>
          <button
            type="button"
            onClick={onUndoCompleteTask}
            className="shrink-0 rounded-lg border border-green-300 bg-white px-2.5 py-1 text-xs font-semibold text-green-700 transition hover:bg-green-50"
          >
            Αναίρεση
          </button>
        </div>
      )}

      {/* Items */}
      {(compact ? allItems : filteredItems).length === 0 ? (
        <p className={`text-sm text-zinc-500${compact ? ' px-4 py-4' : ''}`}>
          {compact ? 'Δεν υπάρχουν άμεσες εκκρεμότητες.' : FILTER_EMPTY[activeFilter]}
        </p>
      ) : (
        <>
          <ul className={compact ? 'divide-y divide-zinc-100' : 'space-y-2'}>
            {visible.map((item) => (
              <li key={item.id}>
                {compact ? (
                  /* Compact mode: clean row inside the white card */
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-zinc-50/60"
                  >
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[item.tone]}`}
                    />
                    <div className="min-w-0 flex-1">
                      {item.customerName && (
                        <p className="truncate text-xs text-zinc-500">{item.customerName}</p>
                      )}
                      <p className="truncate text-sm font-medium text-zinc-800">{item.title}</p>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-zinc-300"
                      fill="none"
                      strokeWidth={2}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </Link>
                ) : (
                  /* Full mode: original tone-colored card rows */
                  <div className={`rounded-2xl ring-1 ${TONE_ROW[item.tone]}`}>
                    <div className="flex items-start">
                      <Link
                        href={item.href}
                        className="flex min-w-0 flex-1 items-start gap-2.5 p-3"
                      >
                        <span
                          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[item.tone]}`}
                        />
                        <div className="min-w-0 flex-1">
                          {item.customerName && (
                            <p className="truncate text-xs font-medium text-zinc-500">
                              {item.customerName}
                            </p>
                          )}
                          <p className="truncate text-sm font-semibold text-zinc-800">
                            {item.title}
                          </p>
                          {item.detail && (
                            <p className="text-xs text-zinc-500">{item.detail}</p>
                          )}
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col items-end gap-1 py-3 pr-3">
                        {item.taskId && onCompleteTask && (
                          <button
                            type="button"
                            onClick={() => onCompleteTask(item.taskId!)}
                            className="rounded-lg bg-green-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-green-700"
                          >
                            Ολοκλήρωση
                          </button>
                        )}
                        {item.quickHref && item.quickLabel && (
                          <Link
                            href={item.quickHref}
                            className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-indigo-700"
                          >
                            {item.quickLabel}
                          </Link>
                        )}
                        {item.category === 'offer_ready' && item.offerId && onMarkOfferSent && (
                          <button
                            type="button"
                            onClick={() => onMarkOfferSent(item.offerId!)}
                            className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-indigo-700"
                          >
                            Στάλθηκε
                          </button>
                        )}
                        {item.category === 'offer_followup' && item.offerId && (
                          !item.customerName ? (
                            <span className="text-[10px] text-zinc-300">Χωρίς πελάτη</span>
                          ) : item.hasExistingTask || createdFollowUpOfferIds.has(item.offerId) ? (
                            <span className="text-[10px] font-medium text-zinc-500">Υπάρχει εργασία</span>
                          ) : onCreateOfferFollowUpTask ? (
                            <button
                              type="button"
                              onClick={() => {
                                onCreateOfferFollowUpTask(item.offerId!);
                                setCreatedFollowUpOfferIds((prev) => new Set(prev).add(item.offerId!));
                              }}
                              className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-50"
                            >
                              Να ξαναμιλήσω
                            </button>
                          ) : null
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!compact && !showAll && extra > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-xs text-indigo-600 hover:text-indigo-700"
            >
              +{extra} ακόμα
            </button>
          )}
        </>
      )}
    </section>
  );
}
