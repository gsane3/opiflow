'use client';

// Shared "review-and-send via Viber" modal for the customer workspace.
//
// The customer screen sends four kinds of Viber message (offer, intake link,
// appointment link, photos/upload link). Every one of them is a review-first
// flow with an identical shell: a draft is prepared server-side, the operator
// reviews the exact message + recipient, and nothing is sent until they press
// "Αποστολή με Viber". This component is that shell; the four call sites differ
// only in copy, the send endpoint/body, and (for appointments) a warning.
//
// It is intentionally PURE/presentational: it owns no state and performs no
// network calls. Each caller passes the current review fields as props and
// supplies onSend/onCopy/onClose callbacks, so the caller keeps its own typed
// useState setter. The send orchestration is shared via executeViberSend below.

import React from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Send orchestration (shared by all four call sites)
// ---------------------------------------------------------------------------

/** The minimal patch executeViberSend applies to a caller's review state. */
export interface ViberSendPatch {
  sending?: boolean;
  sent?: boolean;
  error?: string | null;
}

/** Maps a server "not sent" reason to the operator-facing fallback message. */
export function mapViberFallback(
  reason: string | undefined,
  providerUnavailableMsg: string,
  defaultFallbackMsg: string
): string {
  if (reason === 'missing_mobile' || reason === 'missing_customer') {
    return 'Δεν υπάρχει διαθέσιμο κινητό για αποστολή Viber.';
  }
  if (reason === 'provider_unavailable') {
    return providerUnavailableMsg;
  }
  return defaultFallbackMsg;
}

/**
 * Performs the POST that confirms a Viber send and drives the caller's review
 * state through the sending -> sent / sending -> error transitions.
 *
 * `update` receives a partial patch which the caller merges into its own
 * (typed) review state via setState; this keeps the component generic-free
 * while preserving each call site's exact state type.
 */
export async function executeViberSend(opts: {
  endpoint: string;
  body: Record<string, unknown>;
  update: (patch: ViberSendPatch) => void;
  providerUnavailableMsg: string;
  defaultFallbackMsg: string;
}): Promise<void> {
  const { endpoint, body, update, providerUnavailableMsg, defaultFallbackMsg } = opts;

  const supabase = createBrowserSupabaseClient();
  const {
    data: { session: s },
  } = await supabase.auth.getSession();
  if (!s) {
    update({ error: 'Δεν βρέθηκε session. Δοκίμασε ξανά.' });
    return;
  }

  update({ sending: true, error: null });
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.access_token}`,
      },
      body: JSON.stringify({ mode: 'send', ...body }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      sent?: boolean;
      // The offer endpoint returns `reason`; the link endpoints return
      // `fallbackReason`. Read either.
      reason?: string;
      fallbackReason?: string;
    };
    if (!res.ok || !json.ok) {
      update({ sending: false, error: 'Αποτυχία αποστολής. Δοκίμασε ξανά.' });
      return;
    }
    if (json.sent) {
      update({ sending: false, sent: true, error: null });
    } else {
      const reason = json.reason ?? json.fallbackReason;
      update({
        sending: false,
        error: mapViberFallback(reason, providerUnavailableMsg, defaultFallbackMsg),
      });
    }
  } catch {
    update({ sending: false, error: 'Αποτυχία αποστολής. Δοκίμασε ξανά.' });
  }
}

// ---------------------------------------------------------------------------
// Presentational modal
// ---------------------------------------------------------------------------

export interface SendViaViberModalProps {
  /** Modal heading, e.g. "Αποστολή link ραντεβού". */
  title: string;
  /** Optional hint shown under the heading, e.g. the review-first reassurance. */
  subtitle?: string;
  /** Text shown next to the spinner while the draft is being prepared. */
  loadingText: string;
  /** Green success-banner text shown after a successful send. */
  successText: string;
  /** Label for the "open link" secondary button (default: "Άνοιγμα link"). */
  openLabel?: string;
  /** Optional warning block rendered above the message (appointments use it). */
  warning?: React.ReactNode;

  // --- review state (display only) ---
  loading: boolean;
  message: string | null;
  recipient: string | null;
  responseUrl: string | null;
  sending: boolean;
  sent: boolean;
  error: string | null;
  copied: boolean;

  // --- callbacks ---
  onClose: () => void;
  onSend: () => void;
  onCopy: () => void;
}

export function SendViaViberModal({
  title,
  subtitle,
  loadingText,
  successText,
  openLabel = 'Άνοιγμα link',
  warning,
  loading,
  message,
  recipient,
  responseUrl,
  sending,
  sent,
  error,
  copied,
  onClose,
  onSend,
  onCopy,
}: SendViaViberModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="mx-4 my-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white dark:bg-[#17232f] p-5 shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`${subtitle ? 'mb-1' : 'mb-4'} flex items-center justify-between gap-2`}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="rounded-full p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {subtitle && <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">{subtitle}</p>}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-3 py-4">
            <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-200 dark:border-white/10 border-t-indigo-500" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{loadingText}</p>
          </div>
        )}

        {/* Draft failed -- no message was generated */}
        {!loading && !message && error && (
          <>
            <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-700">{error}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                Κλείσιμο
              </button>
            </div>
          </>
        )}

        {/* Main content: shown once message is available */}
        {!loading && message && (
          <>
            {recipient && (
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                {'Παραλήπτης Viber: '}
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{recipient}</span>
              </p>
            )}

            {warning}

            <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Μήνυμα:</p>
            <div className="mb-4 break-words whitespace-pre-wrap rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 text-xs text-zinc-700 dark:text-zinc-200">
              {message}
            </div>

            {/* Success banner */}
            {sent && (
              <div className="mb-3 rounded-xl bg-green-50 px-3 py-2.5 text-sm font-medium text-green-700">
                {successText}
              </div>
            )}

            {/* Send error / fallback banner */}
            {error && !sent && (
              <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</div>
            )}

            {/* Reassurance: nothing is sent until the operator presses send. */}
            {!sent && (
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                Δεν στέλνεται τίποτα πριν πατήσεις αποστολή.
              </p>
            )}

            {/* Primary: Viber send button (hidden after success) */}
            {!sent && (
              <button
                type="button"
                disabled={sending}
                onClick={onSend}
                className="mb-3 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {sending ? 'Αποστολή...' : 'Αποστολή'}
              </button>
            )}

            {/* Secondary buttons row */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="flex-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                {copied ? 'Αντιγράφηκε!' : 'Αντιγραφή μηνύματος'}
              </button>
              {responseUrl && (
                <button
                  type="button"
                  onClick={() => window.open(responseUrl, '_blank', 'noopener,noreferrer')}
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                >
                  {openLabel}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                Κλείσιμο
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
