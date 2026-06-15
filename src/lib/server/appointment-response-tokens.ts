// Raw public token is never stored. Only the SHA-256 hex hash is written to DB.
// Public appointment-response pages must call server API routes; they must not query
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

const DEFAULT_EXPIRY_HOURS = 72; // 3 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppointmentResponseTokenStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'accepted'
  | 'declined'
  | 'time_change_requested'
  | 'expired'
  | 'revoked';

export type AppointmentResponseValue =
  | 'accepted'
  | 'declined'
  | 'time_change_requested';

export interface AppointmentResponseTokenRow {
  id: string;
  business_id: string;
  task_id: string;
  token_hash: string;
  status: AppointmentResponseTokenStatus;
  sent_channel: 'viber' | 'sms' | 'email' | 'manual';
  sent_to: string | null;
  expires_at: string;
  opened_at: string | null;
  responded_at: string | null;
  response: AppointmentResponseValue | null;
  response_comment: string | null;
  requested_due_date: string | null;
  requested_due_time: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAppointmentResponseTokenResult {
  rawToken: string;
  tokenHash: string;
  responseUrl: string;
  row: AppointmentResponseTokenRow;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function generateRawAppointmentResponseToken(): string {
  return generateRawToken();
}

export function hashAppointmentResponseToken(rawToken: string): string {
  return hashToken(rawToken);
}

export function buildAppointmentResponseUrl(rawToken: string): string {
  return buildPublicTokenUrl('appointment-response', rawToken);
}

// ---------------------------------------------------------------------------
// createAppointmentResponseToken
// ---------------------------------------------------------------------------

export async function createAppointmentResponseToken(params: {
  businessId: string;
  taskId: string;
  sentChannel?: 'viber' | 'sms' | 'email' | 'manual';
  sentTo?: string | null;
  expiryHours?: number;
}): Promise<CreateAppointmentResponseTokenResult> {
  const supabase = createServiceSupabaseClient();

  const rawToken = generateRawAppointmentResponseToken();
  const tokenHash = hashAppointmentResponseToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000
  ).toISOString();

  const channel = params.sentChannel ?? 'manual';

  const { data, error } = await supabase
    .from('appointment_response_tokens')
    .insert({
      business_id: params.businessId,
      task_id: params.taskId,
      token_hash: tokenHash,
      status: channel !== 'manual' ? 'sent' : 'pending',
      sent_channel: channel,
      sent_to: params.sentTo ?? null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create appointment response token: ${error.message}`);
  }

  return {
    rawToken,
    tokenHash,
    responseUrl: buildAppointmentResponseUrl(rawToken),
    row: data as AppointmentResponseTokenRow,
  };
}

// ---------------------------------------------------------------------------
// markAppointmentResponseTokenSent
// ---------------------------------------------------------------------------

export async function markAppointmentResponseTokenSent(params: {
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'email' | 'manual';
  sentTo?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('appointment_response_tokens')
    .update({
      status: 'sent',
      sent_channel: params.sentChannel,
      sent_to: params.sentTo ?? null,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .in('status', ['pending', 'sent', 'opened']);

  if (error) {
    throw new Error(`Failed to mark appointment response token sent: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// findValidAppointmentResponseToken
// ---------------------------------------------------------------------------

export async function findValidAppointmentResponseToken(
  rawToken: string
): Promise<AppointmentResponseTokenRow | null> {
  const supabase = createServiceSupabaseClient();
  const tokenHash = hashAppointmentResponseToken(rawToken);

  const { data, error } = await supabase
    .from('appointment_response_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', new Date().toISOString())
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find appointment response token: ${error.message}`);
  }

  return data ? (data as AppointmentResponseTokenRow) : null;
}

// ---------------------------------------------------------------------------
// markAppointmentResponseTokenOpened
// ---------------------------------------------------------------------------

export async function markAppointmentResponseTokenOpened(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('appointment_response_tokens')
    .update({
      status: 'opened',
      opened_at: now,
      updated_at: now,
    })
    .eq('id', tokenId)
    .in('status', ['pending', 'sent', 'opened'])
    .is('opened_at', null);

  if (error) {
    throw new Error(`Failed to mark appointment response token opened: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// markAppointmentResponseTokenResponded
// ---------------------------------------------------------------------------

export async function markAppointmentResponseTokenResponded(params: {
  tokenId: string;
  response: AppointmentResponseValue;
  comment?: string | null;
  requestedDueDate?: string | null;
  requestedDueTime?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('appointment_response_tokens')
    .update({
      status: params.response,
      response: params.response,
      response_comment: params.comment ?? null,
      requested_due_date: params.requestedDueDate ?? null,
      requested_due_time: params.requestedDueTime ?? null,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .in('status', ['pending', 'sent', 'opened']);

  if (error) {
    throw new Error(`Failed to mark appointment response token responded: ${error.message}`);
  }
}
