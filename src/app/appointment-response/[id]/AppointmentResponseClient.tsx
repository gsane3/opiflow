'use client';

import { useState, useEffect } from 'react';
import { buildAppointmentIcs, downloadIcs } from '@/lib/ics';

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

function parseAppointmentDateTime(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  return new Date(Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]), 0, 0
  ));
}

function formatDateInput(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeInput(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

function buildTimeChangeOption(
  appt: AppointmentData,
  choice: 'earlier' | 'later'
): { requestedDueDate: string; requestedDueTime: string; label: string } | null {
  if (!appt.dueDate || !appt.dueTime) return null;
  const base = parseAppointmentDateTime(appt.dueDate, appt.dueTime);
  if (!base) return null;
  const shifted = new Date(base.getTime() + (choice === 'earlier' ? -1 : 1) * 60 * 60 * 1000);
  const requestedDueDate = formatDateInput(shifted);
  const requestedDueTime = formatTimeInput(shifted);
  const dateLabel = requestedDueDate !== appt.dueDate ? `${requestedDueDate} ` : '';
  return { requestedDueDate, requestedDueTime, label: `${dateLabel}${requestedDueTime}` };
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
  const [timeChangeChoice, setTimeChangeChoice] = useState<'earlier' | 'later' | null>(null);
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
      if (!timeChangeChoice) {
        setSubmitError('Επιλέξτε 1 ώρα νωρίτερα ή 1 ώρα αργότερα.');
        setIsSubmitting(false);
        return;
      }
      const appt = payload?.appointment;
      if (!appt) {
        setSubmitError('Δεν μπορέσαμε να καταγράψουμε την απάντηση. Δοκιμάστε ξανά.');
        setIsSubmitting(false);
        return;
      }
      const option = buildTimeChangeOption(appt, timeChangeChoice);
      if (!option) {
        setSubmitError('Δεν είναι διαθέσιμη αλλαγή ώρας για αυτό το ραντεβού.');
        setIsSubmitting(false);
        return;
      }
      body.requestedDueDate = option.requestedDueDate;
      body.requestedDueTime = option.requestedDueTime;
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
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-[#0e1722]">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Φόρτωση ραντεβού...</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Load error
  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center dark:bg-[#0e1722]">
        <p className="text-base font-medium text-zinc-700 dark:text-zinc-200">{loadError}</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Invalid / expired link
  // -------------------------------------------------------------------------

  if (action === 'invalid' || !payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center dark:bg-[#0e1722]">
        <div className="mx-auto max-w-sm space-y-3">
          <p className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Το link δεν είναι πλέον ενεργό.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Επικοινωνήστε με την επιχείρηση.
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

  function handleAddToCalendar() {
    if (!appointment.dueDate || !appointment.dueTime) return;
    const location = customer?.address || business?.address || undefined;
    const descParts: string[] = [];
    if (business?.name) descParts.push(`Ραντεβού με ${business.name}`);
    if (business?.phone) descParts.push(`Τηλ: ${business.phone}`);
    if (visibleNote) descParts.push(visibleNote);
    const ics = buildAppointmentIcs({
      uid: `${token.slice(0, 16)}@opiflow.ai`,
      title: appointment.title,
      date: appointment.dueDate,
      time: appointment.dueTime,
      description: descParts.join('\n') || undefined,
      location,
    });
    downloadIcs('rantevou.ics', ics);
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-8 dark:bg-[#0e1722]">
      <div className="mx-auto max-w-lg space-y-5 px-4">

        {/* Business header — the customer's first impression */}
        {business && (
          <div className="flex items-center gap-4 rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
            {business.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-14 w-14 flex-shrink-0 rounded-xl object-contain"
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{business.name}</p>
              {business.phone && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{business.phone}</p>
              )}
              {business.email && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{business.email}</p>
              )}
              {business.address && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{business.address}</p>
              )}
            </div>
          </div>
        )}

        {/* Appointment card */}
        <div className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-zinc-200/60 space-y-4 dark:bg-[#17232f] dark:ring-white/10">

          {/* Title and type */}
          <div className="space-y-0.5">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{appointment.title}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{appointmentTypeLabel(appointment.type)}</p>
          </div>

          {/* Details grid */}
          <div className="rounded-xl bg-zinc-50 p-4 space-y-2 dark:bg-[#1e2b38]">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Κατάσταση</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                {appointmentStatusLabel(appointment.status)}
              </span>
            </div>
            {appointment.dueDate && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Ημερομηνία</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatDate(appointment.dueDate)}
                </span>
              </div>
            )}
            {appointment.dueTime && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Ώρα</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatTime(appointment.dueTime)}
                </span>
              </div>
            )}
            {appointment.priority && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Προτεραιότητα</span>
                <span className="text-zinc-600 dark:text-zinc-300">{appointment.priority}</span>
              </div>
            )}
          </div>

          {/* Customer */}
          {customer && (
            <div className="rounded-xl border border-zinc-200/60 p-4 space-y-1 dark:border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Πελάτης
              </p>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {customer.companyName ?? customer.name}
              </p>
              {customer.companyName && customer.name !== customer.companyName && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.name}</p>
              )}
              {customer.email && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.email}</p>
              )}
              {customer.address && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.address}</p>
              )}
            </div>
          )}

          {/* Linked offer */}
          {offer && (
            <div className="rounded-xl border border-zinc-200/60 p-4 space-y-1 dark:border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Σχετική Προσφορά
              </p>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">#{offer.offerNumber}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{offerStatusLabel(offer.status)}</span>
              </div>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {formatCurrency(offer.total)}
              </p>
            </div>
          )}

          {/* Note */}
          {visibleNote && (
            <div className="rounded-xl border border-zinc-200/60 p-4 dark:border-white/10">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Σημείωση
              </p>
              <p className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">{visibleNote}</p>
            </div>
          )}

          {/* Response section */}
          <div className="space-y-3 pt-1">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Απάντησή σας</h2>

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
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                >
                  Αποδέχομαι το ραντεβού
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('confirming_time_change')}
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                >
                  Ζητώ αλλαγή ώρας
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAction('confirming_decline')}
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#17232f] dark:text-zinc-200 dark:hover:bg-white/5"
                >
                  Δεν μπορώ να παρευρεθώ
                </button>
              </div>
            )}

            {/* Idle but canRespond is false */}
            {action === 'idle' && !canRespond && (
              <div className="rounded-xl bg-zinc-50 px-4 py-4 ring-1 ring-zinc-200 text-center dark:bg-[#1e2b38] dark:ring-white/10">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
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
                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Ναι, αποδέχομαι'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="flex h-12 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Confirming decline */}
            {action === 'confirming_decline' && (
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 space-y-3 dark:bg-[#1e2b38] dark:ring-white/10">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Αδυναμία παρουσίας</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Η επιχείρηση θα ενημερωθεί ότι δεν μπορείτε να παρευρεθείτε.
                </p>
                <div className="space-y-1">
                  <label
                    htmlFor="decline-comment"
                    className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
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
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-200 dark:placeholder-zinc-500"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSubmit('declined')}
                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-700 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Ναι, δεν μπορώ'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="flex h-12 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
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
                {appointment.dueDate && appointment.dueTime ? (
                  <>
                    <p className="text-sm text-indigo-700">
                      Επιλέξτε νέα ώρα. Η αλλαγή ισχύει για ±1 ώρα από την προγραμματισμένη ώρα.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {(['earlier', 'later'] as const).map((choice) => {
                        const opt = buildTimeChangeOption(appointment, choice);
                        if (!opt) return null;
                        return (
                          <button
                            key={choice}
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => setTimeChangeChoice(choice)}
                            className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${
                              timeChangeChoice === choice
                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:bg-[#17232f]'
                            }`}
                          >
                            {choice === 'earlier' ? '1 ώρα νωρίτερα' : '1 ώρα αργότερα'}
                            <span className="block text-xs font-normal opacity-80">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-indigo-700">
                    Δεν υπάρχει διαθέσιμη ώρα για αλλαγή.
                  </p>
                )}
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
                    className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-300 focus:border-indigo-400 focus:outline-none disabled:opacity-50 dark:bg-[#0f1923] dark:text-zinc-200 dark:placeholder-zinc-500"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSubmitting || !timeChangeChoice || !appointment.dueDate || !appointment.dueTime}
                    onClick={() => void handleSubmit('time_change_requested')}
                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Αποστολή...' : 'Υποβολή αιτήματος'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setAction('idle')}
                    className="flex h-12 items-center justify-center rounded-xl border border-indigo-200 px-4 text-sm font-medium text-indigo-600 transition hover:bg-indigo-100 disabled:opacity-50"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            )}

            {/* Accepted */}
            {action === 'accepted' && (
              <div className="rounded-xl bg-green-50 px-4 py-5 ring-1 ring-green-200 text-center space-y-3">
                <div className="space-y-1">
                  <p className="text-base font-bold text-green-700">Το ραντεβού επιβεβαιώθηκε.</p>
                  <p className="text-sm text-green-600">
                    Η επιχείρηση ενημερώθηκε και βλέπει την αποδοχή σας.
                  </p>
                </div>
                {appointment.dueDate && appointment.dueTime && (
                  <button
                    type="button"
                    onClick={handleAddToCalendar}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-green-700 ring-1 ring-green-300 transition hover:bg-green-100 dark:bg-[#17232f]"
                  >
                    <svg className="h-4 w-4" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                    </svg>
                    Προσθήκη στο ημερολόγιο
                  </button>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Declined */}
            {action === 'declined' && (
              <div className="rounded-xl bg-amber-50 px-4 py-5 ring-1 ring-amber-200 text-center space-y-1">
                <p className="text-base font-bold text-amber-700">
                  Καταγράψαμε ότι δεν μπορείτε να παρευρεθείτε.
                </p>
                <p className="text-sm text-amber-600">
                  Η επιχείρηση ενημερώθηκε και θα επικοινωνήσει μαζί σας για νέο ραντεβού.
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Time change requested */}
            {action === 'time_change_requested' && (
              <div className="rounded-xl bg-indigo-50 px-4 py-5 ring-1 ring-indigo-200 text-center space-y-1">
                <p className="text-base font-bold text-indigo-700">
                  Το αίτημα αλλαγής ώρας καταγράφηκε.
                </p>
                <p className="text-sm text-indigo-600">
                  Η επιχείρηση ενημερώθηκε και θα επικοινωνήσει μαζί σας.
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Μπορείτε να κλείσετε αυτό το παράθυρο.</p>
              </div>
            )}

            {/* Expired */}
            {action === 'expired' && (
              <div className="rounded-xl bg-zinc-100 px-4 py-5 ring-1 ring-zinc-200 text-center space-y-1 dark:bg-[#1e2b38] dark:ring-white/10">
                <p className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
                  Το link δεν είναι πλέον ενεργό.
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Επικοινωνήστε με την επιχείρηση.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          {action === 'idle' || action === 'confirming_accept' || action === 'confirming_decline' || action === 'confirming_time_change'
            ? 'Δεν στέλνεται τίποτα αυτόματα — η επιχείρηση βλέπει την απάντησή σας.'
            : 'Η απάντησή σας καταγράφηκε από την επιχείρηση.'}
        </p>
      </div>
    </div>
  );
}
