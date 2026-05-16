import Link from 'next/link';
import type { Offer, OfferStatus } from '@/lib/types';
import { fmtEur } from '@/lib/offer-calculations';
import OfferStatusBadge from '@/components/offers/OfferStatusBadge';

const RESOLVED_STATUSES: OfferStatus[] = ['accepted', 'rejected', 'expired'];

function getExpiryState(offer: Offer): 'expired' | 'expiring_soon' | null {
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
  });
}

interface Props {
  offers: Offer[];
  customerMap: Record<string, string>;
}

export default function OpenOffersSection({ offers, customerMap }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Ανοιχτές προσφορές
        </h2>
        {offers.length > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
            {offers.length}
          </span>
        )}
      </div>

      {offers.length === 0 ? (
        <p className="text-sm text-zinc-500">Δεν υπάρχουν ανοιχτές προσφορές.</p>
      ) : (
        <ul className="space-y-2">
          {offers.map((offer) => {
            const customerName = offer.customerId ? customerMap[offer.customerId] : undefined;
            return (
              <li key={offer.id}>
                <Link
                  href={`/offers/${offer.id}`}
                  className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 transition hover:ring-indigo-200 active:bg-zinc-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">
                          {customerName ?? 'Χωρίς πελάτη'}
                        </span>
                        <span className="text-xs text-zinc-400">{offer.offerNumber}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-zinc-700">{fmtEur(offer.total)}</span>
                        <OfferStatusBadge status={offer.status} />
                        {(() => {
                          const exp = getExpiryState(offer);
                          if (exp === 'expired')
                            return (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                                Έληξε
                              </span>
                            );
                          if (exp === 'expiring_soon')
                            return (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700">
                                Λήγει σύντομα
                              </span>
                            );
                          return null;
                        })()}
                        <span className="text-zinc-400">
                          Ισχύει έως {formatDate(offer.validUntil)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
