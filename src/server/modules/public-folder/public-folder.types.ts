// Public-folder — shared types for the five public /f/[token] portal actions
// (message · offer/accept · payment · upload-link · appointment/respond).
//
// These routes are NOT business-user-authenticated: the raw folder token in the
// URL is the sole credential (hashed + verified by findValidFolderToken, fail
// closed). The token resolves to a business_id + work_folder_id + sent_channel,
// which is the explicit tenant scope every service method applies via `.eq`
// filters on the SERVICE-ROLE client (NOT tenantDb — there is no business user).
//
// The DTO/result shapes the routes serialise verbatim live here so the thin
// route shells and the service share one contract and can't drift.

import type { createServiceSupabaseClient } from '../../../lib/server/intake-tokens';

/**
 * The post-verification context for every public-folder action. Derived from the
 * verified folder token (never from a business user): the service-role client +
 * the token's business_id / work_folder_id / id / sent_channel. Every query is
 * scoped with explicit `.eq('business_id', …)` + `.eq('work_folder_id', …)` so a
 * customer holding one folder's link can only ever act on THAT folder.
 */
export interface PublicFolderContext {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  businessId: string;
  workFolderId: string;
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'email' | 'manual' | null;
}

/** Generic { ok:false } shape: the exact error code + HTTP status the route returns. */
export interface PublicFolderFailure {
  ok: false;
  error: string;
  status: number;
}
