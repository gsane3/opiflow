'use client';

import { useState } from 'react';
import type { CallRecord, Task } from '@/lib/types';
import { demoMissedCalls } from '@/lib/demo-data';
import { loadState, addTask } from '@/lib/storage';

// Normalise a phone number to digits only for matching.
function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// Check whether there is already an open call-back task for the given phone number.
function hasExistingCallBackTask(tasks: Task[], phone: string): boolean {
  const norm = normalisePhone(phone);
  return tasks.some(
    (t) =>
      t.status === 'open' &&
      t.type === 'call_back' &&
      t.note.replace(/\D/g, '').includes(norm)
  );
}

function DisabledBtn({ label }: { label: string }) {
  return (
    <button disabled className="cursor-not-allowed text-xs text-zinc-400">
      {label}
    </button>
  );
}

interface Props {
  callRecords: CallRecord[] | undefined;
  customerMap: Record<string, string>;
}

export default function MissedCallsSection({ callRecords, customerMap }: Props) {
  // Local set of demo call IDs marked as handled (session only — no new localStorage keys).
  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  // Track which demo calls already had a follow-up task created this session.
  const [taskCreatedIds, setTaskCreatedIds] = useState<Set<string>>(new Set());

  function markHandled(id: string) {
    setHandledIds((prev) => new Set(prev).add(id));
  }

  function handleCreateFollowUp(callId: string, phone: string, customerName?: string) {
    // Prevent creating a duplicate task.
    const state = loadState();
    const tasks = state.tasks ?? [];
    if (hasExistingCallBackTask(tasks, phone)) {
      setTaskCreatedIds((prev) => new Set(prev).add(callId));
      return;
    }
    const dueDate = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      title: customerName ? `Κλήση πίσω στον/ην ${customerName}` : `Κλήση πίσω σε ${phone}`,
      type: 'call_back',
      status: 'open',
      priority: 'high',
      dueDate,
      note: `Χαμένη κλήση από ${phone}. [Demo]`,
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    setTaskCreatedIds((prev) => new Set(prev).add(callId));
  }

  // When real call records exist, show only genuinely missed ones.
  if (callRecords !== undefined) {
    const missed = callRecords.filter((c) => c.status === 'missed');
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Χαμένες κλήσεις
          </h2>
          {missed.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {missed.length}
            </span>
          )}
        </div>
        {missed.length === 0 ? (
          <p className="text-sm text-zinc-500">Δεν υπάρχουν χαμένες κλήσεις αυτή τη στιγμή.</p>
        ) : (
          <ul className="space-y-2">
            {missed.map((call) => {
              // Try to resolve customer name from customerId.
              const customerName = call.customerId ? customerMap[call.customerId] : undefined;
              return (
                <li key={call.id} className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-900">
                        {customerName ?? 'Άγνωστος αριθμός'}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {new Date(call.startedAt).toLocaleString('el-GR', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  // Demo fallback — user has never used the call mock.
  const visibleCalls = demoMissedCalls.filter((c) => !handledIds.has(c.id));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Χαμένες κλήσεις
        </h2>
        {visibleCalls.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {visibleCalls.length}
          </span>
        )}
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
      </div>

      {visibleCalls.length === 0 ? (
        <p className="text-sm text-zinc-500">Δεν υπάρχουν εκκρεμείς χαμένες κλήσεις.</p>
      ) : (
        <ul className="space-y-2">
          {visibleCalls.map((call) => {
            // Use whatever name is embedded in the demo data (customerMap is id->name,
            // so we cannot match by phone number without additional phone fields).
            const normPhone = normalisePhone(call.phoneDisplay);
            const matchedCustomerName = call.customerName;

            const alreadyCreated = taskCreatedIds.has(call.id);

            return (
              <li key={call.id} className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-red-900">
                        {matchedCustomerName ?? call.phoneDisplay}
                      </span>
                      {call.isUnknown && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                          Άγνωστος αριθμός
                        </span>
                      )}
                    </div>
                    {matchedCustomerName && (
                      <p className="mt-0.5 text-xs text-zinc-500">{call.phoneDisplay}</p>
                    )}
                    <p className="mt-0.5 text-xs text-zinc-500">{call.timeLabel}</p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <svg
                      className="h-4 w-4 text-red-600"
                      fill="none"
                      strokeWidth={2}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z"
                      />
                    </svg>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <DisabledBtn label="Κλήση πίσω" />
                  <span className="text-zinc-200">·</span>
                  {call.isUnknown ? (
                    <DisabledBtn label="Προσθήκη στο CRM" />
                  ) : (
                    <DisabledBtn label="Άνοιγμα πελάτη" />
                  )}
                  <span className="text-zinc-200">·</span>
                  {alreadyCreated ? (
                    <span className="text-xs text-green-700">Task δημιουργήθηκε</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleCreateFollowUp(call.id, normPhone, matchedCustomerName)
                      }
                      className="text-xs font-medium text-indigo-600 transition hover:text-indigo-800"
                    >
                      + Δημιουργία task
                    </button>
                  )}
                  <span className="text-zinc-200">·</span>
                  <button
                    type="button"
                    onClick={() => markHandled(call.id)}
                    className="text-xs font-medium text-zinc-500 transition hover:text-zinc-700"
                  >
                    Ενημερώθηκε
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
