import Link from 'next/link';
import type { Task, TaskType } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import TaskStatusBadge, { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from './TaskStatusBadge';

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

function primaryAction(type: TaskType, customerId?: string, offerId?: string): { label: string; href: string } | null {
  if (type === 'call_back') return { label: 'Άνοιγμα κλήσης', href: '/call/mock' };
  if (type === 'send_offer' || type === 'follow_up_offer') {
    return { label: 'Άνοιγμα προσφοράς', href: offerId ? `/offers/${offerId}` : '/offers' };
  }
  if (
    type === 'visit_customer' ||
    type === 'ask_for_photos_documents' ||
    type === 'book_appointment' ||
    type === 'wait_for_reply'
  ) {
    return customerId ? { label: 'Άνοιγμα πελάτη', href: `/customers/${customerId}` } : null;
  }
  if (type === 'other') {
    return customerId ? { label: 'Άνοιγμα πελάτη', href: `/customers/${customerId}` } : null;
  }
  return null;
}

interface Props {
  task: Task;
  customerName?: string;
  onComplete: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
}

export default function TaskCard({ task, customerName, onComplete, onEdit, onDelete }: Props) {
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
    if (window.confirm(`Διαγραφή task "${task.title}";`)) {
      onDelete(task.id);
    }
  }

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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onComplete(task.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            <svg className="h-3 w-3" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            Ολοκλήρωση
          </button>
          {(() => {
            const action = primaryAction(task.type, task.customerId, task.offerId);
            return action ? (
              <Link
                href={action.href}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                {action.label} →
              </Link>
            ) : null;
          })()}
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Επεξεργασία
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-red-600"
          >
            Διαγραφή
          </button>
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
