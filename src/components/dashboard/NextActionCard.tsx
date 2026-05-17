'use client';

import Link from 'next/link';
import { getEffectiveStatus } from '@/lib/types';
import type { Task, Customer, Offer, CallRecord } from '@/lib/types';

interface Props {
  urgentTasks: Task[];
  calls: CallRecord[] | undefined;
  leads: Customer[];
  openOffers: Offer[];
  customerMap: Record<string, string>;
}

interface Action {
  label: string;
  detail: string;
  href: string;
  color: 'red' | 'amber' | 'blue' | 'indigo' | 'green';
}

function computeNextAction(
  urgentTasks: Task[],
  calls: CallRecord[] | undefined,
  leads: Customer[],
  openOffers: Offer[],
  customerMap: Record<string, string>,
): Action {
  // 1. Overdue task
  const overdue = urgentTasks.find((t) => getEffectiveStatus(t) === 'overdue');
  if (overdue) {
    const who = overdue.customerId ? customerMap[overdue.customerId] : null;
    return {
      label: 'Task εκπρόθεσμο',
      detail: who ? `${overdue.title} — ${who}` : overdue.title,
      href: `/tasks/${overdue.id}`,
      color: 'red',
    };
  }

  // 2. Missed call (most recent)
  const missedCall = calls
    ?.filter((c) => c.status === 'missed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (missedCall) {
    const who = missedCall.customerId ? customerMap[missedCall.customerId] : null;
    return {
      label: 'Χαμένη κλήση',
      detail: who ? `Κάλεσε πίσω τον ${who}` : 'Χαμένη κλήση χωρίς αρχείο',
      href: '/tasks',
      color: 'amber',
    };
  }

  // 3. Follow-up customer (lead needing follow-up)
  const followUp = leads.find((c) => c.status === 'follow_up_needed');
  if (followUp) {
    return {
      label: 'Πελάτης για follow-up',
      detail: followUp.name,
      href: `/customers/${followUp.id}`,
      color: 'blue',
    };
  }

  // 4. Task due today
  const dueToday = urgentTasks.find((t) => getEffectiveStatus(t) === 'due_today');
  if (dueToday) {
    const who = dueToday.customerId ? customerMap[dueToday.customerId] : null;
    return {
      label: 'Task για σήμερα',
      detail: who ? `${dueToday.title} — ${who}` : dueToday.title,
      href: `/tasks/${dueToday.id}`,
      color: 'indigo',
    };
  }

  // 5. Open offer awaiting action
  const offer = openOffers[0];
  if (offer) {
    const who = offer.customerId ? customerMap[offer.customerId] : null;
    return {
      label: 'Ανοιχτή προσφορά',
      detail: who ? `${offer.offerNumber} — ${who}` : offer.offerNumber,
      href: `/offers/${offer.id}`,
      color: 'indigo',
    };
  }

  // 6. All clear
  return {
    label: 'Όλα εντάξει για σήμερα',
    detail: 'Δεν υπάρχουν εκκρεμότητες.',
    href: '#',
    color: 'green',
  };
}

const COLOR_MAP = {
  red: {
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    dot: 'bg-red-500',
    label: 'text-red-700',
    detail: 'text-red-600',
    chevron: 'text-red-300',
  },
  amber: {
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
    label: 'text-amber-700',
    detail: 'text-amber-600',
    chevron: 'text-amber-300',
  },
  blue: {
    bg: 'bg-blue-50',
    ring: 'ring-blue-200',
    dot: 'bg-blue-500',
    label: 'text-blue-700',
    detail: 'text-blue-600',
    chevron: 'text-blue-300',
  },
  indigo: {
    bg: 'bg-indigo-50',
    ring: 'ring-indigo-200',
    dot: 'bg-indigo-500',
    label: 'text-indigo-700',
    detail: 'text-indigo-600',
    chevron: 'text-indigo-300',
  },
  green: {
    bg: 'bg-green-50',
    ring: 'ring-green-200',
    dot: 'bg-green-500',
    label: 'text-green-700',
    detail: 'text-green-600',
    chevron: 'text-green-300',
  },
};

export default function NextActionCard({ urgentTasks, calls, leads, openOffers, customerMap }: Props) {
  const action = computeNextAction(urgentTasks, calls, leads, openOffers, customerMap);
  const c = COLOR_MAP[action.color];

  const inner = (
    <div
      className={`flex min-h-[56px] items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${c.bg} ${c.ring}`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>{action.label}</p>
        <p className={`truncate text-sm font-medium ${c.detail}`}>{action.detail}</p>
      </div>
      {action.href !== '#' && (
        <svg
          className={`h-4 w-4 shrink-0 ${c.chevron}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      )}
    </div>
  );

  if (action.href === '#') return inner;
  return <Link href={action.href}>{inner}</Link>;
}
