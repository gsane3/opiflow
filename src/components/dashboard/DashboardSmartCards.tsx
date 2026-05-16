'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { Task, Customer, Offer } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import ActionSheet from '@/components/common/ActionSheet';
import { getCustomerStatusLabel, getOfferStatusLabel } from '@/lib/ui-labels';
import { fmtEur } from '@/lib/offer-calculations';

type SheetId = 'tasks' | 'leads' | 'offers' | null;

interface Props {
  urgentTasks: Task[];
  leads: Customer[];
  openOffers: Offer[];
  customerMap: Record<string, string>;
  onCompleteTask?: (id: string) => void;
}

export default function DashboardSmartCards({
  urgentTasks,
  leads,
  openOffers,
  customerMap,
  onCompleteTask,
}: Props) {
  const [activeSheet, setActiveSheet] = useState<SheetId>(null);

  const overdueCount = urgentTasks.filter((t) => getEffectiveStatus(t) === 'overdue').length;

  const close = useCallback(() => {
    setActiveSheet(null);
  }, []);

  return (
    <>
      {/* ── 3-card overview ─────────────────────────────────── */}
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Σήμερα με μια ματιά
        </p>
        <div className="grid grid-cols-3 gap-2">
          {/* Tasks card */}
          <button
            type="button"
            onClick={() => setActiveSheet('tasks')}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200 active:bg-zinc-50 min-h-[80px]"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
              overdueCount > 0 ? 'bg-red-100' : urgentTasks.length > 0 ? 'bg-amber-100' : 'bg-zinc-100'
            }`}>
              <svg className={`h-4 w-4 ${overdueCount > 0 ? 'text-red-600' : urgentTasks.length > 0 ? 'text-amber-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <p className={`text-lg font-bold leading-none ${
              overdueCount > 0 ? 'text-red-700' : urgentTasks.length > 0 ? 'text-amber-700' : 'text-zinc-400'
            }`}>
              {urgentTasks.length}
            </p>
            <p className="text-[10px] font-medium text-zinc-500 leading-tight">Tasks σήμερα</p>
          </button>

          {/* Follow-up customers card */}
          <button
            type="button"
            onClick={() => setActiveSheet('leads')}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200 active:bg-zinc-50 min-h-[80px]"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${leads.length > 0 ? 'bg-indigo-100' : 'bg-zinc-100'}`}>
              <svg className={`h-4 w-4 ${leads.length > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            </div>
            <p className={`text-lg font-bold leading-none ${leads.length > 0 ? 'text-indigo-700' : 'text-zinc-400'}`}>
              {leads.length}
            </p>
            <p className="text-[10px] font-medium text-zinc-500 leading-tight">Για follow-up</p>
          </button>

          {/* Offers card */}
          <button
            type="button"
            onClick={() => setActiveSheet('offers')}
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200 active:bg-zinc-50 min-h-[80px]"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${openOffers.length > 0 ? 'bg-green-100' : 'bg-zinc-100'}`}>
              <svg className={`h-4 w-4 ${openOffers.length > 0 ? 'text-green-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <p className={`text-lg font-bold leading-none ${openOffers.length > 0 ? 'text-green-700' : 'text-zinc-400'}`}>
              {openOffers.length}
            </p>
            <p className="text-[10px] font-medium text-zinc-500 leading-tight">Προσφορές</p>
          </button>
        </div>
      </section>

      {/* ── Tasks sheet ──────────────────────────────────────── */}
      <ActionSheet
        open={activeSheet === 'tasks'}
        onClose={close}
        title="Τι πρέπει να γίνει σήμερα"
        subtitle={urgentTasks.length > 0 ? `${urgentTasks.length} εκκρεμότητες` : undefined}
      >
        {urgentTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            Δεν υπάρχει κάτι επείγον σήμερα.
          </p>
        ) : (
          <ul className="space-y-3">
            {urgentTasks.slice(0, 5).map((task) => {
              const eff = getEffectiveStatus(task);
              const customerName = task.customerId ? customerMap[task.customerId] : undefined;
              return (
                <li
                  key={task.id}
                  className={`rounded-2xl p-4 ring-1 space-y-3 ${
                    eff === 'overdue'
                      ? 'bg-red-50 ring-red-200'
                      : 'bg-amber-50 ring-amber-200'
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${eff === 'overdue' ? 'text-red-900' : 'text-amber-900'}`}>
                        {task.title}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        eff === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {eff === 'overdue' ? 'Εκπρόθεσμο' : 'Σήμερα'}
                      </span>
                    </div>
                    {customerName && (
                      <p className="mt-0.5 text-xs text-zinc-500">{customerName}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onCompleteTask && (
                      <button
                        type="button"
                        onClick={() => { onCompleteTask(task.id); close(); }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 min-h-[36px]"
                      >
                        <svg className="h-3 w-3" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Ολοκλήρωση
                      </button>
                    )}
                    <Link
                      href={`/tasks?taskId=${task.id}`}
                      onClick={close}
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 min-h-[36px]"
                    >
                      Άνοιγμα →
                    </Link>
                  </div>
                </li>
              );
            })}
            {urgentTasks.length > 5 && (
              <li>
                <Link
                  href="/tasks"
                  onClick={close}
                  className="block py-2 text-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Δες όλα τα tasks ({urgentTasks.length}) →
                </Link>
              </li>
            )}
          </ul>
        )}
        <Link
          href="/tasks"
          onClick={close}
          className="block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 mt-2"
        >
          Όλα τα tasks →
        </Link>
      </ActionSheet>

      {/* ── Leads / follow-up customers sheet ───────────────── */}
      <ActionSheet
        open={activeSheet === 'leads'}
        onClose={close}
        title="Πελάτες για συνέχεια"
        subtitle={leads.length > 0 ? `${leads.length} χρειάζονται προσοχή` : undefined}
      >
        {leads.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            Δεν υπάρχει πελάτης που θέλει άμεση συνέχεια.
          </p>
        ) : (
          <ul className="space-y-2">
            {leads.slice(0, 8).map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  onClick={close}
                  className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{customer.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                      <span>{getCustomerStatusLabel(customer.status)}</span>
                      {customer.opportunityValue ? (
                        <span className="font-semibold text-zinc-700">
                          €{customer.opportunityValue.toLocaleString('el-GR')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <svg className="h-4 w-4 shrink-0 self-center text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/customers"
          onClick={close}
          className="block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 mt-2"
        >
          Όλοι οι πελάτες →
        </Link>
      </ActionSheet>

      {/* ── Offers sheet ─────────────────────────────────────── */}
      <ActionSheet
        open={activeSheet === 'offers'}
        onClose={close}
        title="Προσφορές που θέλουν προσοχή"
        subtitle={openOffers.length > 0 ? `${openOffers.length} ανοιχτές` : undefined}
      >
        {openOffers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            Δεν υπάρχουν ανοιχτές προσφορές αυτή τη στιγμή.
          </p>
        ) : (
          <ul className="space-y-2">
            {openOffers.slice(0, 8).map((offer) => {
              const customerName = offer.customerId ? customerMap[offer.customerId] : undefined;
              return (
                <li key={offer.id}>
                  <Link
                    href={`/offers/${offer.id}`}
                    onClick={close}
                    className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900 truncate">
                          {customerName ?? 'Χωρίς πελάτη'}
                        </p>
                        <span className="text-xs text-zinc-400">{offer.offerNumber}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-700">{fmtEur(offer.total)}</span>
                        <span>{getOfferStatusLabel(offer.status)}</span>
                      </div>
                      {offer.status === 'accepted' && (
                        <p className="mt-1 text-xs text-green-700 font-medium">
                          ✓ Δημιούργησε task για επόμενο βήμα
                        </p>
                      )}
                      {offer.status === 'rejected' && (
                        <p className="mt-1 text-xs text-amber-600">
                          Σκέψου follow-up ή νέα προσφορά
                        </p>
                      )}
                    </div>
                    <svg className="h-4 w-4 shrink-0 self-center text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/offers"
          onClick={close}
          className="block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 mt-2"
        >
          Όλες οι προσφορές →
        </Link>
      </ActionSheet>
    </>
  );
}
