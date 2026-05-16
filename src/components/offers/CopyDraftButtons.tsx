'use client';

import { useState } from 'react';
import type { Offer } from '@/lib/types';
import { fmtEur } from '@/lib/offer-calculations';

function formatDateGR(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Returns true for statuses where the offer has already been dispatched to the customer.
function isSentStatus(status: Offer['status']): boolean {
  return status === 'sent_manually' || status === 'accepted' || status === 'rejected';
}

function buildViberDraft(offer: Offer, customerName?: string): string {
  const surname = customerName ? customerName.split(' ').slice(-1)[0] : null;
  const greeting = surname ? `Καλησπέρα κύριε/κυρία ${surname}` : 'Καλησπέρα';

  if (isSentStatus(offer.status)) {
    // Follow-up after the offer was already sent
    return `${greeting}, ήθελα να επικοινωνήσω μαζί σας σχετικά με την προσφορά μας ${offer.offerNumber} ύψους ${fmtEur(offer.total)}. Εάν έχετε απορίες ή θέλετε να συζητήσουμε περαιτέρω, είμαι στη διάθεσή σας.`;
  }

  // Default: offer is being sent for the first time
  return `${greeting}, σας αποστέλλω την προσφορά μας ${offer.offerNumber} ύψους ${fmtEur(offer.total)}. Παραμένω στη διάθεσή σας για οποιαδήποτε διευκρίνιση ή ερώτηση.`;
}

function buildEmailDraft(offer: Offer, customerName?: string, businessName?: string): string {
  const surname = customerName ? customerName.split(' ').slice(-1)[0] : null;
  const greeting = surname ? `Αγαπητέ/ή κύριε/κυρία ${surname},` : 'Αγαπητέ/ή κύριε/κυρία,';
  const itemLines = offer.items
    .map((item) => `- ${item.description}: ${fmtEur(item.quantity * item.unitPrice)}`)
    .join('\n');
  const from = businessName ? `\nΜε εκτίμηση,\n${businessName}` : '\nΜε εκτίμηση,';
  const subject = `Θέμα: Προσφορά ${offer.offerNumber}${businessName ? ` — ${businessName}` : ''}`;

  if (isSentStatus(offer.status)) {
    // Follow-up email — do not imply the offer is being sent now
    return `${subject}

${greeting}

Επικοινωνώ μαζί σας σε συνέχεια της προσφοράς μας ${offer.offerNumber} (${fmtEur(offer.total)}) που σας αποστείλαμε.

Θα χαρούμε να απαντήσουμε σε οποιαδήποτε ερώτηση ή να συζητήσουμε τους όρους σε βολική για σας ώρα.
${from}`;
  }

  // Default: first dispatch of the offer
  return `${subject}

${greeting}

Σας αποστέλλουμε την προσφορά μας ${offer.offerNumber} με τα παρακάτω στοιχεία:

${itemLines}

Σύνολο (συμπ. ΦΠΑ ${offer.vatRate}%): ${fmtEur(offer.total)}
Ισχύει μέχρι: ${formatDateGR(offer.validUntil)}

Παραμένουμε στη διάθεσή σας για οποιαδήποτε πληροφορία ή διευκρίνιση.
${from}`;
}

type CopyState = 'idle' | 'copied' | 'error';

function CopyButton({
  label,
  text,
  icon,
}: {
  label: string;
  text: string;
  icon: React.ReactNode;
}) {
  const [state, setCopyState] = useState<CopyState>('idle');
  const [errorText, setErrorText] = useState('');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setErrorText(text);
      setCopyState('error');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCopy}
        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
          state === 'copied'
            ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
            : state === 'error'
            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
            : 'bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100'
        }`}
      >
        {icon}
        {state === 'copied' ? '✓ Αντιγράφηκε' : state === 'error' ? 'Σφάλμα αντιγραφής' : label}
      </button>
      {state === 'error' && (
        <div className="mt-2">
          <p className="mb-1 text-xs text-zinc-500">
            Επέλεξε και αντίγραψε χειροκίνητα:
          </p>
          <textarea
            readOnly
            value={errorText}
            rows={5}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 outline-none"
          />
        </div>
      )}
    </div>
  );
}

interface Props {
  offer: Offer;
  customerName?: string;
  businessName?: string;
}

export default function CopyDraftButtons({ offer, customerName, businessName }: Props) {
  const viberText = buildViberDraft(offer, customerName);
  const emailText = buildEmailDraft(offer, customerName, businessName);

  return (
    <div className="space-y-2">
      <CopyButton
        label="Αντιγραφή Viber μηνύματος"
        text={viberText}
        icon={
          <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
          </svg>
        }
      />
      <CopyButton
        label="Αντιγραφή email draft"
        text={emailText}
        icon={
          <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
        }
      />
      <p className="text-xs text-zinc-400">
        Αντιγράφει κείμενο — η εφαρμογή δεν στέλνει μηνύματα.
      </p>
    </div>
  );
}
