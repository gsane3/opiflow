import Link from 'next/link';
import type { Customer } from '@/lib/types';
import { isLikelyMobile } from '@/lib/phone';
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return iso;
  }
}

interface Props {
  customer: Customer;
}

export default function CustomerCard({ customer }: Props) {
  return (
    <Link
      href={`/customers/${customer.id}`}
      className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 transition hover:ring-indigo-200 active:bg-zinc-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">{customer.name}</span>
            {customer.crmNumber && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-400">
                Πελάτης {customer.crmNumber}
              </span>
            )}
            {customer.isDemo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">
                Demo
              </span>
            )}
          </div>
          {customer.companyName && (
            <p className="mt-0.5 text-xs text-zinc-500">{customer.companyName}</p>
          )}
        </div>
        <CustomerStatusBadge status={customer.status} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span>{SOURCE_LABELS[customer.source] ?? customer.source}</span>
        {customer.opportunityValue && (
          <span className="font-medium text-zinc-700">
            €{customer.opportunityValue.toLocaleString('el-GR')}
          </span>
        )}
        {(customer.mobilePhone || (customer.phone && isLikelyMobile(customer.phone))) && (
          <span>Κιν. {customer.mobilePhone || customer.phone}</span>
        )}
        {(customer.landlinePhone || (customer.phone && !isLikelyMobile(customer.phone) && !customer.mobilePhone)) && (
          <span>Σταθ. {customer.landlinePhone || customer.phone}</span>
        )}
        {(customer.intakeStatus === 'waiting_sms' ||
          customer.intakeStatus === 'reminder_sent' ||
          customer.intakeStatus === 'no_response' ||
          customer.intakeStatus === 'kept_draft') && (
          <span className={
            customer.intakeStatus === 'no_response'
              ? 'text-red-500'
              : customer.intakeStatus === 'reminder_sent'
              ? 'text-amber-600'
              : 'text-zinc-400'
          }>
            {customer.intakeStatus === 'waiting_sms' ? 'Αναμονή SMS'
              : customer.intakeStatus === 'reminder_sent' ? 'Υπενθύμιση SMS'
              : customer.intakeStatus === 'no_response' ? 'Δεν απάντησε στο SMS'
              : 'Πρόχειρη'}
          </span>
        )}
      </div>

      {customer.lastContactAt && (
        <p className="mt-1.5 text-xs text-zinc-400">
          Τελευταία επικοινωνία: {formatDate(customer.lastContactAt)}
        </p>
      )}
    </Link>
  );
}
