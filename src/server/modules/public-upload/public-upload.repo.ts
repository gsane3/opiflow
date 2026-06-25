// Public upload — repository (data access only). Parity-matched to the three
// PUBLIC token routes /api/upload/[token], /complete and /signed-url.
//
// These routes are NOT business-user-authenticated: the businessId/customerId are
// resolved FROM THE VERIFIED upload-token row (findValidUploadToken), and every
// query runs on the SERVICE-ROLE client (createServiceSupabaseClient) with the
// explicit business_id/customer_id taken from that token. There is no tenantDb here
// on purpose — the original routes use the service client with explicit filters.
//
// Token verify / lifecycle marks (findValidUploadToken, markUploadTokenOpened,
// markUploadTokenCompleted, hashUploadToken) and the push send stay in the thin
// route / are injected; this repo only carries the DB reads/writes + Storage call.

import {
  createServiceSupabaseClient,
  buildStoragePath,
  UPLOAD_BUCKET,
} from '../../../lib/server/upload-tokens';

export type RepoContext = {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
};

export interface SessionFileRecord {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'photo' | 'video' | 'other';
}

type DbResult<T> = { data: T | null; error: unknown };

/** Service-client read of a token's status by hash (the GET not-found reason path). */
export async function selectTokenStatusByHash(
  ctx: RepoContext,
  tokenHash: string,
): Promise<{ data: { status: string } | null }> {
  const { data } = await ctx.supabase
    .from('customer_upload_tokens')
    .select('status')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  return { data: (data as { status: string } | null) ?? null };
}

/** Service-client Storage: signed upload URL (bytes never pass through Next.js). */
export async function createSignedUploadUrl(
  ctx: RepoContext,
  params: {
    businessId: string;
    customerId: string;
    uploadTokenId: string;
    filename: string;
  },
): Promise<{ data: { signedUrl: string; path: string; token: string } | null; error: unknown }> {
  const storagePath = buildStoragePath({
    businessId: params.businessId,
    customerId: params.customerId,
    uploadTokenId: params.uploadTokenId,
    filename: params.filename,
  });
  const { data, error } = await ctx.supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUploadUrl(storagePath);
  return { data: (data as { signedUrl: string; path: string; token: string } | null) ?? null, error };
}

/** Service-client insert of ONE upload-session row. Returns the insert error only. */
export async function insertUploadSession(
  ctx: RepoContext,
  values: {
    businessId: string;
    customerId: string;
    uploadTokenId: string;
    files: SessionFileRecord[];
    customerComment: string | null;
    now: string;
  },
): Promise<{ error: unknown }> {
  const { error } = await ctx.supabase.from('customer_upload_sessions').insert({
    business_id: values.businessId,
    customer_id: values.customerId,
    upload_token_id: values.uploadTokenId,
    file_count: values.files.length,
    files: values.files,
    customer_comment: values.customerComment,
    uploaded_at: values.now,
    updated_at: values.now,
  });
  return { error };
}

/** Service-client insert of an INBOUND communication row (the customer's comment). */
export async function insertCommunication(
  ctx: RepoContext,
  values: {
    businessId: string;
    customerId: string;
    channel: 'viber' | 'sms' | 'email';
    summary: string;
  },
): Promise<DbResult<unknown>> {
  const { data, error } = await ctx.supabase.from('communications').insert({
    business_id: values.businessId,
    customer_id: values.customerId,
    channel: values.channel,
    direction: 'inbound',
    status: 'completed',
    phone: null,
    summary: values.summary,
  });
  return { data: data ?? null, error };
}
