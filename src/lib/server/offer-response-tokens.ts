// Raw public token is never stored. Only the SHA-256 hex hash is written to DB.
// Public offer-response pages must call server API routes; they must not query
// Supabase directly with the anon key.

import {
  buildPublicTokenUrl,
  createServiceSupabaseClient,
  generateRawToken,
  getPublicAppUrl,
  hashToken,
} from './public-tokens';

// Re-exported so existing importers of these names from this module keep working.
export { createServiceSupabaseClient, getPublicAppUrl };

const DEFAULT_EXPIRY_HOURS = 168; // 7 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OfferResponseTokenStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'revoked';

export type OfferResponseValue = 'accepted' | 'rejected';

export interface OfferResponseTokenRow {
  id: string;
  business_id: string;
  offer_id: string;
  token_hash: string;
  status: OfferResponseTokenStatus;
  sent_channel: 'viber' | 'sms' | 'email' | 'manual' | null;
  sent_to: string | null;
  expires_at: string;
  opened_at: string | null;
  responded_at: string | null;
  response: OfferResponseValue | null;
  response_comment: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOfferResponseTokenResult {
  rawToken: string;
  tokenHash: string;
  responseUrl: string;
  row: OfferResponseTokenRow;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function generateRawOfferResponseToken(): string {
  return generateRawToken();
}

export function hashOfferResponseToken(rawToken: string): string {
  return hashToken(rawToken);
}

export function buildOfferResponseUrl(rawToken: string): string {
  return buildPublicTokenUrl('offer-response', rawToken);
}

// ---------------------------------------------------------------------------
// createOfferResponseToken
// ---------------------------------------------------------------------------

export async function createOfferResponseToken(params: {
  businessId: string;
  offerId: string;
  sentChannel?: 'viber' | 'sms' | 'email' | 'manual' | null;
  sentTo?: string | null;
  expiryHours?: number;
}): Promise<CreateOfferResponseTokenResult> {
  const supabase = createServiceSupabaseClient();

  const rawToken = generateRawOfferResponseToken();
  const tokenHash = hashOfferResponseToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from('offer_response_tokens')
    .insert({
      business_id: params.businessId,
      offer_id: params.offerId,
      token_hash: tokenHash,
      status: params.sentChannel ? 'sent' : 'pending',
      sent_channel: params.sentChannel ?? null,
      sent_to: params.sentTo ?? null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create offer response token: ${error.message}`);
  }

  return {
    rawToken,
    tokenHash,
    responseUrl: buildOfferResponseUrl(rawToken),
    row: data as OfferResponseTokenRow,
  };
}

// ---------------------------------------------------------------------------
// markOfferResponseTokenSent
// ---------------------------------------------------------------------------

export async function markOfferResponseTokenSent(params: {
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'email' | 'manual';
  sentTo?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('offer_response_tokens')
    .update({
      status: 'sent',
      sent_channel: params.sentChannel,
      sent_to: params.sentTo ?? null,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to mark offer response token sent: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// findValidOfferResponseToken
// ---------------------------------------------------------------------------

export async function findValidOfferResponseToken(
  rawToken: string
): Promise<OfferResponseTokenRow | null> {
  const supabase = createServiceSupabaseClient();
  const tokenHash = hashOfferResponseToken(rawToken);

  const { data, error } = await supabase
    .from('offer_response_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find offer response token: ${error.message}`);
  }

  return data ? (data as OfferResponseTokenRow) : null;
}

// ---------------------------------------------------------------------------
// markOfferResponseTokenOpened
// ---------------------------------------------------------------------------

export async function markOfferResponseTokenOpened(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('offer_response_tokens')
    .update({
      status: 'opened',
      opened_at: now,
      updated_at: now,
    })
    .eq('id', tokenId)
    .in('status', ['pending', 'sent']);

  if (error) {
    throw new Error(`Failed to mark offer response token opened: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// markOfferResponseTokenResponded
// ---------------------------------------------------------------------------

export async function markOfferResponseTokenResponded(params: {
  tokenId: string;
  response: OfferResponseValue;
  comment?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('offer_response_tokens')
    .update({
      status: params.response,
      response: params.response,
      response_comment: params.comment ?? null,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .in('status', ['pending', 'sent', 'opened']);

  if (error) {
    throw new Error(`Failed to mark offer response token responded: ${error.message}`);
  }
}
