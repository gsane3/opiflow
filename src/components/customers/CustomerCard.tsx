import Link from 'next/link';
import type { Customer } from '@/lib/types';
import { isLikelyMobile } from '@/lib/phone';
import { buildMapsUrl } from '@/lib/maps';
import CustomerStatusBadge from './CustomerStatusBadge';

export const SOURCE_LABELS: Record<string, string> = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  website_form: 'Φόρμα website',
  referral: 'Σύσταση',
  inbound_call: 'Εισερχόμενη κλήση',
  missed_call: 'Χαμένη κλήση',
  manual_entry: 'Χειροκίνητη καταχώρηση',
  other: 'Άλλο',
};

function ChevronRight() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500 transition-colors group-hover:text-zinc-500 dark:group-hover:text-zinc-400"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

interface Props {
  customer: Customer;
}

export default function CustomerCard({ customer }: Props) {
  const mobilePhone =
    customer.mobilePhone ||
    (customer.phone && isLikelyMobile(customer.phone) ? customer.phone : null);
  const landlinePhone =
    customer.landlinePhone ||
    (customer.phone && !isLikelyMobile(customer.phone) && !customer.mobilePhone
      ? customer.phone
      : null);
  const displayPhone = mobilePhone || landlinePhone;

  return (
    <div className="relative">
      <Link
        href={`/customers/${customer.id}`}
        className="group flex min-h-[88px] items-center gap-3 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition hover:bg-zinc-50/60 dark:hover:bg-white/5 active:bg-zinc-50 dark:active:bg-white/5 active:scale-[0.99]"
      >
        <div className="min-w-0 flex-1">
          {/* Name — large & bold for readability */}
          <p className="truncate text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-100">
            {customer.name}
          </p>

          {/* Phone line — mobile preferred */}
          {displayPhone && (
            <p className="mt-0.5 truncate text-sm">
              <span className="text-zinc-400 dark:text-zinc-500">{mobilePhone ? 'Κιν.' : 'Σταθ.'}</span>{' '}
              <span className="text-zinc-700 dark:text-zinc-200 tabular-nums">{displayPhone}</span>
            </p>
          )}

          {/* Exactly one status badge */}
          <div className="mt-2">
            <CustomerStatusBadge status={customer.status} />
          </div>

          {/* Next action line */}
          {customer.nextBestAction ? (
            <p className="mt-2 line-clamp-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Επόμενο: {customer.nextBestAction}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Χωρίς εκκρεμότητα</p>
          )}
        </div>

        {/* Chevron — clear "open" affordance */}
        <ChevronRight />
      </Link>

      {/* Maps shortcut — secondary, separate from the main tap target. */}
      {customer.address && (
        <a
          href={buildMapsUrl(customer.address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Πλοήγηση στη διεύθυνση"
          className="absolute right-12 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-50 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-200/70 dark:ring-white/10 transition hover:bg-indigo-50 hover:text-indigo-600 active:bg-indigo-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <svg
            className="h-[18px] w-[18px]"
            fill="none"
            strokeWidth={1.6}
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
        </a>
      )}
    </div>
  );
}
