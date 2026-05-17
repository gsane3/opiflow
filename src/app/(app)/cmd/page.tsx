'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { loadState, addTask, addOffer, updateTask } from '@/lib/storage';
import {
  isSpeechSupported,
  createRecognition,
} from '@/lib/speech';
import type {
  AppSpeechRecognition,
  AppSpeechRecognitionEvent,
  AppSpeechRecognitionErrorEvent,
} from '@/lib/speech';
import type { Task, Customer, BusinessProfile, TaskType, TaskPriority, Offer } from '@/lib/types';
import type { CmdReviewResult } from '@/lib/ai/cmd-schema';

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Χαμηλή',
  normal: 'Κανονική',
  high: 'Υψηλή',
};

const APPT_TYPE_LABELS: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη σε πελάτη',
};

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findCustomerCandidates(name: string | undefined, customers: Customer[]): Customer[] {
  if (!name?.trim()) return [];
  const q = normalizeText(name.trim());
  return customers.filter((c) => normalizeText(c.name).includes(q));
}

function CustomerCandidatePicker({
  candidates,
  selectedId,
  onSelect,
  onContinueWithout,
}: {
  candidates: Customer[];
  selectedId?: string;
  onSelect: (c: Customer) => void;
  onContinueWithout: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-600">Βρέθηκαν πολλοί πελάτες. Διάλεξε τον σωστό:</p>
      <div className="space-y-1.5">
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
              c.id === selectedId
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-zinc-200 bg-white hover:border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            <p className="font-semibold text-zinc-800">{c.name}</p>
            {(c.mobilePhone || c.phone) && <p className="text-xs text-zinc-500">{c.mobilePhone || c.phone}</p>}
            {c.email && <p className="text-xs text-zinc-500">{c.email}</p>}
            {c.address && <p className="text-xs text-zinc-400">{c.address}</p>}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onContinueWithout}
        className="text-xs text-zinc-400 hover:text-zinc-600 transition"
      >
        Συνέχεια χωρίς σύνδεση πελάτη
      </button>
    </div>
  );
}

function fmtEur(n: number): string {
  return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

const CMD_EXAMPLES = [
  'Ποια ραντεβού έχω σήμερα;',
  'Δημιούργησε task να καλέσω τον Δημητρίου αύριο',
  'Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10',
  'Ετοίμασε προσφορά για τον Αλεξάνδρου, υλικά 3500 ευρώ, εργατικά 500',
];

function computeApptCandidates(
  params: { dueDate?: string; dueTime?: string; appointmentType?: string },
  customerId: string | null,
  filterByCustomer: boolean,
  allTasks: Task[],
  customerMap: Record<string, string>
): (Task & { customerName?: string })[] {
  let pool = allTasks.filter(
    (t) => (t.type === 'book_appointment' || t.type === 'visit_customer') && t.status === 'open'
  );
  if (filterByCustomer && customerId) {
    pool = pool.filter((t) => t.customerId === customerId);
  }
  if (params.dueDate) {
    pool = pool.filter((t) => t.dueDate === params.dueDate);
  }
  if (params.dueTime) {
    pool = pool.filter((t) => t.dueTime === params.dueTime);
  }
  if (params.appointmentType) {
    pool = pool.filter((t) => (t.type as string) === params.appointmentType);
  }
  return pool.map((t) => ({
    ...t,
    customerName: t.customerId ? customerMap[t.customerId] : undefined,
  }));
}

function filterByRange(tasks: Task[], range: string): Task[] {
  const today = todayStr();
  const tomorrow = addDaysStr(1);
  const week = addDaysStr(7);
  return tasks.filter((t) => {
    if (t.type !== 'book_appointment' && t.type !== 'visit_customer') return false;
    if (t.status !== 'open') return false;
    if (range === 'today') return t.dueDate === today;
    if (range === 'tomorrow') return t.dueDate === tomorrow;
    if (range === 'week') return t.dueDate >= today && t.dueDate <= week;
    return true; // 'all'
  });
}

export default function CmdPage() {
  const [cmdInput, setCmdInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cmdError, setCmdError] = useState('');
  const [result, setResult] = useState<CmdReviewResult | null>(null);
  const [savedResult, setSavedResult] = useState(false);

  const [queryAppointments, setQueryAppointments] = useState<(Task & { customerName?: string })[]>([]);
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [noCustomerMatch, setNoCustomerMatch] = useState(false);
  const [customerCandidates, setCustomerCandidates] = useState<Customer[]>([]);
  const [customerMatchResolved, setCustomerMatchResolved] = useState(false);

  const [appointmentCandidates, setAppointmentCandidates] = useState<(Task & { customerName?: string })[]>([]);
  const [confirmingCancelApptId, setConfirmingCancelApptId] = useState<string | null>(null);
  const [cancelApptSuccess, setCancelApptSuccess] = useState(false);

  const [offerPreviewData, setOfferPreviewData] = useState<{
    validItems: { description: string; quantity: number; unitPrice: number }[];
    subtotal: number;
    vatAmount: number;
    total: number;
    vatRate: number;
  } | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);

  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<AppSpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const stoppingManuallyRef = useRef(false);

  useEffect(() => {
    const bp = loadState().businessProfile ?? null;
    const detected = isSpeechSupported();
    const timer = window.setTimeout(() => {
      setBusinessProfile(bp);
      setSpeechSupported(detected);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      stoppingManuallyRef.current = true;
      recognitionRef.current?.stop();
    };
  }, []);

  function startListening() {
    setCmdError('');
    const r = createRecognition();
    if (!r) return;
    shouldKeepListeningRef.current = true;
    stoppingManuallyRef.current = false;
    recognitionRef.current = r;

    function attach(instance: AppSpeechRecognition) {
      instance.onresult = (event: AppSpeechRecognitionEvent) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        setInterimText(interim);
        if (final.trim()) {
          setCmdInput((prev) => {
            const t = prev.trim();
            return t ? t + ' ' + final.trim() : final.trim();
          });
          setInterimText('');
        }
      };
      instance.onerror = (event: AppSpeechRecognitionErrorEvent) => {
        shouldKeepListeningRef.current = false;
        stoppingManuallyRef.current = true;
        setIsListening(false);
        setInterimText('');
        const err = event.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setCmdError('Δεν δόθηκε πρόσβαση στο μικρόφωνο.');
        } else if (err === 'no-speech' || err === 'audio-capture') {
          setCmdError('Δεν άκουσα καθαρά. Γράψε την εντολή.');
        }
      };
      instance.onend = () => {
        if (shouldKeepListeningRef.current && !stoppingManuallyRef.current) {
          try {
            const newR = createRecognition();
            if (newR) {
              recognitionRef.current = newR;
              attach(newR);
              newR.start();
            } else {
              setIsListening(false);
              setInterimText('');
            }
          } catch {
            shouldKeepListeningRef.current = false;
            setIsListening(false);
            setInterimText('');
          }
        } else {
          setIsListening(false);
          setInterimText('');
        }
      };
    }

    attach(r);
    r.start();
    setIsListening(true);
  }

  function stopListening() {
    shouldKeepListeningRef.current = false;
    stoppingManuallyRef.current = true;
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimText('');
  }

  async function handleSubmit() {
    const text = cmdInput.trim();
    if (!text) return;
    setIsLoading(true);
    setCmdError('');
    setResult(null);
    setSavedResult(false);
    setQueryAppointments([]);
    setMatchedCustomer(null);
    setNoCustomerMatch(false);
    setCustomerCandidates([]);
    setCustomerMatchResolved(false);
    setAppointmentCandidates([]);
    setConfirmingCancelApptId(null);
    setCancelApptSuccess(false);
    setOfferPreviewData(null);

    try {
      const res = await fetch('/api/ai/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputText: text,
          businessType: businessProfile?.businessType,
          businessName: businessProfile?.businessName,
        }),
      });
      const data = (await res.json()) as { ok: boolean; result?: CmdReviewResult; error?: string };

      if (!data.ok || !data.result) {
        setCmdError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
        return;
      }

      const r = data.result;
      setResult(r);

      const state = loadState();
      const customers = state.customers ?? [];
      const tasks = state.tasks ?? [];
      const customerMap: Record<string, string> = Object.fromEntries(
        customers.map((c) => [c.id, c.name])
      );

      if (r.intent === 'query_appointments') {
        const filtered = filterByRange(tasks, r.params.dateRange ?? 'today').map((t) => ({
          ...t,
          customerName: t.customerId ? customerMap[t.customerId] : undefined,
        }));
        setQueryAppointments(filtered);
      }

      let localMatchedCustomer: Customer | null = null;
      let localCustomerResolved = false;
      if (r.intent === 'create_task' || r.intent === 'create_appointment' || r.intent === 'create_offer' || r.intent === 'cancel_appointment') {
        const hasName = !!r.params.customerName?.trim();
        const candidates = findCustomerCandidates(r.params.customerName, customers);
        if (!hasName) {
          setCustomerCandidates([]);
          setMatchedCustomer(null);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(true);
          localCustomerResolved = true;
        } else if (candidates.length === 0) {
          setCustomerCandidates([]);
          setMatchedCustomer(null);
          setNoCustomerMatch(true);
          setCustomerMatchResolved(true);
          localCustomerResolved = true;
        } else if (candidates.length === 1) {
          setCustomerCandidates([]);
          setMatchedCustomer(candidates[0]);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(true);
          localMatchedCustomer = candidates[0];
          localCustomerResolved = true;
        } else {
          setCustomerCandidates(candidates);
          setMatchedCustomer(null);
          setNoCustomerMatch(false);
          setCustomerMatchResolved(false);
        }
      }

      if (r.intent === 'cancel_appointment') {
        if (localCustomerResolved) {
          const filterByCustomer = !!r.params.customerName?.trim() && !!localMatchedCustomer;
          const cMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
          setAppointmentCandidates(computeApptCandidates(
            { dueDate: r.params.dueDate, dueTime: r.params.dueTime, appointmentType: r.params.appointmentType },
            localMatchedCustomer?.id ?? null, filterByCustomer, tasks, cMap
          ));
        }
      }

      if (r.intent === 'create_offer') {
        const items = (r.params.offerItems ?? []).filter((i) => i.description.trim());
        const vat = businessProfile?.defaultVatRate ?? 24;
        const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vatAmt = Number((sub * vat / 100).toFixed(2));
        setOfferPreviewData({ validItems: items, subtotal: sub, vatAmount: vatAmt, total: Number((sub + vatAmt).toFixed(2)), vatRate: vat });
      }
    } catch {
      setCmdError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSaveTask() {
    if (!result) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    const now = new Date().toISOString();
    const today = todayStr();
    const task: Task = {
      id: crypto.randomUUID(),
      customerId: matchedCustomer?.id,
      title: result.params.title?.trim() || 'Νέο task',
      type: 'other' as TaskType,
      status: 'open',
      priority: (result.params.priority ?? 'normal') as TaskPriority,
      dueDate: result.params.dueDate || today,
      dueTime: result.params.dueTime || undefined,
      note: result.params.note || '',
      createdFromAi: true,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    setSavedResult(true);
  }

  function handleSaveAppointment() {
    if (!result) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    const now = new Date().toISOString();
    const today = todayStr();
    const defaultTitle = matchedCustomer
      ? `Ραντεβού με ${matchedCustomer.name}`
      : 'Νέο ραντεβού';
    const task: Task = {
      id: crypto.randomUUID(),
      customerId: matchedCustomer?.id,
      title: result.params.title?.trim() || defaultTitle,
      type: (result.params.appointmentType ?? 'book_appointment') as TaskType,
      status: 'open',
      priority: (result.params.priority ?? 'normal') as TaskPriority,
      dueDate: result.params.dueDate || today,
      dueTime: result.params.dueTime || undefined,
      note: result.params.note || '',
      createdFromAi: true,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    setSavedResult(true);
  }

  function handleSaveOffer() {
    if (!result || !offerPreviewData || offerPreviewData.validItems.length === 0) return;
    if (customerCandidates.length > 1 && !customerMatchResolved) return;
    const now = new Date().toISOString();
    const today = todayStr();
    const { validItems, subtotal, vatAmount, total, vatRate } = offerPreviewData;

    const existingOffers = loadState().offers ?? [];
    const maxNum = existingOffers.length === 0 ? 0 : Math.max(
      ...existingOffers.map((o) => {
        const match = o.offerNumber.match(/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
    );
    const offerNumber = `#${String(maxNum + 1).padStart(3, '0')}`;

    const validUntilDate = new Date();
    validUntilDate.setDate(validUntilDate.getDate() + 14);
    const validUntil = validUntilDate.toISOString().split('T')[0];

    const offer: Offer = {
      id: crypto.randomUUID(),
      customerId: matchedCustomer?.id,
      offerNumber,
      status: 'draft',
      offerDate: today,
      validUntil,
      items: validItems.map((i) => ({
        id: crypto.randomUUID(),
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      subtotal,
      vatRate,
      vatAmount,
      total,
      notes: result.params.offerNotes || '',
      terms: result.params.offerTerms || businessProfile?.defaultOfferTerms || '',
      acceptanceText: businessProfile?.defaultAcceptanceText ?? 'Αποδέχομαι τους παραπάνω όρους.',
      createdFromAi: true,
      createdAt: now,
      updatedAt: now,
    };
    addOffer(offer);

    const followUp: Task = {
      id: crypto.randomUUID(),
      customerId: matchedCustomer?.id,
      offerId: offer.id,
      title: 'Έλεγχος και αποστολή προσφοράς',
      type: 'send_offer' as TaskType,
      status: 'open',
      priority: 'normal' as TaskPriority,
      dueDate: today,
      note: 'Δημιουργήθηκε από AI εντολή. Έλεγξε την προσφορά πριν τη στείλεις.',
      createdFromAi: true,
      createdAt: now,
      updatedAt: now,
    };
    addTask(followUp);
    setSavedResult(true);
  }

  function handleConfirmCancelAppt(appt: Task & { customerName?: string }) {
    const now = new Date().toISOString();
    const label = new Date(now).toLocaleDateString('el-GR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const noteAppend = `Ακύρωση ραντεβού: ${label}.`;
    const updatedNote = appt.note ? `${appt.note}\n${noteAppend}` : noteAppend;
    const updated: Task = { ...appt, status: 'cancelled' as Task['status'], updatedAt: now, note: updatedNote };
    updateTask(updated);
    setAppointmentCandidates((prev) => prev.filter((t) => t.id !== appt.id));
    setConfirmingCancelApptId(null);
    setCancelApptSuccess(true);
  }

  function reset() {
    setCmdInput('');
    setResult(null);
    setSavedResult(false);
    setCmdError('');
    setQueryAppointments([]);
    setMatchedCustomer(null);
    setNoCustomerMatch(false);
    setCustomerCandidates([]);
    setCustomerMatchResolved(false);
    setAppointmentCandidates([]);
    setConfirmingCancelApptId(null);
    setCancelApptSuccess(false);
    setOfferPreviewData(null);
  }

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">AI εντολές</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Γράψε ή υπαγόρευσε τι θέλεις να οργανώσει το yorgos.ai. Θα δεις πρώτα έλεγχο πριν αποθηκευτεί κάτι.
        </p>
      </div>

      {/* Input card */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
        <textarea
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="Π.χ. Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10"
          rows={2}
          disabled={isListening}
          className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
        />

        {isListening && (
          <p className="min-h-[1.25rem] text-xs italic text-zinc-400">
            {interimText ? interimText + '...' : 'Ακούω...'}
          </p>
        )}

        {!cmdInput.trim() && !isListening && !isLoading && (
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-400">Παραδείγματα:</p>
            <div className="flex flex-wrap gap-1.5">
              {CMD_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setCmdInput(example);
                    setResult(null);
                    setSavedResult(false);
                    setCmdError('');
                  }}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-left text-xs text-zinc-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {speechSupported && (
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              disabled={isLoading}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                isListening
                  ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {isListening ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  Σταμάτημα
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                  Υπαγόρευση
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={isLoading || isListening || !cmdInput.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? 'Ανάλυση...' : 'Ανάλυση εντολής'}
          </button>
        </div>

        {cmdError && <p className="text-xs text-red-600">{cmdError}</p>}
      </div>

      {/* Result section */}
      {result && !isLoading && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ανάλυση</p>
            <p className="mt-1 text-sm text-zinc-700">{result.summary}</p>
          </div>

          {/* unknown */}
          {result.intent === 'unknown' && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <p className="text-sm text-amber-700">
                Αυτή η εντολή δεν υποστηρίζεται ακόμα ή χρειάζεται ξεχωριστή επιβεβαίωση.
              </p>
            </div>
          )}

          {/* query_appointments */}
          {result.intent === 'query_appointments' && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ραντεβού</p>
              {queryAppointments.length === 0 ? (
                <p className="text-sm text-zinc-400">Δεν βρέθηκαν ραντεβού για αυτό το διάστημα.</p>
              ) : (
                <ul className="space-y-2">
                  {queryAppointments.map((appt) => (
                    <li key={appt.id} className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100">
                      <p className="text-sm font-semibold text-zinc-800">{appt.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {appt.dueDate}
                        {appt.dueTime ? ` ${appt.dueTime}` : ''}
                        {appt.customerName ? ` · ${appt.customerName}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/appointments" className="inline-block text-xs text-indigo-600 hover:text-indigo-700">
                Όλα τα ραντεβού →
              </Link>
            </div>
          )}

          {/* create_task */}
          {result.intent === 'create_task' && !savedResult && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Νέο task (προεπισκόπηση)
              </p>
              <div className="space-y-1.5 text-sm text-zinc-700">
                <p><span className="font-medium">Τίτλος:</span> {result.params.title || 'Νέο task'}</p>
                {matchedCustomer && (
                  <div className="flex items-center gap-2">
                    <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                    {customerCandidates.length > 1 && customerMatchResolved && (
                      <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                    )}
                  </div>
                )}
                {customerCandidates.length > 1 && !customerMatchResolved && (
                  <CustomerCandidatePicker
                    candidates={customerCandidates}
                    selectedId={matchedCustomer?.id}
                    onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                    onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                  />
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                <p>
                  <span className="font-medium">Ημερομηνία:</span>{' '}
                  {result.params.dueDate
                    ? result.params.dueDate + (result.params.dueTime ? ` ${result.params.dueTime}` : '')
                    : 'Σήμερα (προεπιλογή)'}
                </p>
                <p>
                  <span className="font-medium">Προτεραιότητα:</span>{' '}
                  {PRIORITY_LABELS[result.params.priority ?? 'normal'] ?? 'Κανονική'}
                </p>
                {result.params.note && (
                  <p><span className="font-medium">Σημείωση:</span> {result.params.note}</p>
                )}
              </div>
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <p className="text-xs text-zinc-400">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
              )}
              <button
                type="button"
                onClick={handleSaveTask}
                disabled={customerCandidates.length > 1 && !customerMatchResolved}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Δημιουργία task
              </button>
            </div>
          )}

          {result.intent === 'create_task' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
              <p className="text-sm font-medium text-green-700">Το task δημιουργήθηκε.</p>
              <Link href="/tasks" className="inline-block text-xs text-indigo-600 hover:text-indigo-700">
                Δες τα tasks →
              </Link>
            </div>
          )}

          {/* create_appointment */}
          {result.intent === 'create_appointment' && !savedResult && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Νέο ραντεβού (προεπισκόπηση)
              </p>
              <div className="space-y-1.5 text-sm text-zinc-700">
                <p>
                  <span className="font-medium">Τίτλος:</span>{' '}
                  {result.params.title?.trim() ||
                    (matchedCustomer ? `Ραντεβού με ${matchedCustomer.name}` : 'Νέο ραντεβού')}
                </p>
                {matchedCustomer && (
                  <div className="flex items-center gap-2">
                    <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                    {customerCandidates.length > 1 && customerMatchResolved && (
                      <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                    )}
                  </div>
                )}
                {customerCandidates.length > 1 && !customerMatchResolved && (
                  <CustomerCandidatePicker
                    candidates={customerCandidates}
                    selectedId={matchedCustomer?.id}
                    onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                    onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                  />
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                <p>
                  <span className="font-medium">Ημερομηνία:</span>{' '}
                  {result.params.dueDate
                    ? result.params.dueDate + (result.params.dueTime ? ` ${result.params.dueTime}` : '')
                    : 'Σήμερα (προεπιλογή)'}
                </p>
                <p>
                  <span className="font-medium">Τύπος:</span>{' '}
                  {APPT_TYPE_LABELS[result.params.appointmentType ?? 'book_appointment'] ?? 'Ραντεβού'}
                </p>
                {result.params.note && (
                  <p><span className="font-medium">Σημείωση:</span> {result.params.note}</p>
                )}
              </div>
              <div className="rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                <p className="text-xs text-amber-700">
                  Το ραντεβού αποθηκεύεται μόνο στο εσωτερικό CRM. Δεν γίνεται αποστολή σε εξωτερικό calendar.
                </p>
              </div>
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <p className="text-xs text-zinc-400">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
              )}
              <button
                type="button"
                onClick={handleSaveAppointment}
                disabled={customerCandidates.length > 1 && !customerMatchResolved}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Δημιουργία ραντεβού
              </button>
            </div>
          )}

          {result.intent === 'create_appointment' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
              <p className="text-sm font-medium text-green-700">Το ραντεβού δημιουργήθηκε στο CRM.</p>
              <div className="rounded-lg bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200">
                <p className="text-xs text-amber-700">
                  Το ραντεβού αποθηκεύεται μόνο στο εσωτερικό CRM. Δεν γίνεται αποστολή σε εξωτερικό calendar.
                </p>
              </div>
              <Link href="/appointments" className="inline-block text-xs text-indigo-600 hover:text-indigo-700">
                Δες τα ραντεβού →
              </Link>
            </div>
          )}

          {/* create_offer */}
          {result.intent === 'create_offer' && !savedResult && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Draft προσφορά (προεπισκόπηση)
              </p>
              {matchedCustomer && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-700"><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                  {customerCandidates.length > 1 && customerMatchResolved && (
                    <button type="button" onClick={() => setCustomerMatchResolved(false)} className="text-xs text-indigo-600 hover:text-indigo-700 transition">Αλλαγή</button>
                  )}
                </div>
              )}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => { setMatchedCustomer(c); setCustomerMatchResolved(true); }}
                  onContinueWithout={() => { setMatchedCustomer(null); setCustomerMatchResolved(true); }}
                />
              )}
              {noCustomerMatch && (
                <p className="text-xs text-amber-600">
                  Δεν βρέθηκε πελάτης, η προσφορά θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                </p>
              )}
              {!offerPreviewData || offerPreviewData.validItems.length === 0 ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
                  <p className="text-sm text-amber-700">
                    Δεν βρέθηκαν γραμμές προσφοράς στην εντολή. Δοκίμασε να γράψεις ποσά και περιγραφές.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
                          <th className="pb-1.5 font-medium">Περιγραφή</th>
                          <th className="pb-1.5 font-medium text-right">Ποσ.</th>
                          <th className="pb-1.5 font-medium text-right">Τιμή</th>
                          <th className="pb-1.5 font-medium text-right">Σύνολο</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {offerPreviewData.validItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 text-zinc-800">{item.description}</td>
                            <td className="py-1.5 text-right text-zinc-600">{item.quantity}</td>
                            <td className="py-1.5 text-right text-zinc-600">{fmtEur(item.unitPrice)}</td>
                            <td className="py-1.5 text-right text-zinc-800">{fmtEur(item.quantity * item.unitPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-2.5 text-sm space-y-1">
                    <div className="flex justify-between text-zinc-500">
                      <span>Καθαρή αξία</span>
                      <span>{fmtEur(offerPreviewData.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>ΦΠΑ {offerPreviewData.vatRate}%</span>
                      <span>{fmtEur(offerPreviewData.vatAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold text-zinc-900">
                      <span>Σύνολο</span>
                      <span>{fmtEur(offerPreviewData.total)}</span>
                    </div>
                  </div>
                  {result.params.offerNotes && (
                    <p className="text-sm text-zinc-600"><span className="font-medium">Σημειώσεις:</span> {result.params.offerNotes}</p>
                  )}
                  {result.params.offerTerms && (
                    <p className="text-sm text-zinc-600"><span className="font-medium">Όροι:</span> {result.params.offerTerms}</p>
                  )}
                  <div className="rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                    <p className="text-xs text-amber-700">
                      Θα δημιουργηθεί draft προσφοράς στο CRM. Δεν γίνεται αποστολή στον πελάτη.
                    </p>
                  </div>
                  {customerCandidates.length > 1 && !customerMatchResolved && (
                    <p className="text-xs text-zinc-400">Διάλεξε πελάτη ή συνέχισε χωρίς σύνδεση πελάτη.</p>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveOffer}
                    disabled={customerCandidates.length > 1 && !customerMatchResolved}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Δημιουργία draft προσφοράς
                  </button>
                </>
              )}
            </div>
          )}

          {result.intent === 'create_offer' && savedResult && (
            <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1.5">
              <p className="text-sm font-medium text-green-700">Η draft προσφορά δημιουργήθηκε.</p>
              <p className="text-xs text-zinc-600">Δημιουργήθηκε και task για έλεγχο και αποστολή.</p>
              <Link href="/offers" className="inline-block text-xs text-indigo-600 hover:text-indigo-700">
                Δες τις προσφορές →
              </Link>
            </div>
          )}

          {/* cancel_appointment */}
          {result.intent === 'cancel_appointment' && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Ακύρωση ραντεβού
              </p>

              {/* Customer disambiguation for cancel */}
              {customerCandidates.length > 1 && !customerMatchResolved && (
                <CustomerCandidatePicker
                  candidates={customerCandidates}
                  selectedId={matchedCustomer?.id}
                  onSelect={(c) => {
                    setMatchedCustomer(c);
                    setCustomerMatchResolved(true);
                    const s = loadState();
                    const cMap = Object.fromEntries((s.customers ?? []).map((cu) => [cu.id, cu.name]));
                    setAppointmentCandidates(computeApptCandidates(
                      { dueDate: result.params.dueDate, dueTime: result.params.dueTime, appointmentType: result.params.appointmentType },
                      c.id, true, s.tasks ?? [], cMap
                    ));
                  }}
                  onContinueWithout={() => {
                    setMatchedCustomer(null);
                    setCustomerMatchResolved(true);
                    const s = loadState();
                    const cMap = Object.fromEntries((s.customers ?? []).map((cu) => [cu.id, cu.name]));
                    setAppointmentCandidates(computeApptCandidates(
                      { dueDate: result.params.dueDate, dueTime: result.params.dueTime, appointmentType: result.params.appointmentType },
                      null, false, s.tasks ?? [], cMap
                    ));
                  }}
                />
              )}

              {customerMatchResolved && (
                <>
                  {cancelApptSuccess ? (
                    <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-1">
                      <p className="text-sm font-medium text-green-700">Το ραντεβού ακυρώθηκε.</p>
                      <p className="text-xs text-zinc-500">Δεν γίνεται αποστολή ενημέρωσης στον πελάτη από αυτή την εντολή.</p>
                    </div>
                  ) : appointmentCandidates.length === 0 ? (
                    <p className="text-sm text-zinc-400">Δεν βρέθηκαν ανοιχτά ραντεβού με αυτά τα κριτήρια.</p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {appointmentCandidates.map((appt) => (
                          <li key={appt.id} className="rounded-xl bg-zinc-50 ring-1 ring-zinc-100">
                            {confirmingCancelApptId === appt.id ? (
                              <div className="p-3 space-y-2">
                                <p className="text-xs font-semibold text-zinc-800">Επιβεβαίωση ακύρωσης ραντεβού</p>
                                <p className="text-xs text-zinc-600">
                                  {appt.title}{appt.customerName ? ` · ${appt.customerName}` : ''}
                                </p>
                                <p className="text-xs text-zinc-500">
                                  {appt.dueDate}{appt.dueTime ? ` ${appt.dueTime}` : ''}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleConfirmCancelAppt(appt)}
                                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
                                  >
                                    Ναι, ακύρωση
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingCancelApptId(null)}
                                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
                                  >
                                    Πίσω
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3">
                                <p className="text-sm font-semibold text-zinc-800">{appt.title}</p>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                  {appt.dueDate}{appt.dueTime ? ` ${appt.dueTime}` : ''}
                                  {appt.customerName ? ` · ${appt.customerName}` : ''}
                                </p>
                                <p className="text-xs text-zinc-400">{APPT_TYPE_LABELS[appt.type] ?? appt.type}</p>
                                <button
                                  type="button"
                                  onClick={() => { setCancelApptSuccess(false); setConfirmingCancelApptId(appt.id); }}
                                  className="mt-2 text-xs font-medium text-red-600 hover:text-red-700 transition"
                                >
                                  Ακύρωση ραντεβού
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-zinc-400">Δεν γίνεται αποστολή ενημέρωσης στον πελάτη από αυτή την εντολή.</p>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Reset */}
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Νέα εντολή
          </button>
        </div>
      )}
    </div>
  );
}
