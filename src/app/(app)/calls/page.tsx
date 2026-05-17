'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState } from '@/lib/storage';
import type { CallRecord, Customer, Task } from '@/lib/types';

const CALL_TYPE_LABELS: Record<string, string> = {
  inbound_new_customer: 'Εισερχόμενη · Νέος πελάτης',
  inbound_existing_customer: 'Εισερχόμενη · Υπάρχων πελάτης',
  outbound_new_lead: 'Εξερχόμενη · Νέο lead',
  outbound_existing_customer: 'Εξερχόμενη · Υπάρχων πελάτης',
};

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}″`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}′ ${s}″` : `${m}′`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

interface CallRowProps {
  call: CallRecord;
  customerName?: string;
}

function CallRow({ call, customerName }: CallRowProps) {
  const isMissed = call.status === 'missed';
  const isInbound = call.direction === 'inbound';

  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${isMissed ? 'bg-red-50 ring-red-100' : 'bg-white ring-zinc-100'} shadow-sm`}>
      {/* Direction + status icon */}
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isMissed ? 'bg-red-100' : isInbound ? 'bg-green-100' : 'bg-blue-100'}`}>
        <svg
          className={`h-4 w-4 ${isMissed ? 'text-red-500' : isInbound ? 'text-green-600' : 'text-blue-600'}`}
          fill="none"
          strokeWidth={1.5}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isMissed ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
          ) : isInbound ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
          )}
        </svg>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold truncate ${isMissed ? 'text-red-700' : 'text-zinc-900'}`}>
          {customerName ?? 'Άγνωστος / Νέος'}
        </p>
        <p className="text-xs text-zinc-500 truncate">
          {CALL_TYPE_LABELS[call.callType] ?? call.callType}
          {call.durationSeconds > 0 && ` · ${fmtDuration(call.durationSeconds)}`}
        </p>
      </div>

      {/* Date + missed badge */}
      <div className="shrink-0 text-right">
        {isMissed && (
          <span className="mb-0.5 block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
            Χαμένη
          </span>
        )}
        <p className="text-[10px] text-zinc-400">{fmtDate(call.createdAt)}</p>
      </div>
    </div>
  );
}

function CallBackTaskRow({ task, customerName }: { task: Task; customerName?: string }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm transition hover:ring-indigo-200"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
        <svg className="h-4 w-4 text-amber-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 truncate">{task.title}</p>
        <p className="text-xs text-zinc-500 truncate">
          {customerName && `${customerName} · `}
          {task.dueDate ?? 'Χωρίς ημερομηνία'}
        </p>
      </div>
      <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

export default function CallsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [callBackTasks, setCallBackTasks] = useState<Task[]>([]);
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const state = loadState();
    const allCalls: CallRecord[] = state.calls ?? [];
    const allTasks: Task[] = state.tasks ?? [];
    const allCustomers: Customer[] = state.customers ?? [];
    const map = Object.fromEntries(allCustomers.map((c) => [c.id, c.name]));
    const cbTasks = allTasks.filter((t) => t.type === 'call_back' && t.status === 'open');

    const timer = window.setTimeout(() => {
      setCalls(allCalls);
      setCallBackTasks(cbTasks);
      setCustomerMap(map);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση κλήσεων...</p>
      </div>
    );
  }

  const sortedCalls = [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const missedCalls = sortedCalls.filter((c) => c.status === 'missed');
  const recentCalls = sortedCalls.filter((c) => c.status !== 'missed').slice(0, 8);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Κλήσεις</h1>
          <p className="text-sm text-zinc-500">
            Μετά κάθε κλήση, το AI ετοιμάζει brief για CRM.
          </p>
        </div>
        <Link
          href="/call/mock"
          className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
        >
          + Νέα κλήση
        </Link>
      </div>

      {/* MVP notice */}
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Demo MVP · Δεν γίνονται πραγματικές κλήσεις. Το dialer και οι κλήσεις είναι simulation.
      </div>

      {/* Call-back tasks — shown first if any */}
      {callBackTasks.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Επιστροφή κλήσης ({callBackTasks.length})
          </p>
          <ul className="space-y-2">
            {callBackTasks.map((task) => (
              <li key={task.id}>
                <CallBackTaskRow
                  task={task}
                  customerName={task.customerId ? customerMap[task.customerId] : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Missed calls */}
      {missedCalls.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-500">
            Χαμένες κλήσεις ({missedCalls.length})
          </p>
          <ul className="space-y-2">
            {missedCalls.map((call) => (
              <li key={call.id}>
                <CallRow
                  call={call}
                  customerName={call.customerId ? customerMap[call.customerId] : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent calls */}
      {recentCalls.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Πρόσφατες κλήσεις
          </p>
          <ul className="space-y-2">
            {recentCalls.map((call) => (
              <li key={call.id}>
                <CallRow
                  call={call}
                  customerName={call.customerId ? customerMap[call.customerId] : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Empty state — no calls at all */}
      {calls.length === 0 && callBackTasks.length === 0 && (
        <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
            <svg className="h-6 w-6 text-indigo-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-600">Δεν υπάρχουν κλήσεις ακόμα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Κάνε μια demo κλήση για να δεις πώς λειτουργεί η ροή.
          </p>
          <Link
            href="/call/mock"
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Δοκίμασε demo κλήση
          </Link>
        </div>
      )}

      {/* CTA strip — always at bottom when there are some calls */}
      {calls.length > 0 && (
        <div className="flex gap-2">
          <Link
            href="/call/mock"
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            + Νέα κλήση
          </Link>
          <Link
            href="/ai-review"
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            AI review
          </Link>
        </div>
      )}
    </div>
  );
}
