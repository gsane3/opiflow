// Email send-offer — repository (tenant-scoped data access). Parity-matched to
// POST /api/email/send-offer.
//
// This route resolves its tenant from the AUTHENTICATED business user (Bearer →
// authenticateBusinessRequest), then performs three business-scoped reads/writes:
//   1. constrain the recipient to one of the caller's OWN customers (open-relay
//      guard) — `customers` filtered by business_id + ilike(email),
//   2. look up the per-business sender identity (`businesses` name/email by id),
//   3. advance the offer's status after a successful send (`offers` by id +
//      business_id, draft|ready_to_send → sent_manually).
//
// Every read/write keeps the live route's EXACT `.eq('business_id', …)` /
// PK-keyed filters and column lists, so the multi-tenant scoping is byte-for-byte
// unchanged. DB rejections bubble up as plain throws; the service's recipient
// lookup wraps its own try/catch to reproduce the route's `recipient_check_failed`
// (500), and the identity / offer-status lookups are best-effort (swallowed) just
// like the original.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = {
  userId: string;
  businessId: string;
  role: string;
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

type SupabaseClient = RepoContext['supabase'];

// ---------------------------------------------------------------------------
// customers (open-relay guard: recipient must be one of the caller's own)
// ---------------------------------------------------------------------------

/**
 * Find a customer of this tenant whose email matches `likePattern` (a
 * pre-escaped ilike pattern). Returns the matched id (or null when the row had
 * no id), or null when no customer matched. DB rejections bubble up.
 */
export async function findRecipientCustomerId(
  supabase: SupabaseClient,
  businessId: string,
  likePattern: string,
): Promise<{ matched: boolean; customerId: string | null }> {
  const { data: recipientMatch } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .ilike('email', likePattern)
    .limit(1)
    .maybeSingle();
  if (!recipientMatch) {
    return { matched: false, customerId: null };
  }
  return {
    matched: true,
    customerId: (recipientMatch as { id?: string } | null)?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// businesses (per-business sender identity — best-effort)
// ---------------------------------------------------------------------------

export interface BusinessIdentityRow {
  name: string | null;
  email: string | null;
}

/**
 * Look up the business's display name + reply-to email by id. Returns null when
 * no row. DB rejections bubble up (the service swallows them, falling back to the
 * global EMAIL_FROM / EMAIL_REPLY_TO identity).
 */
export async function fetchBusinessIdentity(
  supabase: SupabaseClient,
  businessId: string,
): Promise<BusinessIdentityRow | null> {
  const { data: biz } = await supabase
    .from('businesses')
    .select('name, email')
    .eq('id', businessId)
    .maybeSingle();
  if (!biz) return null;
  return {
    name: (biz as { name?: string | null }).name ?? null,
    email: (biz as { email?: string | null }).email ?? null,
  };
}

// ---------------------------------------------------------------------------
// offers (advance status after a successful send — best-effort, non-regressing)
// ---------------------------------------------------------------------------

export interface OfferStatusRow {
  id: string;
  status: string;
}

/** Fetch one offer's id + status, scoped to this tenant. Null when no row. */
export async function fetchOfferStatus(
  supabase: SupabaseClient,
  offerId: string,
  businessId: string,
): Promise<OfferStatusRow | null> {
  const { data: offerRow } = await supabase
    .from('offers')
    .select('id, status')
    .eq('id', offerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return (offerRow as unknown as OfferStatusRow | null) ?? null;
}

/** Mark an offer as sent_manually (id + business_id scoped). */
export async function markOfferSentManually(
  supabase: SupabaseClient,
  offerId: string,
  businessId: string,
): Promise<void> {
  await supabase
    .from('offers')
    .update({ status: 'sent_manually', updated_at: new Date().toISOString() })
    .eq('id', offerId)
    .eq('business_id', businessId);
}
