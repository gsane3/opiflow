'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { DemoCallScenario } from '@/lib/demo-data';
import type { Customer, CallRecord, Task } from '@/lib/types';
import { updateCustomer, addCustomer, loadState, updateCallRecord, addCallRecord, addTask, getNextCrmNumber, addCommunicationRecord } from '@/lib/storage';
import { parseSmsReply } from '@/lib/sms-intake';
import { isLikelyMobile, findCustomerByPhone } from '@/lib/phone';
import { buildSmsHref } from '@/lib/communications';

interface BusinessInfo {
  businessName?: string;
  ownerName?: string;
  businessPhone?: string;
  businessEmail?: string;
}

function buildCrmSmsMessage(bp?: BusinessInfo): string {
  const body =
    'Για την καταχώρηση των στοιχείων σας, παρακαλώ στείλτε μου τα παρακάτω με σειρά:\n\nΌνομα:\nΕπώνυμο:\nΔιεύθυνση:\nEmail:';
  const sigLines: string[] = [];
  if (bp?.ownerName) sigLines.push(bp.ownerName);
  if (bp?.businessName) sigLines.push(bp.businessName);
  if (bp?.businessPhone) sigLines.push(bp.businessPhone);
  if (bp?.businessEmail) sigLines.push(bp.businessEmail);
  const signature =
    sigLines.length > 0 ? `Ευχαριστώ,\n${sigLines.join('\n')}` : 'Ευχαριστώ';
  return `${body}\n\n${signature}`;
}


function buildDemoSmsReply(name?: string): string {
  let firstName = 'Γιώργος';
  let lastName = 'Παπαδόπουλος';
  if (name && name.trim() && !/^Πελάτης #\d+$/.test(name) && !name.includes('Καταχώρηση')) {
    const parts = name.trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
  }
  return [
    `Όνομα: ${firstName}`,
    lastName ? `Επώνυμο: ${lastName}` : null,
    'Διεύθυνση: Κηφισίας 10, Αθήνα',
    'Email: george@example.com',
  ].filter(Boolean).join('\n');
}

function makeDemoMobile(): string {
  const r = () => Math.floor(Math.random() * 10);
  return `+30 69${r()} ${r()}${r()}${r()} ${r()}${r()}${r()}${r()}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}


const inputCls =
  'w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const labelCls = 'mb-1 block text-xs font-medium text-zinc-600';

interface Props {
  durationSeconds: number;
  scenario: DemoCallScenario | null;
  customerPhone?: string;
  customerLandlinePhone?: string;
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
  customerLandlinePhone,
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

  // Local phone — editable mobile for SMS; pre-filled from mobile prop.
  // If existing customer has no mobile (landline only), start empty so user types one.
  // If no customer at all, pre-fill with demo mobile.
  const [tempPhone, setTempPhone] = useState(() => {
    if (customerPhone) return customerPhone;
    if (customerId) return ''; // existing customer but no mobile — must type
    return makeDemoMobile();
  });

  // SMS flow state.
  const [smsDecision, setSmsDecision] = useState<'undecided' | 'yes' | 'no'>('undecided');
  const [demoSmsStatus, setDemoSmsStatus] = useState<'idle' | 'waiting' | 'done'>('idle');
  const [demoSmsText, setDemoSmsText] = useState('');
  const [crmRegistered, setCrmRegistered] = useState(false);
  const [crmRegisteredCustomerId, setCrmRegisteredCustomerId] = useState<string | null>(null);
  const [smsSendLogged, setSmsSendLogged] = useState(false);
  const [reusedExisting, setReusedExisting] = useState(false);

  // Manual registration form state.
  const [manualOpen, setManualOpen] = useState(() =>
    !!(customerLandlinePhone && !customerPhone && !customerId)
  );
  const [manualFirst, setManualFirst] = useState(() => {
    if (!customerName || /^Πελάτης #\d+$/.test(customerName)) return '';
    const parts = customerName.trim().split(/\s+/);
    return parts[0] || '';
  });
  const [manualLast, setManualLast] = useState(() => {
    if (!customerName || /^Πελάτης #\d+$/.test(customerName)) return '';
    const parts = customerName.trim().split(/\s+/);
    return parts.slice(1).join(' ') || '';
  });
  const [manualMobile, setManualMobile] = useState(customerPhone || '');
  const [manualLandline, setManualLandline] = useState(customerLandlinePhone || '');
  const [manualAddress, setManualAddress] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualRegistered, setManualRegistered] = useState(false);
  const [manualRegisteredCustomerId, setManualRegisteredCustomerId] = useState<string | null>(null);

  const smsTimerRef = useRef<number | null>(null);

  // Clear SMS timer on unmount.
  useEffect(() => {
    return () => { if (smsTimerRef.current) window.clearTimeout(smsTimerRef.current); };
  }, []);

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

  // Ensure a CRM customer exists; reuses existing if phone matches, else creates temp card.
  // Returns the resolved customer id or null.
  function ensureCrmCustomer(summary: string): string | null {
    if (activeCrmId) return activeCrmId;
    const phone = tempPhone.trim();
    if (!phone) return null;
    const now = new Date().toISOString();
    const state = loadState();
    const customers = state.customers ?? [];

    // Reuse existing customer if phone matches — prevents duplicate cards.
    const found = findCustomerByPhone(customers, phone);
    if (found) {
      const updates: Partial<Customer> = {};
      if (isLikelyMobile(phone) && !found.mobilePhone) updates.mobilePhone = phone;
      if (!isLikelyMobile(phone) && !found.landlinePhone) updates.landlinePhone = phone;
      if (!found.phone) updates.phone = phone;
      if (Object.keys(updates).length > 0) {
        updateCustomer({ ...found, ...updates, updatedAt: now });
      }
      setActiveCrmId(found.id);
      setReusedExisting(true);
      return found.id;
    }

    const crmNumber = getNextCrmNumber(customers);
    const newCustomer: Customer = {
      id: crypto.randomUUID(),
      crmNumber,
      name: `Πελάτης ${crmNumber}`,
      companyName: '',
      phone,
      mobilePhone: isLikelyMobile(phone) ? phone : undefined,
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
    const now = new Date().toISOString();
    const resolvedId = ensureCrmCustomer(briefSummary);
    if (resolvedId) {
      const state = loadState();
      const existing = (state.customers ?? []).find((c) => c.id === resolvedId);
      if (existing && existing.intakeStatus !== 'completed') {
        updateCustomer({
          ...existing,
          intakeStatus: 'waiting_sms',
          intakeSmsSentAt: now,
          notes: existing.notes
            ? `${existing.notes}\nΑποστολή SMS για στοιχεία πελάτη.`
            : 'Αποστολή SMS για στοιχεία πελάτη.',
          updatedAt: now,
        });
      }
    }
    if (!smsSendLogged && resolvedId) {
      addCommunicationRecord({
        id: crypto.randomUUID(),
        customerId: resolvedId,
        channel: 'sms',
        direction: 'outbound',
        status: 'sent',
        phone: tempPhone.trim(),
        summary: 'Αποστολή SMS για καταχώρηση στοιχείων πελάτη.',
        createdAt: now,
        isMock: true,
      });
      setSmsSendLogged(true);
    }

    setSmsDecision('yes');
    setDemoSmsStatus('waiting');
    smsTimerRef.current = window.setTimeout(() => {
      setDemoSmsText(buildDemoSmsReply(customerName));
      setDemoSmsStatus('done');
    }, 2000);
  }

  function handleSaveBrief() {
    const now = new Date().toISOString();
    const trimmedSummary = briefSummary.trim();
    const trimmedNextStep = briefNextStep.trim();
    // Auto-create temp card if we have a phone but no linked customer yet.
    let resolvedId = activeCrmId || customerId || null;
    if (!resolvedId && tempPhone.trim()) {
      resolvedId = ensureCrmCustomer(trimmedSummary);
    }
    const linkedId = resolvedId ?? undefined;

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

  function handleRegisterCrm() {
    if (crmRegistered) return;
    const now = new Date().toISOString();
    const trimmedSummary = briefSummary.trim();
    const trimmedNextStep = briefNextStep.trim();

    // Resolve / create customer.
    let resolvedId = activeCrmId || customerId || null;
    if (!resolvedId) resolvedId = ensureCrmCustomer(trimmedSummary);

    // Update customer with parsed demo SMS details.
    if (resolvedId && demoSmsText) {
      const parsed = parseSmsReply(demoSmsText);
      const state = loadState();
      const existing = (state.customers ?? []).find((c) => c.id === resolvedId);
      if (existing) {
        const isTempName = /^Πελάτης #\d+$/.test(existing.name) || existing.name.includes('Καταχώρηση');
        const combinedName = [parsed.firstName, parsed.lastName].filter(Boolean).join(' ');
        const noteBase = trimmedSummary
          ? `${trimmedSummary}\nΣτοιχεία συμπληρώθηκαν από demo SMS.`
          : 'Στοιχεία συμπληρώθηκαν από demo SMS.';
        updateCustomer({
          ...existing,
          name: isTempName && combinedName ? combinedName : existing.name,
          address: parsed.address || existing.address,
          email: parsed.email || existing.email,
          status: existing.status === 'new_lead' ? 'contacted' : existing.status,
          intakeStatus: 'completed',
          notes: existing.notes ? `${existing.notes}\n${noteBase}` : noteBase,
          updatedAt: now,
        });
      }
    }

    // Save call brief.
    const linkedId = resolvedId ?? undefined;
    if (endedRecord) {
      updateCallRecord({
        ...endedRecord,
        customerId: endedRecord.customerId ?? linkedId,
        summary: trimmedSummary,
        nextStep: trimmedNextStep || undefined,
      });
    } else {
      addCallRecord({
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
      });
    }

    // Follow-up task.
    if (briefCreateFollowUp && resolvedId) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const noteLines = [`Brief: ${trimmedSummary}`];
      if (trimmedNextStep) noteLines.push(`Επόμενο βήμα: ${trimmedNextStep}`);
      addTask({
        id: crypto.randomUUID(),
        customerId: resolvedId,
        title: 'Follow-up μετά από κλήση',
        type: 'other',
        status: 'open',
        priority: 'normal',
        dueDate: tomorrow.toISOString().split('T')[0],
        note: noteLines.join('\n'),
        createdFromAi: false,
        createdAt: now,
        updatedAt: now,
      } as Task);
    }

    setBriefSaved(true);
    setCrmRegistered(true);
    setCrmRegisteredCustomerId(resolvedId);
  }

  function handleManualRegister() {
    if (manualRegistered) return;
    const now = new Date().toISOString();
    const trimmedSummary = briefSummary.trim();
    const trimmedNextStep = briefNextStep.trim();
    const mobile = manualMobile.trim();
    const landline = manualLandline.trim();
    const combinedName = [manualFirst.trim(), manualLast.trim()].filter(Boolean).join(' ');
    const resolvedPhone = mobile || landline || tempPhone.trim() || '';

    let resolvedId = activeCrmId || customerId || null;

    // Check existing customers by phone before creating new.
    if (!resolvedId) {
      const searchPhone = mobile || landline || tempPhone.trim();
      if (searchPhone) {
        const stateForSearch = loadState();
        const found = findCustomerByPhone(stateForSearch.customers ?? [], searchPhone);
        if (found) {
          resolvedId = found.id;
          setActiveCrmId(found.id);
        }
      }
    }

    if (resolvedId) {
      const state = loadState();
      const existing = (state.customers ?? []).find((c) => c.id === resolvedId);
      if (existing) {
        const noteAdd = trimmedSummary || 'Στοιχεία καταχωρήθηκαν χειροκίνητα.';
        updateCustomer({
          ...existing,
          name: combinedName || existing.name,
          phone: resolvedPhone || existing.phone,
          mobilePhone: mobile || existing.mobilePhone,
          landlinePhone: landline || existing.landlinePhone,
          address: manualAddress.trim() || existing.address,
          email: manualEmail.trim() || existing.email,
          status: existing.status === 'new_lead' ? 'contacted' : existing.status,
          intakeStatus: 'completed',
          notes: existing.notes ? `${existing.notes}\n${noteAdd}` : noteAdd,
          updatedAt: now,
        });
      }
    } else {
      const state = loadState();
      const crmNumber = getNextCrmNumber(state.customers ?? []);
      const newCustomer: Customer = {
        id: crypto.randomUUID(),
        crmNumber,
        name: combinedName || `Πελάτης ${crmNumber}`,
        companyName: '',
        phone: resolvedPhone,
        mobilePhone: mobile || undefined,
        landlinePhone: landline || undefined,
        email: manualEmail.trim(),
        address: manualAddress.trim(),
        source: 'inbound_call',
        status: 'contacted',
        preferredContactMethod: 'phone',
        needsSummary: trimmedSummary,
        notes: trimmedSummary || 'Στοιχεία καταχωρήθηκαν χειροκίνητα.',
        intakeStatus: 'completed',
        createdAt: now,
        updatedAt: now,
      };
      addCustomer(newCustomer);
      resolvedId = newCustomer.id;
      setActiveCrmId(newCustomer.id);
    }

    // Save call brief.
    const linkedId = resolvedId ?? undefined;
    if (endedRecord) {
      updateCallRecord({
        ...endedRecord,
        customerId: endedRecord.customerId ?? linkedId,
        summary: trimmedSummary,
        nextStep: trimmedNextStep || undefined,
      });
    } else {
      addCallRecord({
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
      });
    }

    // Follow-up task.
    if (briefCreateFollowUp && resolvedId) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const noteLines = [`Brief: ${trimmedSummary}`];
      if (trimmedNextStep) noteLines.push(`Επόμενο βήμα: ${trimmedNextStep}`);
      addTask({
        id: crypto.randomUUID(),
        customerId: resolvedId,
        title: 'Follow-up μετά από κλήση',
        type: 'other',
        status: 'open',
        priority: 'normal',
        dueDate: tomorrow.toISOString().split('T')[0],
        note: noteLines.join('\n'),
        createdFromAi: false,
        createdAt: now,
        updatedAt: now,
      } as Task);
    }

    setBriefSaved(true);
    setManualRegistered(true);
    setManualRegisteredCustomerId(resolvedId);
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
            disabled={briefSaved}
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
          />
          <span className="text-sm text-zinc-700">Δημιουργία task follow-up (αύριο)</span>
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

      {/* SMS intake — consolidated yes/no decision + demo simulation */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-800">
          Αποστολή SMS στοιχείων πελάτη
        </h2>

        {smsDecision === 'undecided' && (
          <>
            <p className="text-sm text-zinc-600">
              Να σταλεί SMS στον πελάτη για να αποστείλει τα στοιχεία του στην καρτέλα;
            </p>
            {reusedExisting && (
              <p className="text-xs text-green-700">
                Βρέθηκε υπάρχουσα καρτέλα με αυτό το τηλέφωνο.
              </p>
            )}
            {!customerId && (
              <div className="space-y-2">
                {customerLandlinePhone && !tempPhone && (
                  <p className="text-xs text-amber-700">
                    Υπάρχει μόνο σταθερό ({customerLandlinePhone}). Ζήτησε κινητό για SMS ή καταχώρησε στοιχεία χειροκίνητα.
                  </p>
                )}
                <div>
                  <label className={labelCls}>Κινητό για SMS</label>
                  <input
                    type="tel"
                    value={tempPhone}
                    onChange={(e) => setTempPhone(e.target.value)}
                    placeholder="69xxxxxxxx"
                    className={inputCls}
                  />
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSmsSend}
                disabled={!customerId && !tempPhone.trim()}
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
            <p className="text-sm text-zinc-400">Δεν θα σταλεί SMS καταχώρησης στοιχείων.</p>
            <button
              type="button"
              onClick={() => setSmsDecision('undecided')}
              className="shrink-0 text-xs text-indigo-600 hover:text-indigo-700"
            >
              Αλλαγή
            </button>
          </div>
        )}

        {smsDecision === 'yes' && (
          <>
            <pre className="rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap ring-1 ring-zinc-100">
              {smsMessage}
            </pre>
            <div className="flex flex-col gap-2 sm:flex-row">
              {tempPhone.trim() && (
                <a
                  href={buildSmsHref(tempPhone.trim(), smsMessage)}
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

            {/* Demo SMS response */}
            <div className="border-t border-zinc-100 pt-4 space-y-3">
              {demoSmsStatus === 'waiting' && (
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                  <p className="text-xs text-zinc-500">Αναμονή demo απάντησης SMS...</p>
                </div>
              )}
              {demoSmsStatus === 'done' && (
                <>
                  {crmRegistered ? (
                    <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
                      <p className="text-sm font-semibold text-green-700">
                        Η καρτέλα πελάτη και το call brief καταχωρήθηκαν στο CRM.
                      </p>
                      {crmRegisteredCustomerId && (
                        <Link
                          href={`/customers/${crmRegisteredCustomerId}`}
                          className="inline-flex items-center rounded-xl bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                        >
                          Άνοιγμα καρτέλας →
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-zinc-600">Ήρθε demo απάντηση SMS:</p>
                      <pre className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600 whitespace-pre-wrap ring-1 ring-zinc-100 leading-relaxed">
                        {demoSmsText}
                      </pre>
                      <p className="text-xs text-zinc-400">
                        Στο cloud η απάντηση θα έρχεται από SMS provider webhook.
                      </p>
                      <button
                        type="button"
                        onClick={handleRegisterCrm}
                        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                      >
                        Καταχώρηση στοιχείων &amp; brief στο CRM
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Manual registration */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Χειροκίνητη καταχώρηση στοιχείων</h2>
          {!manualRegistered && (
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="text-xs text-indigo-600 hover:text-indigo-700 transition"
            >
              {manualOpen ? 'Σύμπτυξη' : 'Άνοιγμα'}
            </button>
          )}
        </div>

        {!customerPhone && customerLandlinePhone && (
          <p className="text-xs text-amber-700">
            Δεν υπάρχει κινητό για SMS. Μπορείς να ζητήσεις κινητό ή να καταχωρήσεις τα στοιχεία χειροκίνητα.
          </p>
        )}

        {manualRegistered ? (
          <div className="rounded-xl bg-green-50 px-4 py-3 ring-1 ring-green-200 space-y-2">
            <p className="text-sm font-semibold text-green-700">
              Η καρτέλα πελάτη και το call brief καταχωρήθηκαν στο CRM.
            </p>
            {manualRegisteredCustomerId && (
              <Link
                href={`/customers/${manualRegisteredCustomerId}`}
                className="inline-flex items-center rounded-xl bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
              >
                Άνοιγμα καρτέλας →
              </Link>
            )}
          </div>
        ) : manualOpen ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Όνομα</label>
                <input
                  type="text"
                  value={manualFirst}
                  onChange={(e) => setManualFirst(e.target.value)}
                  placeholder="Γιώργης"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Επώνυμο</label>
                <input
                  type="text"
                  value={manualLast}
                  onChange={(e) => setManualLast(e.target.value)}
                  placeholder="Παπαδόπουλος"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Κινητό</label>
                <input
                  type="tel"
                  value={manualMobile}
                  onChange={(e) => setManualMobile(e.target.value)}
                  placeholder="694 000 0000"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Σταθερό</label>
                <input
                  type="tel"
                  value={manualLandline}
                  onChange={(e) => setManualLandline(e.target.value)}
                  placeholder="210 000 0000"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Διεύθυνση</label>
              <input
                type="text"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="π.χ. Αθήνα, Αττική"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="email@example.gr"
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={handleManualRegister}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Καταχώρηση στοιχείων &amp; brief στο CRM
            </button>
          </div>
        ) : null}
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
