'use client';

import Link from 'next/link';
import type { Customer } from '@/lib/types';
import { isIncompleteCustomer } from '@/components/customers/CustomerDataQualityPanel';

interface Props {
  customers: Customer[];
}

export default function DataQualityWidget({ customers }: Props) {
  const incompleteCount = customers.filter(isIncompleteCustomer).length;
  if (incompleteCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
      <div>
        <p className="text-xs font-semibold text-zinc-700">Ποιότητα δεδομένων</p>
        <p className="text-xs text-zinc-500">
          {incompleteCount} καρτέλ{incompleteCount === 1 ? 'α' : 'ες'} με ελλιπή στοιχεία.
        </p>
      </div>
      <Link
        href="/customers"
        className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-zinc-50"
      >
        Εμφάνιση →
      </Link>
    </div>
  );
}
