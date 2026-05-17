'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { loadState } from '@/lib/storage';
import { norm } from '@/lib/search';
import type { CallRecord, Customer } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'keypad' | 'recent' | 'customers' | 'sms';

const TABS: { id: Tab; label: string }[] = [
  { id: 'keypad', label: 'Πληκτρολόγιο' },
  { id: 'recent', label: 'Πρόσφατες' },
  { id: 'customers', label: 'Πελάτες' },
  { id: 'sms', label: 'SMS' },
];

const CALL_DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Εισερχόμενη',
  outbound: 'Εξερχόμενη',
};

interface SmsTemplate {
  key: string;
  label: string;
  text: string;
}

const SMS_TEMPLATES: SmsTemplate[] = [
  {
    key: 'info_request',
    label: 'Ζήτηση στοιχείων',
    text: 'Καλησπέρα, για να προχωρήσουμε παρακαλώ στείλτε ονοματεπώνυμο, εταιρεία αν υπάρχει, email, διεύθυνση και λίγα λόγια για αυτό που χρειάζεστε.',
  },
  {
    key: 'follow_up',
    label: 'Follow-up μετά από κλήση',
    text: 'Καλησπέρα, σας ευχαριστώ για την επικοινωνία. Ετοιμάζω την προσφορά και θα σας ενημερώσω σύντομα.',
  },
  {
    key: 'reminder',
    label: 'Υπενθύμιση',
    text: 'Καλησπέρα, θέλω να σας υπενθυμίσω ότι αναμένω τα στοιχεία σας για να προχωρήσουμε. Παραμένω στη διάθεσή σας.',
  },
  {
    key: 'offer',
    label: 'Αποστολή προσφοράς',
    text: 'Καλησπέρα, σας αποστέλλω την προσφορά μας. Για οποιαδήποτε διευκρίνιση είμαι στη διάθεσή σας.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'h-5 w-5'} fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  );
}

// ─── Keypad Tab ───────────────────────────────────────────────────────────────

const KEYPAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

function KeypadTab() {
  const [number, setNumber] = useState('');

  function press(key: string) {
    setNumber((n) => (n.length < 20 ? n + key : n));
  }

  function backspace() {
    setNumber((n) => n.slice(0, -1));
  }

  return (
    <div className="space-y-4">
      {/* Number display */}
      <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
        <span className="flex-1 text-center text-2xl font-light tracking-widest text-zinc-800 min-h-[2rem]">
          {number || <span className="text-zinc-300 text-lg">Αριθμός ή αναζήτηση</span>}
        </span>
        {number && (
          <button
            type="button"
            onClick={backspace}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200"
            aria-label="Διαγραφή"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z" />
            </svg>
          </button>
        )}
      </div>

      {/* Numpad grid */}
      <div className="grid grid-cols-3 gap-2">
        {KEYPAD_KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="flex h-14 items-center justify-center rounded-2xl bg-white text-xl font-medium text-zinc-800 ring-1 ring-zinc-200 transition hover:bg-zinc-50 active:bg-zinc-100"
          >
            {key}
          </button>
        ))}
      </div>

      {/* Clear if number present */}
      {number && (
        <button
          type="button"
          onClick={() => setNumber('')}
          className="w-full rounded-xl border border-zinc-200 py-2 text-sm text-zinc-500 transition hover:bg-zinc-50"
        >
          Καθαρισμός
        </button>
      )}

      {/* Call button */}
      <Link
        href="/call/mock"
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 py-4 text-base font-semibold text-white transition hover:bg-green-700 active:bg-green-800"
      >
        <PhoneIcon className="h-5 w-5" />
        Κλήση (Demo)
      </Link>

      {/* MVP disclaimer */}
      <p className="text-center text-xs text-zinc-400">
        Demo κλήση. Δεν γίνεται πραγματική τηλεφωνική κλήση στο MVP.
      </p>
    </div>
  );
}

// ─── Recent Tab ───────────────────────────────────────────────────────────────

function RecentTab({
  calls,
  customerMap,
  onSwitchToSms,
}: {
  calls: CallRecord[];
  customerMap: Record<string, string>;
  onSwitchToSms: () => void;
}) {
  const sorted = [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl bg-zinc-50 px-5 py-10 text-center ring-1 ring-zinc-100">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
          <PhoneIcon className="h-6 w-6 text-indigo-400" />
        </div>
        <p className="text-sm font-medium text-zinc-600">Δεν υπάρχουν πρόσφατες κλήσεις ακόμα.</p>
        <p className="mt-1 text-sm text-zinc-400">
          Δοκίμασε μια demo κλήση για να δεις το AI review.
        </p>
        <Link
          href="/call/mock"
          className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Νέα demo κλήση
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sorted.map((call) => {
        const name = call.customerId ? customerMap[call.customerId] : null;
        const isMissed = call.status === 'missed';
        const isNew = !call.customerId;
        return (
          <li key={call.id} className={`rounded-2xl px-4 py-3 ring-1 shadow-sm space-y-2 ${isMissed ? 'bg-red-50 ring-red-100' : 'bg-white ring-zinc-100'}`}>
            {/* Row 1: name + date */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-semibold truncate ${isMissed ? 'text-red-800' : 'text-zinc-900'}`}>
                  {name ?? 'Άγνωστος / Νέος'}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {CALL_DIRECTION_LABEL[call.direction] ?? call.direction}
                  {call.durationSeconds > 0 && ` · ${fmtDuration(call.durationSeconds)}`}
                </p>
              </div>
              <p className="shrink-0 text-[10px] text-zinc-400 whitespace-nowrap">{fmtDate(call.createdAt)}</p>
            </div>
            {/* Row 2: status chips */}
            <div className="flex flex-wrap gap-1.5">
              {isMissed && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Χαμένη</span>}
              {isNew
                ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Νέος αριθμός</span>
                : <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">Υπάρχων πελάτης</span>
              }
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">CRM</span>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">AI brief</span>
            </div>
            {/* Row 3: quick actions */}
            <div className="flex flex-wrap gap-2">
              {call.customerId && (
                <Link href={`/customers/${call.customerId}`}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 min-h-[32px] flex items-center">
                  Άνοιγμα πελάτη
                </Link>
              )}
              <Link href="/call/mock"
                className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[32px] flex items-center">
                Κλήση ξανά
              </Link>
              <button type="button" onClick={onSwitchToSms}
                className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 min-h-[32px] flex items-center">
                SMS
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Customers Tab ────────────────────────────────────────────────────────────

function CustomersTab({
  customers,
  onSwitchToSms,
}: {
  customers: Customer[];
  onSwitchToSms: (customer: Customer) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? customers.filter((c) => {
        const q = norm(search.trim());
        return (
          norm(c.name).includes(q) ||
          norm(c.companyName ?? '').includes(q) ||
          norm(c.phone ?? '').includes(q) ||
          norm(c.email ?? '').includes(q)
        );
      })
    : customers;

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Αναζήτηση ονόματος, τηλεφώνου, email..."
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100">
          <p className="text-sm text-zinc-500">
            {search.trim() ? 'Δεν βρέθηκαν αποτελέσματα.' : 'Δεν υπάρχουν πελάτες ακόμα.'}
          </p>
          {!search.trim() && (
            <Link href="/customers" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
              Πήγαινε στους Πελάτες →
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.slice(0, 20).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 truncate">{c.name}</p>
                <p className="text-xs text-zinc-500 truncate">
                  {[c.companyName, c.phone].filter(Boolean).join(' · ') || 'Χωρίς στοιχεία'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Link
                  href="/call/mock"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-green-600 ring-1 ring-green-200 transition hover:bg-green-100"
                  title="Κλήση"
                >
                  <PhoneIcon className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => onSwitchToSms(c)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-100"
                  title="SMS"
                >
                  <svg className="h-3.5 w-3.5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                </button>
                <Link
                  href={`/customers/${c.id}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100"
                  title="Άνοιγμα"
                >
                  <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── SMS Tab ──────────────────────────────────────────────────────────────────

function SmsTab({ preselectedCustomer, customers }: { preselectedCustomer: Customer | null; customers: Customer[] }) {
  const [selectedCustomerId, setSelectedCustomerId] = useState(preselectedCustomer?.id ?? '');
  const [templateKey, setTemplateKey] = useState(SMS_TEMPLATES[0].key);
  const [customText, setCustomText] = useState('');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const template = SMS_TEMPLATES.find((t) => t.key === templateKey) ?? SMS_TEMPLATES[0];
  const smsText = customText || template.text;
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? preselectedCustomer;

  function handleCopy() {
    navigator.clipboard.writeText(smsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    });
  }

  function pickTemplate(key: string) {
    setTemplateKey(key);
    setCustomText('');
  }

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200">
        <p className="text-xs text-zinc-500">
          Δεν αποστέλλεται αυτόματα. Το μήνυμα αντιγράφεται για να το στείλεις εσύ.
        </p>
      </div>

      {/* Customer picker */}
      {customers.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Πελάτης (προαιρετικό)
          </label>
          <select
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— Χωρίς πελάτη —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
            ))}
          </select>
          {selectedCustomer?.phone && (
            <p className="mt-1 text-xs text-zinc-400">Προς: {selectedCustomer.phone}</p>
          )}
        </div>
      )}

      {/* Template picker */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Πρότυπο</p>
        <div className="grid grid-cols-2 gap-2">
          {SMS_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pickTemplate(t.key)}
              className={`rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                templateKey === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-indigo-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message preview / edit */}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Μήνυμα
        </label>
        <textarea
          ref={textareaRef}
          rows={5}
          value={customText || template.text}
          onChange={(e) => setCustomText(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none resize-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        {customText && (
          <button type="button" onClick={() => setCustomText('')}
            className="mt-1 text-xs text-zinc-400 hover:text-zinc-600">
            Επαναφορά προτύπου
          </button>
        )}
      </div>

      {/* Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold transition ${
          copied
            ? 'bg-green-600 text-white'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
        }`}
      >
        {copied ? (
          <>
            <svg className="h-5 w-5" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            Το SMS αντιγράφηκε.
          </>
        ) : (
          <>
            <svg className="h-5 w-5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            Αντιγραφή SMS
          </>
        )}
      </button>
    </div>
  );
}

// ─── After-call product story card ────────────────────────────────────────────

function AfterCallStoryCard() {
  return (
    <div className="rounded-2xl bg-indigo-50 px-4 py-4 ring-1 ring-indigo-100 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
        Τι γίνεται μετά από κλήση
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-indigo-800">Νέος αριθμός</p>
          {['Δημιουργείται πρόχειρη καρτέλα', 'Ετοιμάζεται SMS για στοιχεία', 'Δημιουργείται brief για review'].map((s) => (
            <p key={s} className="flex items-start gap-1.5 text-xs text-indigo-700">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              {s}
            </p>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-indigo-800">Υπάρχων πελάτης</p>
          {['Η κλήση μπαίνει στο ιστορικό', 'Δημιουργούνται call notes', 'Προτείνεται επόμενη ενέργεια'].map((s) => (
            <p key={s} className="flex items-start gap-1.5 text-xs text-indigo-700">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
              {s}
            </p>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-indigo-500">
        Εξήγηση προϊόντος — όχι υλοποιημένο ακόμα στο MVP.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CallsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>('keypad');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({});
  const [smsPreselect, setSmsPreselect] = useState<Customer | null>(null);

  useEffect(() => {
    const state = loadState();
    const allCalls: CallRecord[] = state.calls ?? [];
    const allCustomers: Customer[] = state.customers ?? [];
    const map = Object.fromEntries(allCustomers.map((c) => [c.id, c.name]));
    const timer = window.setTimeout(() => {
      setCalls(allCalls);
      setCustomers(allCustomers);
      setCustomerMap(map);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function switchToSms(customer?: Customer) {
    if (customer) setSmsPreselect(customer);
    setTab('sms');
  }

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">Κλήσεις</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Κάθε κλήση οργανώνεται σε CRM σημείωση, task ή follow-up αφού την ελέγξεις.
        </p>
      </div>

      {/* ── Business number card ── */}
      <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-100 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100">
              <PhoneIcon className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-700">Ψηφιακός αριθμός</p>
              <p className="text-sm font-medium text-zinc-500">Demo αριθμός</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Demo</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">CRM logging</span>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">AI brief</span>
          </div>
        </div>
        <p className="text-xs text-zinc-400">
          Στο MVP δεν γίνεται πραγματική τηλεφωνική κλήση ή ηχογράφηση.
        </p>
      </div>

      {/* ── Segmented tabs ── */}
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg py-2 text-[11px] font-semibold transition ${
              tab === t.id
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === 'keypad' && (
        <div className="space-y-4">
          <KeypadTab />
          <AfterCallStoryCard />
        </div>
      )}

      {tab === 'recent' && (
        <RecentTab
          calls={calls}
          customerMap={customerMap}
          onSwitchToSms={() => switchToSms()}
        />
      )}

      {tab === 'customers' && (
        <CustomersTab
          customers={customers}
          onSwitchToSms={(c) => switchToSms(c)}
        />
      )}

      {tab === 'sms' && (
        <SmsTab
          preselectedCustomer={smsPreselect}
          customers={customers}
        />
      )}
    </div>
  );
}
