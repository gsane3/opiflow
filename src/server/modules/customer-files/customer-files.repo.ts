// Customer files — repository (data access only). Parity-matched to the four
// /api/customers/[id]/files routes.
//
// Two clients are in play, exactly as in the live routes:
//   - the AUTH-SCOPED service-role client (ctx.supabase) for the customer / session
//     ownership reads — tenant-scoped via tenantDb so the business_id filter can't be
//     forgotten (equivalent to the original `.eq('id', …).eq('business_id', …)`);
//   - a SEPARATE service client (createServiceSupabaseClient) for the upload-token and
//     upload-session rows + the Supabase Storage signed URLs — kept thin (we just call
//     the existing upload-tokens lib). These rows carry an explicit business_id filter
//     in the original, so they stay explicit on the service client (NOT tenantDb).

import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  createServiceSupabaseClient,
  buildStoragePath,
  UPLOAD_BUCKET,
  UPLOAD_TOKEN_EXPIRY_HOURS,
  generateRawUploadToken,
  hashUploadToken,
} from '../../../lib/server/upload-tokens';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface ManualTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
}

export interface FileRecord {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'photo' | 'video' | 'other';
}

export interface InsertedSessionRow {
  id: string;
  file_count: number;
  files: FileRecord[];
  customer_comment: string | null;
  uploaded_at: string;
}

type DbResult<T> = { data: T | null; error: unknown };

/** Auth-scoped customer ownership read. Returns { data, error } unchanged. */
export async function selectCustomer(
  ctx: RepoContext,
  customerId: string,
): Promise<DbResult<{ id: string }>> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('customers').byId(customerId, 'id').maybeSingle();
  return { data: (data as { id: string } | null) ?? null, error };
}

/** Auth-scoped single upload-session read (selecting `files`). */
export async function selectSessionFiles(
  ctx: RepoContext,
  sessionId: string,
  customerId: string,
): Promise<DbResult<{ files: unknown }>> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customer_upload_sessions')
    .select('files')
    .eq('id', sessionId)
    .eq('customer_id', customerId)
    .maybeSingle();
  return { data: (data as unknown as { files: unknown } | null) ?? null, error };
}

/** Auth-scoped batch upload-session read (selecting `id, files`). */
export async function selectSessionsFiles(
  ctx: RepoContext,
  sessionIds: string[],
  customerId: string,
): Promise<DbResult<Array<{ id: string; files: unknown }>>> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customer_upload_sessions')
    .select('id, files')
    .in('id', sessionIds)
    .eq('customer_id', customerId);
  return { data: (data as unknown as Array<{ id: string; files: unknown }> | null) ?? null, error };
}

/** Service-client read of an upload token scoped to this business + customer. */
export async function selectUploadToken(
  businessId: string,
  customerId: string,
  uploadTokenId: string,
): Promise<DbResult<ManualTokenRow>> {
  const serviceClient = createServiceSupabaseClient();
  const { data, error } = await serviceClient
    .from('customer_upload_tokens')
    .select('id, business_id, customer_id')
    .eq('id', uploadTokenId)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle();
  return { data: (data as unknown as ManualTokenRow | null) ?? null, error };
}

/** Service-client creation of a manual (sent_channel='manual') upload token. */
export async function createManualToken(
  businessId: string,
  customerId: string,
  now: string,
): Promise<DbResult<ManualTokenRow>> {
  const serviceClient = createServiceSupabaseClient();
  const rawToken = generateRawUploadToken();
  const tokenHash = hashUploadToken(rawToken);
  const expiresAt = new Date(
    Date.now() + UPLOAD_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await serviceClient
    .from('customer_upload_tokens')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      token_hash: tokenHash,
      status: 'opened',
      sent_channel: 'manual',
      sent_to_phone: null,
      expires_at: expiresAt,
      updated_at: now,
    })
    .select('id, business_id, customer_id')
    .single();
  return { data: (data as unknown as ManualTokenRow | null) ?? null, error };
}

/** Service-client insert of ONE upload-session row, selecting back the read fields. */
export async function insertSession(
  businessId: string,
  customerId: string,
  uploadTokenId: string,
  files: FileRecord[],
  comment: string | null,
  now: string,
): Promise<DbResult<InsertedSessionRow>> {
  const serviceClient = createServiceSupabaseClient();
  const { data, error } = await serviceClient
    .from('customer_upload_sessions')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      upload_token_id: uploadTokenId,
      file_count: files.length,
      files,
      customer_comment: comment,
      uploaded_at: now,
      updated_at: now,
    })
    .select('id, file_count, files, customer_comment, uploaded_at')
    .single();
  return { data: (data as unknown as InsertedSessionRow | null) ?? null, error };
}

/** Service-client Storage: signed upload URL (bytes never pass through Next.js). */
export async function createSignedUploadUrl(
  token: ManualTokenRow,
  filename: string,
): Promise<{ data: { signedUrl: string; path: string; token: string } | null; error: unknown }> {
  const serviceClient = createServiceSupabaseClient();
  const storagePath = buildStoragePath({
    businessId: token.business_id,
    customerId: token.customer_id,
    uploadTokenId: token.id,
    filename,
  });
  const { data, error } = await serviceClient.storage
    .from(UPLOAD_BUCKET)
    .createSignedUploadUrl(storagePath);
  return { data: (data as { signedUrl: string; path: string; token: string } | null) ?? null, error };
}

/** Auth-scoped Storage: one signed view URL (300s). */
export async function createSignedViewUrl(
  ctx: RepoContext,
  path: string,
  ttlSeconds: number,
): Promise<{ data: { signedUrl: string } | null; error: unknown }> {
  const { data, error } = await ctx.supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  return { data: (data as { signedUrl: string } | null) ?? null, error };
}

/** Auth-scoped Storage: batch signed view URLs. */
export async function createSignedViewUrls(
  ctx: RepoContext,
  paths: string[],
  ttlSeconds: number,
): Promise<{ data: Array<{ signedUrl: string | null }> | null; error: unknown }> {
  const { data, error } = await ctx.supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrls(paths, ttlSeconds);
  return { data: (data as Array<{ signedUrl: string | null }> | null) ?? null, error };
}
