'use client';

import type { Customer, Task, Offer } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import { fmtEur } from '@/lib/offer-calculations';

interface Props {
  customers: Customer[];
  tasks: Task[];
  offers: Offer[];
}

export default function LocalAnalyticsWidget({ customers, tasks, offers }: Props) {
  const openTasks = tasks.filter(t => t.status === 'open');
  const overdueTasks = tasks.filter(t => getEffectiveStatus(t) === 'overdue');

  const openOffers = offers.filter(o => ['draft', 'ready_to_send', 'sent_manually'].includes(o.status));
  const openOffersValue = openOffers.reduce((sum, o) => sum + (o.total ?? 0), 0);

  const acceptedOffers = offers.filter(o => o.status === 'accepted');
  const acceptedValue = acceptedOffers.reduce((sum, o) => sum + (o.total ?? 0), 0);

  const wonCustomers = customers.filter(c => c.status === 'won').length;
  const lostCustomers = customers.filter(c => c.status === 'lost').length;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Τοπική εικόνα
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100">
          <p className="text-lg font-bold text-zinc-900">{openTasks.length}</p>
          <p className="text-xs text-zinc-400">Ανοιχτά tasks</p>
          {overdueTasks.length > 0 && (
            <p className="mt-0.5 text-xs font-medium text-red-500">{overdueTasks.length} εκπρόθεσμα</p>
          )}
        </div>
        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100">
          <p className="text-lg font-bold text-zinc-900">{openOffers.length}</p>
          <p className="text-xs text-zinc-400">Ανοιχτές προσφορές</p>
          {openOffersValue > 0 && (
            <p className="mt-0.5 text-xs text-zinc-500">{fmtEur(openOffersValue)}</p>
          )}
        </div>
        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100">
          <p className="text-lg font-bold text-green-700">{acceptedOffers.length}</p>
          <p className="text-xs text-zinc-400">Αποδεκτές προσφορές</p>
          {acceptedValue > 0 && (
            <p className="mt-0.5 text-xs text-green-600">{fmtEur(acceptedValue)}</p>
          )}
        </div>
        {(wonCustomers > 0 || lostCustomers > 0) && (
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-100">
            <p className="text-xs text-zinc-400">Κερδισμένοι / Χαμένοι</p>
            <p className="text-sm font-bold text-zinc-900">
              <span className="text-green-600">{wonCustomers}</span>
              {' / '}
              <span className="text-red-500">{lostCustomers}</span>
            </p>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-400">Τοπικά δεδομένα μόνο. Χωρίς cloud analytics ή tracking.</p>
    </section>
  );
}
