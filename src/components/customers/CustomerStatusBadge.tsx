import type { CustomerStatus } from '@/lib/types';

export const STATUS_LABELS: Record<CustomerStatus, string> = {
  new: 'Νέος',
  in_progress: 'Σε εξέλιξη',
  new_lead: 'Νέος',
  contacted: 'Μίλησα',
  follow_up_needed: 'Να ξαναμιλήσω',
  offer_drafted: 'Πρόχειρη προσφορά',
  offer_sent: 'Στάλθηκε προσφορά',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

const STATUS_COLORS: Record<CustomerStatus, string> = {
  new: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  new_lead: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  contacted: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  follow_up_needed: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  offer_drafted: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  offer_sent: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  won: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  lost: 'bg-zinc-100 text-zinc-500 dark:bg-[#1e2b38] dark:text-zinc-400',
};

export default function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
