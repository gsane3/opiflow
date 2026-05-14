import type { OfferStatus } from '@/lib/types';

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Draft',
  ready_to_send: 'Έτοιμη για αποστολή',
  sent_manually: 'Στάλθηκε χειροκίνητα',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
};

const STATUS_COLORS: Record<OfferStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-500',
  ready_to_send: 'bg-amber-100 text-amber-700',
  sent_manually: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-zinc-100 text-zinc-400',
};

export default function OfferStatusBadge({ status }: { status: OfferStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {OFFER_STATUS_LABELS[status]}
    </span>
  );
}
