// Public work-folder (Έργο) link tokens (WF-2).
//
// Mirrors the upload/intake token pattern: the raw token is NEVER stored — only
// its SHA-256 hex hash. The token is FOLDER-scoped (business_id + work_folder_id;
// the customer is derived from work_folders.customer_id), so one public link maps
// to exactly one job. Public /f/[token] access goes through service-role server
// code only; the token never carries business auth.
//
// Reuses createServiceSupabaseClient + getPublicAppUrl from intake-tokens (the
// shared service client + public-origin helper) so only the folder-specific
// crypto/url/CRUD lives here. Requires migration 046 (customer_folder_tokens).

import crypto from 'node:crypto';
import { createServiceSupabaseClient, getPublicAppUrl } from './intake-tokens';

const TOKEN_BYTES = 32;
// A job folder lives for weeks, so the link defaults to a longer 30-day window.
const DEFAULT_EXPIRY_HOURS = 720;

export type FolderTokenStatus = 'pending' | 'sent' | 'opened' | 'expired' | 'revoked';

export interface FolderTokenRow {
  id: string;
  business_id: string;
  work_folder_id: string;
  token_hash: string;
  status: FolderTokenStatus;
  sent_channel: 'viber' | 'sms' | 'email' | 'manual' | null;
  sent_to_phone: string | null;
  expires_at: string;
  opened_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFolderTokenResult {
  rawToken: string;
  tokenHash: string;
  folderUrl: string;
  row: FolderTokenRow;
}

export function generateRawFolderToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashFolderToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function buildFolderUrl(rawToken: string): string {
  return `${getPublicAppUrl()}/f/${encodeURIComponent(rawToken)}`;
}

/** Extract the raw token from a /f/{rawToken} URL (for send-mode verification). */
export function extractRawTokenFromFolderUrl(folderUrl: string): string | null {
  try {
    const url = new URL(folderUrl);
    const last = url.pathname.split('/').pop();
    if (!last) return null;
    const raw = decodeURIComponent(last);
    return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function createCustomerFolderToken(params: {
  businessId: string;
  workFolderId: string;
  sentChannel?: 'viber' | 'sms' | 'email' | 'manual' | null;
  sentToPhone?: string | null;
  expiryHours?: number;
}): Promise<CreateFolderTokenResult> {
  const supabase = createServiceSupabaseClient();

  const rawToken = generateRawFolderToken();
  const tokenHash = hashFolderToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('customer_folder_tokens')
    .insert({
      business_id: params.businessId,
      work_folder_id: params.workFolderId,
      token_hash: tokenHash,
      status: params.sentChannel ? 'sent' : 'pending',
      sent_channel: params.sentChannel ?? null,
      sent_to_phone: params.sentToPhone ?? null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create folder token: ${error.message}`);
  }

  return { rawToken, tokenHash, folderUrl: buildFolderUrl(rawToken), row: data as FolderTokenRow };
}

/** Resolve a raw token to a live folder token (pending/sent/opened, not expired/revoked). */
export async function findValidFolderToken(rawToken: string): Promise<FolderTokenRow | null> {
  const supabase = createServiceSupabaseClient();
  const tokenHash = hashFolderToken(rawToken);

  const { data, error } = await supabase
    .from('customer_folder_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', new Date().toISOString())
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find folder token: ${error.message}`);
  }
  return data ? (data as FolderTokenRow) : null;
}

export async function markFolderTokenOpened(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('customer_folder_tokens')
    .update({ status: 'opened', opened_at: now, updated_at: now })
    .eq('id', tokenId)
    .in('status', ['pending', 'sent', 'opened']);
  if (error) {
    throw new Error(`Failed to mark folder token opened: ${error.message}`);
  }
}

export async function markFolderTokenSent(params: {
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'email' | 'manual';
  sentToPhone?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('customer_folder_tokens')
    .update({
      status: 'sent',
      sent_channel: params.sentChannel,
      sent_to_phone: params.sentToPhone ?? null,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .in('status', ['pending', 'sent', 'opened']);
  if (error) {
    throw new Error(`Failed to mark folder token sent: ${error.message}`);
  }
}

export async function revokePendingFolderTokens(params: {
  businessId: string;
  workFolderId: string;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('customer_folder_tokens')
    .update({ status: 'revoked', revoked_at: now, updated_at: now })
    .eq('business_id', params.businessId)
    .eq('work_folder_id', params.workFolderId)
    .in('status', ['pending', 'sent', 'opened'])
    .is('revoked_at', null);
  if (error) {
    throw new Error(`Failed to revoke folder tokens: ${error.message}`);
  }
}
