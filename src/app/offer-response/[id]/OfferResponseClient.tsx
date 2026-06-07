'use client';

import { useState, useEffect } from 'react';
import { fmtEur } from '@/lib/offer-calculations';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface ApiOfferItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

interface ApiOffer {
  offerNumber: string;
  status: string;
  offerDate: string;
  validUntil: string | null;
  items: ApiOfferItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptanceText: string | null;
}

interface ApiBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  vatNumber: string | null;
  logoUrl: string | null;
  legalName: string | null;
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  taxOffice: string | null;
  website: string | null;
}

interface ApiCustomer {
  name: string;
  companyName: string | null;
  email: string | null;
  address: string | null;
}

interface ApiPayload {
  ok: true;
  tokenStatus: string;
  offer: ApiOffer;
  business: ApiBusiness | null;
  customer: ApiCustomer | null;
  canRespond: boolean;
}

type ResponseAction =
  | 'idle'
  | 'confirming_accept'
  | 'confirming_reject'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'invalid';

interface Props {
  token: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function computeInitialAction(offer: ApiOffer, canRespond: boolean): ResponseAction {
  if (offer.status === 'accepted') return 'accepted';
  if (offer.status === 'rejected') return 'rejected';
  if (offer.status === 'expired') return 'expired';
  // canRespond false covers past valid_until and other non-interactive states
  if (!canRespond) return 'expired';
  return 'idle';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'accepted':      return 'Αποδεκτή';
    case 'rejected':      return 'Απορρίφθηκε';
    case 'expired':       return 'Έληξε';
    case 'sent_manually': return 'Εστάλη';
    case 'ready_to_send': return 'Έτοιμη';
    default:              return 'Σε αναμονή';
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'accepted': return 'bg-green-100 text-green-700';
    case 'rejected': return 'bg-red-100 text-red-700';
    case 'expired':  return 'bg-zinc-200 text-zinc-600';
    default:         return 'bg-indigo-100 text-indigo-700';
  }
}

// Filter out CRM tracking lines the server appended after a response.
function visibleNotes(notes: string | null): string {
  if (!notes) return '';
  return notes
    .split('\n')
    .filter((l) => !l.startsWith('Απάντηση μέσω δημόσιου link:'))
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OfferResponseClient({ token }: Props) {
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState('');
  const [payload, setPayload]             = useState<ApiPayload | null>(null);
  const [action, setAction]               = useState<ResponseAction>('idle');
  const [rejectComment, setRejectComment] = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [submitError, setSubmitError]     = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const res = await fetch(`/api/offer-response/${encodeURIComponent(token)}`);
        const data = (await res.json()) as { ok: boolean; error?: string } & Partial<ApiPayload>;
        if (cancelled) return;

        if (!res.ok) {
          if (data.error === 'offer_response_link_invalid_or_expired') {
            setAction('invalid');
          } else {
            setLoadError('Δεν ήταν δυνατή η φόρτωση της προσφοράς. Δοκιμάστε ξανά.');
          }
          return;
        }

        if (!data.ok || !data.offer) {
          setLoadError('Δεν ήταν δυνατή η φόρτωση της προσφοράς. Δοκιμάστε ξανά.');
          return;
        }

        const fullPayload = data as ApiPayload;
        setPayload(fullPayload);
        setAction(computeInitialAction(fullPayload.offer, fullPayload.canRespond));
      } catch {
        if (!cancelled) {
          setLoadError('Σφάλμα σύνδεσης. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(response: 'accepted' | 'rejected') {
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const body: { response: string; comment?: string } = { response };
      if (response === 'rejected' && rejectComment.trim()) {
        body.comment = rejectComment.trim();
      }
      const res = await fetch(`/api/offer-response/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };

      if (res.ok && data.ok) {
        setPayload((prev) =>
          prev ? { ...prev, offer: { ...prev.offer, status: response } } : prev
        );
        setAction(response);
      } else if (res.status === 409 && data.error === 'offer_already_final') {
        setSubmitError('Η προσφορά έχει ήδη απαντηθεί.');
      } else if (res.status === 409 && data.error === 'offer_expired') {
        setAction('expired');
      } else {
        setSubmitError('Δεν μπορέσαμε να καταγράψουμε την απάντηση. Δοκιμάστε ξανά.');
      }
    } catch {
      setSubmitError('Δεν μπορέσαμε να καταγράψουμε την απάντηση. Δοκιμάστε ξανά.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // -- Loading ---------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-sm text-zinc-400">Φόρτωση προσφοράς...</p>
      </div>
    );
  }

  // -- Invalid or expired link -----------------------------------------------
  if (action === 'invalid') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100">
          <svg
            className="h-7 w-7 text-zinc-400"
            fill="none"
            strokeWidth={1.5}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-zinc-700">
            Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει.
          </p>
          <p className="mt-1 max-w-xs text-sm text-zinc-400">
            Επικοινωνήστε με την επιχείρηση για νέο σύνδεσμο προσφοράς.
          </p>
        </div>
      </div>
    );
  }

  // -- Load error ------------------------------------------------------------
  if (loadError || !payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-4 text-center">
        <p className="text-base font-medium text-zinc-600">
          {loadError || 'Δεν ήταν δυνατή η φόρτωση της προσφοράς.'}
        </p>
        <button
          type="button"
          onClick={() => { window.location.reload(); }}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Δοκιμάστε ξανά
        </button>
      </div>
    );
  }

  // -- Main offer view -------------------------------------------------------
  const { offer, business, customer, canRespond } = payload;
  const notesVisible = visibleNotes(offer.notes);

  return (
    <div className="min-h-screen bg-zinc-50 py-8">
      <div className="mx-auto max-w-2xl space-y-6 px-4">

        {/* Business header */}
        <div className="space-y-1 text-center">
          {business?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoUrl}
              alt="Logo"
              className="mx-auto mb-2 h-12 w-auto object-contain"
            />
          )}
          {(() => {
            if (!business) {
              // No business identity loaded — hide the header rather than show a
              // placeholder the customer would not trust.
              return null;
            }
            const primaryName = business.legalName || business.name;
            const showTrade =
              business.tradeName &&
              business.tradeName.trim() !== primaryName.trim();
            const addrLine1 = business.addressLine1 || business.address;
            const postalCity = [business.postalCode, business.city]
              .filter(Boolean).join(' ');
            return (
              <>
                <p className="text-lg font-bold text-zinc-900">{primaryName}</p>
                {showTrade && (
                  <p className="text-sm text-zinc-500">{business.tradeName}</p>
                )}
                {business.phone   && <p className="text-sm text-zinc-500">{business.phone}</p>}
                {business.email   && <p className="text-sm text-zinc-500">{business.email}</p>}
                {business.website && <p className="text-sm text-zinc-500">{business.website}</p>}
                {addrLine1        && <p className="text-sm text-zinc-500">{addrLine1}</p>}
                {business.addressLine2 && (
                  <p className="text-sm text-zinc-500">{business.addressLine2}</p>
                )}
                {postalCity       && <p className="text-sm text-zinc-500">{postalCity}</p>}
                {business.region  && <p className="text-sm text-zinc-500">{business.region}</p>}
                {business.vatNumber  && (
                  <p className="text-sm text-zinc-500">ΑΦΜ: {business.vatNumber}</p>
                )}
                {business.taxOffice  && (
                  <p className="text-sm text-zinc-500">ΔΟΥ: {business.taxOffice}</p>
                )}
              </>
            );
          })()}
        </div>

        {/* Offer document */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 space-y-5">

          {/* Offer meta + status badge */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xl font-bold text-zinc-900">ΠΡΟΣΦΟΡΑ {offer.offerNumber}</p>
              <p className="text-sm text-zinc-500">Ημερομηνία: {formatDate(offer.offerDate)}</p>
              {offer.validUntil && (
                <p className="text-sm text-zinc-500">Ισχύει μέχρι: {formatDate(offer.validUntil)}</p>
              )}
            </div>
            <div className="shrink-0">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(offer.status)}`}
              >
                {statusLabel(offer.status)}
              </span>
            </div>
          </div>

          {/* Customer info */}
          {customer && (
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Προς</p>
              <p className="font-semibold text-zinc-800">{customer.name}</p>
              {customer.companyName && <p className="text-sm text-zinc-500">{customer.companyName}</p>}
              {customer.address     && <p className="text-sm text-zinc-500">{customer.address}</p>}
              {customer.email       && <p className="text-sm text-zinc-500">{customer.email}</p>}
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
                {(offer.items ?? []).map((item, idx) => (
                  <tr key={idx} className="border-b border-zinc-100">
                    <td className="py-2 pr-2 text-zinc-800 break-words">{item.description}</td>
                    <td className="py-2 text-right text-zinc-600">{item.quantity}</td>
                    <td className="py-2 text-right text-zinc-600">{fmtEur(item.unitPrice)}</td>
                    <td className="py-2 text-right font-medium text-zinc-800">{fmtEur(item.lineTotal)}</td>
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

          {/* Notes (server CRM tracking lines filtered out) */}
          {notesVisible && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Σημειώσεις
              </p>
              <p className="mt-1 text-sm text-zinc-600 whitespace-pre-wrap">{notesVisible}</p>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Κείμενο αποδοχής
              </p>
              <p className="mt-1 text-sm text-zinc-600">{offer.acceptanceText}</p>
            </div>
          )}
        </div>

        {/* Response section */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Απάντηση στην προσφορά</h2>
            {action === 'idle' && canRespond && (
              <p className="mt-0.5 text-sm text-zinc-500">
                Διαβάστε την προσφορά και επιλέξτε αποδοχή ή απόρριψη.
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

          {/* Accepted */}
          {action === 'accepted' && (
            <div className="rounded-xl bg-green-50 px-4 py-5 ring-1 ring-green-200 space-y-2 text-center">
              <div className="flex justify-center mb-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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

          {/* Rejected */}
          {action === 'rejected' && (
            <div className="rounded-xl bg-red-50 px-4 py-5 ring-1 ring-red-200 space-y-2 text-center">
              <p className="text-base font-bold text-red-700">Η προσφορά απορρίφθηκε</p>
              <p className="text-sm text-red-600">Η επιχείρηση θα δει την απάντησή σας.</p>
              <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
            </div>
          )}

          {/* Idle: accept/reject buttons (only when canRespond) */}
          {action === 'idle' && canRespond && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setAction('confirming_accept')}
                className="flex-1 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Αποδοχή προσφοράς
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setAction('confirming_reject')}
                className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Απόρριψη προσφοράς
              </button>
            </div>
          )}

          {/* Idle: canRespond false but not in expired state (edge case) */}
          {action === 'idle' && !canRespond && (
            <div className="rounded-xl bg-zinc-100 px-4 py-4 text-center">
              <p className="text-sm text-zinc-600">
                Η απάντηση στην προσφορά δεν είναι διαθέσιμη.
              </p>
            </div>
          )}

          {/* Confirming accept */}
          {action === 'confirming_accept' && (
            <div className="rounded-xl bg-green-50 p-4 ring-1 ring-green-200 space-y-3">
              <p className="text-sm font-semibold text-green-800">Επιβεβαίωση αποδοχής</p>
              <p className="text-sm text-green-700">
                Με την αποδοχή επιβεβαιώνετε ότι συμφωνείτε με τους όρους της προσφοράς{' '}
                {offer.offerNumber} ύψους {fmtEur(offer.total)}.
              </p>
              {submitError && <p className="text-xs text-red-600">{submitError}</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => { void handleSubmit('accepted'); }}
                  className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Καταχώρηση...' : 'Ναι, αποδέχομαι την προσφορά'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('idle')}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                  maxLength={1000}
                  placeholder="π.χ. Η τιμή είναι εκτός προϋπολογισμού..."
                  className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              {submitError && <p className="text-xs text-red-600">{submitError}</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => { void handleSubmit('rejected'); }}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Καταχώρηση...' : 'Ναι, απόρριψη προσφοράς'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('idle')}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-xs text-zinc-400">
            Η απάντηση καταγράφεται από την επιχείρηση.
            Δεν αποτελεί αυτοματοποιημένη αποστολή μηνύματος.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-400">opiflow.ai</p>

      </div>
    </div>
  );
}
