// ---------------------------------------------------------------------------
// Server-side customer email sender (Resend).
//
// A small, env-safe helper that sends a plain-text email to a customer through
// Resend, mirroring the request shape of /api/email/send-offer. Used by the
// intake / upload / appointment link routes so "email" becomes a real,
// auto-sent channel (not just a mailto: deep link).
//
// Env-gated and non-throwing: when RESEND_API_KEY / EMAIL_FROM are not set
// every call is a safe no-op returning { ok: false, reason: 'missing_email_config' }.
//
// Recipient safety: callers pass the email of a customer they have already
// loaded under their own business_id, so this helper sends only to that
// verified address. It does NOT accept arbitrary recipients.
// ---------------------------------------------------------------------------

import { buildBusinessFromHeader, resolveReplyTo } from './email-identity';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_PROVIDER_TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendCustomerEmailParams {
  to: string | null | undefined;
  subject: string;
  text: string;
  /**
   * Business display name — presented to the customer as the sender, e.g.
   * "<Business> via Opiflow <noreply@opiflow.gr>". Falls back to the global
   * EMAIL_FROM identity when absent.
   */
  businessName?: string | null;
  /**
   * Business reply-to email — customer replies route here when set; otherwise
   * the global EMAIL_REPLY_TO is used.
   */
  businessEmail?: string | null;
}

export type SendCustomerEmailResult =
  | { ok: true; skipped: false; messageId: string | null }
  | { ok: false; skipped: true; reason: 'missing_email_config' | 'missing_or_invalid_email' }
  | { ok: false; skipped: false; reason: 'provider_error' | 'timeout' | 'network_error' };

/**
 * Send a plain-text email to a customer via Resend.
 *
 * Never throws; returns a structured result in all cases.
 */
export async function sendCustomerLinkEmail(
  params: SendCustomerEmailParams
): Promise<SendCustomerEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, skipped: true, reason: 'missing_email_config' };
  }

  const to = params.to?.trim();
  if (!to || !EMAIL_RE.test(to)) {
    return { ok: false, skipped: true, reason: 'missing_or_invalid_email' };
  }

  const subject = params.subject.trim();
  const text = params.text.trim();
  if (!subject || !text) {
    return { ok: false, skipped: true, reason: 'missing_or_invalid_email' };
  }

  const payload: Record<string, unknown> = {
    from: buildBusinessFromHeader(params.businessName, from),
    to: [to],
    subject,
    text,
  };

  const replyTo = resolveReplyTo(params.businessEmail, process.env.EMAIL_REPLY_TO);
  if (replyTo) payload.reply_to = replyTo;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'opiflow-mvp/0.1',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => null)) as { id?: string } | null;

    if (!res.ok) {
      return { ok: false, skipped: false, reason: 'provider_error' };
    }

    return { ok: true, skipped: false, messageId: data?.id ?? null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, skipped: false, reason: 'timeout' };
    }
    return { ok: false, skipped: false, reason: 'network_error' };
  } finally {
    clearTimeout(timeoutId);
  }
}
