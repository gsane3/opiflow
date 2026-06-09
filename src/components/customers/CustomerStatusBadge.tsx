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
  new: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-amber-100 text-amber-700',
  new_lead: 'bg-indigo-100 text-indigo-700',
  contacted: 'bg-sky-100 text-sky-700',
  follow_up_needed: 'bg-amber-100 text-amber-700',
  offer_drafted: 'bg-purple-100 text-purple-700',
  offer_sent: 'bg-blue-100 text-blue-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-zinc-100 text-zinc-500',
};

export default function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
