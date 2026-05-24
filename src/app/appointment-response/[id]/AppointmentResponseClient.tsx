'use client';

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResponseAction =
  | 'idle'
  | 'confirming_accept'
  | 'confirming_decline'
  | 'confirming_time_change'
  | 'accepted'
  | 'declined'
  | 'time_change_requested'
  | 'expired'
  | 'invalid';

interface AppointmentData {
  title: string;
  type: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  dueTime: string | null;
  note: string | null;
}

interface BusinessData {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
}

interface CustomerData {
  name: string;
  companyName: string | null;
  email: string | null;
  address: string | null;
}

interface OfferData {
  offerNumber: string;
  status: string;
  total: number;
}

interface ApiPayload {
  ok: true;
  tokenStatus: string;
  appointment: AppointmentData;
  business: BusinessData | null;
  customer: CustomerData | null;
  offer: OfferData | null;
  canRespond: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  return timeStr;
}

function isBeforeToday(dateStr: string): boolean {
  return dateStr < new Date().toISOString().split('T')[0];
}

function appointmentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    open: 'Εκκρεμεί',
    completed: 'Ολοκληρώθηκε',
    cancelled: 'Ακυρώθηκε',
    accepted: 'Αποδεκτό',
    declined: 'Απορρίφθηκε',
    time_change_requested: 'Αίτημα αλλαγής ώρας',
  };
  return map[status] ?? status;
}

function appointmentTypeLabel(type: string): string {
  const map: Record<string, string> = {
    book_appointment: 'Ραντεβού',
    visit_customer: 'Επίσκεψη πελάτη',
  };
  return map[type] ?? type;
}

function offerStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Πρόχειρο',
    sent: 'Εστάλη',
    accepted: 'Αποδεκτή',
    rejected: 'Απορρίφθηκε',
    expired: 'Έληξε',
  };
  return map[status] ?? status;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

function computeInitialAction(data: ApiPayload): ResponseAction {
  const { tokenStatus, appointment, canRespond } = data;
  if (tokenStatus === 'accepted' || appointment.status === 'accepted') return 'accepted';
  if (tokenStatus === 'declined' || appointment.status === 'declined') return 'declined';
  if (tokenStatus === 'time_change_requested') return 'time_change_requested';
  if (!canRespond && appointment.dueDate && isBeforeToday(appointment.dueDate)) return 'expired';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  token: string;
}

export default function AppointmentResponseClient({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [action, setAction] = useState<ResponseAction>('idle');
  const [comment, setComment] = useState('');
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [requestedDueTime, setRequestedDueTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;


    fetch(`/api/appointment-response/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          if (data.error === 'appointment_response_link_invalid_or_expired') {
            setAction('invalid');
          } else {
            setLoadError('Αδυναμία φόρτωσης ραντεβού. Δοκιμάστε ξανά.');
          }
          return;
        }
        setPayload(data as ApiPayload);
        setAction(computeInitialAction(data as ApiPayload));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Αδυναμία φόρτωσης ραντεβού. Δοκιμάστε ξανά.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(
    response: 'accepted' | 'declined' | 'time_change_requested'
  ) {
    setIsSubmitting(true);
    setSubmitError(null);

    const body: Record<string, unknown> = { response };

    if (response === 'declined') {
      const trimmed = comment.trim();
      if (trimmed) body.comment = trimmed;
    }

    if (response === 'time_change_requested') {
      if (requestedDueDate) body.requestedDueDate = requestedDueDate;
      if (requestedDueTime) body.requestedDueTime = requestedDueTime;
      const trimmed = comment.trim();
      if (trimmed) body.comment = trimmed;
    }

    try {
      const res = await fetch(
        `/api/appointment-response/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();

      if (data.ok) {
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                appointment: {
                  ...prev.appointment,
                  status: data.appointment.status,
                  dueDate: data.appointment.dueDate,
                  dueTime: data.appointment.dueTime,
                },
              }
            : prev
        );
        setAction(response);
      } else if (res.status === 409 && data.error === 'appointment_already_final') {
        setSubmitError('Το ραντεβού έχει ήδη απαντηθεί ή ολοκληρωθεί.');
      } else if (res.status === 409 && data.error === 'appointment_expired') {
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

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-400">Φόρτωση ραντεβού...</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Load error
  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
        <p className="text-base font-medium text-zinc-600">{loadError}</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Invalid / expired link
  // -------------------------------------------------------------------------

  if (action === 'invalid' || !payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
        <div className="mx-auto max-w-sm space-y-3">
          <p className="text-base font-semibold text-zinc-700">
            Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει.
          </p>
          <p className="text-sm text-zinc-400">
            Αν πιστεύετε ότι πρόκειται για σφάλμα, επικοινωνήστε με την επιχείρηση.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main content
  // -------------------------------------------------------------------------

  const { appointment, business, customer, offer, canRespond } = payload;

  // Filter out internal tracking lines appended by the API
  const visibleNote = appointment.note
    ? appointment.note
        .split('\n')
        .filter((line) => !line.startsWith('Απάντηση μέσω δημόσιου link:'))
        .join('\n')
        .trim() || null
    : null;

  return (
    <div className="min-h-screen bg-zinc-50 py-8">
      <div className="mx-auto max-w-lg space-y-5 px-4">

        {/* Business header */}
        {business && (
          <div className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
            {business.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-12 w-12 flex-shrink-0 rounded-lg object-contain"
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-semibold text-zinc-900">{business.name}</p>
              {business.phone && (
                <p className="text-sm text-zinc-500">{business.phone}</p>
              )}
              {business.email && (
                <p className="text-sm text-zinc-500">{business.email}</p>
              )}
              {business.address && (
                <p className="text-sm text-zinc-400">{business.address}</p>
              )}
            </div>
          </div>
        )}

        {/* Appointment card */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 space-y-4">

          {/* Title and type */}
          <div className="space-y-0.5">
            <h1 className="text-xl font-bold text-zinc-900">{appointment.title}</h1>
            <p className="text-sm text-zinc-500">{appointmentTypeLabel(appointment.type)}</p>
          </div>

          {/* Details grid */}
          <div className="rounded-xl bg-zinc-50 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-zinc-500">Κατάσταση</span>
              <span className="font-medium text-zinc-700">
                {appointmentStatusLabel(appointment.status)}
              </span>
            </div>
            {appointment.dueDate && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Ημερομηνία</span>
                <span className="font-semibold text-zinc-900">
                  {formatDate(appointment.dueDate)}
                </span>
              </div>
            )}
            {appointment.dueTime && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Ώρα</span>
                <span className="font-semibold text-zinc-900">
                  {formatTime(appointment.dueTime)}
                </span>
              </div>
            )}
            {appointment.priority && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500">Προτεραιότητα</span>
                <span className="text-zinc-600">{appointment.priority}</span>
              </div>
            )}
          </div>

          {/* Customer */}
          {customer && (
            <div className="rounded-xl border border-zinc-100 p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Πελάτης
              </p>
              <p className="text-sm font-medium text-zinc-800">
                {customer.companyName ?? customer.name}
              </p>
              {customer.companyName && customer.name !== customer.companyName && (
                <p className="text-sm text-zinc-500">{customer.name}</p>
              )}
              {customer.email && (
                <p className="text-sm text-zinc-500">{customer.email}</p>
              )}
              {customer.address && (
                <p className="text-sm text-zinc-400">{customer.address}</p>
              )}
            </div>
          )}

          {/* Linked offer */}
          {offer && (
            <div className="rounded-xl border border-zinc-100 p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Σχετική Προσφορά
              </p>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-zinc-700">#{offer.offerNumber}</span>
                <span className="text-zinc-500">{offerStatusLabel(offer.status)}</span>
              </div>
              <p className="text-sm font-semibold text-zinc-800">
                {formatCurrency(offer.total)}
              </p>
            </div>
          )}

          {/* Note */}
          {visibleNote && (
            <div className="rounded-xl border border-zinc-100 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Σημείωση
              </p>
              <p className="whitespace-pre-line text-sm text-zinc-600">{visibleNote}</p>
            </div>
          )}

          {/* Response section */}
          <div className="space-y-3 pt-1">
            <h2 className="text-sm font-semibold text-zinc-800">Απάντησή σας</h2>

            {/* Submit error */}
            {submitError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
                <p className="text-sm text-red-600">{submitError}</p>
              </div>
            )}

            {/* Idle: action buttons (canRespond true) */}
            {action === 'idle' && canRespond && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('confirming_accept')}
                  className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                >
                  Αποδέχομαι το ραντεβού
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('confirming_time_change')}
                  className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                >
                  Ζητώ αλλαγή ώρας
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('confirming_decline')}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                >
                  Δεν μπορώ να παρευρεθώ
                </button>
              </div>
            )}

            {/* Idle but canRespond is false */}
            {action === 'idle' && !canRespond && (
              <div className="rounded-xl bg-zinc-50 px-4 py-4 ring-1 ring-zinc-200 text-center">
                <p className="text-sm text-zinc-500">
                  Δεν είναι διαθέσιμη απάντηση για αυτό το ραντεβού.
                </p>
              </div>
            )}

            {/* Confirming accept */}
            {action === 'confirming_accept' && (
              <div className="rounded-xl bg-green-50 p-4 ring-1 ring-green-200 space-y-3">
                <p className="text-sm font-semibold text-green-800">Επιβεβαίωση αποδοχής</p>
                <p className="text-sm text-green-700">
                  Επιβεβαιώνετε ότι θα παρευρεθείτε
                  {appointment.dueDate ? ` στις ${formatDate(appointment.dueDate)}` : ''}
                  {appointment.dueTime ? ` ώρα ${formatTime(appointment.dueTime)}` : ''}.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSubmit('accepted')}
                    className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Ναι, αποδέχομαι'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Confirming decline */}
            {action === 'confirming_decline' && (
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3">
                <p className="text-sm font-semibold text-zinc-800">Αδυναμία παρουσίας</p>
                <p className="text-sm text-zinc-600">
                  Η επιχείρηση θα ενημερωθεί ότι δεν μπορείτε να παρευρεθείτε.
                </p>
                <div className="space-y-1">
                  <label
                    htmlFor="decline-comment"
                    className="block text-xs font-medium text-zinc-500"
                  >
                    Σχόλιο (προαιρετικό)
                  </label>
                  <textarea
                    id="decline-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="π.χ. έχω ήδη άλλο ραντεβού"
                    disabled={isSubmitting}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSubmit('declined')}
                    className="flex-1 rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Ναι, δεν μπορώ'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Confirming time change */}
            {action === 'confirming_time_change' && (
              <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-200 space-y-3">
                <p className="text-sm font-semibold text-indigo-800">Αίτημα αλλαγής ώρας</p>
                <p className="text-sm text-indigo-700">
                  Συμπληρώστε την ώρα ή ημερομηνία που σας εξυπηρετεί. Όλα τα πεδία είναι προαιρετικά.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="tc-date"
                      className="block text-xs font-medium text-indigo-700"
                    >
                      Νέα προτεινόμενη ημερομηνία (προαιρετικό)
                    </label>
                    <input
                      id="tc-date"
                      type="date"
                      value={requestedDueDate}
                      onChange={(e) => setRequestedDueDate(e.target.value)}
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="tc-time"
                      className="block text-xs font-medium text-indigo-700"
                    >
                      Νέα προτεινόμενη ώρα (προαιρετικό)
                    </label>
                    <input
                      id="tc-time"
                      type="time"
                      value={requestedDueTime}
                      onChange={(e) => setRequestedDueTime(e.target.value)}
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="tc-comment"
                      className="block text-xs font-medium text-indigo-700"
                    >
                      Σχόλιο (προαιρετικό)
                    </label>
                    <textarea
                      id="tc-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder="π.χ. μπορώ μόνο το πρωί"
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSubmit('time_change_requested')}
                    className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Υποβολή αιτήματος'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="rounded-xl border border-indigo-200 px-4 py-2.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-100 disabled:opacity-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Accepted */}
            {action === 'accepted' && (
              <div className="rounded-xl bg-green-50 px-4 py-5 ring-1 ring-green-200 text-center space-y-1">
                <p className="text-base font-bold text-green-700">Το ραντεβού επιβεβαιώθηκε.</p>
                <p className="text-sm text-green-600">
                  Η επιχείρηση θα δει την αποδοχή σας στο σύστημά της.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Declined */}
            {action === 'declined' && (
              <div className="rounded-xl bg-amber-50 px-4 py-5 ring-1 ring-amber-200 text-center space-y-1">
                <p className="text-base font-bold text-amber-700">
                  Καταγράψαμε ότι δεν μπορείτε να παρευρεθείτε.
                </p>
                <p className="text-sm text-amber-600">
                  Η επιχείρηση θα επικοινωνήσει μαζί σας για νέο ραντεβού.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Time change requested */}
            {action === 'time_change_requested' && (
              <div className="rounded-xl bg-indigo-50 px-4 py-5 ring-1 ring-indigo-200 text-center space-y-1">
                <p className="text-base font-bold text-indigo-700">
                  Το αίτημα αλλαγής ώρας καταγράφηκε.
                </p>
                <p className="text-sm text-indigo-600">
                  Η επιχείρηση θα επικοινωνήσει μαζί σας.
                </p>
                <p className="text-xs text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Expired */}
            {action === 'expired' && (
              <div className="rounded-xl bg-zinc-100 px-4 py-5 ring-1 ring-zinc-200 text-center space-y-1">
                <p className="text-base font-semibold text-zinc-600">
                  Το ραντεβού αυτό δεν είναι πλέον ενεργό.
                </p>
                <p className="text-sm text-zinc-500">
                  Η ημερομηνία έχει παρέλθει ή το ραντεβού δεν δέχεται πλέον απαντήσεις.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-xs text-zinc-400">
          Η απάντηση καταγράφεται από την επιχείρηση. Δεν στέλνεται αυτόματα μήνυμα ή πρόσκληση ημερολογίου.
        </p>
      </div>
    </div>
  );
}
