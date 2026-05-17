'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { loadState, addTask } from '@/lib/storage';
import {
  isSpeechSupported,
  createRecognition,
} from '@/lib/speech';
import type {
  AppSpeechRecognition,
  AppSpeechRecognitionEvent,
  AppSpeechRecognitionErrorEvent,
} from '@/lib/speech';
import type { Task, Customer, BusinessProfile, TaskType, TaskPriority } from '@/lib/types';
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

function matchCustomer(name: string | undefined, customers: Customer[]): Customer | null {
  if (!name?.trim()) return null;
  const q = name.trim().toLowerCase();
  return customers.find((c) => c.name.toLowerCase().includes(q)) ?? null;
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

      if (r.intent === 'create_task' || r.intent === 'create_appointment') {
        const matched = matchCustomer(r.params.customerName, customers);
        setMatchedCustomer(matched);
        setNoCustomerMatch(!!r.params.customerName?.trim() && !matched);
      }
    } catch {
      setCmdError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSaveTask() {
    if (!result) return;
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

  function reset() {
    setCmdInput('');
    setResult(null);
    setSavedResult(false);
    setCmdError('');
    setQueryAppointments([]);
    setMatchedCustomer(null);
    setNoCustomerMatch(false);
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
                  <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                {result.params.dueDate && (
                  <p>
                    <span className="font-medium">Ημερομηνία:</span> {result.params.dueDate}
                    {result.params.dueTime ? ` ${result.params.dueTime}` : ''}
                  </p>
                )}
                <p>
                  <span className="font-medium">Προτεραιότητα:</span>{' '}
                  {PRIORITY_LABELS[result.params.priority ?? 'normal'] ?? 'Κανονική'}
                </p>
                {result.params.note && (
                  <p><span className="font-medium">Σημείωση:</span> {result.params.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleSaveTask}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
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
                  <p><span className="font-medium">Πελάτης:</span> {matchedCustomer.name}</p>
                )}
                {noCustomerMatch && (
                  <p className="text-xs text-amber-600">
                    Δεν βρέθηκε πελάτης, θα δημιουργηθεί χωρίς σύνδεση πελάτη.
                  </p>
                )}
                {result.params.dueDate && (
                  <p>
                    <span className="font-medium">Ημερομηνία:</span> {result.params.dueDate}
                    {result.params.dueTime ? ` ${result.params.dueTime}` : ''}
                  </p>
                )}
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
              <button
                type="button"
                onClick={handleSaveAppointment}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
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
