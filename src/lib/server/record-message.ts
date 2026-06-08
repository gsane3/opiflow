// ---------------------------------------------------------------------------
// Outbound message logging for the customer timeline (#57).
//
// Every successful outbound message (intake / upload / appointment / offer
// link sent via Viber, SMS or Email) is logged as a `communications` row so it
// shows up in the customer timeline. For Viber/SMS we ALSO insert a linked
// `viber_messages` row carrying the Apifon request/message/reference ids, so
// the Apifon status webhook can later propagate delivery/seen/failed status
// back onto the communications row.
//
// Pure server-side, uses the service-role client, and NON-THROWING: any failure
// here is swallowed — the message was already sent, so timeline logging must
// never turn a successful send into an error.
// ---------------------------------------------------------------------------

import { createServiceSupabaseClient } from './intake-tokens';

export type OutboundChannel = 'viber' | 'sms' | 'email';

export interface RecordOutboundMessageParams {
  businessId: string;
  customerId: string | null;
  channel: OutboundChannel;
  /** Short Greek action label shown in the timeline, e.g. "Αίτημα στοιχείων". */
  summary: string;
  /** Recipient phone (Viber/SMS) — stored on the communications row. */
  phone?: string | null;
  /** Apifon reference_id (used by the status webhook fallback match). */
  referenceId?: string | null;
  /** Apifon request_id / message_id, when the send returned them. */
  providerRequestId?: string | null;
  providerMessageId?: string | null;
}

export interface RecordOutboundMessageResult {
  communicationId: string | null;
}

/**
 * Log a successfully-sent outbound message to the timeline. Best-effort.
 */
export async function recordOutboundMessage(
  params: RecordOutboundMessageParams
): Promise<RecordOutboundMessageResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const nowIso = new Date().toISOString();

    // 1. Timeline row (communications). status starts at 'sent'.
    const { data: commRow } = await supabase
      .from('communications')
      .insert({
        business_id: params.businessId,
        customer_id: params.customerId,
        channel: params.channel,
        direction: 'outbound',
        status: 'sent',
        phone: params.phone ?? null,
        summary: params.summary,
      })
      .select('id')
      .single();

    const communicationId = (commRow as { id?: string } | null)?.id ?? null;

    // 2. For Viber/SMS, store a provider-tracking row so the Apifon status
    //    webhook can mark it delivered/seen/failed and propagate to the
    //    communications row above. Email has no Apifon status callback.
    if ((params.channel === 'viber' || params.channel === 'sms')) {
      const refId = params.referenceId?.trim() || null;

      // Keep the reference_id-based webhook match unambiguous: a re-send reuses
      // the same reference_id, so drop any prior tracking row for it first.
      if (refId) {
        try {
          await supabase
            .from('viber_messages')
            .delete()
            .eq('business_id', params.businessId)
            .eq('reference_id', refId);
        } catch {
          // best-effort
        }
      }

      try {
        await supabase.from('viber_messages').insert({
          business_id: params.businessId,
          customer_id: params.customerId,
          communication_id: communicationId,
          provider: 'apifon',
          provider_request_id: params.providerRequestId ?? null,
          provider_message_id: params.providerMessageId ?? null,
          reference_id: refId,
          recipient_phone: params.phone ?? null,
          status: 'sent',
          sent_at: nowIso,
        });
      } catch {
        // best-effort: the message was already sent
      }
    }

    return { communicationId };
  } catch {
    return { communicationId: null };
  }
}

/**
 * Extract Apifon request/message ids from a sendViaPreferredChannel result's
 * underlying viber/sms detail (which is typed `unknown`). Mirrors the pattern
 * used inline in /api/offers/[id]/notify.
 */
export function extractProviderIds(detail: unknown): {
  providerRequestId: string | null;
  providerMessageId: string | null;
} {
  const d = detail as { requestId?: string | null; messageId?: string | null } | null | undefined;
  return {
    providerRequestId: d?.requestId ?? null,
    providerMessageId: d?.messageId ?? null,
  };
}
