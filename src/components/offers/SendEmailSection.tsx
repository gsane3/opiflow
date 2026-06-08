'use client';

import { useState } from 'react';
import type { Offer, OfferStatus } from '@/lib/types';
import { buildEmailSubject, buildEmailBody } from '@/lib/offer-email';

type SendState = 'idle' | 'sending' | 'sent' | 'missing_config' | 'invalid_email' | 'error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls =
  'w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

interface Props {
  offer: Offer;
  customerEmail?: string;
  customerName?: string;
  businessName?: string;
  // Post-send action props
  offerStatus?: OfferStatus;
  onMarkSent?: () => void;
  onCreateFollowUpTask?: () => void;
}

export default function SendEmailSection({
  offer,
  customerEmail,
  customerName,
  businessName,
  offerStatus,
  onMarkSent,
  onCreateFollowUpTask,
}: Props) {
  const [to, setTo] = useState(customerEmail ?? '');
  const [subject, setSubject] = useState(() => buildEmailSubject(offer, businessName));
  const [body, setBody] = useState(() => buildEmailBody(offer, customerName, businessName));
  const [state, setState] = useState<SendState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Track within-session task creation to prevent duplicates
  const [taskCreated, setTaskCreated] = useState(false);

  async function handleSend() {
    if (!EMAIL_RE.test(to.trim())) {
      setState('invalid_email');
      return;
    }
    setState('sending');
    setErrorMsg('');

    try {
      const res = await fetch('/api/email/send-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          text: body.trim(),
          offerId: offer.id,
          offerNumber: offer.offerNumber,
          customerName,
        }),
      });

      const data = (await res.json()) as { ok: boolean; error?: string };

      if (data.ok) {
        setState('sent');
      } else if (data.error === 'missing_email_config') {
        setState('missing_config');
      } else if (data.error === 'invalid_email') {
        setState('invalid_email');
      } else {
        setState('error');
        setErrorMsg(data.error ?? 'Άγνωστο σφάλμα');
      }
    } catch {
      setState('error');
      setErrorMsg('Δεν ήταν δυνατή η επικοινωνία με τον server.');
    }
  }

  if (state === 'missing_config') {
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Αποστολή email
        </p>
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
          Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το draft και να το στείλεις χειροκίνητα.
        </p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-2 text-xs text-zinc-400 hover:text-zinc-600"
        >
          Πίσω
        </button>
      </section>
    );
  }

  if (state === 'sent') {
    const alreadyMarked = offerStatus === 'sent_manually';
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Αποστολή email
        </p>

        <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-200">
          Το email στάλθηκε επιτυχώς.
        </div>

        {/* Post-send actions */}
        {(onMarkSent || onCreateFollowUpTask) && (
          <div className="mt-3 space-y-2">
            {/* Mark as sent */}
            {onMarkSent && (
              alreadyMarked ? (
                <p className="text-xs text-green-700">
                  Η προσφορά σημάνθηκε ως &quot;Στάλθηκε&quot;.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onMarkSent}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Σήμανση ως &quot;Στάλθηκε&quot;
                </button>
              )
            )}

            {/* Follow-up task */}
            {onCreateFollowUpTask && (
              taskCreated ? (
                <p className="text-xs text-zinc-500">
                  Δημιουργήθηκε task follow-up για σε 3 μέρες.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onCreateFollowUpTask();
                    setTaskCreated(true);
                  }}
                  className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                >
                  + Δημιουργία task follow-up (σε 3 μέρες)
                </button>
              )
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-3 text-xs text-zinc-400 hover:text-zinc-600"
        >
          Αποστολή νέου
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Αποστολή email
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Προς</label>
          <input
            type="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              if (state === 'invalid_email') setState('idle');
            }}
            placeholder="email@example.com"
            className={
              inputCls +
              (state === 'invalid_email' ? ' border-red-400 ring-1 ring-red-200' : '')
            }
          />
          {state === 'invalid_email' && (
            <p className="mt-1 text-xs text-red-600">Μη έγκυρη διεύθυνση email.</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Θέμα</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Μήνυμα</label>
          <textarea
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
          />
        </div>

        <p className="text-xs text-zinc-400">
          Η προσφορά δεν επισυνάπτεται ως PDF σε αυτό το MVP. Μπορείς να κάνεις{' '}
          <span className="font-medium text-zinc-500">Αποθήκευση ως PDF</span> και να τη στείλεις
          χειροκίνητα.
        </p>

        <p className="text-xs text-zinc-400">
          Αν η αποστολή email είναι ρυθμισμένη στον server, το κουμπί θα στείλει πραγματικό email στη διεύθυνση παραλήπτη.
        </p>

        {state === 'error' && (
          <p className="text-sm text-red-600">Σφάλμα αποστολής: {errorMsg}</p>
        )}

        <button
          type="button"
          onClick={handleSend}
          disabled={state === 'sending'}
          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {state === 'sending' ? 'Αποστολή...' : 'Αποστολή email'}
        </button>
      </div>
    </section>
  );
}
