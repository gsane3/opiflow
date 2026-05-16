import Link from 'next/link';
import type { Offer, Task } from '@/lib/types';
import { fmtEur } from '@/lib/offer-calculations';

interface Props {
  offers: Offer[];
  customerMap: Record<string, string>;
  tasks?: Task[];
}

function formatDate(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

export default function RecentResponsesSection({ offers, customerMap, tasks = [] }: Props) {
  const responded = offers
    .filter((o) => o.status === 'accepted' || o.status === 'rejected')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  if (responded.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Πρόσφατες απαντήσεις προσφορών
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
          {responded.length}
        </span>
      </div>

      <ul className="space-y-2">
        {responded.map((offer) => {
          const customerName = offer.customerId ? customerMap[offer.customerId] : undefined;
          const isAccepted = offer.status === 'accepted';
          // Step 139: check for existing open task linked to this offer
          const hasOpenTask = tasks.some(
            (t) =>
              t.status === 'open' &&
              (t.offerId === offer.id ||
                (offer.customerId &&
                  t.customerId === offer.customerId &&
                  offer.offerNumber &&
                  t.title.includes(offer.offerNumber)))
          );

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
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          isAccepted
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {isAccepted ? 'Αποδεκτή' : 'Απορρίφθηκε'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="font-semibold text-zinc-700">{fmtEur(offer.total)}</span>
                      <span>{formatDate(offer.updatedAt)}</span>
                    </div>
                    {/* Step 139: task-aware hint */}
                    <p className={`mt-1 text-xs font-medium ${isAccepted ? 'text-green-600' : 'text-red-500'}`}>
                      {isAccepted
                        ? hasOpenTask
                          ? 'Υπάρχει ήδη σχετικό task'
                          : 'Επόμενο βήμα: προγραμμάτισε εργασία'
                        : hasOpenTask
                        ? 'Υπάρχει ήδη follow-up task'
                        : 'Σκέψου follow-up ή νέα προσφορά'}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
