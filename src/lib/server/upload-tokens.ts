import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Raw public token is never stored. Only the SHA-256 hex hash is written to DB.
// Public upload pages must call server API routes; they must not query
// Supabase directly with the anon key.

const TOKEN_BYTES = 32;
export const UPLOAD_TOKEN_EXPIRY_HOURS = 72;

interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadTokenStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'completed'
  | 'expired'
  | 'revoked';

export interface UploadTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
  token_hash: string;
  status: UploadTokenStatus;
  sent_channel: 'viber' | 'sms' | 'manual' | null;
  sent_to_phone: string | null;
  expires_at: string;
  opened_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUploadTokenResult {
  rawToken: string;
  tokenHash: string;
  uploadUrl: string;
  row: UploadTokenRow;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireServerEnv(): ServerEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase server env');
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
}

export function createServiceSupabaseClient() {
  const env = requireServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getPublicAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (appUrl) {
    return appUrl.replace(/\/$/, '');
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function generateRawUploadToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashUploadToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function buildUploadUrl(rawToken: string): string {
  return `${getPublicAppUrl()}/upload/${encodeURIComponent(rawToken)}`;
}

export async function createCustomerUploadToken(params: {
  businessId: string;
  customerId: string;
  sentChannel?: 'viber' | 'sms' | 'manual' | null;
  sentToPhone?: string | null;
  expiryHours?: number;
}): Promise<CreateUploadTokenResult> {
  const supabase = createServiceSupabaseClient();

  const rawToken = generateRawUploadToken();
  const tokenHash = hashUploadToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiryHours ?? UPLOAD_TOKEN_EXPIRY_HOURS) * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from('customer_upload_tokens')
    .insert({
      business_id: params.businessId,
      customer_id: params.customerId,
      token_hash: tokenHash,
      status: 'pending',
      sent_channel: params.sentChannel ?? null,
      sent_to_phone: params.sentToPhone ?? null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create upload token: ${error.message}`);
  }

  return {
    rawToken,
    tokenHash,
    uploadUrl: buildUploadUrl(rawToken),
    row: data as UploadTokenRow,
  };
}

export async function findValidUploadToken(rawToken: string): Promise<UploadTokenRow | null> {
  const supabase = createServiceSupabaseClient();
  const tokenHash = hashUploadToken(rawToken);

  const { data, error } = await supabase
    .from('customer_upload_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find upload token: ${error.message}`);
  }

  return data ? (data as UploadTokenRow) : null;
}

export async function markUploadTokenOpened(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_upload_tokens')
    .update({
      status: 'opened',
      opened_at: now,
      updated_at: now,
    })
    .eq('id', tokenId)
    .in('status', ['pending', 'sent', 'opened']);

  if (error) {
    throw new Error(`Failed to mark upload token opened: ${error.message}`);
  }
}

export async function markUploadTokenSent(params: {
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'manual';
  sentToPhone?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_upload_tokens')
    .update({
      status: 'sent',
      sent_channel: params.sentChannel,
      sent_to_phone: params.sentToPhone ?? null,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .in('status', ['pending', 'sent']);

  if (error) {
    throw new Error(`Failed to mark upload token sent: ${error.message}`);
  }
}

export async function revokePendingCustomerUploadTokens(params: {
  businessId: string;
  customerId: string;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_upload_tokens')
    .update({ status: 'revoked', revoked_at: now, updated_at: now })
    .eq('business_id', params.businessId)
    .eq('customer_id', params.customerId)
    .in('status', ['pending', 'sent', 'opened'])
    .is('revoked_at', null);

  if (error) {
    throw new Error(`Failed to revoke upload tokens: ${error.message}`);
  }
}
