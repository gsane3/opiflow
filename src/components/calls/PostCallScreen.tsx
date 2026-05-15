'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DemoCallScenario } from '@/lib/demo-data';
import type { Customer } from '@/lib/types';
import { updateCustomer, addCustomer, loadState } from '@/lib/storage';
import { parseSmsReply, formatParsedData, type ParsedSmsData } from '@/lib/sms-intake';

interface BusinessInfo {
  businessName?: string;
  ownerName?: string;
  businessPhone?: string;
  businessEmail?: string;
}

function buildSmsMessage(bp?: BusinessInfo): string {
  const body =
    'Παρακαλώ στείλτε μου τα παρακάτω στοιχεία για την καταχώρηση στο σύστημά μας:\n\nΌνομα:\nΕπώνυμο:\nΔιεύθυνση:\nEmail:';
  const sigLines: string[] = [];
  if (bp?.ownerName) sigLines.push(bp.ownerName);
  if (bp?.businessName) sigLines.push(bp.businessName);
  if (bp?.businessPhone) sigLines.push(bp.businessPhone);
  if (bp?.businessEmail) sigLines.push(bp.businessEmail);
  const signature =
    sigLines.length > 0 ? `Ευχαριστώ,\n${sigLines.join('\n')}` : 'Ευχαριστώ';
  return `${body}\n\n${signature}`;
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
  onNewCall,
}: Props) {
  const [copied, setCopied] = useState(false);
  const smsMessage = buildSmsMessage({ businessName, ownerName, businessPhone, businessEmail });

  // SMS intake state
  const [smsRaw, setSmsRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedSmsData | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saveResult, setSaveResult] = useState<'saved' | 'created' | null>(null);
  const [dataCopied, setDataCopied] = useState(false);

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(smsMessage).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
        () => fallbackCopy()
      );
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const el = document.createElement('textarea');
    el.value = smsMessage;
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(el);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleAnalyze() {
    const result = parseSmsReply(smsRaw);
    setParsed(result);
    setEditFirst(result.firstName);
    setEditLast(result.lastName);
    setEditAddress(result.address);
    setEditEmail(result.email);
    setSaveResult(null);
  }

  function handleSave() {
    const now = new Date().toISOString();
    const combinedName = [editFirst, editLast].filter(Boolean).join(' ');

    if (customerId) {
      // Update existing customer
      const state = loadState();
      const existing = (state.customers ?? []).find((c) => c.id === customerId);
      if (!existing) return;
      updateCustomer({
        ...existing,
        name: combinedName || existing.name,
        address: editAddress || existing.address,
        email: editEmail || existing.email,
        updatedAt: now,
      });
      setSaveResult('saved');
    } else if (customerPhone) {
      // Create new customer from SMS reply
      const newCustomer: Customer = {
        id: crypto.randomUUID(),
        name: combinedName || customerPhone,
        companyName: '',
        phone: customerPhone,
        email: editEmail,
        address: editAddress,
        source: 'inbound_call',
        status: 'new_lead',
        preferredContactMethod: 'phone',
        needsSummary: '',
        notes: 'Δημιουργήθηκε από απάντηση SMS.',
        createdAt: now,
        updatedAt: now,
      };
      addCustomer(newCustomer);
      setSaveResult('created');
    }
  }

  function handleCopyParsed() {
    const text = formatParsedData({
      firstName: editFirst,
      lastName: editLast,
      address: editAddress,
      email: editEmail,
    });
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setDataCopied(true); setTimeout(() => setDataCopied(false), 2000); },
        () => {}
      );
    }
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

      {/* SMS details request */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-1 text-sm font-semibold text-zinc-800">Ζήτησε στοιχεία με SMS</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Άνοιξε έτοιμο SMS στο κινητό σου. Το μήνυμα δεν στέλνεται αυτόματα.
        </p>

        <pre className="mb-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap ring-1 ring-zinc-100">
          {smsMessage}
        </pre>

        <div className="flex flex-col gap-2 sm:flex-row">
          {customerPhone ? (
            <a
              href={buildSmsHref(customerPhone, smsMessage)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              Άνοιγμα SMS
            </a>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-400">
              Δεν υπάρχει τηλέφωνο πελάτη.
            </div>
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
      </div>

      {/* SMS intake section */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-1 text-sm font-semibold text-zinc-800">Καταχώρηση απάντησης SMS</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Επικόλλησε την απάντηση του πελάτη. Τα στοιχεία δεν αποθηκεύονται αυτόματα — πρέπει να πατήσεις αποθήκευση.
        </p>

        <div className="space-y-3">
          <textarea
            value={smsRaw}
            onChange={(e) => { setSmsRaw(e.target.value); setParsed(null); setSaveResult(null); }}
            rows={5}
            placeholder={
              'Όνομα: Γιώργος\nΕπώνυμο: Παπαδόπουλος\nΔιεύθυνση: Κηφισίας 10, Αθήνα\nEmail: george@example.com'
            }
            className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
          />

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!smsRaw.trim()}
            className="w-full rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ανάλυση απάντησης
          </button>
        </div>

        {/* Parsed / editable fields */}
        {parsed !== null && (
          <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Όνομα</label>
                <input
                  type="text"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Επώνυμο</label>
                <input
                  type="text"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Διεύθυνση</label>
              <input
                type="text"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className={inputCls}
              />
            </div>

            {/* Save / copy actions */}
            {saveResult === 'saved' && (
              <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700 ring-1 ring-green-200">
                Ο πελάτης ενημερώθηκε.
              </p>
            )}
            {saveResult === 'created' && (
              <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700 ring-1 ring-green-200">
                Νέος πελάτης δημιουργήθηκε.
              </p>
            )}

            {saveResult === null && (
              <>
                {customerId ? (
                  <button
                    type="button"
                    onClick={handleSave}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Ενημέρωση πελάτη{customerName ? ` — ${customerName}` : ''}
                  </button>
                ) : customerPhone ? (
                  <button
                    type="button"
                    onClick={handleSave}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Δημιουργία πελάτη
                  </button>
                ) : (
                  <p className="text-xs text-zinc-400">
                    Δεν υπάρχει τηλέφωνο πελάτη. Δεν μπορεί να δημιουργηθεί εγγραφή. Αντέγραψε τα στοιχεία.
                  </p>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleCopyParsed}
              className={`w-full rounded-xl border px-4 py-2 text-sm font-medium transition ${
                dataCopied
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              {dataCopied ? 'Αντιγράφηκε' : 'Αντιγραφή στοιχείων'}
            </button>
          </div>
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
