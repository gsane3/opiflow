'use client';

import { useState, useEffect } from 'react';
import { loadState } from '@/lib/storage';
import { addCallRecord } from '@/lib/storage';
import { demoCallScenarios } from '@/lib/demo-data';
import type { CallType, Customer, CallRecord } from '@/lib/types';
import CallTypeSelector, { CALL_TYPE_LABELS } from '@/components/calls/CallTypeSelector';
import MockCallScreen from '@/components/calls/MockCallScreen';
import PostCallScreen from '@/components/calls/PostCallScreen';

type Phase = 'setup' | 'active' | 'ended';

const NEEDS_EXISTING_CUSTOMER: CallType[] = [
  'inbound_existing_customer',
  'outbound_existing_customer',
];

export default function MockCallPage() {
  const [customers] = useState<Customer[]>(() => {
    if (typeof window === 'undefined') return [];
    return loadState().customers ?? [];
  });

  const [phase, setPhase] = useState<Phase>('setup');
  const [callType, setCallType] = useState<CallType | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [duration, setDuration] = useState(0);
  const [startedAt, setStartedAt] = useState('');
  const [endedRecord, setEndedRecord] = useState<CallRecord | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (phase !== 'active') return;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const displayName =
    selectedCustomer?.name ??
    (callType === 'inbound_new_customer' || callType === 'outbound_new_lead'
      ? 'Άγνωστος / Νέος πελάτης'
      : 'Άγνωστος αριθμός');

  const filteredScenarios = callType
    ? demoCallScenarios.filter((s) => s.callTypes.includes(callType))
    : demoCallScenarios;

  const selectedScenario = scenarioId
    ? (demoCallScenarios.find((s) => s.id === scenarioId) ?? null)
    : null;

  function handleStartCall() {
    if (!callType) {
      setError('Επέλεξε τύπο κλήσης για να συνεχίσεις.');
      return;
    }
    setError('');
    const now = new Date().toISOString();
    setStartedAt(now);
    setDuration(0);
    setPhase('active');
  }

  function handleEndCall() {
    const now = new Date().toISOString();
    const record: CallRecord = {
      id: crypto.randomUUID(),
      customerId: customerId || undefined,
      callType: callType!,
      direction: callType!.startsWith('inbound') ? 'inbound' : 'outbound',
      status: 'completed',
      startedAt: startedAt || now,
      endedAt: now,
      durationSeconds: duration,
      isMock: true,
      demoScenarioId: scenarioId || undefined,
      createdAt: now,
    };
    addCallRecord(record);
    setEndedRecord(record);
    setPhase('ended');
  }

  function handleNewCall() {
    setPhase('setup');
    setCallType(null);
    setCustomerId('');
    setScenarioId('');
    setDuration(0);
    setStartedAt('');
    setEndedRecord(null);
    setError('');
  }

  if (phase === 'active') {
    return (
      <MockCallScreen
        displayName={displayName}
        callTypeLabel={callType ? CALL_TYPE_LABELS[callType] : ''}
        duration={duration}
        onEndCall={handleEndCall}
      />
    );
  }

  if (phase === 'ended') {
    return (
      <PostCallScreen
        durationSeconds={endedRecord?.durationSeconds ?? duration}
        scenario={selectedScenario}
        onNewCall={handleNewCall}
      />
    );
  }

  // Phase: setup
  return (
    <div className="mx-auto max-w-2xl px-4 py-5 space-y-5">
      <h1 className="text-lg font-semibold text-zinc-900">Νέα κλήση</h1>

      {/* Mock notice */}
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Demo κλήση. Δεν γίνεται πραγματική τηλεφωνική κλήση ή ηχογράφηση στο MVP.
      </div>

      {/* Call type */}
      <div>
        <p className="mb-2 text-sm font-medium text-zinc-700">Τύπος κλήσης</p>
        <CallTypeSelector value={callType} onChange={(t) => { setCallType(t); setError(''); }} />
      </div>

      {/* Customer picker — only for existing customer types */}
      {callType && NEEDS_EXISTING_CUSTOMER.includes(callType) && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Πελάτης{' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— Άγνωστος / δεν έχει εισαχθεί —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Demo scenario picker */}
      {callType && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Demo σενάριο{' '}
            <span className="text-xs font-normal text-zinc-400">(προαιρετικό)</span>
          </label>
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— Γενική κλήση (χωρίς σενάριο) —</option>
            {filteredScenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">
            Το σενάριο καθορίζει τη demo περίληψη που εμφανίζεται μετά την κλήση.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleStartCall}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
      >
        Έναρξη κλήσης
      </button>
    </div>
  );
}
