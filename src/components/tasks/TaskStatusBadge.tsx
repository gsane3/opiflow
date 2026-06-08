import type { Task, TaskEffectiveStatus, TaskType, TaskPriority } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  call_back: 'Κλήση πίσω',
  send_offer: 'Αποστολή προσφοράς',
  follow_up_offer: 'Να ξαναμιλήσω για προσφορά',
  ask_for_photos_documents: 'Ζήτα φωτογραφίες/έγγραφα',
  book_appointment: 'Κλείσιμο ραντεβού',
  visit_customer: 'Επίσκεψη σε πελάτη',
  wait_for_reply: 'Αναμονή απάντησης',
  other: 'Άλλο',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Χαμηλή',
  normal: 'Κανονική',
  high: 'Υψηλή',
};

const STATUS_STYLES: Record<TaskEffectiveStatus, string> = {
  overdue: 'bg-red-100 text-red-700',
  due_today: 'bg-amber-100 text-amber-700',
  upcoming: 'bg-zinc-100 text-zinc-600',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-zinc-100 text-zinc-400',
};

const STATUS_LABELS: Record<TaskEffectiveStatus, string> = {
  overdue: 'Εκπρόθεσμο',
  due_today: 'Σήμερα',
  upcoming: 'Επερχόμενο',
  completed: 'Ολοκληρωμένο',
  cancelled: 'Ακυρωμένο',
};

export default function TaskStatusBadge({ task }: { task: Task }) {
  const status = getEffectiveStatus(task);
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
