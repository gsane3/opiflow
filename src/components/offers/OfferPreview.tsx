'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadState, updateOffer, deleteOffer, addTask } from '@/lib/storage';
import type { Offer, OfferStatus, Task, Customer, BusinessProfile } from '@/lib/types';
import { fmtEur, lineTotal } from '@/lib/offer-calculations';
import OfferStatusBadge, { OFFER_STATUS_LABELS } from './OfferStatusBadge';
import CopyDraftButtons from './CopyDraftButtons';
import SendEmailSection from './SendEmailSection';

const ALL_STATUSES: OfferStatus[] = [
  'draft',
  'ready_to_send',
  'sent_manually',
  'accepted',
  'rejected',
  'expired',
];

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface Props {
  offerId: string;
}

export default function OfferPreview({ offerId }: Props) {
  const router = useRouter();

  // Start with null so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bp, setBp] = useState<BusinessProfile | null>(null);

  // Load localStorage after mount to avoid hydration mismatch.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
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
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [offerId]);

  function handleStatusChange(status: OfferStatus) {
    if (!offer) return;
    const updated = { ...offer, status, updatedAt: new Date().toISOString() };
    updateOffer(updated);
    setOffer(updated);
  }

  function handleMarkSent() {
    if (!offer) return;
    const updated: Offer = {
      ...offer,
      status: 'sent_manually',
      updatedAt: new Date().toISOString(),
    };
    updateOffer(updated);
    setOffer(updated);
  }

  function handleCreateFollowUpTask() {
    if (!offer) return;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      customerId: offer.customerId,
      title: `Follow-up προσφοράς ${offer.offerNumber}`,
      type: 'follow_up_offer',
      status: 'open',
      priority: 'normal',
      dueDate: dueDate.toISOString().split('T')[0],
      note: 'Follow-up μετά την αποστολή της προσφοράς μέσω email.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
  }

  function handleDelete() {
    if (!offer) return;
    if (!window.confirm(`Διαγραφή προσφοράς ${offer.offerNumber};`)) return;
    deleteOffer(offerId);
    router.push('/offers');
  }

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400">Φόρτωση προσφοράς...</p>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-500">Η προσφορά δεν βρέθηκε.</p>
        <button
          type="button"
          onClick={() => router.push('/offers')}
          className="mt-4 text-sm text-indigo-600"
        >
          ← Πίσω στις προσφορές
        </button>
      </div>
    );
  }

  const customerName = customer?.name;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 space-y-5">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => router.push('/offers')}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← Προσφορές
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
          </svg>
          Αποθήκευση ως PDF
        </button>
      </div>

      {/* Page title */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <h1 className="text-base font-semibold text-zinc-700">Προεπισκόπηση προσφοράς</h1>
        {offer.isDemo && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
        )}
      </div>

      {/* PDF-style document */}
      <div className="offer-print-document rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 space-y-5">

        {/* Header row: business + offer meta */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            {bp?.logoDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bp.logoDataUrl} alt="Logo" className="mb-2 h-12 w-auto object-contain" />
            )}
            <p className="text-base font-bold text-zinc-900">{bp?.businessName ?? 'Επωνυμία επιχείρησης'}</p>
            {bp?.ownerName && <p className="text-sm text-zinc-500">{bp.ownerName}</p>}
            {bp?.phone && <p className="text-sm text-zinc-500">{bp.phone}</p>}
            {bp?.email && <p className="text-sm text-zinc-500">{bp.email}</p>}
            {bp?.address && <p className="text-sm text-zinc-500">{bp.address}</p>}
            {bp?.vatNumber && <p className="text-sm text-zinc-500">ΑΦΜ: {bp.vatNumber}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-bold text-zinc-900">ΠΡΟΣΦΟΡΑ {offer.offerNumber}</p>
            <p className="mt-1 text-sm text-zinc-500">Ημερομηνία: {formatDate(offer.offerDate)}</p>
            <p className="text-sm text-zinc-500">Ισχύει μέχρι: {formatDate(offer.validUntil)}</p>
            <div className="mt-2">
              <OfferStatusBadge status={offer.status} />
            </div>
          </div>
        </div>

        {/* Customer info */}
        {customer && (
          <div className="rounded-xl bg-zinc-50 p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Πελάτης</p>
            <p className="font-semibold text-zinc-800">{customer.name}</p>
            {customer.companyName && <p className="text-sm text-zinc-500">{customer.companyName}</p>}
            {customer.phone && <p className="text-sm text-zinc-500">{customer.phone}</p>}
            {customer.email && <p className="text-sm text-zinc-500">{customer.email}</p>}
            {customer.address && <p className="text-sm text-zinc-500">{customer.address}</p>}
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
                  <td className="py-2 pr-2 text-zinc-800 break-words">
                    {item.description}
                  </td>
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

        {/* Notes */}
        {offer.notes && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Σημειώσεις</p>
            <p className="mt-1 text-sm text-zinc-600 whitespace-pre-wrap">{offer.notes}</p>
          </div>
        )}

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

      {/* Status management */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Αλλαγή status
        </p>
        <select
          value={offer.status}
          onChange={(e) => handleStatusChange(e.target.value as OfferStatus)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{OFFER_STATUS_LABELS[s]}</option>
          ))}
        </select>
        {offer.status === 'sent_manually' && (
          <p className="mt-2 text-xs text-zinc-400">
            Η προσφορά στάλθηκε χειροκίνητα εκτός της εφαρμογής. Η εφαρμογή δεν πραγματοποίησε αποστολή.
          </p>
        )}
      </section>

      {/* Send email */}
      <SendEmailSection
        offer={offer}
        customerEmail={customer?.email || undefined}
        customerName={customerName}
        businessName={bp?.businessName}
        offerStatus={offer.status}
        onMarkSent={handleMarkSent}
        onCreateFollowUpTask={handleCreateFollowUpTask}
      />

      {/* Copy drafts */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Drafts επικοινωνίας
        </p>
        <CopyDraftButtons
          offer={offer}
          customerName={customerName}
          businessName={bp?.businessName}
        />
      </section>

      {/* Delete */}
      <section className="rounded-2xl border border-red-100 bg-red-50 p-4 print:hidden">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400">
          Ζώνη κινδύνου
        </h2>
        <p className="mb-3 text-xs text-zinc-500">Η διαγραφή αφαιρεί μόνο τοπικά δεδομένα.</p>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
        >
          Διαγραφή προσφοράς
        </button>
      </section>
    </div>
  );
}
