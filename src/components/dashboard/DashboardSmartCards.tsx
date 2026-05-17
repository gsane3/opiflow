'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { Task, Customer, Offer, CallRecord } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import ActionSheet from '@/components/common/ActionSheet';
import { getCustomerStatusLabel, getOfferStatusLabel } from '@/lib/ui-labels';
import { fmtEur } from '@/lib/offer-calculations';

type SheetId = 'tasks' | 'leads' | 'offers' | 'missed' | 'customers' | null;

interface Props {
  urgentTasks: Task[];
  leads: Customer[];
  openOffers: Offer[];
  customers: Customer[];
  calls: CallRecord[] | undefined;
  customerMap: Record<string, string>;
  onCompleteTask?: (id: string) => void;
}

interface DashboardCardProps {
  id: SheetId;
  icon: React.ReactNode;
  title: string;
  count: number | string;
  hint: string;
  urgent?: boolean;
  active?: boolean;
  href?: string;
  onOpen: (id: SheetId) => void;
}

function DashboardCard({ id, icon, title, count, urgent, active, href, onOpen }: DashboardCardProps) {
  const cls = `flex flex-col items-center gap-1.5 rounded-2xl p-3 text-center ring-1 shadow-sm transition min-h-[84px] ${
    urgent && Number(count) > 0
      ? 'bg-red-50 ring-red-200 hover:ring-red-300'
      : active && Number(count) > 0
      ? 'bg-white ring-indigo-200 hover:ring-indigo-300'
      : 'bg-white ring-zinc-100 hover:ring-indigo-200'
  } active:bg-zinc-50`;

  const inner = (
    <>
      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
        urgent && Number(count) > 0 ? 'bg-red-100' : active && Number(count) > 0 ? 'bg-indigo-100' : 'bg-zinc-100'
      }`}>
        {icon}
      </div>
      <p className={`text-xl font-bold leading-none ${
        urgent && Number(count) > 0 ? 'text-red-700' : active && Number(count) > 0 ? 'text-indigo-700' : 'text-zinc-400'
      }`}>{count}</p>
      <p className="text-xs font-semibold text-zinc-700 leading-tight">{title}</p>
    </>
  );

  if (href) {
    return <Link href={href} className={cls}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={() => onOpen(id)} className={cls}>
      {inner}
    </button>
  );
}

export default function DashboardSmartCards({
  urgentTasks,
  leads,
  openOffers,
  customers,
  calls,
  customerMap,
  onCompleteTask,
}: Props) {
  const [activeSheet, setActiveSheet] = useState<SheetId>(null);

  const overdueCount = urgentTasks.filter((t) => getEffectiveStatus(t) === 'overdue').length;
  const missedCalls = calls ? calls.filter((c) => c.status === 'missed') : [];
  const openOffersValue = openOffers.reduce((s, o) => s + (o.total ?? 0), 0);

  const close = useCallback(() => setActiveSheet(null), []);

  return (
    <>
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Σήμερα με μια ματιά
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <DashboardCard
            id="tasks"
            title="Σήμερα"
            count={urgentTasks.length}
            hint="Τι πρέπει να γίνει"
            urgent={overdueCount > 0}
            active={urgentTasks.length > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${overdueCount > 0 ? 'text-red-600' : urgentTasks.length > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            }
          />
          <DashboardCard
            id="leads"
            title="Follow-up"
            count={leads.length}
            hint="Ποιον να πάρεις"
            active={leads.length > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${leads.length > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            }
          />
          <DashboardCard
            id="offers"
            title="Προσφορές"
            count={openOffers.length}
            hint="Τι περιμένει απάντηση"
            active={openOffers.length > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${openOffers.length > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            }
          />
          <DashboardCard
            id="missed"
            title="Χαμένες κλήσεις"
            count={calls === undefined ? '—' : missedCalls.length}
            hint="Κλήσεις χωρίς απάντηση"
            urgent={missedCalls.length > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${missedCalls.length > 0 ? 'text-red-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
              </svg>
            }
          />
          <DashboardCard
            id="customers"
            title="Πελάτες"
            count={customers.length}
            hint="Όλες οι καρτέλες"
            active={customers.length > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${customers.length > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            }
          />
          <DashboardCard
            id={null}
            title="Κλήσεις"
            count={calls === undefined ? '—' : calls.length}
            hint="Ιστορικό & ενέργειες"
            href="/calls"
            active={(calls?.length ?? 0) > 0}
            onOpen={setActiveSheet}
            icon={
              <svg className={`h-5 w-5 ${(calls?.length ?? 0) > 0 ? 'text-indigo-600' : 'text-zinc-400'}`} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
            }
          />
        </div>
      </section>

      {/* ── Tasks sheet ── */}
      <ActionSheet
        open={activeSheet === 'tasks'}
        onClose={close}
        title="Τι πρέπει να γίνει σήμερα"
        subtitle={urgentTasks.length > 0 ? `${urgentTasks.length} εκκρεμότητες` : undefined}
      >
        {urgentTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Δεν υπάρχει κάτι επείγον σήμερα.</p>
        ) : (
          <ul className="space-y-3">
            {urgentTasks.slice(0, 5).map((task) => {
              const eff = getEffectiveStatus(task);
              const customerName = task.customerId ? customerMap[task.customerId] : undefined;
              return (
                <li key={task.id} className={`rounded-2xl p-4 ring-1 space-y-3 ${eff === 'overdue' ? 'bg-red-50 ring-red-200' : 'bg-amber-50 ring-amber-200'}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${eff === 'overdue' ? 'text-red-900' : 'text-amber-900'}`}>{task.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${eff === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {eff === 'overdue' ? 'Εκπρόθεσμο' : 'Σήμερα'}
                      </span>
                    </div>
                    {customerName && <p className="mt-0.5 text-xs text-zinc-500">{customerName}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onCompleteTask && (
                      <button type="button" onClick={() => { onCompleteTask(task.id); close(); }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 min-h-[36px]">
                        <svg className="h-3 w-3" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Ολοκλήρωση
                      </button>
                    )}
                    <Link href={`/tasks?taskId=${task.id}`} onClick={close}
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 min-h-[36px]">
                      Άνοιγμα →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/tasks" onClick={close} className="mt-2 block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50">
          Όλα τα tasks →
        </Link>
      </ActionSheet>

      {/* ── Follow-up sheet ── */}
      <ActionSheet
        open={activeSheet === 'leads'}
        onClose={close}
        title="Πελάτες για συνέχεια"
        subtitle={leads.length > 0 ? `${leads.length} χρειάζονται προσοχή` : undefined}
      >
        {leads.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Δεν υπάρχει πελάτης που θέλει άμεση συνέχεια.</p>
        ) : (
          <ul className="space-y-2">
            {leads.slice(0, 8).map((customer) => (
              <li key={customer.id}>
                <Link href={`/customers/${customer.id}`} onClick={close}
                  className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{customer.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-zinc-500">
                      <span>{getCustomerStatusLabel(customer.status)}</span>
                      {customer.opportunityValue ? (
                        <span className="font-semibold text-zinc-700">€{customer.opportunityValue.toLocaleString('el-GR')}</span>
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
        <Link href="/customers" onClick={close} className="mt-2 block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50">
          Όλοι οι πελάτες →
        </Link>
      </ActionSheet>

      {/* ── Offers sheet ── */}
      <ActionSheet
        open={activeSheet === 'offers'}
        onClose={close}
        title="Προσφορές που θέλουν προσοχή"
        subtitle={openOffers.length > 0 ? `${openOffers.length} ανοιχτές · ${fmtEur(openOffersValue)}` : undefined}
      >
        {openOffers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Δεν υπάρχουν ανοιχτές προσφορές αυτή τη στιγμή.</p>
        ) : (
          <ul className="space-y-2">
            {openOffers.slice(0, 8).map((offer) => {
              const customerName = offer.customerId ? customerMap[offer.customerId] : undefined;
              return (
                <li key={offer.id}>
                  <Link href={`/offers/${offer.id}`} onClick={close}
                    className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900 truncate">{customerName ?? 'Χωρίς πελάτη'}</p>
                        <span className="text-xs text-zinc-400">{offer.offerNumber}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-700">{fmtEur(offer.total)}</span>
                        <span>{getOfferStatusLabel(offer.status)}</span>
                      </div>
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
        <Link href="/offers" onClick={close} className="mt-2 block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50">
          Όλες οι προσφορές →
        </Link>
      </ActionSheet>

      {/* ── Missed calls sheet ── */}
      <ActionSheet
        open={activeSheet === 'missed'}
        onClose={close}
        title="Χαμένες κλήσεις"
      >
        {calls === undefined ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-500">
              Οι χαμένες κλήσεις εμφανίζονται εδώ όταν συνδεθεί VoIP provider στο τελικό προϊόν.
            </p>
            <p className="text-xs text-zinc-400">Στο MVP δεν υπάρχει πραγματικό VoIP ή ηχογράφηση.</p>
            <Link href="/call/mock" onClick={close}
              className="inline-block rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100">
              Demo κλήση →
            </Link>
          </div>
        ) : missedCalls.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Δεν υπάρχουν χαμένες κλήσεις τώρα.</p>
        ) : (
          <ul className="space-y-2">
            {missedCalls.slice(0, 8).map((call) => {
              const name = call.customerId ? customerMap[call.customerId] : 'Άγνωστος';
              return (
                <li key={call.id} className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
                  <p className="text-sm font-semibold text-red-900">{name}</p>
                  <p className="text-xs text-zinc-500">{new Date(call.startedAt).toLocaleString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </li>
              );
            })}
          </ul>
        )}
      </ActionSheet>

      {/* ── Customers sheet ── */}
      <ActionSheet
        open={activeSheet === 'customers'}
        onClose={close}
        title="Πελάτες"
        subtitle={`${customers.length} συνολικά`}
      >
        {customers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">Δεν υπάρχουν πελάτες ακόμα.</p>
        ) : (
          <ul className="space-y-2">
            {customers.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} onClick={close}
                  className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{c.name}</p>
                    <p className="text-xs text-zinc-500">{getCustomerStatusLabel(c.status)}</p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 self-center text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/customers" onClick={close} className="mt-2 block w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-50">
          Όλοι οι πελάτες →
        </Link>
      </ActionSheet>

    </>
  );
}
