'use client';

// Appointment preview slide-over (feedback v3 · item 4). Opened by tapping an
// appointment row in the customer Info panel. A clean, calendar-style interface:
// a date tile (day · weekday · month), the time, a status pill, the title/reason
// and note. The primary action re-sends the confirmation link to the customer
// (Viber with SMS fallback) via the existing appointment-link review flow.

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { Badge, type BadgeTone, Button } from '@/components/ui';
import { SendViaViberModal, executeViberSend } from './SendViaViberModal';
import { useOverlayDismiss } from './useOverlayDismiss';

export interface ApptLite {
  id: string; type: string; status: string;
  dueDate: string | null; dueTime: string | null; title: string | null; note: string | null;
}

const STATUS_GR: Record<string, string> = { open: 'Ανοιχτό', completed: 'Ολοκληρώθηκε', cancelled: 'Ακυρώθηκε', ai_draft: 'Πρόχειρο' };
const STATUS_TONE: Record<string, BadgeTone> = { open: 'indigo', completed: 'green', cancelled: 'zinc', ai_draft: 'amber' };

// Parse a YYYY-MM-DD (or ISO) into display parts, locale el-GR.
function dateParts(iso: string | null): { day: string; weekday: string; month: string; year: string } | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return null;
  return {
    day: String(d.getDate()).padStart(2, '0'),
    weekday: d.toLocaleDateString('el-GR', { weekday: 'long' }),
    month: d.toLocaleDateString('el-GR', { month: 'long' }),
    year: String(d.getFullYear()),
  };
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
  warning: string | null; sending: boolean; sent: boolean; error: string | null; copied: boolean;
}

export default function AppointmentPreviewSheet({
  appt, customerId, open, onClose,
}: {
  appt: ApptLite | null; customerId: string; open: boolean; onClose: () => void;
}) {
  const [review, setReview] = useState<SendReview | null>(null);
  const parts = appt ? dateParts(appt.dueDate) : null;

  async function openSend() {
    if (!appt) return;
    setReview({ loading: true, message: null, recipient: null, responseUrl: null, warning: null, sending: false, sent: false, error: null, copied: false });
    const headers = await authHeaders();
    if (!headers) { setReview({ loading: false, message: null, recipient: null, responseUrl: null, warning: null, sending: false, sent: false, error: 'Συνδέσου ξανά.', copied: false }); return; }
    try {
      const res = await fetch(`/api/customers/${customerId}/appointment-link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'draft', taskId: appt.id }) });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; recipient?: string | null; responseUrl?: string; warning?: string | null };
      if (json?.ok && json.message && json.responseUrl) {
        setReview({ loading: false, message: json.message, recipient: json.recipient ?? null, responseUrl: json.responseUrl, warning: json.warning ?? null, sending: false, sent: false, error: null, copied: false });
      } else {
        setReview((p) => p ? { ...p, loading: false, error: 'Δεν δημιουργήθηκε link ραντεβού. Δοκίμασε ξανά.' } : p);
      }
    } catch {
      setReview((p) => p ? { ...p, loading: false, error: 'Δεν δημιουργήθηκε link ραντεβού. Δοκίμασε ξανά.' } : p);
    }
  }

  function patchReview(patch: Partial<SendReview>) { setReview((p) => p ? { ...p, ...patch } : p); }

  async function send() {
    if (!appt || !review?.responseUrl) return;
    await executeViberSend({
      endpoint: `/api/customers/${customerId}/appointment-link`,
      body: { taskId: appt.id, responseUrl: review.responseUrl },
      update: (p) => patchReview(p),
      providerUnavailableMsg: 'Ο πάροχος αποστολής δεν είναι ρυθμισμένος ακόμα.',
      defaultFallbackMsg: 'Δεν στάλθηκε. Δοκίμασε ξανά.',
    });
  }

  function copy() {
    if (!review?.message) return;
    void navigator.clipboard?.writeText(review.message).then(() => { patchReview({ copied: true }); setTimeout(() => patchReview({ copied: false }), 2000); });
  }

  useOverlayDismiss(open, onClose);

  if (!open || !appt) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[#F5F5F7] shadow-2xl motion-safe:animate-[slideInRight_0.28s_cubic-bezier(0.32,0.72,0,1)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Πίσω" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition active:scale-95 hover:bg-zinc-100">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <p className="flex-1 truncate text-base font-semibold text-zinc-900">Ραντεβού</p>
          <Badge tone={STATUS_TONE[appt.status] ?? 'zinc'}>{STATUS_GR[appt.status] ?? appt.status}</Badge>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Hero date tile */}
          <div className="rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-zinc-200/60">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                <span className="text-3xl font-bold leading-none tabular-nums">{parts?.day ?? '–'}</span>
                <span className="mt-1 text-[11px] font-medium uppercase tracking-wide">{parts?.month ?? ''}</span>
              </div>
              <div className="min-w-0">
                {parts && <p className="text-sm font-medium capitalize text-zinc-500">{parts.weekday}</p>}
                <p className="text-lg font-bold text-zinc-900">
                  {appt.dueTime ? appt.dueTime : 'Χωρίς ώρα'}
                </p>
                {appt.dueDate && <p className="text-xs text-zinc-400">{formatDateGr(appt.dueDate)}</p>}
              </div>
            </div>

            {(appt.title || appt.note) && (
              <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                {appt.title && (<div><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Αιτία</p><p className="mt-0.5 text-sm font-medium text-zinc-800">{appt.title}</p></div>)}
                {appt.note && (<div><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Σημείωση</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600">{appt.note}</p></div>)}
              </div>
            )}
          </div>

          {/* Send reminder/confirmation link */}
          <Button variant="primary" fullWidth size="md" onClick={openSend}>
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 4.82A1 1 0 0 1 4.6 3.5l15.5 7.6a1 1 0 0 1 0 1.8L4.6 20.5a1 1 0 0 1-1.33-1.32L6 12Zm0 0h7" /></svg>
            Αποστολή link ραντεβού
          </Button>
          <p className="px-1 text-center text-xs text-zinc-400">Στέλνεται με Viber, με fallback σε SMS.</p>
        </div>
      </div>

      {review && (
        <SendViaViberModal
          title="Αποστολή link ραντεβού"
          subtitle="Έλεγξε το μήνυμα. Δεν στέλνεται τίποτα πριν πατήσεις αποστολή."
          loadingText="Ετοιμάζεται το μήνυμα…"
          successText="Το link ραντεβού στάλθηκε."
          loading={review.loading}
          message={review.message}
          recipient={review.recipient}
          responseUrl={review.responseUrl}
          sending={review.sending}
          sent={review.sent}
          error={review.error}
          copied={review.copied}
          warning={review.warning ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">Λείπει ημερομηνία ή ώρα από το ραντεβού. Συμπλήρωσέ τα για πιο σαφές μήνυμα.</p> : undefined}
          onClose={() => setReview(null)}
          onSend={send}
          onCopy={copy}
        />
      )}
    </div>
  );
}
