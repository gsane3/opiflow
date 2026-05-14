import Link from 'next/link';
import type { Offer, OfferStatus } from '@/lib/types';
import OfferStatusBadge, { OFFER_STATUS_LABELS } from './OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface Props {
  offer: Offer;
  customerName?: string;
  onStatusChange: (id: string, status: OfferStatus) => void;
  onDelete: (id: string) => void;
}

const ALL_STATUSES: OfferStatus[] = [
  'draft',
  'ready_to_send',
  'sent_manually',
  'accepted',
  'rejected',
  'expired',
];

export default function OfferCard({ offer, customerName, onStatusChange, onDelete }: Props) {
  function handleDelete() {
    if (window.confirm(`Διαγραφή προσφοράς ${offer.offerNumber};`)) {
      onDelete(offer.id);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">
              {customerName ?? 'Χωρίς πελάτη'}
            </span>
            <span className="text-xs text-zinc-400">{offer.offerNumber}</span>
            {offer.isDemo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">
                demo
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-800">{fmtEur(offer.total)}</span>
            <OfferStatusBadge status={offer.status} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Εκδόθηκε {formatDate(offer.offerDate)} · Ισχύει μέχρι {formatDate(offer.validUntil)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/offers/${offer.id}`}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
        >
          Preview
        </Link>

        <select
          value={offer.status}
          onChange={(e) => onStatusChange(offer.id, e.target.value as OfferStatus)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-indigo-400"
          aria-label="Αλλαγή status"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OFFER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleDelete}
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:text-red-600 hover:bg-zinc-50"
        >
          Διαγραφή
        </button>
      </div>

      {offer.status === 'sent_manually' && (
        <p className="mt-2 text-xs text-zinc-400">
          Η προσφορά στάλθηκε χειροκίνητα εκτός της εφαρμογής.
        </p>
      )}
    </div>
  );
}
