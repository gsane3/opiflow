// Account (GDPR erasure) — service (cascade orchestration). Parity-matched to
// POST /api/account/delete.
//
// GDPR erasure: delete the caller's customer-uploaded media + all business data,
// then the auth user. Most relational tables ON DELETE CASCADE from businesses,
// so deleting the business row removes them; the explicit per-table pass is a
// belt-and-suspenders for any without a cascade. The authoritative deletes
// (businesses, auth user) are FAIL-LOUD.
//
// The owner gate, rate limit, audit events and structured logs are orchestration/
// observability the thin route owns (they need env / a real client); this service
// holds only the storage + DB cascade. It returns a discriminated result the route
// maps to the EXACT same responses (key order + extra fields preserved), and takes
// optional side-effect hooks (injected by the route) fired at the same points the
// live route logged a warn / recorded the failure audit event.

import { UPLOAD_BUCKET } from '../../../lib/server/upload-tokens';
import {
  deleteAuthUser,
  deleteBusinessRow,
  deleteCascadeTables,
  purgeBusinessStorage,
  type RepoContext,
} from './account.repo';

export type DeleteAccountResult =
  | { kind: 'ok'; storageRemoved: number; storagePurgeIncomplete: boolean }
  | { kind: 'business_failed' }
  | { kind: 'auth_failed' };

export interface DeleteAccountDeps {
  /** Fired (best-effort) when the storage purge could not remove every object. */
  onStoragePurgeIncomplete?: (info: { removed: number }) => void;
}

export async function deleteAccount(
  ctx: RepoContext,
  deps: DeleteAccountDeps = {},
): Promise<DeleteAccountResult> {
  // 1) Purge uploaded customer media from Storage (not covered by FK cascade).
  const storage = await purgeBusinessStorage(ctx.supabase, UPLOAD_BUCKET, ctx.businessId);
  if (storage.failed) {
    deps.onStoragePurgeIncomplete?.({ removed: storage.removed });
  }

  // 2) Child rows first (most also cascade from businesses; explicit for safety).
  await deleteCascadeTables(ctx);

  // 3) Authoritative delete of the business row (cascades the rest). FAIL-LOUD.
  const businessOk = await deleteBusinessRow(ctx);
  if (!businessOk) {
    return { kind: 'business_failed' };
  }

  // 4) Delete the auth user last (after their data is gone). FAIL-LOUD.
  const authOk = await deleteAuthUser(ctx);
  if (!authOk) {
    return { kind: 'auth_failed' };
  }

  return {
    kind: 'ok',
    storageRemoved: storage.removed,
    storagePurgeIncomplete: storage.failed,
  };
}
