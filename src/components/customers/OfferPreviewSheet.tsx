'use client';

// Offer preview slide-over (feedback v3 · item 2). Opened by tapping an offer
// row in the customer Info panel. Shows the offer EXACTLY as a customer-facing
// document — number, status, dates, line items, totals, notes/terms — so the
// operator can see "what I sent" and the current κατάσταση. A secondary action
// re-opens the review-and-send flow (the same Viber→SMS message), and a compact
// status control lets the operator mark accepted / rejected / sent.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Badge, type BadgeTone, Spinner, Button } from '@/components/ui';
import { SendViaViberModal, executeViberSend } from './SendViaViberModal';
import { useOverlayDismiss } from './useOverlayDismiss';

interface OfferItem { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }
interface OfferFull {
  id: string; offerNumber: string | null; status: string;
  offerDate: string | null; validUntil: string | null;
  items: OfferItem[]; subtotal: number; vatRate: number; vatAmount: number; total: number;
  notes: string | null; terms: string | null; acceptanceText: string | null;
}

const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Πρόχειρη', ready_to_send: 'Έτοιμη', sent_manually: 'Στάλθηκε',
  accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε',
};
const OFFER_STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'zinc', ready_to_send: 'indigo', sent_manually: 'indigo',
  accepted: 'green', rejected: 'red', expired: 'amber',
};
// Statuses the operator can set by hand from the preview.
const SETTABLE: Array<{ value: string; label: string }> = [
  { value: 'sent_manually', label: 'Στάλθηκε' },
  { value: 'accepted', label: 'Αποδεκτή' },
  { value: 'rejected', label: 'Απορρίφθηκε' },
];

function eur(n: number): string {
  return `€${(n ?? 0).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

interface SendReview {
  loading: boolean; message: string | null; recipient: string | null; responseUrl: string | null;
  sending: boolean; sent: boolean; error: string | null; copied: boolean;
}

export default function OfferPreviewSheet({
  offerId, open, onClose, onChanged,
}: {
  offerId: string | null; open: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const [offer, setOffer] = useState<OfferFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [review, setReview] = useState<SendReview | null>(null);

  const load = useCallback(async () => {
    if (!offerId) return;
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/offers/${offerId}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.offer) setOffer(json.offer as OfferFull);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [offerId]);

  useEffect(() => { if (open && offerId) { setOffer(null); setReview(null); void load(); } }, [open, offerId, load]);

  async function changeStatus(status: string) {
    if (!offerId || !offer || status === offer.status) return;
    setSavingStatus(true);
    try {
      const headers = await authHeaders(); if (!headers) return;
      const res = await fetch(`/api/offers/${offerId}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.offer) { setOffer(json.offer as OfferFull); onChanged?.(); }
    } catch { /* non-fatal */ } finally { setSavingStatus(false); }
  }

  // Open the review-and-send flow: fetch the draft message, then show the modal.
  async function openSend() {
    if (!offerId) return;
    setReview({ loading: true, message: null, recipient: null, responseUrl: null, sending: false, sent: false, error: null, copied: false });
    const headers = await authHeaders();
    if (!headers) { setReview({ loading: false, message: null, recipient: null, responseUrl: null, sending: false, sent: false, error: 'Συνδέσου ξανά.', copied: false }); return; }
    try {
      const res = await fetch(`/api/offers/${offerId}/notify`, { method: 'POST', headers, body: JSON.stringify({ mode: 'draft' }) });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; recipient?: string | null; responseUrl?: string };
      if (json?.ok && json.message && json.responseUrl) {
        setReview({ loading: false, message: json.message, recipient: json.recipient ?? null, responseUrl: json.responseUrl, sending: false, sent: false, error: null, copied: false });
      } else {
        setReview((p) => p ? { ...p, loading: false, error: 'Δεν δημιουργήθηκε μήνυμα. Δοκίμασε ξανά.' } : p);
      }
    } catch {
      setReview((p) => p ? { ...p, loading: false, error: 'Δεν δημιουργήθηκε μήνυμα. Δοκίμασε ξανά.' } : p);
    }
  }

  function patchReview(patch: Partial<SendReview>) { setReview((p) => p ? { ...p, ...patch } : p); }

  async function send() {
    if (!offerId || !review?.responseUrl) return;
    await executeViberSend({
      endpoint: `/api/offers/${offerId}/notify`,
      body: { responseUrl: review.responseUrl },
      update: (p) => patchReview(p),
      providerUnavailableMsg: 'Ο πάροχος αποστολής δεν είναι ρυθμισμένος ακόμα.',
      defaultFallbackMsg: 'Δεν στάλθηκε. Δοκίμασε ξανά.',
    });
    onChanged?.();
    void load();
  }

  function copy() {
    if (!review?.message) return;
    void navigator.clipboard?.writeText(review.message).then(() => { patchReview({ copied: true }); setTimeout(() => patchReview({ copied: false }), 2000); });
  }

  useOverlayDismiss(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[#F5F5F7] shadow-2xl motion-safe:animate-[slideInRight_0.28s_cubic-bezier(0.32,0.72,0,1)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Πίσω" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition active:scale-95 hover:bg-zinc-100">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <p className="flex-1 truncate text-base font-semibold text-zinc-900">{offer?.offerNumber ?? 'Προσφορά'}</p>
          {offer && <Badge tone={OFFER_STATUS_TONE[offer.status] ?? 'zinc'}>{OFFER_STATUS_GR[offer.status] ?? offer.status}</Badge>}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500"><Spinner size="md" className="text-indigo-500" /><span>Φόρτωση…</span></div>
          ) : !offer ? (
            <p className="py-16 text-center text-sm text-zinc-500">Η προσφορά δεν βρέθηκε.</p>
          ) : (
            <>
              {/* Document */}
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-zinc-900">ΠΡΟΣΦΟΡΑ</p>
                    <p className="text-sm font-medium text-zinc-500">{offer.offerNumber}</p>
                  </div>
                  <div className="text-right text-xs text-zinc-500">
                    <p>Ημ/νία: {formatDateGr(offer.offerDate)}</p>
                    {offer.validUntil && <p>Ισχύει: {formatDateGr(offer.validUntil)}</p>}
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-zinc-100">
                  <table className="w-full table-fixed text-sm">
                    <colgroup><col className="w-1/2" /><col className="w-[14%]" /><col className="w-[18%]" /><col className="w-[18%]" /></colgroup>
                    <thead><tr className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-400">
                      <th className="px-2.5 py-2 text-left font-medium">Περιγραφή</th>
                      <th className="px-1 py-2 text-right font-medium">Ποσ.</th>
                      <th className="px-1 py-2 text-right font-medium">Τιμή</th>
                      <th className="px-2.5 py-2 text-right font-medium">Σύνολο</th>
                    </tr></thead>
                    <tbody>
                      {offer.items.map((it) => (
                        <tr key={it.id} className="border-t border-zinc-100 align-top">
                          <td className="px-2.5 py-2 text-zinc-800 break-words">{it.description}</td>
                          <td className="px-1 py-2 text-right tabular-nums text-zinc-600">{it.quantity}</td>
                          <td className="px-1 py-2 text-right tabular-nums text-zinc-600">{eur(it.unitPrice)}</td>
                          <td className="px-2.5 py-2 text-right font-medium tabular-nums text-zinc-800">{eur(it.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 ml-auto w-full max-w-[16rem] space-y-1 text-sm">
                  <div className="flex justify-between text-zinc-500"><span>Καθαρή αξία</span><span className="tabular-nums">{eur(offer.subtotal)}</span></div>
                  <div className="flex justify-between text-zinc-500"><span>ΦΠΑ {offer.vatRate}%</span><span className="tabular-nums">{eur(offer.vatAmount)}</span></div>
                  <div className="flex justify-between border-t border-zinc-200 pt-1.5 text-base font-bold text-zinc-900"><span>Σύνολο</span><span className="tabular-nums">{eur(offer.total)}</span></div>
                </div>

                {offer.notes && (<div className="mt-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Σημειώσεις</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{offer.notes}</p></div>)}
                {offer.terms && (<div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Όροι</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{offer.terms}</p></div>)}
              </div>

              {/* Status control */}
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Κατάσταση</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SETTABLE.map((s) => {
                    const active = offer.status === s.value;
                    return (
                      <button key={s.value} type="button" disabled={savingStatus || active} onClick={() => changeStatus(s.value)}
                        className={`rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition active:scale-95 disabled:opacity-60 ${active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'}`}>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* See / resend the message */}
              <Button variant="secondary" fullWidth size="md" onClick={openSend}>
                <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 4.82A1 1 0 0 1 4.6 3.5l15.5 7.6a1 1 0 0 1 0 1.8L4.6 20.5a1 1 0 0 1-1.33-1.32L6 12Zm0 0h7" /></svg>
                Δες / στείλε ξανά μήνυμα
              </Button>
            </>
          )}
        </div>
      </div>

      {review && (
        <SendViaViberModal
          title="Αποστολή προσφοράς"
          subtitle="Έλεγξε το μήνυμα. Δεν στέλνεται τίποτα πριν πατήσεις αποστολή."
          loadingText="Ετοιμάζεται το μήνυμα…"
          successText="Το μήνυμα στάλθηκε."
          loading={review.loading}
          message={review.message}
          recipient={review.recipient}
          responseUrl={review.responseUrl}
          sending={review.sending}
          sent={review.sent}
          error={review.error}
          copied={review.copied}
          onClose={() => setReview(null)}
          onSend={send}
          onCopy={copy}
        />
      )}
    </div>
  );
}
