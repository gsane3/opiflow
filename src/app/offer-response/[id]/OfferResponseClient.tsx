'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadState, updateOffer, addCommunicationRecord } from '@/lib/storage';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import { fmtEur, lineTotal } from '@/lib/offer-calculations';
import type { Offer, Customer, BusinessProfile } from '@/lib/types';

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTimestamp(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ResponseAction =
  | 'idle'
  | 'confirming_accept'
  | 'confirming_reject'
  | 'accepted'
  | 'rejected'
  | 'expired';

interface Props {
  offerId: string;
}

export default function OfferResponseClient({ offerId }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bp, setBp] = useState<BusinessProfile | null>(null);
  const [action, setAction] = useState<ResponseAction>('idle');
  const [rejectComment, setRejectComment] = useState('');

  useEffect(() => {
    const state = loadState();
    const foundOffer = (state.offers ?? []).find((o) => o.id === offerId) ?? null;
    const foundCustomer = foundOffer?.customerId
      ? (state.customers ?? []).find((c) => c.id === foundOffer.customerId) ?? null
      : null;
    const foundBp = state.businessProfile ?? null;
    const timer = window.setTimeout(() => {
      setOffer(foundOffer);
      setCustomer(foundCustomer);
      setBp(foundBp);
      if (foundOffer?.status === 'accepted') setAction('accepted');
      else if (foundOffer?.status === 'rejected') setAction('rejected');
      else if (foundOffer?.status === 'expired') setAction('expired');
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [offerId]);

  function handleConfirmAccept() {
    if (!offer) return;
    // Step 136: re-read current state — prevent acting on stale offer
    const currentState = loadState();
    const currentOffer = (currentState.offers ?? []).find((o) => o.id === offer.id);
    if (currentOffer && ['accepted', 'rejected', 'expired'].includes(currentOffer.status)) {
      setOffer(currentOffer);
      setAction(currentOffer.status === 'accepted' ? 'accepted' : currentOffer.status === 'rejected' ? 'rejected' : 'expired');
      return;
    }
    const now = new Date().toISOString();
    const dateLabel = formatTimestamp(now);
    // Step 124: timestamped note
    const note = `Απάντηση μέσω demo link: Αποδοχή στις ${dateLabel}.`;
    const updated: Offer = {
      ...offer,
      status: 'accepted',
      notes: offer.notes ? `${offer.notes}\n${note}` : note,
      updatedAt: now,
    };
    updateOffer(updated);
    // Step 135: guard against duplicate comm records
    const alreadyLogged = (currentState.communications ?? []).some(
      (c) => c.isMock && c.summary?.includes(offer.offerNumber) && c.summary?.includes('μέσω demo link')
    );
    if (!alreadyLogged) {
      addCommunicationRecord({
        id: crypto.randomUUID(),
        customerId: offer.customerId,
        channel: 'sms',
        direction: 'inbound',
        status: 'completed',
        summary: `Ο πελάτης αποδέχτηκε την προσφορά ${offer.offerNumber} μέσω demo link.`,
        createdAt: now,
        isMock: true,
      });
    }
    setOffer(updated);
    setAction('accepted');
  }

  function handleConfirmReject() {
    if (!offer) return;
    // Step 136: re-read current state — prevent acting on stale offer
    const currentState = loadState();
    const currentOffer = (currentState.offers ?? []).find((o) => o.id === offer.id);
    if (currentOffer && ['accepted', 'rejected', 'expired'].includes(currentOffer.status)) {
      setOffer(currentOffer);
      setAction(currentOffer.status === 'accepted' ? 'accepted' : currentOffer.status === 'rejected' ? 'rejected' : 'expired');
      return;
    }
    const now = new Date().toISOString();
    const dateLabel = formatTimestamp(now);
    // Step 124: timestamped note
    let note = `Απάντηση μέσω demo link: Απόρριψη στις ${dateLabel}.`;
    if (rejectComment.trim()) note += ` Σχόλιο: ${rejectComment.trim()}`;
    const updated: Offer = {
      ...offer,
      status: 'rejected',
      notes: offer.notes ? `${offer.notes}\n${note}` : note,
      updatedAt: now,
    };
    updateOffer(updated);
    // Step 135: guard against duplicate comm records
    const alreadyLogged = (currentState.communications ?? []).some(
      (c) => c.isMock && c.summary?.includes(offer.offerNumber) && c.summary?.includes('μέσω demo link')
    );
    if (!alreadyLogged) {
      addCommunicationRecord({
        id: crypto.randomUUID(),
        customerId: offer.customerId,
        channel: 'sms',
        direction: 'inbound',
        status: 'completed',
        summary: `Ο πελάτης απέρριψε την προσφορά ${offer.offerNumber} μέσω demo link.${rejectComment.trim() ? ` Σχόλιο: ${rejectComment.trim()}` : ''}`,
        createdAt: now,
        isMock: true,
      });
    }
    setOffer(updated);
    setAction('rejected');
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-sm text-zinc-400">Φόρτωση προσφοράς...</p>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-4 text-center">
        <p className="text-base font-medium text-zinc-600">Η προσφορά δεν βρέθηκε.</p>
        <p className="max-w-xs text-sm text-zinc-400">
          Βεβαιωθείτε ότι ανοίγετε τον σύνδεσμο στον ίδιο browser στον οποίο
          δημιουργήθηκε η προσφορά. Τα δεδομένα αποθηκεύονται τοπικά ανά browser.
        </p>
        <Link href="/offers" className="text-sm text-indigo-600 hover:text-indigo-700">
          ← Πίσω στις προσφορές
        </Link>
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-xs text-amber-700">
            Demo μόνο. Στο MVP τα δεδομένα αποθηκεύονται μόνο σε αυτόν τον browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-8">
      <div className="mx-auto max-w-2xl space-y-6 px-4">

        {/* Step 168: Demo mission banner */}
        <DemoStepBanner
          step="response"
          stepNum={6}
          title="Απάντηση σαν πελάτης"
          body="Αυτό βλέπει ο πελάτης. Πάτα 'Αποδοχή προσφοράς' και επιβεβαίωσε. Μετά γύρνα στο CRM για followup."
          watchLabel="Δεν γίνεται πραγματική αποστολή -- αποθηκεύεται τοπικά μόνο."
          actionLabel="Επόμενο: Follow-up στο CRM"
          actionHref={`/offers/${offerId}?demoStep=followup`}
        />
        {/* Step 127: Demo/signature disclaimer — visible on screen and in print */}
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 ring-1 ring-amber-200 text-center">
          <p className="text-xs font-medium text-amber-700">
            Demo μόνο · Τοπική αποθήκευση · Δεν αποτελεί νομική ηλεκτρονική υπογραφή
          </p>
        </div>

        {/* Business header */}
        <div className="space-y-1 text-center">
          {bp?.logoDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={bp.logoDataUrl}
              alt="Logo"
              className="mx-auto mb-2 h-12 w-auto object-contain"
            />
          )}
          <p className="text-lg font-bold text-zinc-900">
            {bp?.businessName || 'Επωνυμία επιχείρησης'}
          </p>
          {bp?.phone && <p className="text-sm text-zinc-500">{bp.phone}</p>}
          {bp?.email && <p className="text-sm text-zinc-500">{bp.email}</p>}
        </div>

        {/* Offer document */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 space-y-5">

          {/* Offer meta + status */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xl font-bold text-zinc-900">ΠΡΟΣΦΟΡΑ {offer.offerNumber}</p>
              <p className="text-sm text-zinc-500">Ημερομηνία: {formatDate(offer.offerDate)}</p>
              <p className="text-sm text-zinc-500">Ισχύει μέχρι: {formatDate(offer.validUntil)}</p>
            </div>
            <div className="shrink-0">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  offer.status === 'accepted'
                    ? 'bg-green-100 text-green-700'
                    : offer.status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : offer.status === 'expired'
                    ? 'bg-zinc-200 text-zinc-600'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                {offer.status === 'accepted'
                  ? '✓ Αποδεκτή'
                  : offer.status === 'rejected'
                  ? '✕ Απορρίφθηκε'
                  : offer.status === 'expired'
                  ? 'Έληξε'
                  : 'Σε αναμονή απάντησης'}
              </span>
            </div>
          </div>

          {/* Customer info */}
          {customer && (
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Προς</p>
              <p className="font-semibold text-zinc-800">{customer.name}</p>
              {customer.companyName && <p className="text-sm text-zinc-500">{customer.companyName}</p>}
              {customer.address && <p className="text-sm text-zinc-500">{customer.address}</p>}
              {customer.email && <p className="text-sm text-zinc-500">{customer.email}</p>}
            </div>
          )}

          {/* Line items */}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-1/2" />
                <col className="w-[10%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 text-left font-medium">Περιγραφή</th>
                  <th className="pb-2 text-right font-medium">Ποσ.</th>
                  <th className="pb-2 text-right font-medium">Τιμή</th>
                  <th className="pb-2 text-right font-medium">Σύνολο</th>
                </tr>
              </thead>
              <tbody>
                {offer.items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-2 text-zinc-800 break-words">{item.description}</td>
                    <td className="py-2 text-right text-zinc-600">{item.quantity}</td>
                    <td className="py-2 text-right text-zinc-600">{fmtEur(item.unitPrice)}</td>
                    <td className="py-2 text-right font-medium text-zinc-800">{fmtEur(lineTotal(item))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-[16rem] space-y-1 text-sm">
              <div className="flex justify-between text-zinc-500">
                <span>Καθαρή αξία</span>
                <span>{fmtEur(offer.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>ΦΠΑ {offer.vatRate}%</span>
                <span>{fmtEur(offer.vatAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-1.5 font-bold text-zinc-900">
                <span>ΣΥΝΟΛΟ</span>
                <span>{fmtEur(offer.total)}</span>
              </div>
            </div>
          </div>

          {/* Notes — filter out CRM response-tracking lines before showing to customer */}
          {(() => {
            const visible = (offer.notes ?? '')
              .split('\n')
              .filter(
                (l) =>
                  !l.startsWith('Απάντηση μέσω demo link:') &&
                  !l.startsWith('Αποδοχή demo') &&
                  !l.startsWith('Απόρριψη demo')
              )
              .join('\n')
              .trim();
            return visible ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Σημειώσεις
                </p>
                <p className="mt-1 text-sm text-zinc-600 whitespace-pre-wrap">{visible}</p>
              </div>
            ) : null;
          })()}

          {/* Terms */}
          {offer.terms && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Όροι</p>
              <p className="mt-1 text-sm text-zinc-600 whitespace-pre-wrap">{offer.terms}</p>
            </div>
          )}

          {/* Acceptance text */}
          {offer.acceptanceText && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Κείμενο αποδοχής</p>
              <p className="mt-1 text-sm text-zinc-600">{offer.acceptanceText}</p>
            </div>
          )}
        </div>

        {/* Step 126: Response section with intro */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Απάντηση στην προσφορά</h2>
            {action === 'idle' && (
              <p className="mt-0.5 text-sm text-zinc-500">
                Δείτε την προσφορά και επιλέξτε αποδοχή ή απόρριψη.
              </p>
            )}
          </div>

          {/* Expired */}
          {action === 'expired' && (
            <div className="rounded-xl bg-zinc-100 px-4 py-4 text-center">
              <p className="text-sm font-semibold text-zinc-600">Η προσφορά έχει λήξει.</p>
              <p className="mt-1 text-xs text-zinc-400">
                Επικοινωνήστε με την επιχείρηση για ενημερωμένη προσφορά.
              </p>
            </div>
          )}

          {/* Step 168: Followup CTA shown after accept/reject when in demo mission */}
          {(action === 'accepted' || action === 'rejected') && (
            <DemoStepBanner
              step="response"
              stepNum={6}
              title="Τέλεια! Η απάντηση αποθηκεύτηκε."
              body="Γύρνα τώρα στο CRM offer για να δεις το status και να δημιουργήσεις follow-up task."
              watchLabel="Mission 7: follow-up task μετά αποδοχή."
              actionLabel="CRM offer + followup"
              actionHref={`/offers/${offerId}?demoStep=followup`}
            />
          )}
          {/* Step 134: Accepted success — clear next-step messaging */}
          {action === 'accepted' && (
            <div className="rounded-xl bg-green-50 px-4 py-5 ring-1 ring-green-200 space-y-2 text-center">
              <div className="flex justify-center mb-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-5 w-5 text-green-600" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </span>
              </div>
              <p className="text-base font-bold text-green-700">Η προσφορά αποδέχτηκε</p>
              <p className="text-sm text-green-600">
                Η επιχείρηση θα επικοινωνήσει μαζί σας για το επόμενο βήμα.
              </p>
              <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
            </div>
          )}

          {/* Step 134: Rejected success — clear CRM note messaging */}
          {action === 'rejected' && (
            <div className="rounded-xl bg-red-50 px-4 py-5 ring-1 ring-red-200 space-y-2 text-center">
              <p className="text-base font-bold text-red-700">Η προσφορά απορρίφθηκε</p>
              <p className="text-sm text-red-600">
                Η επιχείρηση θα δει την απάντησή σας στο demo CRM.
              </p>
              <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
            </div>
          )}

          {/* Idle — action buttons */}
          {action === 'idle' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setAction('confirming_accept')}
                className="flex-1 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700"
              >
                Αποδοχή προσφοράς
              </button>
              <button
                type="button"
                onClick={() => setAction('confirming_reject')}
                className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                Απόρριψη προσφοράς
              </button>
            </div>
          )}

          {/* Confirming accept */}
          {action === 'confirming_accept' && (
            <div className="rounded-xl bg-green-50 p-4 ring-1 ring-green-200 space-y-3">
              <p className="text-sm font-semibold text-green-800">Επιβεβαίωση αποδοχής</p>
              <p className="text-sm text-green-700">
                Με την αποδοχή επιβεβαιώνετε ότι συμφωνείτε με τους όρους
                της προσφοράς {offer.offerNumber} ύψους {fmtEur(offer.total)}.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleConfirmAccept}
                  className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  Ναι, αποδέχομαι την προσφορά
                </button>
                <button
                  type="button"
                  onClick={() => setAction('idle')}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          )}

          {/* Confirming reject */}
          {action === 'confirming_reject' && (
            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
              <p className="text-sm font-semibold text-zinc-800">Επιβεβαίωση απόρριψης</p>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Σχόλιο προς την επιχείρηση{' '}
                  <span className="font-normal text-zinc-400">(προαιρετικό)</span>
                </label>
                <textarea
                  rows={2}
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="π.χ. Η τιμή είναι εκτός προϋπολογισμού..."
                  className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleConfirmReject}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Ναι, απόρριψη προσφοράς
                </button>
                <button
                  type="button"
                  onClick={() => setAction('idle')}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          )}

          {/* Step 127: E-signature disclaimer — always visible including in print */}
          <p className="text-xs text-zinc-400">
            Demo μόνο. Στο MVP η απάντηση αποθηκεύεται μόνο σε αυτόν τον browser.
            Δεν γίνεται νόμιμη ηλεκτρονική υπογραφή ούτε επαλήθευση ταυτότητας.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-400">
          yorgos.ai MVP · Τοπική αποθήκευση μόνο
        </p>
      </div>
    </div>
  );
}
