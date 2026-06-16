// Shared offer-response (accept/reject) logic — extracted from the public
// offer-response token route so BOTH that route AND the folder-scoped portal
// endpoint (POST /api/f/[token]/offer/[offerId]/accept) apply IDENTICAL guards
// and side effects. The folder flow has no offer-response token row, so callers
// pass `tokenId: undefined` to skip the token-state update; everything else
// (offer status, customer pipeline, follow-up task, communications row, owner
// push) is the same. Pure helpers live here too so the two callers can't drift.

import type { SupabaseClient } from '@supabase/supabase-js';
import { markOfferResponseTokenResponded } from './offer-response-tokens';
import { sendPushToBusinessOwner } from './push';
import { OFFER_FINAL_STATUSES, isBeforeToday, offerCanRespond } from './offer-status';

// Re-export the pure status helpers so existing importers keep one entry point.
export { OFFER_FINAL_STATUSES, isBeforeToday, offerCanRespond };

export function buildOfferNoteAppend(
  response: 'accepted' | 'rejected',
  isoDate: string,
  comment: string | null,
): string {
  const label =
    response === 'accepted'
      ? `Απάντηση μέσω δημόσιου link: Αποδοχή στις ${isoDate}.`
      : `Απάντηση μέσω δημόσιου link: Απόρριψη στις ${isoDate}.`;
  return comment ? `${label} Σχόλιο: ${comment}` : label;
}

export function buildOfferCommunicationSummary(
  response: 'accepted' | 'rejected',
  offerNumber: string,
  comment: string | null,
): string {
  const base =
    response === 'accepted'
      ? `Ο πελάτης αποδέχτηκε την προσφορά ${offerNumber} μέσω δημόσιου link.`
      : `Ο πελάτης απέρριψε την προσφορά ${offerNumber} μέσω δημόσιου link.`;
  return comment ? `${base} Σχόλιο: ${comment}` : base;
}

export function resolveOfferChannel(sentChannel: string | null | undefined): string {
  if (sentChannel === 'viber' || sentChannel === 'sms' || sentChannel === 'email') return sentChannel;
  return 'email';
}

/** The minimal offer fields applyOfferResponse needs (already fetched + tenant-scoped). */
export interface OfferForResponse {
  id: string;
  customer_id: string | null;
  offer_number: string;
  status: string;
  valid_until: string | null;
  notes: string | null;
  total: number;
}

export interface ApplyOfferResponseResult {
  ok: boolean;
  /** HTTP status the caller should return (200 on success, 409/500 otherwise). */
  httpStatus: number;
  error?: string;
  offerNumber?: string;
  status?: string;
  total?: number;
}

/**
 * Apply a customer's accept/reject to an already-fetched, already-tenant-validated
 * offer. Re-checks the FINAL/expiry guards itself (defense in depth + idempotency).
 * `tokenId` → mark the offer-response token responded (omit for the folder flow).
 * `workFolderId` → stamp the communications/follow-up rows so the response shows
 * on the folder timeline (folder flow only; the token route omits it).
 */
export async function applyOfferResponse(opts: {
  supabase: SupabaseClient;
  businessId: string;
  offer: OfferForResponse;
  response: 'accepted' | 'rejected';
  comment: string | null;
  sentChannel: string | null | undefined;
  tokenId?: string | null;
  workFolderId?: string | null;
}): Promise<ApplyOfferResponseResult> {
  const { supabase, businessId, offer, response, comment, sentChannel, tokenId, workFolderId } = opts;

  // Guards (idempotency + expiry) — re-checked here so every caller is safe.
  if ((OFFER_FINAL_STATUSES as readonly string[]).includes(offer.status)) {
    return { ok: false, httpStatus: 409, error: 'offer_already_final' };
  }
  if (offer.valid_until && isBeforeToday(offer.valid_until)) {
    return { ok: false, httpStatus: 409, error: 'offer_expired' };
  }

  const nowIso = new Date().toISOString();
  const isoDate = nowIso.split('T')[0];

  const noteAppend = buildOfferNoteAppend(response, isoDate, comment);
  const updatedNotes = offer.notes ? `${offer.notes}\n\n${noteAppend}` : noteAppend;

  // 1. Offer status + notes (PRIMARY, fatal). The `.not(status in final)` makes
  // the transition ATOMIC: under two concurrent accepts only one UPDATE matches a
  // row; the other matches 0 rows → 409 (so the side effects below — follow-up
  // task, communications, push — run exactly once, never duplicated by a race).
  try {
    const { data: updated, error } = await supabase
      .from('offers')
      .update({ status: response, notes: updatedNotes, updated_at: nowIso })
      .eq('id', offer.id)
      .eq('business_id', businessId)
      .not('status', 'in', '(accepted,rejected,expired)')
      .select('id');
    if (error) return { ok: false, httpStatus: 500, error: 'offer_response_update_failed' };
    if (!updated || updated.length === 0) {
      // Another request finalized this offer between our guard check and the write.
      return { ok: false, httpStatus: 409, error: 'offer_already_final' };
    }
  } catch {
    return { ok: false, httpStatus: 500, error: 'offer_response_update_failed' };
  }

  // 2. Customer pipeline (best-effort) + 3. follow-up task on accept (best-effort).
  if (offer.customer_id) {
    const customerStatus = response === 'accepted' ? 'won' : 'lost';
    try {
      await supabase
        .from('customers')
        .update({ status: customerStatus, updated_at: nowIso })
        .eq('id', offer.customer_id)
        .eq('business_id', businessId);
    } catch {
      // non-fatal: the offer response was already recorded
    }
    if (response === 'accepted') {
      try {
        await supabase.from('tasks').insert({
          business_id: businessId,
          customer_id: offer.customer_id,
          offer_id: offer.id,
          ...(workFolderId ? { work_folder_id: workFolderId } : {}),
          title: `Επικοινωνία για προγραμματισμό — αποδεκτή προσφορά ${offer.offer_number}`,
          type: 'call_back',
          status: 'open',
          priority: 'high',
          due_date: isoDate,
          note: 'Αυτόματη εργασία: ο πελάτης αποδέχτηκε την προσφορά μέσω δημόσιου link.',
          created_from_ai: false,
        });
      } catch {
        // non-fatal
      }
    }
  }

  // 4. Communications row (CRM audit trail, fatal). Stamp work_folder_id when present.
  const commSummary = buildOfferCommunicationSummary(response, offer.offer_number, comment);
  try {
    const { error } = await supabase.from('communications').insert({
      business_id: businessId,
      customer_id: offer.customer_id,
      channel: resolveOfferChannel(sentChannel),
      direction: 'inbound',
      status: 'completed',
      phone: null,
      summary: commSummary,
      ...(workFolderId ? { work_folder_id: workFolderId } : {}),
    });
    if (error) return { ok: false, httpStatus: 500, error: 'offer_response_record_failed' };
  } catch {
    return { ok: false, httpStatus: 500, error: 'offer_response_record_failed' };
  }

  // 5. Mark the offer-response token responded — token flow only.
  if (tokenId) {
    try {
      await markOfferResponseTokenResponded({ tokenId, response, comment });
    } catch {
      return { ok: false, httpStatus: 500, error: 'offer_response_record_failed' };
    }
  }

  // 6. Owner push (best-effort, inert until FCM configured, never throws).
  await sendPushToBusinessOwner(businessId, {
    title:
      response === 'accepted'
        ? `Προσφορά ${offer.offer_number}: Αποδοχή ✅`
        : `Προσφορά ${offer.offer_number}: Απόρριψη`,
    body: commSummary,
    ...(offer.customer_id ? { url: `/customers/${offer.customer_id}` } : {}),
    data: { type: 'offer_response', offerId: offer.id, response },
  });

  return { ok: true, httpStatus: 200, offerNumber: offer.offer_number, status: response, total: offer.total };
}
