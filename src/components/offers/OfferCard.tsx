import { useState } from 'react';
import Link from 'next/link';
import type { Offer, OfferStatus } from '@/lib/types';
import OfferStatusBadge, { OFFER_STATUS_LABELS } from './OfferStatusBadge';
import { fmtEur } from '@/lib/offer-calculations';

// Statuses that are already resolved, no expiry warning needed.
const RESOLVED_STATUSES: OfferStatus[] = ['accepted', 'rejected', 'expired'];

type ExpiryState = 'expiring_soon' | 'expired' | null;

function getExpiryState(offer: Offer): ExpiryState {
  if (RESOLVED_STATUSES.includes(offer.status)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const validUntil = new Date(offer.validUntil + 'T00:00:00');
  const diffDays = Math.round((validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'expiring_soon';
  return null;
}

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
  onDelete?: (id: string) => void;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function handleDelete() {
    onDelete?.(offer.id);
  }

  const expiryState = getExpiryState(offer);

  return (
    <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
      {/* Customer + offer number */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-zinc-900">
            {customerName ?? 'Χωρίς πελάτη'}
          </p>
          <p className="mt-0.5 text-xs font-medium text-zinc-500">{offer.offerNumber}</p>
        </div>
        {offer.isDemo && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
            Demo
          </span>
        )}
      </div>

      {/* Total + status + expiry */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-zinc-900">{fmtEur(offer.total)}</span>
        <OfferStatusBadge status={offer.status} />
        {expiryState === 'expired' && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            Έληξε
          </span>
        )}
        {expiryState === 'expiring_soon' && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
            Λήγει σύντομα
          </span>
        )}
      </div>

      {/* Dates */}
      <p className="mt-2 text-xs text-zinc-500">
        Εκδόθηκε {formatDate(offer.offerDate)} · Ισχύει μέχρι {formatDate(offer.validUntil)}
      </p>

      {offer.status === 'sent_manually' && (
        <p className="mt-1 text-xs text-zinc-500">
          Στάλθηκε χειροκίνητα εκτός της εφαρμογής.
        </p>
      )}

      {/* Primary action */}
      <Link
        href={`/offers/${offer.id}`}
        className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
      >
        Προεπισκόπηση
      </Link>

      {/* Secondary controls: change status + delete */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`offer-status-${offer.id}`}>
          Αλλαγή κατάστασης
        </label>
        <select
          id={`offer-status-${offer.id}`}
          value={offer.status}
          onChange={(e) => onStatusChange(offer.id, e.target.value as OfferStatus)}
          className="h-12 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-indigo-400"
          aria-label="Αλλαγή κατάστασης"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OFFER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {!confirmingDelete && onDelete && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="h-12 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-red-600"
          >
            Διαγραφή
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div className="mt-3 space-y-2 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/60">
          <p className="text-sm font-semibold text-zinc-800">Να διαγραφεί αυτή η προσφορά;</p>
          <p className="text-xs text-zinc-600">Η ενέργεια αφορά μόνο το τοπικό CRM.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDelete}
              className="h-12 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Ναι, διαγραφή
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="h-12 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Πίσω
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
