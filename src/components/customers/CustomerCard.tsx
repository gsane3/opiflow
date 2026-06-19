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

interface Props {
  customer: Customer;
}

// B6 — clean, scannable customer card: brand avatar, name + status, phone meta,
// and a highlighted next-best-action. The whole card opens the profile; the Maps
// shortcut is a separate tap target (a nested <a> inside the Link would be invalid
// HTML, so it sits as an absolutely-positioned sibling).
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
  const initial = customer.name.trim().charAt(0).toUpperCase() || '?';
  const hasAddress = Boolean(customer.address);

  return (
    <div className="relative">
      <Link
        href={`/customers/${customer.id}`}
        className="group block rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/60 transition hover:shadow-md hover:ring-indigo-300/70 active:scale-[0.99] dark:bg-[#17232f] dark:ring-white/10 dark:hover:ring-indigo-500/40"
      >
        <div className={`flex items-center gap-3.5 ${hasAddress ? 'pr-11' : ''}`}>
          {/* Brand avatar — initial */}
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-lg font-bold text-white shadow-sm">
            {initial}
          </div>

          {/* Name + status + phone */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight text-zinc-900 dark:text-zinc-100">
              {customer.name}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <CustomerStatusBadge status={customer.status} />
              {displayPhone && (
                <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span className="text-zinc-400 dark:text-zinc-500">{mobilePhone ? 'Κιν. ' : 'Σταθ. '}</span>
                  {displayPhone}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Next best action — the smart line; muted when nothing is pending */}
        {customer.nextBestAction ? (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-indigo-50/70 px-3 py-2 dark:bg-indigo-500/10">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            <p className="line-clamp-2 text-xs font-medium leading-snug text-indigo-800 dark:text-indigo-200">
              {customer.nextBestAction}
            </p>
          </div>
        ) : (
          <p className="mt-2 pl-[3.75rem] text-xs text-zinc-400 dark:text-zinc-500">Χωρίς εκκρεμότητα</p>
        )}
      </Link>

      {/* Maps shortcut — secondary, separate from the main tap target. */}
      {hasAddress && (
        <a
          href={buildMapsUrl(customer.address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Πλοήγηση στη διεύθυνση"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200/70 transition hover:bg-indigo-50 hover:text-indigo-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-[#1e2b38] dark:text-zinc-400 dark:ring-white/10"
        >
          <svg className="h-[18px] w-[18px]" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
        </a>
      )}
    </div>
  );
}
