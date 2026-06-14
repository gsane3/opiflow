'use client';

// Review-first, multi-channel send sheet for the customer workspace.
//
// A single reusable shell the operator uses to review the *exact* prepared
// message + recipient and then pick how to send it. It deliberately surfaces
// the message first and sends NOTHING until a channel is chosen.
//
// Channels:
//   - Viber   — either a backend auto-send (a callback that POSTs server-side)
//               OR a `viber://forward` deep link carrying the text. Omit to hide.
//   - WhatsApp — client deep link (buildWhatsAppHref), enabled by recipientPhone.
//   - Email    — client deep link (buildEmailHref), enabled by recipientEmail.
//   - SMS      — client deep link (buildSmsHref), enabled by recipientPhone.
//   - Copy     — copies the full text to the clipboard.
//   - Open link — opens the optional link.
//
// The deep-link channels all carry `fullText` = message + (link ? "\n" + link
// : ""). The backend Viber send composes its own server-side message and so
// ignores fullText entirely.
//
// Presentational + tiny-local-state only: the single piece of state it owns is
// the transient "copied" flag. The only network action it triggers is the
// caller-supplied `viber.onSend` callback.

import React, { useState } from 'react';
import { BottomSheet, Button, Spinner, cn } from '@/components/ui';
import {
  buildEmailHref,
  buildSmsHref,
} from '@/lib/communications';

export interface SendChannelSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small reassurance line under the title. */
  subtitle?: string;
  /** While a draft is being prepared. */
  loading?: boolean;
  loadingText?: string;
  /** The exact prepared text (review-first). */
  message: string | null;
  /** Optional URL; appended to deep-link text and shown as "Άνοιγμα link". */
  link?: string | null;
  /** Enables WhatsApp + SMS. */
  recipientPhone?: string | null;
  /** Enables Email. */
  recipientEmail?: string | null;
  emailSubject?: string;
  /**
   * Viber options: backend auto-send OR a viber:// forward deep link, OR omit
   * (null/undefined) to hide Viber entirely.
   */
  viber?:
    | { kind: 'backend'; onSend: () => void; sending?: boolean; sent?: boolean; error?: string | null }
    | { kind: 'forward' }
    | null;
  /**
   * Email backend auto-send (server sends the email via Resend). When provided
   * (and recipientEmail is set), the Email button triggers this instead of the
   * mailto: deep link. Omit to keep the plain mailto: behaviour.
   */
  email?:
    | { kind: 'backend'; onSend: () => void; sending?: boolean; sent?: boolean; error?: string | null }
    | null;
  /**
   * Optional callback fired right before any channel action runs (Viber
   * forward, WhatsApp, Email, SMS). Lets the caller react to "a channel was
   * used" — e.g. the reject flow marks the customer as lost. Should be
   * idempotent on the caller's side. Not fired for the backend Viber send
   * (which has its own onSend), nor for Copy / Open link.
   */
  onChannelUse?: () => void;
}

/** Channel buttons share a height/shape so the list reads as one stack. */
const channelButtonClass = 'h-12 w-full rounded-xl';

export function SendChannelSheet({
  open,
  onClose,
  title,
  subtitle,
  loading = false,
  loadingText = 'Ετοιμάζεται το μήνυμα…',
  message,
  link,
  recipientPhone,
  recipientEmail,
  emailSubject,
  viber,
  email,
  onChannelUse,
}: SendChannelSheetProps) {
  const [copied, setCopied] = useState(false);

  // The text used for ALL client deep-link channels (and the clipboard).
  // The backend Viber send composes its own message server-side, so it ignores
  // this value.
  const fullText = (message ?? '') + (link ? '\n' + link : '');

  function handleCopy() {
    void navigator.clipboard?.writeText(fullText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  const showEmail = Boolean(recipientEmail);
  const showSms = Boolean(recipientPhone);

  return (
    <BottomSheet open={open} onClose={onClose} title={title} description={subtitle}>
      {loading ? (
        <div className="flex items-center gap-3 py-6 text-zinc-600 dark:text-zinc-300">
          <Spinner size="md" className="text-indigo-600" />
          <p className="text-sm">{loadingText}</p>
        </div>
      ) : message ? (
        <div className="space-y-4">
          {/* Recipient summary */}
          {(recipientPhone || recipientEmail) && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Παραλήπτης</p>
              {recipientPhone && (
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{recipientPhone}</p>
              )}
              {recipientEmail && (
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 break-all">{recipientEmail}</p>
              )}
            </div>
          )}

          {/* The exact message — review-first */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Μήνυμα</p>
            <div className="whitespace-pre-wrap break-words rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3.5 py-3 text-sm text-zinc-700 dark:text-zinc-200 ring-1 ring-zinc-200/60 dark:ring-white/10">
              {message}
            </div>
          </div>

          {/* Reassurance */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Δεν στέλνεται τίποτα μέχρι να επιλέξεις τρόπο αποστολής.
          </p>

          {/* Channel list */}
          <div className="space-y-2">
            {/* Viber */}
            {viber?.kind === 'backend' && (
              <BackendSendButton channel="Viber" variant="primary" state={viber} />
            )}
            {viber?.kind === 'forward' && (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className={channelButtonClass}
                onClick={() => {
                  onChannelUse?.();
                  window.open(
                    'viber://forward?text=' + encodeURIComponent(fullText),
                    '_blank',
                    'noopener,noreferrer',
                  );
                }}
              >
                Αποστολή με Viber
              </Button>
            )}


            {/* Email — backend auto-send when wired, else a mailto: deep link. */}
            {email?.kind === 'backend' && showEmail ? (
              <BackendSendButton channel="Email" variant="secondary" state={email} />
            ) : (
              showEmail && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={channelButtonClass}
                  onClick={() => {
                    onChannelUse?.();
                    window.location.href = buildEmailHref(
                      recipientEmail as string,
                      emailSubject,
                      fullText,
                    );
                  }}
                >
                  Αποστολή με Email
                </Button>
              )
            )}

            {/* SMS */}
            {showSms && (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                className={channelButtonClass}
                onClick={() => {
                  onChannelUse?.();
                  window.location.href = buildSmsHref(recipientPhone as string, fullText);
                }}
              >
                Αποστολή με SMS
              </Button>
            )}

            {/* Copy */}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              className={channelButtonClass}
              onClick={handleCopy}
            >
              {copied ? 'Αντιγράφηκε!' : 'Αντιγραφή μηνύματος'}
            </Button>

            {/* Open link */}
            {link && (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                className={channelButtonClass}
                onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
              >
                Άνοιγμα link
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

/**
 * A backend auto-send button (Viber or Email) + its sending/sent/error states.
 * Split out so the success state can replace the button entirely.
 */
function BackendSendButton({
  channel,
  variant,
  state,
}: {
  channel: 'Viber' | 'Email';
  variant: 'primary' | 'secondary';
  state: { onSend: () => void; sending?: boolean; sent?: boolean; error?: string | null };
}) {
  if (state.sent) {
    return (
      <div className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-50 px-4 text-sm font-semibold text-green-700 ring-1 ring-green-600/20">
        {`Στάλθηκε με ${channel} ✓`}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        size="lg"
        fullWidth
        loading={state.sending}
        className={channelButtonClass}
        onClick={state.onSend}
      >
        {state.sending ? 'Αποστολή…' : `Αποστολή με ${channel}`}
      </Button>
      {state.error && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {state.error}
        </p>
      )}
    </div>
  );
}

export default SendChannelSheet;
