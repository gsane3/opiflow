// ---------------------------------------------------------------------------
// Server-side message dispatcher.
//
// Picks a sendable channel for a customer based on their preferred contact
// method and sends a message, with a Viber -> SMS fallback.
//
// Pure server-side, env-safe, and non-throwing: when Apifon is not configured
// every send is a safe no-op (the underlying helpers return
// `{ ok: false, skipped: true, reason: 'missing_apifon_config' }`), and this
// dispatcher reports `{ ok: false, channel: 'none', fallbackApplied: ... }`.
//
// Note: whatsapp / email are operator deep-links handled client-side elsewhere.
// The server cannot deep-link, so for server-initiated auto-sends those
// preferences are treated as Viber (with SMS fallback).
// ---------------------------------------------------------------------------

import { sendViberMessage } from './apifon-viber';
import { sendSmsMessage } from './apifon-sms';

export type SendChannel = 'viber' | 'sms' | 'whatsapp' | 'email' | 'phone';

/**
 * Map a customer's `preferredContactMethod` to a server-sendable channel.
 *
 * Only 'sms' resolves to direct SMS. Everything else (viber / whatsapp / email /
 * phone / unknown / empty) defaults to 'viber', which the dispatcher will fall
 * back to SMS for if Viber is unavailable.
 */
export function channelForCustomer(preferred: string | null | undefined): SendChannel {
  const value = preferred?.trim().toLowerCase();

  if (value === 'sms') return 'sms';

  // viber / whatsapp / email / phone / anything unknown -> default Viber path.
  return 'viber';
}

export interface SendViaPreferredChannelParams {
  preferred: string | null;
  phone: string | null;
  text: string;
  customerId?: string | null;
  referenceId?: string | null;
}

export interface SendViaPreferredChannelResult {
  ok: boolean;
  channel: 'viber' | 'sms' | 'none';
  viber?: unknown;
  sms?: unknown;
  fallbackApplied: boolean;
  reason?: string;
}

/**
 * Send `text` to a customer through their preferred channel.
 *
 * - If the preferred method resolves to 'sms', send via SMS directly.
 * - Otherwise try Viber; if Viber is skipped or fails, fall back to SMS.
 *
 * Never throws. When nothing could be sent, returns `channel: 'none'`.
 */
export async function sendViaPreferredChannel(
  params: SendViaPreferredChannelParams
): Promise<SendViaPreferredChannelResult> {
  const channel = channelForCustomer(params.preferred);

  // Direct SMS path.
  if (channel === 'sms') {
    const sms = await sendSmsMessage({
      phone: params.phone,
      text: params.text,
      customerId: params.customerId,
      referenceId: params.referenceId,
    });

    if (sms.ok) {
      return { ok: true, channel: 'sms', sms, fallbackApplied: false };
    }

    return {
      ok: false,
      channel: 'none',
      sms,
      fallbackApplied: false,
      reason: 'reason' in sms ? sms.reason : 'error' in sms ? sms.error : 'sms_send_failed',
    };
  }

  // Default Viber path, with SMS fallback.
  const viber = await sendViberMessage({
    phone: params.phone,
    text: params.text,
    customerId: params.customerId,
    referenceId: params.referenceId,
  });

  if (viber.ok) {
    return { ok: true, channel: 'viber', viber, fallbackApplied: false };
  }

  // Viber was skipped or failed -> fall back to SMS.
  const sms = await sendSmsMessage({
    phone: params.phone,
    text: params.text,
    customerId: params.customerId,
    referenceId: params.referenceId,
  });

  if (sms.ok) {
    return { ok: true, channel: 'sms', viber, sms, fallbackApplied: true };
  }

  return {
    ok: false,
    channel: 'none',
    viber,
    sms,
    fallbackApplied: true,
    reason: 'reason' in sms ? sms.reason : 'error' in sms ? sms.error : 'send_failed',
  };
}
