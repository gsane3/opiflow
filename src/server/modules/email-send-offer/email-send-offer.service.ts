// Email send-offer — service (validation + recipient guard + send orchestration).
// Parity-matched to POST /api/email/send-offer (the post-parse body).
//
// The route stays a thin shell that performs the request-bound concerns it alone
// can do — rate-limit (caller IP), content-type / content-length guards, the
// RESEND_API_KEY / EMAIL_FROM config check, and the raw-body size + JSON parse —
// then hands the already-parsed body (plus the env-derived sender config) to this
// service, which reproduces the route's body from line `const { to, subject, … }`
// onward EXACTLY: every validation code + order, the open-relay recipient guard,
// the best-effort per-business identity lookup, the Resend payload (key order
// preserved), the provider call, the best-effort offer-status advance, and the
// best-effort timeline log.
//
// External effects — the Resend `fetch` and the timeline logger
// (recordOutboundMessage) — are kept behind injected deps so the route uses the
// real implementations while unit tests stay pure (they never reach them: every
// covered branch fires BEFORE the provider call).
//
// The service returns `{ payload, status }`; the route serialises it verbatim
// with `NextResponse.json(payload, { status })`, so the wire contract (status +
// JSON key order) is byte-for-byte unchanged.

import { buildBusinessFromHeader, resolveReplyTo } from '../../../lib/server/email-identity';
import {
  fetchBusinessIdentity,
  fetchOfferStatus,
  findRecipientCustomerId,
  markOfferSentManually,
  type RepoContext,
} from './email-send-offer.repo';

export type { RepoContext } from './email-send-offer.repo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_PROVIDER_TIMEOUT_MS = 15_000;

/** What the thin route serialises: `NextResponse.json(payload, { status })`. */
export interface SendOfferResponse {
  payload: Record<string, unknown>;
  status: number;
}

/** Effects injected by the route; unit tests never reach them. */
export interface SendOfferDeps {
  recordOutboundMessage: (params: {
    businessId: string;
    customerId: string | null;
    channel: 'viber' | 'sms' | 'email';
    summary: string;
  }) => Promise<{ communicationId: string | null }>;
  /** Defaults to global fetch; injectable so the provider call stays mockable. */
  fetchImpl?: typeof fetch;
}

export interface SendOfferConfig {
  /** RESEND_API_KEY (already verified non-empty by the route). */
  apiKey: string;
  /** EMAIL_FROM (already verified non-empty by the route). */
  from: string;
  /** process.env.EMAIL_REPLY_TO at request time (may be undefined). */
  replyToEnv: string | null | undefined;
}

export async function sendOfferEmail(
  ctx: RepoContext,
  body: unknown,
  config: SendOfferConfig,
  deps: SendOfferDeps,
): Promise<SendOfferResponse> {
  const { supabase, businessId } = ctx;

  if (typeof body !== 'object' || body === null) {
    return { payload: { ok: false, error: 'invalid_body' }, status: 400 };
  }

  const { to, subject, text, html, offerId } = body as Record<string, unknown>;

  if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) {
    return { payload: { ok: false, error: 'invalid_email' }, status: 400 };
  }

  // Constrain the recipient to one of the caller's own customers, so the
  // company's verified sender domain cannot be abused as an open relay.
  const recipientEmail = to.trim();
  const likePattern = recipientEmail.replace(/([\\%_])/g, '\\$1');
  let recipientCustomerId: string | null = null;
  try {
    const recipientMatch = await findRecipientCustomerId(supabase, businessId, likePattern);
    if (!recipientMatch.matched) {
      return { payload: { ok: false, error: 'recipient_not_allowed' }, status: 403 };
    }
    recipientCustomerId = recipientMatch.customerId;
  } catch {
    return { payload: { ok: false, error: 'recipient_check_failed' }, status: 500 };
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return { payload: { ok: false, error: 'missing_subject' }, status: 400 };
  }
  if (
    (!text || typeof text !== 'string' || !text.trim()) &&
    (!html || typeof html !== 'string' || !html.trim())
  ) {
    return { payload: { ok: false, error: 'missing_body' }, status: 400 };
  }

  const apiKey = config.apiKey;
  const from = config.from;

  // Per-business sender identity (#xx): present the business's own name over the
  // verified Opiflow domain, and route replies to the business's own inbox.
  // Best-effort — on any lookup failure we fall back to the global identity.
  let businessName: string | null = null;
  let businessEmail: string | null = null;
  try {
    const biz = await fetchBusinessIdentity(supabase, businessId);
    if (biz) {
      businessName = biz.name ?? null;
      businessEmail = biz.email ?? null;
    }
  } catch {
    // non-fatal: fall back to the global EMAIL_FROM / EMAIL_REPLY_TO identity
  }

  const payload: Record<string, unknown> = {
    from: buildBusinessFromHeader(businessName, from),
    to: [to.trim()],
    subject: subject.trim(),
  };
  if (typeof text === 'string' && text.trim()) payload.text = text.trim();
  if (typeof html === 'string' && html.trim()) payload.html = html.trim();

  const replyTo = resolveReplyTo(businessEmail, config.replyToEnv);
  if (replyTo) payload.reply_to = replyTo;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'opiflow-mvp/0.1',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { id?: string; message?: string };

    if (!res.ok) {
      return { payload: { ok: false, error: 'provider_error' }, status: 502 };
    }

    // Email sent successfully -> advance the OFFER's own status so it no longer
    // reads as "Πρόχειρη" after a real send (label "Στάλθηκε"). Mirrors the Viber
    // notify route. Best-effort & non-fatal: the email was already sent, so a
    // status-update failure must not change the email response. Only acts when an
    // offerId was provided, and never regresses an offer that already reached a
    // final state (accepted/rejected/expired) or was already sent.
    if (typeof offerId === 'string' && offerId.trim()) {
      try {
        const offerRow = await fetchOfferStatus(supabase, offerId.trim(), businessId);
        if (
          offerRow &&
          (offerRow.status === 'draft' || offerRow.status === 'ready_to_send')
        ) {
          await markOfferSentManually(supabase, offerRow.id, businessId);
        }
      } catch {
        // intentionally swallowed: the email was already sent
      }
    }

    // Log to the customer timeline (#57). Best-effort; non-fatal.
    if (recipientCustomerId) {
      await deps.recordOutboundMessage({
        businessId,
        customerId: recipientCustomerId,
        channel: 'email',
        summary: 'Αποστολή προσφοράς',
      });
    }

    return { payload: { ok: true, id: data.id }, status: 200 };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { payload: { ok: false, error: 'email_timeout' }, status: 504 };
    }
    return { payload: { ok: false, error: 'network_error' }, status: 502 };
  } finally {
    clearTimeout(timeoutId);
  }
}
