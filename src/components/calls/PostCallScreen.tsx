'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DemoCallScenario } from '@/lib/demo-data';
import type { Customer, CallRecord, Task } from '@/lib/types';
import { updateCustomer, addCustomer, loadState, updateCallRecord, addCallRecord, addTask } from '@/lib/storage';
import { parseSmsReply } from '@/lib/sms-intake';

interface BusinessInfo {
  businessName?: string;
  ownerName?: string;
  businessPhone?: string;
  businessEmail?: string;
}

function buildCrmSmsMessage(bp?: BusinessInfo): string {
  const body =
    'Για την καταχώρηση στο CRM, παρακαλώ στείλτε μου τα παρακάτω στοιχεία με σειρά:\n\nΌνομα:\nΕπώνυμο:\nΔιεύθυνση:\nEmail:';
  const sigLines: string[] = [];
  if (bp?.ownerName) sigLines.push(bp.ownerName);
  if (bp?.businessName) sigLines.push(bp.businessName);
  if (bp?.businessPhone) sigLines.push(bp.businessPhone);
  if (bp?.businessEmail) sigLines.push(bp.businessEmail);
  const signature =
    sigLines.length > 0 ? `Ευχαριστώ,\n${sigLines.join('\n')}` : 'Ευχαριστώ';
  return `${body}\n\n${signature}`;
}

function getNextCrmNumber(customers: Customer[]): string {
  const nums = customers
    .map((c) => c.crmNumber)
    .filter(Boolean)
    .map((n) => {
      const match = n!.match(/(\d+)$/);
      return match ? parseInt(match[1]) : 0;
    });
  const max = nums.length > 0 ? Math.max(...nums) : 329;
  return `#${max + 1}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function buildSmsHref(phone: string, message: string): string {
  return `sms:${phone}?body=${encodeURIComponent(message)}`;
}

const inputCls =
  'w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const labelCls = 'mb-1 block text-xs font-medium text-zinc-600';

interface Props {
  durationSeconds: number;
  scenario: DemoCallScenario | null;
  customerPhone?: string;
  customerId?: string;
  customerName?: string;
  businessName?: string;
  ownerName?: string;
  businessPhone?: string;
  businessEmail?: string;
  endedRecord?: CallRecord;
  onNewCall: () => void;
}

export default function PostCallScreen({
  durationSeconds,
  scenario,
  customerPhone,
  customerId,
  customerName,
  businessName,
  ownerName,
  businessPhone,
  businessEmail,
  endedRecord,
  onNewCall,
}: Props) {
  const smsMessage = buildCrmSmsMessage({ businessName, ownerName, businessPhone, businessEmail });
  const [copied, setCopied] = useState(false);

  // CRM brief state — pre-filled with rule-based draft from scenario + customer.
  const [briefSummary, setBriefSummary] = useState(() => {
    const nameStr = customerName ? `πελάτης ${customerName}` : 'πελάτης';
    if (scenario?.summaryText) {
      const first = scenario.summaryText.split(/[.!?]/).find((s) => s.trim().length > 10)?.trim();
      return first
        ? `${first}. Ο ${nameStr} χρειάζεται συνέχεια από την επιχείρηση.`
        : `Ο ${nameStr} επικοινώνησε. Απαιτείται συνέχεια.`;
    }
    return `Ο ${nameStr} επικοινώνησε. Απαιτείται συνέχεια από την επιχείρηση.`;
  });
  const [briefNextStep, setBriefNextStep] = useState('Follow-up με πελάτη ή αποστολή προσφοράς.');
  const [briefCreateFollowUp, setBriefCreateFollowUp] = useState(false);
  const [briefSaved, setBriefSaved] = useState(false);

  // Active CRM customer — starts from prop customerId; may be set when a temp card is created.
  const [activeCrmId, setActiveCrmId] = useState<string | null>(customerId || null);

  // SMS flow state.
  const [smsDecision, setSmsDecision] = useState<'undecided' | 'yes' | 'no'>('undecided');
  const [smsRaw, setSmsRaw] = useState('');
  const [smsSimDone, setSmsSimDone] = useState(false);
  const [smsSimCustomerId, setSmsSimCustomerId] = useState<string | null>(null);

  function handleCopy() {
    const doCopy = () => {
      const el = document.createElement('textarea');
      el.value = smsMessage;
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(el);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(smsMessage).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
        () => { doCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      );
    } else {
      doCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Ensure a CRM customer exists; creates a temp card if only phone is available.
  // Returns the resolved customer id or null.
  function ensureCrmCustomer(summary: string): string | null {
    if (activeCrmId) return activeCrmId;
    if (!customerPhone) return null;
    const now = new Date().toISOString();
    const state = loadState();
    const customers = state.customers ?? [];
    const crmNumber = getNextCrmNumber(customers);
    const newCustomer: Customer = {
      id: crypto.randomUUID(),
      crmNumber,
      name: `Καταχώρηση CRM ${crmNumber}`,
      companyName: '',
      phone: customerPhone,
      email: '',
      address: '',
      source: 'inbound_call',
      status: 'new_lead',
      preferredContactMethod: 'phone',
      needsSummary: summary,
      notes: `${summary}\nΑναμονή στοιχείων από SMS.`,
      createdAt: now,
      updatedAt: now,
    };
    addCustomer(newCustomer);
    setActiveCrmId(newCustomer.id);
    return newCustomer.id;
  }

  function handleSmsSend() {
    ensureCrmCustomer(briefSummary);
    setSmsDecision('yes');
  }

  function handleSimulateSms() {
    const parsed = parseSmsReply(smsRaw);
    const now = new Date().toISOString();

    let targetId = activeCrmId;
    if (!targetId) {
      targetId = ensureCrmCustomer(briefSummary);
    }
    if (!targetId) return;

    const state = loadState();
    const existing = (state.customers ?? []).find((c) => c.id === targetId);
    if (!existing) return;

    const combinedName = [parsed.firstName, parsed.lastName].filter(Boolean).join(' ');
    updateCustomer({
      ...existing,
      name: combinedName || existing.name,
      address: parsed.address || existing.address,
      email: parsed.email || existing.email,
      status: existing.status === 'new_lead' ? 'contacted' : existing.status,
      notes: existing.notes
        ? `${existing.notes}\nΣτοιχεία συμπληρώθηκαν από SMS.`
        : 'Στοιχεία συμπληρώθηκαν από SMS.',
      updatedAt: now,
    });

    setSmsSimCustomerId(targetId);
    setSmsSimDone(true);
  }

  function handleSaveBrief() {
    const now = new Date().toISOString();
    const trimmedSummary = briefSummary.trim();
    const trimmedNextStep = briefNextStep.trim();
    const linkedId = activeCrmId || customerId || undefined;

    if (endedRecord) {
      updateCallRecord({
        ...endedRecord,
        customerId: endedRecord.customerId ?? linkedId,
        summary: trimmedSummary,
        nextStep: trimmedNextStep || undefined,
      });
    } else {
      const record: CallRecord = {
        id: crypto.randomUUID(),
        customerId: linkedId,
        callType: 'outbound_existing_customer',
        direction: 'outbound',
        status: 'completed',
        startedAt: now,
        durationSeconds: 0,
        isMock: true,
        summary: trimmedSummary,
        nextStep: trimmedNextStep || undefined,
        createdAt: now,
      };
      addCallRecord(record);
    }

    if (briefCreateFollowUp && activeCrmId) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const noteLines = [`Brief: ${trimmedSummary}`];
      if (trimmedNextStep) noteLines.push(`Επόμενο βήμα: ${trimmedNextStep}`);
      const task: Task = {
        id: crypto.randomUUID(),
        customerId: activeCrmId,
        title: 'Follow-up μετά από κλήση',
        type: 'other',
        status: 'open',
        priority: 'normal',
        dueDate: tomorrow.toISOString().split('T')[0],
        note: noteLines.join('\n'),
        createdFromAi: false,
        createdAt: now,
        updatedAt: now,
      };
      addTask(task);
    }

    setBriefSaved(true);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-zinc-900">Κλήση ολοκληρώθηκε</h1>
        <p className="mt-1 text-sm text-zinc-500">Διάρκεια: {formatDuration(durationSeconds)}</p>
      </div>

      {/* Demo summary */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Demo περίληψη κλήσης
          </h2>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
        </div>
        <p className="text-sm text-zinc-700 leading-relaxed">
          {scenario?.summaryText ??
            'Η κλήση ολοκληρώθηκε. Σε πραγματική χρήση, το yorgos.ai θα δημιουργούσε αυτόματα περίληψη, tasks και draft προσφοράς από τη συνομιλία.'}
        </p>
      </div>

      {/* CRM brief */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Brief κλήσης για CRM
          </h2>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
        </div>

        <div>
          <label className={labelCls}>Σύνοψη</label>
          <textarea
            rows={3}
            value={briefSummary}
            onChange={(e) => setBriefSummary(e.target.value)}
            disabled={briefSaved}
            className={`${inputCls} resize-none disabled:bg-zinc-50 disabled:text-zinc-500`}
          />
        </div>

        <div>
          <label className={labelCls}>
            Επόμενο βήμα{' '}
            <span className="text-zinc-400">(προαιρετικό)</span>
          </label>
          <input
            type="text"
            value={briefNextStep}
            onChange={(e) => setBriefNextStep(e.target.value)}
            disabled={briefSaved}
            className={`${inputCls} disabled:bg-zinc-50 disabled:text-zinc-500`}
          />
        </div>

        <label className={`flex items-center gap-2 ${briefSaved ? 'opacity-50' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={briefCreateFollowUp}
            onChange={(e) => setBriefCreateFollowUp(e.target.checked)}
            disabled={briefSaved || !activeCrmId}
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
          />
          <span className="text-sm text-zinc-700">Δημιουργία task follow-up (αύριο)</span>
          {!activeCrmId && (
            <span className="text-xs text-zinc-400">— χωρίς συνδεδεμένο πελάτη</span>
          )}
        </label>

        {briefSaved ? (
          <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
            <p className="text-sm font-semibold text-green-700">Αποθηκεύτηκε στο CRM.</p>
            {activeCrmId && (
              <Link
                href={`/customers/${activeCrmId}`}
                className="inline-flex items-center rounded-xl bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
              >
                Άνοιγμα πελάτη →
              </Link>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSaveBrief}
            disabled={!briefSummary.trim()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Αποθήκευση στο CRM
          </button>
        )}
      </div>

      {/* SMS CRM intake — send decision */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-800">
          Αποστολή SMS καταχώρησης στοιχείων CRM
        </h2>

        {smsDecision === 'undecided' && (
          <>
            <p className="text-sm text-zinc-600">
              Να σταλεί SMS στον πελάτη για να συμπληρώσει τα στοιχεία της καρτέλας CRM;
            </p>
            {!customerPhone && (
              <p className="text-xs text-amber-600">
                Δεν υπάρχει τηλέφωνο πελάτη. Δεν μπορεί να σταλεί SMS.
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSmsSend}
                disabled={!customerPhone}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ναι, αποστολή SMS
              </button>
              <button
                type="button"
                onClick={() => setSmsDecision('no')}
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                Όχι τώρα
              </button>
            </div>
          </>
        )}

        {smsDecision === 'no' && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">Μπορείς να το στείλεις αργότερα.</p>
            <button
              type="button"
              onClick={() => setSmsDecision('undecided')}
              className="shrink-0 text-xs text-indigo-600 hover:text-indigo-700"
            >
              Αποστολή SMS
            </button>
          </div>
        )}

        {smsDecision === 'yes' && (
          <>
            <pre className="rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap ring-1 ring-zinc-100">
              {smsMessage}
            </pre>
            <div className="flex flex-col gap-2 sm:flex-row">
              {customerPhone && (
                <a
                  href={buildSmsHref(customerPhone, smsMessage)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                  </svg>
                  Άνοιγμα SMS
                </a>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition sm:flex-none sm:w-auto ${
                  copied
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                {copied ? 'Αντιγράφηκε' : 'Αντιγραφή μηνύματος'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Incoming SMS simulation */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Απάντηση SMS πελάτη</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Στο demo κάνε paste την απάντηση. Στο cloud θα έρχεται αυτόματα από SMS provider.
          </p>
        </div>

        {smsSimDone ? (
          <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
            <p className="text-sm font-semibold text-green-700">Η καρτέλα CRM ενημερώθηκε.</p>
            {smsSimCustomerId && (
              <Link
                href={`/customers/${smsSimCustomerId}`}
                className="inline-flex items-center rounded-xl bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
              >
                Άνοιγμα καρτέλας →
              </Link>
            )}
          </div>
        ) : (
          <>
            {!customerPhone && !customerId && (
              <p className="text-xs text-zinc-400">
                Χωρίς τηλέφωνο ή πελάτη δεν μπορεί να γίνει σύνδεση.
              </p>
            )}
            <textarea
              value={smsRaw}
              onChange={(e) => setSmsRaw(e.target.value)}
              rows={4}
              placeholder={
                'Όνομα: Γιώργος\nΕπώνυμο: Παπαδόπουλος\nΔιεύθυνση: Κηφισίας 10, Αθήνα\nEmail: george@example.com'
              }
              className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
            />
            <button
              type="button"
              onClick={handleSimulateSms}
              disabled={!smsRaw.trim() || (!activeCrmId && !customerPhone)}
              className="w-full rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Προσομοίωση εισερχόμενου SMS
            </button>
          </>
        )}
      </div>

      {/* AI review */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
        <h2 className="mb-1 text-sm font-semibold text-indigo-700">AI Review</h2>
        <p className="text-sm text-zinc-600">
          Δεν αποθηκεύτηκε τίποτα στο CRM ακόμα. Έλεγξε και αποθήκευσε το αποτέλεσμα χειροκίνητα.
        </p>
        <Link
          href="/ai-review"
          className="mt-3 inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Άνοιγμα AI Review →
        </Link>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Πίσω στην αρχική
        </Link>
        <button
          type="button"
          onClick={onNewCall}
          className="flex items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
        >
          Νέα κλήση
        </button>
      </div>
    </div>
  );
}
